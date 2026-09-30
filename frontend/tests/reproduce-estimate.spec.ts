// @vitest-environment jsdom
/**
 * **점검의 대조 예상 시간이 사진 실험에도 선다** (open-decisions.md 87).
 *
 * 대조 판은 실험의 표 설정과 정본 표가 없으면 기준표를 보기도 전에 멈춰서, 사진 실험은 늘 `알 수 없음`이었다.
 * 학습 화면은 같은 사진을 사진 기준표로 낸다. 입력은 학습 화면이 넘기는 모양과 같아야 한다 — 데이터 종류는
 * 실험의 것, 행은 훈련 몫, 폭은 표가 아니면 0.
 *
 * 앞의 검사는 부품 밖 함수(`ml/reproduce-estimate.ts`)를 재고, 마지막 묶음은 진짜 대조 판을 띄워 그 함수가
 * 판의 예상에 닿는지를 잰다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/ml/worker/client', () => ({
  train: () => ({ result: new Promise(() => {}), cancel: () => {} }),
  calibrateDevice: () => Promise.resolve(null),
}))

vi.mock('../src/ml/worker/spawn', () => ({ spawnTrainingWorker: () => ({}) }))

const { MLJS_ENGINE } = await import('../src/ml/engines/mljs')
const { PYODIDE_SKLEARN_ENGINE } = await import('../src/ml/engines/pyodide-sklearn')
const { describe: describeEstimate, estimateMs } = await import('../src/ml/estimate')
const { reproduceEstimate, reproduceEstimateInputs } = await import('../src/ml/reproduce-estimate')
const { DEFAULT_BACKBONE_ID } = await import('../src/ml/backbones')
const { i18n, setLocale } = await import('../src/i18n')
const ReproducePanel = (await import('../src/views/inspect/ReproducePanel.vue')).default
const { experiment, run } = await import('./fixtures/project')

import type { Experiment, Run } from '../src/project/schema'

/** 사진 실험 하나. 스냅샷은 사진의 모양이다 — 표의 것을 두면 여는 문이 거절한다. */
function imageExperiment(runs: Run[], trained = 40): Experiment {
  const base = experiment('experiment-image', runs)
  return {
    ...base,
    settings: {
      ...base.settings,
      data: {
        categories: ['고양이', '개'],
        backboneId: DEFAULT_BACKBONE_ID,
        categoryCounts: [25, 25],
        unlabeledCount: 0,
      },
      trainIndices: Array.from({ length: trained }, (_, at) => at),
      testIndices: [],
    },
  }
}

const naiveBayes = run('run-nb', {
  algorithm: 'naive_bayes',
  hyperparameters: {},
  engine: MLJS_ENGINE,
})

describe('사진 실험의 대조 예상', () => {
  it('입력은 학습 화면과 같은 모양이다 - 사진, 훈련 몫, 폭 0', () => {
    const inputs = reproduceEstimateInputs({
      experiment: imageExperiment([naiveBayes]),
      dataType: 'image',
      featureWidth: null,
    })
    expect(inputs).toEqual([
      {
        algorithm: 'naive_bayes',
        dataType: 'image',
        rows: 40,
        columns: 0,
        hyperparameters: {},
        runtime: 'mljs',
      },
    ])
  })

  /**
   * **클래스 수도 학습 화면처럼 넘긴다** (open-decisions.md 88). 기록의 혼동 행렬 라벨 수이고, 혼동 행렬이
   * 없으면(분류가 아니면) 비어 클래스 배수가 안 붙는다.
   */
  it('분류 run은 혼동 행렬의 라벨 수를 클래스 수로 넘긴다', () => {
    const classified = run('run-nb-cm', {
      algorithm: 'naive_bayes',
      hyperparameters: {},
      engine: MLJS_ENGINE,
      confusionMatrix: { labels: ['개', '고양이', '새', '말'], matrix: [] },
    })
    const inputs = reproduceEstimateInputs({
      experiment: imageExperiment([classified, naiveBayes]),
      dataType: 'image',
      featureWidth: null,
    })
    expect(inputs?.map((input) => input.classes)).toEqual([4, undefined])
  })

  it('사진 기준표로 선다 - 학습 화면이 같은 입력으로 내는 값과 같다', () => {
    const subject = {
      experiment: imageExperiment([naiveBayes]),
      dataType: 'image' as const,
      featureWidth: null,
    }
    const expected = estimateMs(
      {
        algorithm: 'naive_bayes',
        dataType: 'image',
        rows: 40,
        columns: 0,
        hyperparameters: {},
        runtime: 'mljs',
      },
      2,
    )
    expect(expected, 'the image baseline for naive Bayes must be measured').not.toBeNull()
    expect(reproduceEstimate(subject, 2)).toEqual(describeEstimate(expected))
  })

  it('기준표가 빈 사진 칸은 알 수 없음이다 - sklearn 인공신경망', () => {
    const neural = run('run-nn', {
      algorithm: 'neural_network',
      hyperparameters: {},
      engine: { ...PYODIDE_SKLEARN_ENGINE, version: '1.5.2' },
    })
    const subject = {
      experiment: imageExperiment([naiveBayes, neural]),
      dataType: 'image' as const,
      featureWidth: null,
    }
    expect(reproduceEstimate(subject, 1)).toEqual({ kind: 'unknown' })
  })

  it('기준표가 빈 사진 칸은 알 수 없음이다 - 선형 회귀', () => {
    const linear = run('run-linear', {
      algorithm: 'linear_regression',
      hyperparameters: {},
      engine: MLJS_ENGINE,
    })
    const subject = {
      experiment: imageExperiment([linear]),
      dataType: 'image' as const,
      featureWidth: null,
    }
    expect(reproduceEstimate(subject, 1)).toEqual({ kind: 'unknown' })
  })

  it('설정이 그 종류로 안 읽히면 모른다 - 사진 프로젝트에 표 스냅샷', () => {
    const tabular = experiment('experiment-mismatch', [naiveBayes])
    expect(
      reproduceEstimateInputs({ experiment: tabular, dataType: 'image', featureWidth: 2 }),
    ).toBeNull()
  })
})

describe('표 실험의 대조 예상은 그대로다', () => {
  const tree = run('run-tree', { engine: MLJS_ENGINE })

  it('폭은 대조 판이 센 특성 폭이고 행은 훈련 몫이다', () => {
    const claim = experiment('experiment-table', [tree])
    expect(
      reproduceEstimateInputs({ experiment: claim, dataType: 'tabular', featureWidth: 3 }),
    ).toEqual([
      {
        algorithm: 'decision_tree',
        dataType: 'tabular',
        rows: claim.settings.trainIndices.length,
        columns: 3,
        hyperparameters: tree.hyperparameters,
        runtime: 'mljs',
      },
    ])
  })

  it('표를 못 열어 폭을 모르면 모른다', () => {
    const claim = experiment('experiment-table', [tree])
    expect(
      reproduceEstimateInputs({ experiment: claim, dataType: 'tabular', featureWidth: null }),
    ).toBeNull()
  })

  it('끝나지 않은 run은 안 센다', () => {
    const failed = run('run-failed', { engine: MLJS_ENGINE, status: 'failed' })
    const claim = experiment('experiment-table', [tree, failed])
    expect(
      reproduceEstimateInputs({ experiment: claim, dataType: 'tabular', featureWidth: 2 }),
    ).toHaveLength(1)
  })
})

describe('모르는 것은 지어내지 않는다', () => {
  it('엔진이 적히지 않은 run이 있으면 모른다', () => {
    const unknown = run('run-no-engine')
    expect(
      reproduceEstimateInputs({
        experiment: imageExperiment([naiveBayes, unknown]),
        dataType: 'image',
        featureWidth: null,
      }),
    ).toBeNull()
  })

  it('서버에서 돈 run이 있으면 모른다 - 우리가 모르는 기기다', () => {
    const server = run('run-server', {
      algorithm: 'naive_bayes',
      hyperparameters: {},
      engine: { kind: 'sklearn', version: '1.5.2' },
    })
    const subject = {
      experiment: imageExperiment([naiveBayes, server]),
      dataType: 'image' as const,
      featureWidth: null,
    }
    expect(reproduceEstimate(subject, 1)).toEqual({ kind: 'unknown' })
  })

  it('기기 배수를 아직 못 쟀으면 모른다', () => {
    const subject = {
      experiment: imageExperiment([naiveBayes]),
      dataType: 'image' as const,
      featureWidth: null,
    }
    expect(reproduceEstimate(subject, null)).toEqual({ kind: 'unknown' })
  })
})

/**
 * **진짜 대조 판이 그 함수로 낸다.** 사진 실험은 아직 대조가 안 열려(`IMAGE_NOT_OPEN`) 예상 줄이 화면에
 * 안 서므로 판이 쥔 값(`estimate`)을 읽는다 — `inspect-reproduce-width.spec.ts`가 `featureWidth`를 읽는 것과 같다.
 */
describe('대조 판', () => {
  const FACTOR_KEY = 'ml-playgrounds:device-factor'

  beforeEach(async () => {
    setActivePinia(createPinia())
    await setLocale('ko')
    window.localStorage.setItem(FACTOR_KEY, '2')
  })

  afterEach(() => {
    window.localStorage.removeItem(FACTOR_KEY)
  })

  function estimateOf(props: {
    experiment: Experiment
    dataType: 'tabular' | 'image'
    dataset: { columns: string[]; rows: string[][] } | null
  }): unknown {
    const panel = mount(ReproducePanel, {
      props: { ...props, order: 1, testDataset: null, preprocessor: null, appVersion: '0.0.0' },
      global: { plugins: [i18n] },
    })
    const value = (panel.vm as unknown as { estimate: unknown }).estimate
    panel.unmount()
    return value
  }

  it('사진 실험에도 사진 기준표로 예상을 낸다', () => {
    const claim = imageExperiment([naiveBayes])
    const value = estimateOf({ experiment: claim, dataType: 'image', dataset: null })
    expect(value).toEqual(
      reproduceEstimate({ experiment: claim, dataType: 'image', featureWidth: null }, 2),
    )
    expect(value).not.toEqual({ kind: 'unknown' })
  })

  it('표 실험은 표를 열었을 때만 낸다', () => {
    const claim = experiment('experiment-table', [run('run-tree', { engine: MLJS_ENGINE })])
    const table = {
      columns: ['꽃받침 길이', 'petal_length', '품종'],
      rows: [
        ['5.1', '1.4', 'setosa'],
        ['7.0', '4.7', 'versicolor'],
        ['6.3', '6.0', 'virginica'],
        ['4.9', '1.5', 'setosa'],
      ],
    }
    expect(estimateOf({ experiment: claim, dataType: 'tabular', dataset: table })).not.toEqual({
      kind: 'unknown',
    })
    expect(estimateOf({ experiment: claim, dataType: 'tabular', dataset: null })).toEqual({
      kind: 'unknown',
    })
  })
})
