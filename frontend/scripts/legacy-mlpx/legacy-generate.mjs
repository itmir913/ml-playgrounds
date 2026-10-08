/**
 * 과거 배포판에서 `.mlpx` 골든 파일을 짓는 생성기 (`tests/fixtures/legacy/README.md`).
 *
 * **이 저장소의 검사가 아니다.** `generate.sh`가 태그마다 꺼낸 작업 트리의 `tests/`에
 * `zz-legacy-generate.spec.ts`라는 이름으로 복사해 **그 태그의 코드로** vitest가 돌린다. 그래서
 * 상대 경로(`../src/...`)는 그 자리 기준이다.
 *
 * **JS로 쓴다.** 태그마다 API의 모양이 조금씩 달라 타입을 붙일 수 없고, 이 저장소는 `any`를 금지한다.
 * 타입 없는 JS는 TS 문법으로도 맞으므로 `.spec.ts`로 복사해도 그대로 돈다.
 *
 * 진짜 입구를 지난다: CSV → `openTable` → `importTable` → `applyDataset` → 설정 문 →
 * `trainingSourceOf` → `runExperiment`(mljs) → `applyExperiment` → `writeProject`.
 * 사진은 `addImages`로 앉히고 임베딩은 `addEmbeddings`로 붙인다 — 백본은 안 돌린다.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { it } from 'vitest'

import * as algorithms from '../src/ml/algorithms'
import * as backbones from '../src/ml/backbones'
import * as experimentModule from '../src/ml/experiment'
import * as images from '../src/ml/images'
import * as models from '../src/ml/models'
import * as predict from '../src/ml/predict'
import * as preprocess from '../src/ml/preprocess'
import * as trainingSource from '../src/ml/training-source'
import * as tableModule from '../src/data/table'
import * as attach from '../src/project/attach'
import * as create from '../src/project/create'
import * as datasetModule from '../src/project/dataset'
import * as embeddings from '../src/project/embeddings'
import * as format from '../src/project/format'
import * as imageProject from '../src/project/images'
import * as settings from '../src/project/settings'
import * as hash from '../src/hash'

const OUT = process.env.LEGACY_OUT ?? ''
const TAG = process.env.LEGACY_TAG ?? 'unknown'
const NOW = '2026-10-08T09:00:00.000Z'
const SEED = {
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  createdAt: '2026-10-08T08:00:00.000Z',
  randomState: 42,
}

/** 질의를 짓는 결정적 난수(mulberry32). 태그마다 같은 질의가 나와야 한다. */
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

// ── 표 데이터 ─────────────────────────────────────────────────────────────────

const TABLE_COLUMNS = ['sepal_length', 'sepal_width', 'petal_length', 'petal_width', 'species']
const TABLE_ROWS = [
  [5.1, 3.5, 1.4, 0.2, 'setosa'],
  [4.9, 3.0, 1.4, 0.2, 'setosa'],
  [4.7, 3.2, 1.3, 0.2, 'setosa'],
  [4.6, 3.1, 1.5, 0.2, 'setosa'],
  [5.0, 3.6, 1.4, 0.2, 'setosa'],
  [5.4, 3.9, 1.7, 0.4, 'setosa'],
  [4.6, 3.4, 1.4, 0.3, 'setosa'],
  [5.0, 3.4, 1.5, 0.2, 'setosa'],
  [4.4, 2.9, 1.4, 0.2, 'setosa'],
  [4.9, 3.1, 1.5, 0.1, 'setosa'],
  [7.0, 3.2, 4.7, 1.4, 'versicolor'],
  [6.4, 3.2, 4.5, 1.5, 'versicolor'],
  [6.9, 3.1, 4.9, 1.5, 'versicolor'],
  [5.5, 2.3, 4.0, 1.3, 'versicolor'],
  [6.5, 2.8, 4.6, 1.5, 'versicolor'],
  [5.7, 2.8, 4.5, 1.3, 'versicolor'],
  [6.3, 3.3, 4.7, 1.6, 'versicolor'],
  [4.9, 2.4, 3.3, 1.0, 'versicolor'],
  [6.6, 2.9, 4.6, 1.3, 'versicolor'],
  [5.2, 2.7, 3.9, 1.4, 'versicolor'],
  [6.3, 3.3, 6.0, 2.5, 'virginica'],
  [5.8, 2.7, 5.1, 1.9, 'virginica'],
  [7.1, 3.0, 5.9, 2.1, 'virginica'],
  [6.3, 2.9, 5.6, 1.8, 'virginica'],
  [6.5, 3.0, 5.8, 2.2, 'virginica'],
  [7.6, 3.0, 6.6, 2.1, 'virginica'],
  [4.9, 2.5, 4.5, 1.7, 'virginica'],
  [7.3, 2.9, 6.3, 1.8, 'virginica'],
  [6.7, 2.5, 5.8, 1.8, 'virginica'],
  [7.2, 3.6, 6.1, 2.5, 'virginica'],
]

/**
 * 표의 질의 200개 — 특성마다 데이터의 범위 안에서 고르게 뽑는다.
 *
 * **많이, 경계까지 묻는다.** 쉬운 점 몇 개만 물었더니 KNN의 거리 공식을 바꿔도 답이 같아 골든이
 * 해석기의 고장을 못 잡았다(돌연변이로 쟀다). 특성 이름 -> 값이고, 학습에 쓴 특성만 골라 쓴다.
 */
function tableQueries() {
  const next = random(20261008)
  const features = TABLE_COLUMNS.slice(0, 4)
  const ranges = features.map((_, column) => {
    const values = TABLE_ROWS.map((row) => row[column])
    return [Math.min(...values), Math.max(...values)]
  })
  return Array.from({ length: 200 }, () =>
    Object.fromEntries(
      features.map((name, column) => {
        const [low, high] = ranges[column]
        return [name, (low + (high - low) * next()).toFixed(1)]
      }),
    ),
  )
}

/** 과제마다 타깃과 특성. 군집에는 타깃이 없다. */
const TABLE_TASKS = [
  { taskType: 'classification', target: 'species', features: TABLE_COLUMNS.slice(0, 4) },
  { taskType: 'regression', target: 'petal_width', features: TABLE_COLUMNS.slice(0, 3) },
  { taskType: 'clustering', target: undefined, features: TABLE_COLUMNS.slice(0, 4) },
]

function tableCsv() {
  const lines = [TABLE_COLUMNS.join(','), ...TABLE_ROWS.map((row) => row.join(','))]
  return new TextEncoder().encode(`${lines.join('\r\n')}\r\n`)
}

// ── 공통 ─────────────────────────────────────────────────────────────────────

/** 이 태그에서 그 데이터·과제에 mljs로 학습할 수 있는 알고리즘 전부. */
function mljsAlgorithms(dataType, taskType) {
  return algorithms.ALGORITHMS.filter(
    (one) =>
      one.dataTypes?.[dataType] !== false &&
      one.taskTypes?.[taskType] === true &&
      one.runtimes?.mljs === true,
  ).map((one) => one.id)
}

async function train(project, taskType, dataType) {
  const source = await trainingSource.trainingSourceOf({ project, taskType })
  const result = await experimentModule.runExperiment(
    {
      dataset: source.dataset,
      testDataset: source.testDataset,
      taskType,
      dataType,
      settings: source.settings,
      context: {
        serverStatus: 'unavailable',
        limitsOff: false,
        rowCount: source.dataset.rows.length,
        dataType,
      },
      snapshot: source.snapshot,
    },
    { now: () => NOW, history: source.project.document.runs },
  )
  return attach.applyExperiment(source.project, result, NOW)
}

/** 0.9.0~0.2x는 `bytes`를, 그 뒤는 `blob`을 돌려준다. */
async function writeBytes(project) {
  const written = await format.writeProject(project, '# legacy fixture\n')
  if (written.bytes instanceof Uint8Array) return written.bytes
  return new Uint8Array(await written.blob.arrayBuffer())
}

/** `readPreprocessors`가 없던 판(0.9.0)은 화면이 하던 대로 `parsePreprocessor`로 읽는다. */
function preprocessorsOf(project) {
  if (typeof predict.readPreprocessors === 'function') {
    return predict.readPreprocessors(project.document, project.models)
  }
  const found = new Map()
  for (const experiment of project.document.runs.experiments) {
    const path = experiment.preprocessor?.path
    const bytes = path === undefined ? undefined : project.models.get(path)
    if (!bytes) continue
    found.set(
      experiment.id,
      preprocess.parsePreprocessor(JSON.parse(new TextDecoder().decode(bytes))),
    )
  }
  return found
}

function needsRows(formatId) {
  return models.interpreterFor?.(formatId)?.needsTrainingRows === true
}

/**
 * 모델마다 답과 확률. 열쇠는 `실험/run/알고리즘`. 못 내면 그 코드를 적는다.
 * **확률을 내는 모델은 확률도 적는다** — 라벨만으로는 파라미터가 조금 틀어져도 안 보인다.
 */
function answersOf(project, contextOf, featuresOf) {
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
        const context = needsRows(run.model.format) ? contextOf(experiment, preprocessor) : {}
        const features = featuresOf(experiment, preprocessor)
        answers[key] = models.loadModel(payload, context)(features)
        const proba = models.loadModelProba?.(payload, context)
        // 행이 `Float64Array`라 그대로 `JSON.stringify`하면 `{"0":…}` 객체가 된다 — 배열로 편다.
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

// ── 표 프로젝트 ───────────────────────────────────────────────────────────────

async function tabularProject() {
  const opened = await tableModule.openTable(tableCsv(), 'iris.csv', { locale: 'ko' })
  const imported = tableModule.importTable(opened)
  const document = create.newProjectDocument(
    { name: 'legacy tabular', locale: 'ko', dataType: 'tabular' },
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
    fileName: 'iris.csv',
    hasHeader: true,
    now: NOW,
  })
  let project = applied.project ?? applied
  for (const task of TABLE_TASKS) {
    let doc = settings.withTaskType(project.document, task.taskType, NOW)
    if (task.target !== undefined) doc = settings.withTarget(doc, task.target, NOW)
    doc = settings.withFeatures(doc, [...task.features], NOW)
    // 층화는 범주 타깃에만 뜻이 있다. 0.9.0은 회귀에서 켜 둔 층화를 학습 전에 거부했다
    // (`SPLIT_STRATIFY_TARGET_CONTINUOUS`) — 학생이 끄던 것을 여기서도 끈다.
    doc = settings.withSplit(doc, { stratify: task.taskType === 'classification' }, NOW)
    doc = settings.withSelectedAlgorithms(
      doc,
      mljsAlgorithms('tabular', task.taskType).map((algorithm) => ({ algorithm, runtime: 'mljs' })),
      NOW,
    )
    project = await train({ ...project, document: doc }, task.taskType, 'tabular')
  }
  return project
}

function tabularAnswers(project, queries) {
  const dataset = datasetModule.readDataset?.(project)
  return answersOf(
    project,
    (experiment, preprocessor) => ({
      trainingRows: predict.trainingRowsFor(experiment, preprocessor, dataset),
    }),
    (experiment, preprocessor) =>
      queries.map((values) => predict.inputVector(experiment, preprocessor, values)),
  )
}

// ── 사진 프로젝트 ─────────────────────────────────────────────────────────────

const PER_CATEGORY = 6
/** 신경망 은닉층의 뉴런 수. 기본 100이면 1,280차원 임베딩에서 모델 하나가 2.7MB다. */
const IMAGE_NEURONS = 2

function backbone() {
  const id = backbones.DEFAULT_BACKBONE_ID ?? backbones.BACKBONE_IDS[0]
  return backbones.backboneFor(id)
}

/**
 * 앞 절반 칸은 `weight`, 뒤 절반은 `1 - weight`에 선다 — 개는 1, 고양이는 0. 사진마다 조금씩 다르다.
 * **`tests/legacy-mlpx.spec.ts`가 같은 식으로 질의를 짓는다** — 바꾸면 그쪽도 바꿔라.
 */
function vectorOf(weight, index, dim) {
  const vector = new Float32Array(dim)
  for (let at = 0; at < dim; at += 1) {
    const firstHalf = at < dim / 2
    vector[at] = (firstHalf ? weight : 1 - weight) + ((at * 7 + index * 13) % 17) / 170
  }
  return vector
}

/** 사진 질의 60개 — 두 무리 사이(`weight` 0.35~0.65)에 몰아 둔다. 표의 질의와 같은 이유다. */
function imageQuerySeeds() {
  const next = random(8102026)
  return Array.from({ length: 60 }, (_, index) => ({
    weight: Number((0.35 + 0.3 * next()).toFixed(3)),
    index: 200 + index,
  }))
}

async function imageProjectFile() {
  const spec = backbone()
  const dim = spec.embeddingDim
  const document = create.newProjectDocument(
    { name: 'legacy image', locale: 'ko', dataType: 'image', taskType: 'classification' },
    SEED,
  )
  let project = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  const photos = []
  for (let index = 0; index < PER_CATEGORY * 2; index += 1) {
    const dog = index < PER_CATEGORY
    const bytes = new TextEncoder().encode(`legacy:${dog ? 'dog' : 'cat'}:${index}`)
    photos.push({
      hash: hash.hashBytes(bytes),
      bytes,
      category: dog ? '개' : '고양이',
      vector: vectorOf(dog ? 1 : 0, index, dim),
    })
  }
  const loose = new TextEncoder().encode('legacy:loose')
  photos.push({
    hash: hash.hashBytes(loose),
    bytes: loose,
    category: '_unlabeled',
    vector: vectorOf(1, 50, dim),
  })
  // **두 정본 형식을 섞는다** — 0.9.0부터 webp·jpeg 둘이고, 경로의 확장자가 형식을 말한다.
  // 범주마다 마지막 한 장이 jpeg다.
  const isJpeg = (index) => index === PER_CATEGORY - 1 || index === PER_CATEGORY * 2 - 1
  for (const formatId of ['webp', 'jpeg']) {
    const batch = photos.filter((_, index) => (formatId === 'jpeg') === isJpeg(index))
    const added = imageProject.addImages(
      project,
      batch.map(({ hash: photoHash, bytes, category }) => ({ hash: photoHash, bytes, category })),
      { canonicalSize: spec.canonicalSize, now: NOW, format: formatId },
    )
    project = added.project ?? added
  }
  project = embeddings.addEmbeddings(
    project,
    spec.id,
    new Map(photos.map((one) => [one.hash, one.vector])),
  )
  for (const taskType of ['classification', 'clustering']) {
    let doc = settings.withTaskType(project.document, taskType, NOW)
    const selected = mljsAlgorithms('image', taskType)
    doc = settings.withSelectedAlgorithms(
      doc,
      selected.map((algorithm) => ({ algorithm, runtime: 'mljs' })),
      NOW,
    )
    if (selected.includes('neural_network')) {
      doc = settings.withHyperparameter(
        doc,
        { algorithm: 'neural_network', runtime: 'mljs', name: 'neuronsPerLayer' },
        IMAGE_NEURONS,
        NOW,
      )
    }
    project = await train({ ...project, document: doc }, taskType, 'image')
  }
  return project
}

function imageAnswers(project, seeds) {
  const spec = backbone()
  const dim = spec.embeddingDim
  const vectors = embeddings.readEmbeddings(project, spec.id, dim)
  const queries = {
    columns: images.embeddingColumns(dim),
    rows: seeds.map(({ weight, index }) =>
      Array.from(vectorOf(weight, index, dim), (value) => String(value)),
    ),
  }
  return answersOf(
    project,
    (experiment, preprocessor) => {
      const rows = images.imageTrainingRows(
        project,
        experiment,
        preprocessor,
        spec,
        vectors,
        experiment.settings.taskType,
      )
      return rows ? { trainingRows: rows } : {}
    },
    (_, preprocessor) =>
      preprocess.transform(
        preprocessor,
        queries,
        seeds.map((__, index) => index),
        'onehot',
      ),
  )
}

// ── 생성 ─────────────────────────────────────────────────────────────────────

it('legacy .mlpx fixtures', { timeout: 600_000 }, async () => {
  if (OUT === '') throw new Error('set LEGACY_OUT')
  mkdirSync(OUT, { recursive: true })

  const tabular = await tabularProject()
  const tabularBytes = await writeBytes(tabular)
  // **쓴 파일을 다시 읽어 답한다** — 그 태그가 그 파일을 열면 낸 답이다.
  const tabularReopened = (await format.readProject(tabularBytes)).project
  writeFileSync(join(OUT, 'tabular.mlpx'), tabularBytes)

  const image = await imageProjectFile()
  const imageBytes = await writeBytes(image)
  const imageReopened = (await format.readProject(imageBytes)).project
  writeFileSync(join(OUT, 'image.mlpx'), imageBytes)

  const queries = tableQueries()
  const seeds = imageQuerySeeds()
  const record = {
    tag: TAG,
    formatVersion: tabularReopened.document.manifest.formatVersion,
    tabular: { queries, ...tabularAnswers(tabularReopened, queries) },
    image: { querySeeds: seeds, ...imageAnswers(imageReopened, seeds) },
  }
  writeFileSync(join(OUT, 'answers.json'), `${JSON.stringify(record)}\n`)
})
