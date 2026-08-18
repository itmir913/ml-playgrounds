/**
 * 재실행 대조.
 *
 * **여기서 확인하는 것은 판정이 아니라 사실이다.** 허용 오차는 아직 미결이고
 * (open-decisions.md #12) 이 층은 "차이가 얼마인가"까지만 답한다.
 *
 * 가장 중요한 것은 **못 하는 것을 안 맞는다고 하지 않는가**다. 엔진이 다른 파일을
 * NOT_REPRODUCED로 내면 도구가 무고한 학생을 지목한다.
 */

import { describe, expect, it } from 'vitest'

import { runExperiment as runExperimentRaw, type ExperimentInput } from '../src/ml/experiment'
import { dataSnapshot } from '../src/project/schema'
import { reproduceExperiment } from '../src/ml/reproduce'
import type { Dataset } from '../src/ml/preprocess'
import type { Experiment, Run, Settings } from '../src/project/schema'
import { irisDataset, IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN } from './fixtures/iris'

/**
 * 스냅샷은 **표에서는 설정에서 그대로 나온다** (open-decisions.md "이미지 학습은 표
 * 문제로 바꿔서 푼다"). 검사가 매번 손으로 적을 값이 아니라 여기서 한 번 채운다 —
 * 갈리는 것은 이미지뿐이고 그건 어댑터가 짓는다.
 */
function runExperiment(
  input: Omit<ExperimentInput, 'snapshot'>,
  options?: Parameters<typeof runExperimentRaw>[1],
): ReturnType<typeof runExperimentRaw> {
  return runExperimentRaw({ ...input, snapshot: dataSnapshot('tabular', input.settings) }, options)
}

const dataset = irisDataset()

function settingsFor(algorithms: string[]): Settings {
  return {
    data: {
      features: [...IRIS_FEATURE_COLUMNS],
      target: IRIS_TARGET_COLUMN,
      preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    },
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: algorithms.map((algorithm) => ({ algorithm })),
    hyperparameters: {},
  }
}

function trained(algorithms: string[]): Experiment {
  return runExperiment(
    {
      dataset,
      testDataset: null,
      taskType: 'classification',
      dataType: 'tabular',
      settings: settingsFor(algorithms),
      context: { serverStatus: 'unavailable', rowCount: 30, dataType: 'tabular' },
    },
    { now: () => '2026-08-06T00:00:00.000Z' },
  ).experiment
}

/** run 하나를 손본 실험. 파일을 풀어 고친 상태를 흉내 낸다. */
function withRun(experiment: Experiment, index: number, overrides: Partial<Run>): Experiment {
  const runs = experiment.runs.map((run, at) => (at === index ? { ...run, ...overrides } : run))
  return { ...experiment, runs }
}

describe('재실행 대조', () => {
  it('방금 학습한 실험은 그대로 재현된다', () => {
    const experiment = trained(['decision_tree', 'knn', 'naive_bayes', 'svm'])
    const found = reproduceExperiment({ experiment, dataset, testDataset: null })

    expect(found).toHaveLength(4)
    for (const one of found) {
      expect(one.status, one.algorithm).toBe('REPRODUCED')
      // 차이가 0이라는 것을 값으로도 남긴다. 화면이 허용 오차를 정할 때 볼 값이다.
      expect(
        Object.values(one.deltas ?? {}).every((delta) => delta === 0),
        one.algorithm,
      ).toBe(true)
    }
  })

  it('지표를 고친 파일은 어긋나고, 얼마나 어긋났는지까지 준다', () => {
    const experiment = trained(['decision_tree'])
    const stored = experiment.runs[0]?.metrics?.['accuracy'] ?? 0
    const tampered = withRun(experiment, 0, {
      metrics: { ...experiment.runs[0]?.metrics, accuracy: 1 },
    })

    const [found] = reproduceExperiment({ experiment: tampered, dataset, testDataset: null })
    expect(found?.status).toBe('NOT_REPRODUCED')
    expect(found?.again?.['accuracy']).toBe(stored)
    // 판정하지 않고 차이를 준다. 얼마까지 봐 줄지는 이 층이 정하지 않는다.
    expect(found?.deltas?.['accuracy']).toBeCloseTo(stored - 1, 10)
  })

  it('엔진이 다르면 대조하지 않는다 - 무고한 학생을 지목하지 않는다', () => {
    const experiment = trained(['decision_tree'])
    const other = withRun(experiment, 0, { engine: { kind: 'mljs', version: '999' } })

    const [found] = reproduceExperiment({ experiment: other, dataset, testDataset: null })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
    // 무엇으로 만든 것인지 함께 준다. 화면이 "이 파일은 다른 엔진에서 왔다"를 말해야 한다.
    expect(found?.engine?.version).toBe('999')
    expect(found?.again).toBeUndefined()
  })

  it('무엇으로 만들었는지 모르는 run도 대조하지 않는다', () => {
    const experiment = trained(['decision_tree'])
    const [found] = reproduceExperiment({
      experiment: withRun(experiment, 0, { engine: undefined }),
      dataset,
      testDataset: null,
    })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
  })

  it('실패한 run은 대조 대상이 아니다 - 견줄 지표가 없다', () => {
    const experiment = trained(['decision_tree'])
    const failed = withRun(experiment, 0, {
      status: 'failed',
      metrics: undefined,
      failure: { code: 'JOB_FAILED' },
    })
    expect(reproduceExperiment({ experiment: failed, dataset, testDataset: null })).toEqual([])
  })

  it('학생이 바꾼 하이퍼파라미터를 그대로 먹인다', () => {
    // 기본값으로 다시 채우면 다른 설정으로 학습해 놓고 "안 맞는다"고 말하게 된다.
    const experiment = trained(['decision_tree'])
    const shallow = withRun(experiment, 0, { hyperparameters: { maxDepth: 1, minNumSamples: 3 } })

    const [found] = reproduceExperiment({ experiment: shallow, dataset, testDataset: null })
    // 깊이 1로 다시 돌리면 붓꽃 세 품종을 못 가르므로 파일의 지표와 어긋난다.
    expect(found?.status).toBe('NOT_REPRODUCED')
    expect(found?.again?.['accuracy']).toBeLessThan(experiment.runs[0]?.metrics?.['accuracy'] ?? 1)
  })
})

/**
 * **대조도 학습셋에서만 전처리기를 fit해야 한다.**
 *
 * `settings.trainIndices` 대신 표 전체로 fit해도 이 파일과 `lifecycle.spec.ts`가 전부
 * 통과했다 (V11 R2 감사 B-8). 붓꽃 30행 + `standard`에서는 새는 것이 정확도를 못 움직여서다 —
 * 트리는 단조 변환에 불변이고 KNN도 그 정도 여유에서는 라벨이 안 뒤집힌다.
 * **정확도라는 눈금이 너무 굵었다.**
 *
 * 새면 위조 탐지가 **양쪽으로** 무너진다. 정직한 학생의 지표가 재현되지 않고(학습은
 * 학습셋으로 fit했으니까), 반대로 평가셋을 섞어 부풀린 지표가 대조를 통과할 수 있다.
 *
 * **평가 쪽에만 극단값을 둔다.** 그 행이 fit에 섞이면 `standard`의 폭이 통째로 달라져
 * 학습 행들의 좌표가 눌리고, KNN의 이웃이 바뀐다.
 */
/**
 * **대조도 학습셋에서만 전처리기를 fit해야 한다.**
 *
 * `settings.trainIndices` 대신 표 전체로 fit해도 이 파일과 `lifecycle.spec.ts`가 전부
 * 통과했다 (V11 R2 감사 B-8). 붓꽃 30행 + `standard`에서는 새는 것이 정확도를 못 움직여서다 —
 * 트리는 단조 변환에 불변이고 KNN도 그 정도 여유에서는 라벨이 안 뒤집힌다.
 * **정확도라는 눈금이 너무 굵었다.**
 *
 * 새면 위조 탐지가 **양쪽으로** 무너진다. 정직한 학생의 지표가 재현되지 않고(학습은
 * 학습셋으로 fit했으니까), 반대로 평가셋을 섞어 부풀린 지표가 대조를 통과할 수 있다.
 *
 * **평가로 갈 네 자리에만 극단값을 둔다.** 씨앗 7의 분할이 `[3,4,10,13]`을 평가로 보내므로
 * (`split.spec.ts`가 그 결정성을 지킨다) 그 행들이 fit에 섞이면 `a`의 폭이 통째로 달라져
 * 학습 행들의 좌표가 눌리고, `k=1`인 KNN의 이웃이 다른 무리로 넘어간다.
 */
describe('대조의 전처리기도 학습셋에서만 나온다', () => {
  const TEST_ROWS = new Set([3, 4, 10, 13])
  /** 평가 자리는 극단값, 학습 자리는 두 무리. `a`가 가르고 `b`는 반대로 끈다. */
  const skewed: Dataset = {
    columns: ['a', 'b', 'label'],
    rows: Array.from({ length: 16 }, (_, index) => {
      if (TEST_ROWS.has(index)) return ['1000', '0', 'y']
      return index % 2 === 0 ? ['0', '0', 'x'] : ['1', '10', 'y']
    }),
  }

  const skewedSettings: Settings = {
    data: {
      features: ['a', 'b'],
      target: 'label',
      preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    },
    split: { method: 'holdout', testSize: 0.25, stratify: false, randomState: 7 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'knn' }],
    hyperparameters: { knn: { mljs: { k: 1 } } },
  }

  it('학습한 그대로 대조하면 어긋나는 곳이 없다', () => {
    const experiment = runExperiment(
      {
        dataset: skewed,
        testDataset: null,
        taskType: 'classification',
        dataType: 'tabular',
        settings: skewedSettings,
        context: { serverStatus: 'unavailable', rowCount: 16, dataType: 'tabular' },
      },
      { now: () => '2026-08-06T00:00:00.000Z' },
    ).experiment

    // 평가 자리가 정말 극단값 행인지 먼저 못 박는다 - 분할이 바뀌면 이 검사가 무뎌진다.
    expect([...experiment.settings.testIndices].sort((a, b) => a - b)).toEqual([3, 4, 10, 13])

    const [found] = reproduceExperiment({ experiment, dataset: skewed, testDataset: null })
    expect(found?.status).toBe('REPRODUCED')
    expect(Object.values(found?.deltas ?? {}).every((delta) => delta === 0)).toBe(true)
  })
})

/**
 * **군집도 대조된다.**
 *
 * 예전에는 `target`이 없으면 `''`로 떨어지고 `targetValues(dataset, …, '')`가
 * `COLUMN_NOT_FOUND`로 던졌으며, 그 예외를 `shared`의 `try`가 삼켜 **모든 군집 run이
 * `ENGINE_UNAVAILABLE`로 나왔다** — 엔진은 바로 거기 있는데도 그랬다 (V11 R2 감사 B-3).
 * 설령 그 자리를 고쳐도 `evaluate('clustering', …)`이 등록부에 없어 던졌다. 군집은
 * `evaluateCluster(data, assignments, centroids)`라는 다른 시그니처를 쓴다
 * (architecture.md §3.7).
 *
 * 이 파일의 픽스처가 분류 하나뿐이라 그 상태를 아무것도 안 봤다.
 */
describe('군집도 대조한다', () => {
  const clusters: Dataset = {
    columns: ['x', 'y'],
    rows: [
      ['0', '0'],
      ['1', '0'],
      ['0', '1'],
      ['10', '10'],
      ['11', '10'],
      ['10', '11'],
      ['20', '20'],
      ['21', '20'],
      ['20', '21'],
    ],
  }

  const clusterSettings: Settings = {
    data: {
      features: ['x', 'y'],
      preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
    },
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'k_means' }],
    hyperparameters: {},
  }

  function clusterExperiment(): Experiment {
    return runExperiment(
      {
        dataset: clusters,
        testDataset: null,
        taskType: 'clustering',
        dataType: 'tabular',
        settings: clusterSettings,
        context: { serverStatus: 'unavailable', rowCount: 9, dataType: 'tabular' },
      },
      { now: () => '2026-08-06T00:00:00.000Z' },
    ).experiment
  }

  it('엔진이 없다고 하지 않는다 - 엔진은 거기 있다', () => {
    const [found] = reproduceExperiment({
      experiment: clusterExperiment(),
      dataset: clusters,
      testDataset: null,
    })
    expect(found?.status).toBe('REPRODUCED')
    expect(found?.again?.['silhouette']).toBeDefined()
    expect(found?.again?.['inertia']).toBeDefined()
  })

  it('군집 지표를 고친 파일도 잡는다', () => {
    const experiment = clusterExperiment()
    const tampered = withRun(experiment, 0, {
      metrics: { ...experiment.runs[0]?.metrics, silhouette: 0.1 },
    })
    const [found] = reproduceExperiment({
      experiment: tampered,
      dataset: clusters,
      testDataset: null,
    })
    expect(found?.status).toBe('NOT_REPRODUCED')
    expect(found?.deltas?.['silhouette']).not.toBe(0)
  })
})
