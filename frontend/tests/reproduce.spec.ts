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
import {
  IRIS_FEATURES,
  IRIS_FEATURE_COLUMNS,
  IRIS_LABELS,
  IRIS_TARGET_COLUMN,
  irisDataset,
} from './fixtures/iris'

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
      context: { limitsOff: false, serverStatus: 'unavailable', rowCount: 30, dataType: 'tabular' },
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
  /**
   * **견줄 것이 하나도 없으면 재현됐다고 말하지 않는다.**
   *
   * `same`의 `Object.keys(deltas).length > 0` 가드를 지우면 `every`가 공허하게 참이 되어
   * **아무것도 안 견주고 `REPRODUCED`**를 낸다. 지워도 저장소 전체가 초록이었다
   * (R13-2 감사 A-4).
   *
   * **도달한다.** `metrics`는 `z.record(...).optional()`이라 `"metrics": {}`인 `done` run은
   * 스키마를 통과하는 정상 `.mlpx`이고, 그런 파일이 이 층의 위협 모형 자체다 —
   * 학생이 학습 전에 `runs.json`을 고치고 저장하면 해시는 멀쩡하다.
   */
  it('견줄 지표가 없으면 재현됐다고 말하지 않는다', () => {
    const experiment = withRun(trained(['decision_tree']), 0, { metrics: {} })
    const found = reproduceExperiment({ experiment, dataset, testDataset: null })

    expect(found).toHaveLength(1)
    expect(found[0]?.status).not.toBe('REPRODUCED')
  })

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
 * **대조도 훈련 데이터에서만 전처리기를 fit해야 한다.**
 *
 * `settings.trainIndices` 대신 표 전체로 fit해도 이 파일과 `lifecycle.spec.ts`가 전부
 * 통과했다 (V11 R2 감사 B-8). 붓꽃 30행 + `standard`에서는 새는 것이 정확도를 못 움직여서다 —
 * 트리는 단조 변환에 불변이고 KNN도 그 정도 여유에서는 라벨이 안 뒤집힌다.
 * **정확도라는 눈금이 너무 굵었다.**
 *
 * 새면 위조 탐지가 **양쪽으로** 무너진다. 정직한 학생의 지표가 재현되지 않고(학습은
 * 훈련 데이터로 fit했으니까), 반대로 테스트 데이터를 섞어 부풀린 지표가 대조를 통과할 수 있다.
 *
 * **평가로 갈 네 자리에만 극단값을 둔다.** 씨앗 7의 분할이 `[3,4,10,13]`을 테스트로 보내므로
 * (`split.spec.ts`가 그 결정성을 지킨다) 그 행들이 fit에 섞이면 `a`의 폭이 통째로 달라져
 * 훈련 행들의 좌표가 눌리고, `k=1`인 KNN의 이웃이 다른 무리로 넘어간다.
 */
describe('대조의 전처리기도 훈련 데이터에서만 나온다', () => {
  const TEST_ROWS = new Set([3, 4, 10, 13])
  /** 테스트 자리는 극단값, 훈련 자리는 두 무리. `a`가 가르고 `b`는 반대로 끈다. */
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
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: 16,
          dataType: 'tabular',
        },
      },
      { now: () => '2026-08-06T00:00:00.000Z' },
    ).experiment

    // 테스트 자리가 정말 극단값 행인지 먼저 못 박는다 - 분할이 바뀌면 이 검사가 무뎌진다.
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
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: 9,
          dataType: 'tabular',
        },
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

/**
 * **테스트 파일이 따로 온 실험도 대조된다** (R7 감사 A-1).
 *
 * `provided`면 `testIndices`가 훈련 정본이 아니라 **테스트 정본**의 행 번호다
 * (mlpx-spec.md §1.1). 이 갈래를 지나는 검사가 하나도 없어서, `reproduce.ts`의 그
 * 삼항을 통째로 `dataset`으로 뭉개도 저장소 전체 1,996개가 초록이었다.
 *
 * **깨지면 학생이 지는 쪽으로 깨진다** — 손대지 않은 제출물이 `NOT_REPRODUCED`가 되고,
 * 교사 화면에서 그것은 "고쳤다"는 뜻이다.
 */
describe('테스트 파일이 따로 온 실험', () => {
  /** 훈련 정본과 **다른 표**다. 두 표를 바꿔치기하면 지표가 달라지도록 라벨을 뒤집는다. */
  function testTable(): Dataset {
    return {
      columns: [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN],
      rows: IRIS_FEATURES.slice(0, 12).map((values, row) => [
        ...values.map(String),
        IRIS_LABELS[IRIS_LABELS.length - 1 - row] ?? '',
      ]),
    }
  }

  function providedExperiment(): { experiment: Experiment; testDataset: Dataset } {
    const testDataset = testTable()
    const settings = settingsFor(['decision_tree', 'knn'])
    const experiment = runExperiment(
      {
        dataset,
        testDataset,
        taskType: 'classification',
        dataType: 'tabular',
        settings: {
          ...settings,
          split: { ...settings.split, method: 'provided' },
        },
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: 30,
          dataType: 'tabular',
        },
      },
      { now: () => '2026-08-06T00:00:00.000Z' },
    ).experiment
    return { experiment, testDataset }
  }

  it('방금 학습한 것이 그대로 재현된다', () => {
    const { experiment, testDataset } = providedExperiment()
    const found = reproduceExperiment({ experiment, dataset, testDataset })

    expect(found).toHaveLength(2)
    for (const one of found) expect(one.status, one.algorithm).toBe('REPRODUCED')
  })

  /**
   * **이 검사가 이 묶음의 이유다.** 채점 대상을 훈련 정본으로 바꿔치기하면 지표가
   * 달라져야 한다 — 안 달라지면 `provided` 갈래가 아무 일도 안 하고 있는 것이다.
   */
  it('채점 대상이 훈련 정본으로 바뀌면 재현되지 않는다', () => {
    const { experiment } = providedExperiment()
    const found = reproduceExperiment({ experiment, dataset, testDataset: dataset })

    expect(found.some((one) => one.status !== 'REPRODUCED')).toBe(true)
  })

  /** 테스트 정본이 없으면 대조 자체가 불가능하다 - 없는 것을 있는 척하지 않는다. */
  it('테스트 정본이 없으면 대조할 수 없다고 말한다', () => {
    const { experiment } = providedExperiment()
    const found = reproduceExperiment({ experiment, dataset, testDataset: null })

    // **바닥이다.** 없으면 이 순회가 0회 돌고 초록이라, 지키는 것이 "말한다"가 아니라
    // "적어도 거짓말은 안 한다"까지로 줄어든다. 실제로 앞에 `return []` 한 줄을 끼워도
    // 저장소 전체가 초록이었다 (R13-2 감사 A-5). 그때 교사는 아무 줄도 못 본다.
    expect(found).toHaveLength(2)
    for (const one of found) expect(one.status, one.algorithm).not.toBe('REPRODUCED')
  })
})

/**
 * **씨앗이 대조의 `fit`까지 닿는가** (R7 감사 A-2).
 *
 * 학습 경로(`ml/experiment.ts`)는 2026-08-18에 검사가 붙었는데 **대조 경로는 무방비였다** —
 * `reproduce.ts`의 `randomState`를 `0`으로 못 박아도 저장소 전체가 초록이었다.
 *
 * **씨앗에 민감한 모델이라야 잡힌다.** 랜덤포레스트는 배깅이 씨앗을 먹으므로 다른 씨앗이면
 * 다른 나무가 서고 지표가 갈린다 — 결정트리로는 이 축을 못 가른다.
 */
describe('대조도 파일에 적힌 씨앗으로 돌린다', () => {
  /**
   * **붓꽃 30행으로는 이 축을 못 가른다.** 씨앗을 바꿔도 랜덤포레스트가 같은 지표를 낸다 —
   * `rule-coverage.md`가 *"지금 픽스처가 그래서 무디다"*라고 적어 둔 자리다. 그래서 여기서만
   * 쓰는 표를 짓는다: **행이 많고 라벨에 잡음이 섞여** 배깅이 씨앗마다 다른 나무를 세운다.
   */
  const NOISY_COLUMNS = ['x0', 'x1', 'x2', 'y'] as const

  function noisyTable(): Dataset {
    const rows: string[][] = []
    // 결정적 의사난수. 씨앗이 아니라 **데이터**를 만드는 자리라 값이 고정이어야 한다.
    let state = 12345
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
    for (let index = 0; index < 120; index += 1) {
      const x0 = next()
      const x1 = next()
      const x2 = next()
      const clean = x0 + x1 > 1 ? 'A' : 'B'
      // 라벨 20%를 뒤집는다. 갈리지 않는 데이터일수록 나무가 씨앗을 크게 탄다.
      const label = next() < 0.2 ? (clean === 'A' ? 'B' : 'A') : clean
      rows.push([x0.toFixed(4), x1.toFixed(4), x2.toFixed(4), label])
    }
    return { columns: [...NOISY_COLUMNS], rows }
  }

  const noisy = noisyTable()

  function forestWith(randomState: number): Experiment {
    return runExperiment(
      {
        dataset: noisy,
        testDataset: null,
        taskType: 'classification',
        dataType: 'tabular',
        settings: {
          data: {
            features: ['x0', 'x1', 'x2'],
            target: 'y',
            preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
          },
          split: { method: 'holdout', testSize: 0.3, stratify: true, randomState },
          runtime: 'mljs',
          selectedAlgorithms: [{ algorithm: 'random_forest' }],
          hyperparameters: {},
        },
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: noisy.rows.length,
          dataType: 'tabular',
        },
      },
      { now: () => '2026-08-06T00:00:00.000Z' },
    ).experiment
  }

  /**
   * **전제부터 확인한다.** 두 씨앗이 실제로 다른 지표를 내야 아래 검사가 뜻을 갖는다 —
   * 안 갈리면 픽스처가 무딘 것이지 코드가 옳은 것이 아니다.
   */
  it('씨앗이 다르면 지표가 갈린다 - 이 픽스처가 그 축을 가른다', () => {
    const left = forestWith(42).runs[0]?.metrics
    const right = forestWith(7).runs[0]?.metrics
    expect(left).toBeDefined()
    expect(right).not.toEqual(left)
  })

  it('파일의 씨앗으로 다시 돌린다 - 못 박힌 값이 아니라', () => {
    const experiment = forestWith(7)
    const [found] = reproduceExperiment({ experiment, dataset: noisy, testDataset: null })
    expect(found?.status).toBe('REPRODUCED')
  })
})
