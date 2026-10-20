/**
 * 과거 배포판에서 **범주 열이 든** `.mlpx` 골든을 짓고 답을 적는 생성기
 * (`tests/fixtures/legacy-categorical/README.md`).
 *
 * `legacy-generate.mjs`의 짝이다 — 그 골든은 붓꽃이라 수치 열뿐이어서 범주 인코딩 경로(v1 범주 열을 실험의 공통
 * 인코딩으로 채우기, v2의 열별 인코딩·지정 순서)를 못 문다. `generate.sh`가 `LEGACY_GENERATOR`로 이 파일을 골라
 * 태그마다 꺼낸 트리의 `tests/`에 복사해 **그 태그의 코드로** 돌린다. 상대 경로는 그 자리 기준이다.
 *
 * 둘을 한다. 둘 다 **쓴 파일을 그 태그의 `readProject`로 다시 열어** 답한다.
 *
 * - `LEGACY_ZOO`(CSV 경로)가 있으면 zoo 데이터로 프로젝트를 짓는다. 열별 인코딩이 있는 판(`resolveColumnPreprocessing`)
 *   이면 공통값과 다른 열·지정 순서·`none` 열을 섞은 실험 둘을, 없는 판이면 공통 서수·공통 원-핫 실험 둘을 짓는다.
 * - `LEGACY_REAL`(디렉터리)이 있으면 그 안의 `.mlpx`를 **그대로 두고** 답만 적는다 — 학생이 그 판으로 만든 실제 파일이다.
 *
 * JS로 쓰는 이유는 `legacy-generate.mjs`와 같다.
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { it } from 'vitest'

import * as algorithms from '../src/ml/algorithms'
import * as experimentModule from '../src/ml/experiment'
import * as models from '../src/ml/models'
import * as predict from '../src/ml/predict'
import * as preprocess from '../src/ml/preprocess'
import * as trainingSource from '../src/ml/training-source'
import * as tableModule from '../src/data/table'
import * as attach from '../src/project/attach'
import * as create from '../src/project/create'
import * as datasetModule from '../src/project/dataset'
import * as format from '../src/project/format'
import * as settings from '../src/project/settings'

const OUT = process.env.LEGACY_OUT ?? ''
const TAG = process.env.LEGACY_TAG ?? 'unknown'
const ZOO = process.env.LEGACY_ZOO ?? ''
const REAL = process.env.LEGACY_REAL ?? ''
const NOW = '2026-10-20T09:00:00.000Z'
const SEED = {
  projectId: '6f1c2a4e-0b7d-4c55-9a3e-2d8f1e7b9c01',
  createdAt: '2026-10-20T08:00:00.000Z',
  randomState: 42,
}
/** 훈련에 없던 범주. 원-핫은 모두 0, 서수는 −1이 되는지 본다. */
const UNSEEN = '처음 보는 값'
const QUERIES = 200

/** 질의를 짓는 결정적 난수(mulberry32). `legacy-generate.mjs`와 같은 식이다. */
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(text) {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0
  return hash
}

// ── 답 ───────────────────────────────────────────────────────────────────────

function preprocessorsOf(project) {
  return predict.readPreprocessors(project.document, project.models)
}

function needsRows(formatId) {
  return models.interpreterFor?.(formatId)?.needsTrainingRows === true
}

/** `legacy-generate.mjs`의 `answersOf`와 같다. 열쇠는 `실험/run/알고리즘`. */
function answersOf(project, queries) {
  const dataset = datasetModule.readDataset(project)
  const preprocessors = preprocessorsOf(project)
  const answers = {}
  const probabilities = {}
  for (const experiment of project.document.runs.experiments) {
    const preprocessor = preprocessors.get(experiment.id)
    for (const run of experiment.runs) {
      const key = `${experiment.id}/${run.id}/${run.algorithm}`
      if (!run.model) {
        answers[key] = { omitted: run.modelOmitted ?? null }
        continue
      }
      const bytes = project.models.get(run.model.path)
      if (!bytes || !preprocessor) {
        answers[key] = { error: 'NO_BYTES_OR_PREPROCESSOR' }
        continue
      }
      const payload = JSON.parse(new TextDecoder().decode(bytes))
      try {
        const context = needsRows(run.model.format)
          ? { trainingRows: predict.trainingRowsFor(experiment, preprocessor, dataset) }
          : {}
        // 0.36.0부터 `inputVector(preprocessor, values)`다 — 인자 수로 가른다(`legacy-generate.mjs`와 같다).
        const features = queries.map((values) =>
          predict.inputVector.length >= 3
            ? predict.inputVector(experiment, preprocessor, values)
            : predict.inputVector(preprocessor, values),
        )
        answers[key] = models.loadModel(payload, context)(features)
        const proba = models.loadModelProba?.(payload, context)
        if (proba) {
          probabilities[key] = {
            classes: [...proba.classes],
            values: proba.predict(features).map((row) => Array.from(row)),
          }
        }
      } catch (error) {
        answers[key] = { error: error?.code ?? String(error) }
      }
    }
  }
  return { answers, probabilities }
}

/**
 * 질의. **데이터에 있는 값을 열마다 따로 뽑아 섞는다** — 있던 행만 물으면 인코딩 번호가 틀어져도 트리·KNN이 같은
 * 답을 낼 수 있다. 범주 열은 열에 하나꼴로 훈련에 없던 값을 넣는다. 특성은 실험마다 달라도 되게 모든 열을 적는다.
 */
function queriesOf(project, name) {
  const dataset = datasetModule.readDataset(project)
  const next = random(seedOf(name))
  const values = dataset.columns.map((_, column) => [
    ...new Set(dataset.rows.map((row) => row[column]).filter((value) => value !== '')),
  ])
  const numeric = values.map((column) => column.every((value) => Number.isFinite(Number(value))))
  return Array.from({ length: QUERIES }, () =>
    Object.fromEntries(
      dataset.columns.map((name, column) => {
        const seen = values[column]
        if (!numeric[column] && next() < 0.1) return [name, UNSEEN]
        return [name, seen[Math.floor(next() * seen.length)] ?? '']
      }),
    ),
  )
}

async function recordOf(bytes, name) {
  const { project } = await format.readProject(bytes)
  const queries = queriesOf(project, name)
  return {
    formatVersion: project.document.manifest.formatVersion,
    queries,
    ...answersOf(project, queries),
  }
}

// ── zoo ──────────────────────────────────────────────────────────────────────

const TARGET = 'type'
const NOT_FEATURES = new Set(['animal_name', TARGET])

function mljsAlgorithms(taskType) {
  return algorithms.ALGORITHMS.filter(
    (one) =>
      one.dataTypes?.tabular !== false &&
      one.taskTypes?.[taskType] === true &&
      one.runtimes?.mljs === true,
  ).map((one) => one.id)
}

async function train(project) {
  const source = await trainingSource.trainingSourceOf({ project, taskType: 'classification' })
  const result = await experimentModule.runExperiment(
    {
      dataset: source.dataset,
      testDataset: source.testDataset,
      taskType: 'classification',
      dataType: 'tabular',
      settings: source.settings,
      context: {
        serverStatus: 'unavailable',
        limitsOff: false,
        rowCount: source.dataset.rows.length,
        dataType: 'tabular',
      },
      snapshot: source.snapshot,
    },
    { now: () => NOW, history: source.project.document.runs },
  )
  return attach.applyExperiment(source.project, result, NOW)
}

/**
 * 실험마다의 전처리. **열별 인코딩이 있는 판**이면 공통값과 다른 열, 공통값과 같은 덮어쓰기, 지정 순서(정렬과
 * 다른 순서), `none`으로 뺀 열을 섞는다. 없는 판이면 공통 서수·공통 원-핫이다.
 */
function preprocessings() {
  if (typeof preprocess.resolveColumnPreprocessing !== 'function') {
    return [
      { missing: 'drop', scaling: 'minmax', categoricalEncoding: 'ordinal' },
      { missing: 'drop', scaling: 'minmax', categoricalEncoding: 'onehot' },
    ]
  }
  return [
    {
      missing: 'drop',
      scaling: 'minmax',
      categoricalEncoding: 'ordinal',
      columns: {
        hair: { categoricalEncoding: 'onehot' },
        eggs: { categories: ['Yes (1)', 'No (0)'] },
        milk: { categoricalEncoding: 'ordinal', categories: ['Yes (1)', 'No (0)'] },
        venomous: { categoricalEncoding: 'none' },
      },
    },
    {
      missing: 'drop',
      scaling: 'minmax',
      categoricalEncoding: 'onehot',
      columns: {
        feathers: { categoricalEncoding: 'ordinal', categories: ['Yes (1)', 'No (0)'] },
        aquatic: { categoricalEncoding: 'ordinal' },
        // 서수가 아니라 무시되는 순서 — 저장은 남고 학습은 공통 원-핫이다(결정 116 규칙 9).
        fins: { categories: ['Yes (1)', 'No (0)'] },
      },
    },
  ]
}

async function zooProject() {
  const opened = await tableModule.openTable(new Uint8Array(readFileSync(ZOO)), 'zoo.csv', {
    locale: 'ko',
  })
  const imported = tableModule.importTable(opened)
  const document = create.newProjectDocument(
    { name: 'legacy categorical', locale: 'ko', dataType: 'tabular' },
    SEED,
  )
  const empty = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  const applied = datasetModule.applyDataset(empty, imported, {
    fileName: 'zoo.csv',
    hasHeader: true,
    now: NOW,
  })
  let project = applied.project ?? applied
  const features = datasetModule
    .readDataset(project)
    .columns.filter((name) => !NOT_FEATURES.has(name))
  for (const preprocessing of preprocessings()) {
    let doc = settings.withTaskType(project.document, 'classification', NOW)
    doc = settings.withTarget(doc, TARGET, NOW)
    doc = settings.withFeatures(doc, features, NOW)
    doc = settings.withPreprocessing(doc, preprocessing, NOW)
    // 유형 중 넷 이하인 무리가 있어 층화를 끈다.
    doc = settings.withSplit(doc, { stratify: false }, NOW)
    doc = settings.withSelectedAlgorithms(
      doc,
      mljsAlgorithms('classification').map((algorithm) => ({ algorithm, runtime: 'mljs' })),
      NOW,
    )
    project = await train({ ...project, document: doc })
  }
  const written = await format.writeProject(project, '# legacy categorical fixture\n')
  return new Uint8Array(await written.blob.arrayBuffer())
}

// ── 생성 ─────────────────────────────────────────────────────────────────────

it('legacy categorical .mlpx fixtures', { timeout: 600_000 }, async () => {
  if (OUT === '') throw new Error('set LEGACY_OUT')
  mkdirSync(OUT, { recursive: true })
  const files = {}
  if (ZOO !== '') {
    const bytes = await zooProject()
    writeFileSync(join(OUT, 'zoo.mlpx'), bytes)
    files['zoo.mlpx'] = await recordOf(bytes, 'zoo.mlpx')
  }
  if (REAL !== '') {
    for (const name of readdirSync(REAL).filter((one) => one.endsWith('.mlpx'))) {
      const path = join(REAL, name)
      copyFileSync(path, join(OUT, basename(path)))
      files[name] = await recordOf(new Uint8Array(readFileSync(path)), name)
    }
  }
  if (Object.keys(files).length === 0) throw new Error('set LEGACY_ZOO or LEGACY_REAL')
  writeFileSync(join(OUT, 'answers.json'), `${JSON.stringify({ tag: TAG, files })}\n`)
})
