/**
 * **열마다의 인코딩을 쓴 실험이 `.mlpx`로 나갔다 들어와도 같은 답을 낸다** (open-decisions.md 116, `CLAUDE.md` §4의
 * "`.mlpx` 왕복 무손실").
 *
 * 0.36.0 골든(`fixtures/legacy/0.36.0`)은 붓꽃이라 수치 열뿐이다 — `preprocessing.columns`도 범주 열의 전처리기 v2
 * 칸(`encoding`·`orderSpecified`)도 안 담긴다. 그 빈자리를 여기서 채운다: 앱의 진짜 입구(`runExperiment` →
 * `applyExperiment`)로 학습해 프로젝트에 앉히고, `.mlpx`로 써서 다시 읽고, 같은 질의에 같은 답을 내는지 본다.
 */

import { describe, expect, it } from 'vitest'

import { writeProjectBytes } from './fixtures/write'

import type { RuntimeContext } from '../src/ml/backend'
import { runExperiment } from '../src/ml/experiment'
import { loadModel } from '../src/ml/models'
import { experimentPreprocessor, type Dataset } from '../src/ml/preprocess'
import { inputVector } from '../src/ml/predict'
import { applyExperiment } from '../src/project/attach'
import { newProjectDocument } from '../src/project/create'
import { readProject, type ProjectFile } from '../src/project/format'
import { dataSnapshot, type Preprocessing, type Settings } from '../src/project/schema'

const GRADES = ['하', '중', '상']
const REGIONS = ['서울', '부산', '대구']

const train: Dataset = {
  columns: ['grade', 'region', 'hours', 'level'],
  rows: Array.from({ length: 30 }, (_v, i) => {
    const grade = GRADES[i % 3] ?? '하'
    const region = REGIONS[(i * 2) % 3] ?? '서울'
    const hours = 1 + ((i * 7) % 10)
    const score = 10 * GRADES.indexOf(grade) + hours + (region === '서울' ? 3 : 0)
    return [grade, region, String(hours), score >= 15 ? 'pass' : 'fail']
  }),
}

/** 등급은 지정한 순서(하 < 중 < 상)의 순서 인코딩, 지역은 공통값(원-핫). */
const PREPROCESSING: Preprocessing = {
  missing: 'drop',
  scaling: 'standard',
  categoricalEncoding: 'onehot',
  columns: { grade: { categoricalEncoding: 'ordinal', categories: GRADES } },
}

const CONTEXT: RuntimeContext = {
  serverStatus: 'unavailable',
  limitsOff: false,
  rowCount: train.rows.length,
  dataType: 'tabular',
}

const QUERIES = [
  { grade: '상', region: '부산', hours: '4' },
  { grade: '하', region: '서울', hours: '9' },
  { grade: '중', region: '대구', hours: '2' },
  // 처음 보는 값 — 순서 인코딩은 −1, 원-핫은 전부 0이어야 한다.
  { grade: '최상', region: '제주', hours: '5' },
]

async function trainedProject(): Promise<ProjectFile> {
  const document = newProjectDocument(
    { name: '열별 인코딩', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440045',
      createdAt: '2026-10-20T00:00:00Z',
      randomState: 42,
    },
  )
  const settings: Settings = {
    ...document.settings,
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [
      { algorithm: 'logistic_regression' },
      { algorithm: 'naive_bayes' },
      { algorithm: 'decision_tree' },
    ],
    hyperparameters: {},
    data: { features: ['grade', 'region', 'hours'], target: 'level', preprocessing: PREPROCESSING },
  }
  const result = await runExperiment(
    {
      dataset: train,
      testDataset: null,
      taskType: 'classification',
      dataType: 'tabular',
      settings,
      context: CONTEXT,
      snapshot: dataSnapshot('tabular', settings),
    },
    { now: () => '2026-10-20T00:00:00.000Z' },
  )
  const empty: ProjectFile = {
    document: { ...document, settings },
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return applyExperiment(empty, result, '2026-10-20T00:00:01.000Z')
}

/** 실험마다 run마다, 같은 질의에 낸 답. 파일에서 읽은 전처리기와 모델로 낸다. */
function answersOf(project: ProjectFile): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const experiment of project.document.runs.experiments) {
    const preprocessor = experimentPreprocessor(experiment, project.models)
    if (preprocessor === null) throw new Error(`${experiment.id}: preprocessor unreadable`)
    for (const run of experiment.runs) {
      const bytes = run.model ? project.models.get(run.model.path) : undefined
      if (bytes === undefined) throw new Error(`${run.id}: model missing`)
      const predict = loadModel(JSON.parse(new TextDecoder().decode(bytes)))
      out[`${experiment.id}/${run.algorithm}`] = predict(
        QUERIES.map((values) => inputVector(preprocessor, values)),
      )
    }
  }
  return out
}

describe('열별 인코딩 · .mlpx 왕복', () => {
  it('설정·전처리기·모델이 그대로 돌아오고 같은 질의에 같은 답을 낸다', async () => {
    const project = await trainedProject()
    const before = answersOf(project)
    expect(Object.keys(before)).toHaveLength(3)

    const { bytes } = await writeProjectBytes(project, '# 열별 인코딩\n')
    const reopened = (await readProject(bytes)).project

    // 문서 — 열마다의 덮어쓰기가 살아남는다.
    expect(reopened.document.manifest.formatVersion).toBe(5)
    expect(reopened.document.settings).toEqual(project.document.settings)
    expect(reopened.document.runs).toEqual(project.document.runs)

    // 전처리기 — v2이고, 범주 열마다 인코딩과 지정 여부를 든다.
    const experiment = reopened.document.runs.experiments[0]
    expect(experiment?.preprocessor?.format).toBe('mlpx-preprocess-v2')
    const preprocessor = experiment ? experimentPreprocessor(experiment, reopened.models) : null
    expect(preprocessor?.columns.filter((column) => column.kind === 'categorical')).toEqual([
      {
        name: 'grade',
        kind: 'categorical',
        categories: GRADES,
        encoding: 'ordinal',
        orderSpecified: true,
      },
      {
        name: 'region',
        kind: 'categorical',
        categories: ['대구', '부산', '서울'],
        encoding: 'onehot',
        orderSpecified: false,
      },
    ])

    // 답 — 쓰기 전과 읽은 뒤가 같다. 처음 보는 값의 질의까지.
    expect(answersOf(reopened)).toEqual(before)
  })
})
