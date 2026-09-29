// @vitest-environment jsdom
/**
 * **파일 안에서 스스로 어긋나는 run** (open-decisions.md "재현 판정은 (알고리즘 × 엔진)이 정하고,
 * 못 가르는 자리는 교사에게 넘긴다"의 분류 눈금 문단, 결정문 62의 "대가").
 *
 * 두 결정문이 *"지표만 한 칸 올린 파일은 저장된 정확도와 저장된 혼동 행렬이 서로 안 맞는다 —
 * 재실행 없이 파일 안에서 잡힌다"*고 적었는데, 그 판정(`storedMetricsMatchMatrix`)을 부르는
 * 화면이 없었다. 그래서 대조가 판정을 안 하는 자리 — 사진 프로젝트(대조가 잠긴다), `advisory`
 * 알고리즘, 계산 규칙이 바뀐 옛 파일 — 에서 **정확도만 고친 파일이 아무 표시 없이 지나갔다.**
 *
 * 그리고 판정 자체가 반 칸의 여유를 두고 있었다(`0.5 / total`). 근거로 적힌 *"파일의 정확도는
 * 이미 반올림된 값"*은 거짓이다 — 지표는 반올림하지 않고 저장한다(`ml/metrics.ts` 머리말).
 * 그 여유 안에서 고친 값(시험 10행에서 0.9 → 0.92)은 통과했다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { ALGORITHMS } from '../src/ml/algorithms'
import { supports } from '../src/ml/axes'
import { runExperiment } from '../src/ml/experiment'
import { evaluate } from '../src/ml/metrics'
import { storedMetricsMatchMatrix } from '../src/ml/reproduce'
import { i18n, setLocale } from '../src/i18n'
import { dataSnapshot, type Experiment, type Run, type Settings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

vi.mock('../src/ml/worker/client', () => ({
  train: () => ({ result: new Promise(() => {}), cancel: () => {} }),
  calibrateDevice: () => Promise.resolve(null),
}))
vi.mock('../src/ml/worker/spawn', () => ({ spawnTrainingWorker: () => ({}) }))

const { experiment, run } = await import('./fixtures/project')
const ReproducePanel = (await import('../src/views/inspect/ReproducePanel.vue')).default

/** 시험 10행, 9행을 맞힌 분류 run. 정확도는 앱이 적는 그대로 `9 / 10`이다. */
function honest(id: string, overrides: Partial<Run> = {}): Run {
  return run(id, {
    metrics: { accuracy: 9 / 10, f1Macro: 0.8989898989898989 },
    confusionMatrix: {
      labels: ['setosa', 'versicolor'],
      matrix: [
        [5, 0],
        [1, 4],
      ],
    },
    ...overrides,
  })
}

describe('저장된 정확도와 저장된 혼동 행렬', () => {
  it('앱이 적은 그대로면 맞는다', () => {
    expect(storedMetricsMatchMatrix(honest('a'))).toBe(true)
  })

  it('반 칸보다 적게 고친 정확도도 안 맞는다 — 지표는 반올림하지 않고 저장한다', () => {
    expect(storedMetricsMatchMatrix(honest('a', { metrics: { accuracy: 0.92 } }))).toBe(false)
  })
})

/**
 * **여유 0이 기대는 전제를 문다** — 앱이 적은 정확도는 행렬의 대각합 / 전체와 비트까지 같다.
 * 정확도 식을 바꾸면(쌍별 합의 평균, `1 - 틀린 수 / 전체` 같은) 정직한 파일의 run이 교사 화면에
 * 이름이 뜨므로, 그 식을 고치는 사람이 여기서 멈춰야 한다. 파일에 적히는 모양 그대로 보려고
 * JSON을 한 번 왕복한다.
 */
describe('앱이 적은 run은 비트까지 맞는다', () => {
  /** 표·분류·브라우저 엔진에서 되는 알고리즘 전부. **등록부가 답한다** — 손으로 적지 않는다. */
  const CLASSIFIERS = ALGORITHMS.filter(
    (one) =>
      supports(one.dataTypes, 'tabular') &&
      supports(one.taskTypes, 'classification') &&
      supports(one.runtimes, 'mljs'),
  ).map((one) => one.id)

  function asStored(value: unknown): Run {
    return JSON.parse(JSON.stringify(value)) as Run
  }

  it('등록부에서 고른 알고리즘이 있다', () => {
    expect(CLASSIFIERS.length).toBeGreaterThan(0)
  })

  for (const stratify of [true, false]) {
    it(`실제 학습한 완료 run마다 맞는다 (층화 ${stratify ? '켬' : '끔'})`, async () => {
      const settings: Settings = {
        data: {
          features: [...IRIS_FEATURE_COLUMNS],
          target: IRIS_TARGET_COLUMN,
          preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
        },
        split: { method: 'holdout', testSize: 0.3, stratify, randomState: 42 },
        runtime: 'mljs',
        selectedAlgorithms: CLASSIFIERS.map((algorithm) => ({ algorithm })),
        hyperparameters: {},
      }
      const { experiment: trained } = await runExperiment({
        dataset: irisDataset(),
        testDataset: null,
        taskType: 'classification',
        dataType: 'tabular',
        settings,
        snapshot: dataSnapshot('tabular', settings),
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: 30,
          dataType: 'tabular',
        },
      })
      const done = trained.runs.filter((one) => one.status === 'done')
      expect(done.map((one) => one.algorithm)).toEqual(CLASSIFIERS)
      for (const one of done) {
        expect(storedMetricsMatchMatrix(asStored(one)), one.algorithm).toBe(true)
      }
    })
  }

  it('씨앗을 고정한 무작위 평가도 맞는다 — 예측에만 나온 범주·시험에 없는 범주를 섞어', () => {
    let state = 20260930
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
    // 정답은 앞 범주에서만, 예측은 뒤 범주까지 — 예측에만 나온 범주가 생긴다. 정답 쪽 범주
    // 일부는 어느 표본에서도 안 뽑혀 시험에 없는 범주가 된다.
    const labels = ['가', '나', '다', '1', '1.0', '', 'NaN', 'z']
    for (let trial = 0; trial < 500; trial += 1) {
      const rows = 1 + Math.floor(next() * 400)
      const truthKinds = 1 + Math.floor(next() * (labels.length - 2))
      const actual = Array.from({ length: rows }, () => labels[Math.floor(next() * truthKinds)]!)
      const predicted = actual.map((truth) =>
        next() < 0.7 ? truth : labels[Math.floor(next() * labels.length)]!,
      )
      const evaluation = evaluate('classification', actual, predicted)
      const stored = asStored({
        status: 'done',
        metrics: evaluation.metrics,
        confusionMatrix: evaluation.confusionMatrix,
      })
      expect(storedMetricsMatchMatrix(stored), `trial ${trial}`).toBe(true)
    }
  })
})

function mountPanel(one: Experiment, dataType: 'tabular' | 'image') {
  return mount(ReproducePanel, {
    props: {
      experiment: one,
      order: 1,
      dataType,
      dataset: null,
      testDataset: null,
      appVersion: '0.0.0',
    },
    global: { plugins: [i18n] },
  })
}

describe('대조 판이 파일 안의 어긋남을 누르기 전에 말한다', () => {
  beforeEach(() => {
    setLocale('ko')
    setActivePinia(createPinia())
  })

  const MISMATCH = (model: string) => i18n.global.t('inspect.matrixMismatch', { model })
  /** 모델 이름은 학습한 곳까지다(`predict.modelName`). 엔진이 안 적힌 run은 위치로 선다. */
  const named = (runtimeKey: string) =>
    i18n.global.t('predict.modelName', {
      algorithm: i18n.global.t('algorithms.decision_tree'),
      runtime: i18n.global.t(runtimeKey),
    })
  const TREE = () => named('execution.browser')

  it('같은 알고리즘을 엔진 둘로 돌렸으면 어느 쪽인지 가른다', () => {
    const panel = mountPanel(
      experiment('e', [
        honest('r1', { engine: { kind: 'mljs', version: '3' } }),
        honest('r2', {
          engine: { kind: 'pyodide-sklearn', version: '314.0.7' },
          metrics: { accuracy: 1 },
        }),
      ]),
      'image',
    )
    const text = panel.text()
    expect(text).toContain(MISMATCH(named('runtimes.pyodide-sklearn')))
    expect(text).not.toContain(MISMATCH(named('runtimes.mljs')))
  })

  it('사진 프로젝트 — 대조가 잠겨도 정확도만 고친 run을 말한다', () => {
    const panel = mountPanel(
      experiment('e', [honest('r1'), honest('r2', { metrics: { accuracy: 1 } })]),
      'image',
    )
    const text = panel.text()
    expect(text).toContain(MISMATCH(TREE()))
    // 고친 run 하나만이다 — 정직한 run까지 말하면 신호가 아니라 소음이다.
    expect(text.split(MISMATCH(TREE())).length - 1).toBe(1)
  })

  it('정직한 파일에는 한 줄도 없다', () => {
    const panel = mountPanel(experiment('e', [honest('r1'), honest('r2')]), 'tabular')
    expect(panel.text()).not.toContain(MISMATCH(TREE()))
  })

  it('행렬이 없는 run(회귀·군집·옛 파일)에는 말하지 않는다', () => {
    const panel = mountPanel(
      experiment('e', [honest('r1', { confusionMatrix: undefined, metrics: { accuracy: 1 } })]),
      'tabular',
    )
    expect(panel.text()).not.toContain(MISMATCH(TREE()))
  })

  it('실패한 run에는 말하지 않는다 — 견줄 주장이 없다', () => {
    const panel = mountPanel(
      experiment('e', [
        honest('r1', {
          status: 'failed',
          failure: { code: 'JOB_FAILED' },
          metrics: { accuracy: 1 },
        }),
      ]),
      'tabular',
    )
    expect(panel.text()).not.toContain(MISMATCH(TREE()))
  })
})
