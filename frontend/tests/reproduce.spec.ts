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
import { isClientError } from '../src/errors'
import {
  compareExperiments,
  flippedRows,
  reproduceBlockers,
  reproduceExperiment,
  reproduceInputOf,
  storedMetricsMatchMatrix,
  type Reproduction,
} from '../src/ml/reproduce'
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

function trained(algorithms: string[]): Promise<Experiment> {
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
  ).then((result) => result.experiment)
}

/** run 하나를 손본 실험. 파일을 풀어 고친 상태를 흉내 낸다. */
async function withRun(
  experiment: Experiment,
  index: number,
  overrides: Partial<Run>,
): Promise<Experiment> {
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
  it('견줄 지표가 없으면 재현됐다고 말하지 않는다', async () => {
    const experiment = await withRun(await trained(['decision_tree']), 0, { metrics: {} })
    const found = await reproduceExperiment({ experiment, dataset, testDataset: null })

    expect(found).toHaveLength(1)
    expect(found[0]?.status).not.toBe('REPRODUCED')
  })

  it('방금 학습한 실험은 그대로 재현된다', async () => {
    const experiment = await trained(['decision_tree', 'knn', 'naive_bayes', 'svm'])
    const found = await reproduceExperiment({ experiment, dataset, testDataset: null })

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

  it('지표를 고친 파일은 어긋나고, 얼마나 어긋났는지까지 준다', async () => {
    const experiment = await trained(['decision_tree'])
    const stored = experiment.runs[0]?.metrics?.['accuracy'] ?? 0
    const tampered = await withRun(experiment, 0, {
      metrics: { ...experiment.runs[0]?.metrics, accuracy: 1 },
    })

    const [found] = await reproduceExperiment({ experiment: tampered, dataset, testDataset: null })
    expect(found?.status).toBe('NOT_REPRODUCED')
    expect(found?.again?.['accuracy']).toBe(stored)
    // 판정하지 않고 차이를 준다. 얼마까지 봐 줄지는 이 층이 정하지 않는다.
    expect(found?.deltas?.['accuracy']).toBeCloseTo(stored - 1, 10)
  })

  it('엔진이 다르면 대조하지 않는다 - 무고한 학생을 지목하지 않는다', async () => {
    const experiment = await trained(['decision_tree'])
    const other = await withRun(experiment, 0, { engine: { kind: 'mljs', version: '999' } })

    const [found] = await reproduceExperiment({ experiment: other, dataset, testDataset: null })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
    // 무엇으로 만든 것인지 함께 준다. 화면이 "이 파일은 다른 엔진에서 왔다"를 말해야 한다.
    expect(found?.engine?.version).toBe('999')
    expect(found?.again).toBeUndefined()
  })

  it('무엇으로 만들었는지 모르는 run도 대조하지 않는다', async () => {
    const experiment = await trained(['decision_tree'])
    const [found] = await reproduceExperiment({
      experiment: await withRun(experiment, 0, { engine: undefined }),
      dataset,
      testDataset: null,
    })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
  })

  it('실패한 run은 대조 대상이 아니다 - 견줄 지표가 없다', async () => {
    const experiment = await trained(['decision_tree'])
    const failed = await withRun(experiment, 0, {
      status: 'failed',
      metrics: undefined,
      failure: { code: 'JOB_FAILED' },
    })
    expect(await reproduceExperiment({ experiment: failed, dataset, testDataset: null })).toEqual(
      [],
    )
  })

  it('학생이 바꾼 하이퍼파라미터를 그대로 먹인다', async () => {
    // 기본값으로 다시 채우면 다른 설정으로 학습해 놓고 "안 맞는다"고 말하게 된다.
    const experiment = await trained(['decision_tree'])
    const shallow = await withRun(experiment, 0, {
      hyperparameters: { maxDepth: 1, minNumSamples: 3 },
    })

    const [found] = await reproduceExperiment({ experiment: shallow, dataset, testDataset: null })
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

  it('학습한 그대로 대조하면 어긋나는 곳이 없다', async () => {
    const experiment = (
      await runExperiment(
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
      )
    ).experiment

    // 테스트 자리가 정말 극단값 행인지 먼저 못 박는다 - 분할이 바뀌면 이 검사가 무뎌진다.
    expect([...experiment.settings.testIndices].sort((a, b) => a - b)).toEqual([3, 4, 10, 13])

    const [found] = await reproduceExperiment({ experiment, dataset: skewed, testDataset: null })
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

  function clusterExperiment(): Promise<Experiment> {
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
    ).then((result) => result.experiment)
  }

  it('엔진이 없다고 하지 않는다 - 엔진은 거기 있다', async () => {
    const [found] = await reproduceExperiment({
      experiment: await clusterExperiment(),
      dataset: clusters,
      testDataset: null,
    })
    expect(found?.status).toBe('REPRODUCED')
    expect(found?.again?.['silhouette']).toBeDefined()
    expect(found?.again?.['inertia']).toBeDefined()
  })

  it('군집 지표를 고친 파일도 잡는다', async () => {
    const experiment = await clusterExperiment()
    const tampered = await withRun(experiment, 0, {
      metrics: { ...experiment.runs[0]?.metrics, silhouette: 0.1 },
    })
    const [found] = await reproduceExperiment({
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

  async function providedExperiment(): Promise<{ experiment: Experiment; testDataset: Dataset }> {
    const testDataset = testTable()
    const settings = settingsFor(['decision_tree', 'knn'])
    const experiment = (
      await runExperiment(
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
      )
    ).experiment
    return { experiment, testDataset }
  }

  it('방금 학습한 것이 그대로 재현된다', async () => {
    const { experiment, testDataset } = await providedExperiment()
    const found = await reproduceExperiment({ experiment, dataset, testDataset })

    expect(found).toHaveLength(2)
    for (const one of found) expect(one.status, one.algorithm).toBe('REPRODUCED')
  })

  /**
   * **이 검사가 이 묶음의 이유다.** 채점 대상을 훈련 정본으로 바꿔치기하면 지표가
   * 달라져야 한다 — 안 달라지면 `provided` 갈래가 아무 일도 안 하고 있는 것이다.
   */
  it('채점 대상이 훈련 정본으로 바뀌면 재현되지 않는다', async () => {
    const { experiment } = await providedExperiment()
    const found = await reproduceExperiment({ experiment, dataset, testDataset: dataset })

    expect(found.some((one) => one.status !== 'REPRODUCED')).toBe(true)
  })

  /**
   * **테스트 정본이 없으면 시끄럽게 선다.**
   *
   * 옛 판은 여기서 run마다 `ENGINE_UNAVAILABLE`을 돌려줬는데, 기록된 분할이 `splitRows`의
   * 방어를 건너뛰게 되면서 **조용히 틀릴 자리**가 생겼다 — 시험 표의 행 번호로 훈련 표를
   * 자르면 범위 안에서는 아무 예외도 없이 엉뚱한 행으로 채점한다 (R4 B-3).
   * 그래서 던지고, **교사가 보는 말은 gate가 한다**(`reproduceBlockers`).
   */
  it('테스트 정본이 없으면 던진다 - 조용히 딴 행으로 채점하지 않는다', async () => {
    const { experiment } = await providedExperiment()

    await expect(reproduceExperiment({ experiment, dataset, testDataset: null })).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'TEST_DATASET_NO_USABLE_ROWS',
    )
  })

  it('gate가 그 사실을 먼저 말한다 - 단추가 잠기는 이유다', async () => {
    const { experiment } = await providedExperiment()

    expect(
      reproduceBlockers({
        experiment,
        dataType: 'tabular',
        hasDataset: true,
        hasTestDataset: false,
      }),
    ).toEqual(['NO_TEST_DATASET'])
  })
})

/**
 * **씨앗이 대조의 `fit`까지 닿는가** (R7 감사 A-2).
 *
 * 학습 경로(`ml/experiment.ts`)는 2026-08-18에 검사가 붙었는데 **대조 경로는 무방비였다** —
 * 그때 대조는 씨앗을 손으로 넘겼고, 그 자리를 `0`으로 못 박아도 저장소 전체가 초록이었다.
 * **지금은 조립이 실험 스냅샷을 그대로 넘기므로 씨앗도 그 길로 간다** — 그래도 이 검사는
 * 남는다: 조립이 `split`을 안 옮기면 여기서 운다.
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

  async function forestWith(randomState: number): Promise<Experiment> {
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
    ).then((result) => result.experiment)
  }

  /**
   * **전제부터 확인한다.** 두 씨앗이 실제로 다른 지표를 내야 아래 검사가 뜻을 갖는다 —
   * 안 갈리면 픽스처가 무딘 것이지 코드가 옳은 것이 아니다.
   */
  it('씨앗이 다르면 지표가 갈린다 - 이 픽스처가 그 축을 가른다', async () => {
    const left = (await forestWith(42)).runs[0]?.metrics
    const right = (await forestWith(7)).runs[0]?.metrics
    expect(left).toBeDefined()
    expect(right).not.toEqual(left)
  })

  it('파일의 씨앗으로 다시 돌린다 - 못 박힌 값이 아니라', async () => {
    const experiment = await forestWith(7)
    const [found] = await reproduceExperiment({ experiment, dataset: noisy, testDataset: null })
    expect(found?.status).toBe('REPRODUCED')
  })
})

/**
 * **조립 — 파일의 어느 값을 어느 자리에 넣는가** (`reproduceInputOf`).
 *
 * 계획 감사의 A급 둘이 여기 있었다. 둘 다 *"스냅샷을 그대로 쓰면 된다"*에서 나왔고,
 * 둘 다 **정직한 학생이 붉은 말을 듣는** 모양이었다 (open-decisions.md "재실행은 학습
 * 경로를 그대로 탄다"의 "조립은 문서 설정을 한 글자도 안 읽는다").
 */
describe('조립은 run에서 읽는다', () => {
  it('손잡이를 바꿔 가며 남긴 실험도 각자의 값으로 다시 돈다', async () => {
    // **실험 스냅샷에는 `hyperparameters`가 없다.** 문서 설정을 쓰면 마지막 화면 상태로
    // 돌고, 스냅샷만 쓰면 전부 기본값으로 돈다 - 어느 쪽이든 첫 실험이 어긋난다.
    const shallow = await runExperiment({
      dataset,
      testDataset: null,
      taskType: 'classification',
      dataType: 'tabular',
      settings: {
        ...settingsFor(['decision_tree']),
        hyperparameters: { decision_tree: { mljs: { maxDepth: 2 } } },
      },
      context: { limitsOff: false, serverStatus: 'unavailable', rowCount: 30, dataType: 'tabular' },
    })
    const deep = await runExperiment({
      dataset,
      testDataset: null,
      taskType: 'classification',
      dataType: 'tabular',
      settings: {
        ...settingsFor(['decision_tree']),
        hyperparameters: { decision_tree: { mljs: { maxDepth: 10 } } },
      },
      context: { limitsOff: false, serverStatus: 'unavailable', rowCount: 30, dataType: 'tabular' },
    })

    // 두 실험의 손잡이가 실제로 갈렸는지부터 본다. 같으면 아래가 아무것도 안 가른다.
    expect(shallow.experiment.runs[0]?.hyperparameters['maxDepth']).toBe(2)
    expect(deep.experiment.runs[0]?.hyperparameters['maxDepth']).toBe(10)

    for (const experiment of [shallow.experiment, deep.experiment]) {
      const [found] = await reproduceExperiment({ experiment, dataset, testDataset: null })
      expect(found?.status, String(experiment.runs[0]?.hyperparameters['maxDepth'])).toBe(
        'REPRODUCED',
      )
    }
  })

  it('실행 방법은 run의 엔진에서 되짚는다 - 스냅샷의 요청이 아니라', async () => {
    // **스냅샷은 요청한 방법이고 run의 엔진이 실제로 돈 것이다.** 학습 때 자동으로
    // 넘어간 run(요청은 pyodide, 실제로는 mljs)을 스냅샷대로 다시 돌리면 그 방법이
    // 준비되지 않았다며 **실패 run**이 된다 - 엔진은 바로 거기 있는데도.
    const experiment = await trained(['decision_tree'])
    const asked: Experiment = {
      ...experiment,
      settings: {
        ...experiment.settings,
        runtime: 'pyodide-sklearn',
        selectedAlgorithms: [{ algorithm: 'decision_tree', runtime: 'pyodide-sklearn' }],
      },
    }

    const [found] = await reproduceExperiment({ experiment: asked, dataset, testDataset: null })
    expect(found?.status).toBe('REPRODUCED')
  })

  it('중단된 실험은 앞부분만 견준다', async () => {
    // 취소는 도착한 run만으로 실험을 조립한다 (`ml/worker/client.ts`). 그때 자리가 맞는
    // 것은 앞부분뿐이라, 뒤엣것까지 견주면 엉뚱한 run과 짝지어진다.
    const experiment = await trained(['decision_tree', 'knn'])
    const stopped: Experiment = { ...experiment, runs: [experiment.runs[0]!] }

    const found = await reproduceExperiment({ experiment: stopped, dataset, testDataset: null })
    expect(found).toHaveLength(1)
    expect(found[0]?.algorithm).toBe('decision_tree')
    expect(found[0]?.status).toBe('REPRODUCED')
  })

  /**
   * **자리를 맞추려고 통째로 넘긴다** — 그래서 `selectedAlgorithms`가 run보다 길면 남는
   * 모델이 헛돈다. 서른 개를 이어 여는 교사에게 그 시간이 그대로 기다림이다.
   *
   * 여기 검사가 없던 동안 `.slice(0, runs.length)`를 지워도 저장소 어디서도 안 울었다
   * (2026-09-18 R28 C-1) — 판정은 인덱스로 짝지어져 안 갈리기 때문이다.
   */
  it('중단된 실험은 안 돌 모델을 아예 안 넘긴다', async () => {
    const experiment = await trained(['decision_tree', 'knn'])
    // 주장이 둘인 실험은 둘 다 넘긴다 - 안 그러면 아래가 아무것도 안 가른다.
    expect(
      reproduceInputOf({ experiment, dataset, testDataset: null }).settings.selectedAlgorithms,
    ).toHaveLength(2)

    const stopped: Experiment = { ...experiment, runs: [experiment.runs[0]!] }
    const input = reproduceInputOf({ experiment: stopped, dataset, testDataset: null })
    expect(
      input.settings.selectedAlgorithms,
      'a run that never happened is not run again',
    ).toHaveLength(1)
  })
})

/**
 * **점검이 채우는 실행 환경** (open-decisions.md "재실행은 학습 경로를 그대로 탄다").
 *
 * **상한은 끈다.** 학생이 상한을 끄고 학습한 제출물을 교사 기기가 거절하면 **대조 자체가
 * 불가능해진다** — 거절 대신 경고가 맞다.
 *
 * 여기 검사가 없던 동안 `limitsOff: true`를 `false`로 뒤집어도 저장소 어디서도 안 울었다
 * (2026-09-18 R28 B-4). 픽스처가 전부 상한 아래라, 되돌아가도 **다치는 파일이 검사에
 * 하나도 없다.**
 */
describe('점검이 채우는 실행 환경', () => {
  it('상한을 끄고, 행 수는 표에서 읽고, 서버는 모르는 채로 둔다', async () => {
    const experiment = await trained(['decision_tree'])
    const { context } = reproduceInputOf({ experiment, dataset, testDataset: null })
    expect(context.limitsOff, 'a submission trained with limits off must still be checkable').toBe(
      true,
    )
    expect(context.rowCount).toBe(dataset.rows.length)
    expect(context.serverStatus).toBe('unknown')
    expect(context.engineStates).toEqual({})
  })

  /** 파일에 적힌 분할을 그대로 넘긴다 — 다시 나누면 대조가 아니라 새 학습이다. */
  it('기록된 분할을 그대로 넘긴다', async () => {
    const experiment = await trained(['decision_tree'])
    const { recordedSplit } = reproduceInputOf({ experiment, dataset, testDataset: null })
    expect(recordedSplit, 'the recorded split must reach the training path').toBeDefined()
    expect(recordedSplit?.trainIndices).toEqual(experiment.settings.trainIndices)
    expect(recordedSplit?.testIndices).toEqual(experiment.settings.testIndices)
  })
})

/**
 * **run 하나씩 견주는 자리** (2026-09-18 R28 B-8·B-9).
 *
 * 화면이 실제로 부르는 것은 `compareExperiments`인데 이 파일의 검사는 거의 전부
 * `reproduceExperiment`를 지났고, 그쪽은 학습 루프의 `index`로 짝을 짓는다. 그래서
 * **화면이 쓰는 짝짓기에는 검사가 없었다.**
 */
describe('실험끼리 견준다', () => {
  /** 이 주장과 똑같이 생긴 신선한 실험. 지표만 갈아 끼울 수 있다. */
  function fresh(claim: Experiment, metrics?: Record<string, number>[]): Experiment {
    return {
      ...claim,
      runs: claim.runs.map((one, index) => ({
        ...one,
        ...(metrics?.[index] ? { metrics: metrics[index] } : {}),
      })),
    }
  }

  /**
   * **짝은 `runs.json`의 자리다.** 앞에 실패한 run이 있으면 성공한 것만 세는 방식으로는
   * 뒤 run이 **엉뚱한 것과 견줘진다** — 실패한 자리도 신선한 쪽에 그대로 있기 때문이다.
   */
  it('앞에 실패한 run이 있어도 뒤 run이 제 짝과 견줘진다', async () => {
    const trained2 = await trained(['decision_tree', 'knn'])
    const failed: Run = { ...trained2.runs[0]!, status: 'failed', metrics: {} }
    const claim: Experiment = { ...trained2, runs: [failed, trained2.runs[1]!] }

    const found = compareExperiments(claim, fresh(trained2))
    expect(found, 'only the succeeded claim is compared').toHaveLength(1)
    expect(found[0]?.runId).toBe(trained2.runs[1]?.id)
    expect(found[0]?.status).toBe('REPRODUCED')
  })

  /**
   * **파일에 없는 지표는 아예 빠진다** (`Reproduction.deltas`). 없는 것과 어긋난 것은
   * 다른 말이고, **옛 파일에는 지금 있는 지표가 없을 수 있다** — `value - 0`으로 세면
   * 지표가 하나 는 배포 뒤에 정직한 학생이 `재현되지 않음`이 된다.
   */
  it('파일에 없는 지표는 차이로 안 센다', async () => {
    const claim = await trained(['decision_tree'])
    const thin: Experiment = {
      ...claim,
      runs: [
        { ...claim.runs[0]!, metrics: { accuracy: claim.runs[0]?.metrics?.['accuracy'] ?? 0 } },
      ],
    }

    const [found] = compareExperiments(thin, fresh(claim))
    expect(
      Object.keys(found?.deltas ?? {}),
      'a metric the file never had is not a difference',
    ).toEqual(['accuracy'])
    expect(found?.status).toBe('REPRODUCED')
  })

  /** 자리가 비면 지목하지 않는다 — 우리가 못 돌린 것이지 학생이 고친 것이 아니다. */
  it('신선한 쪽에 그 자리가 없으면 엔진 없음이다', async () => {
    const claim = await trained(['decision_tree'])
    const [found] = compareExperiments(claim, { ...claim, runs: [] })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
  })

  /**
   * **run이 선택보다 많은 파일** (2026-09-18 R28-V). `runs.json`에 run을 덧붙이는 것이
   * 정확히 이 층의 위협 모형이고, 그때 `selectedAlgorithms`는 그대로라 조립이 신선한
   * 쪽을 **짧게** 만든다 — `reproduceExperiment`의 폴백이 그 자리를 채운다.
   *
   * **그 폴백은 "등록부에 없는 알고리즘 때문"이라고 적혀 있었고 그것은 거짓이었다**
   * (R28 C-2). 이유를 고쳐 적었으니 그 경로가 실제로 서는 것도 여기서 못 박는다.
   */
  it('run을 덧붙인 파일은 덧붙인 자리가 엔진 없음으로 선다', async () => {
    const honest = await trained(['decision_tree'])
    const padded: Experiment = {
      ...honest,
      runs: [honest.runs[0]!, { ...honest.runs[0]!, id: 'x' }],
    }

    const found = await reproduceExperiment({ experiment: padded, dataset, testDataset: null })
    expect(found, 'both claims are answered').toHaveLength(2)
    expect(found[0]?.status).toBe('REPRODUCED')
    expect(found[1]?.status, 'a run that was never selected cannot be run again').toBe(
      'ENGINE_UNAVAILABLE',
    )
  })
})

/**
 * **못 가르는 자리는 교사에게 넘긴다** (`NOT_JUDGED`).
 *
 * `Math.exp`/`log`/`pow`를 누적하는 알고리즘은 JS 엔진마다 마지막 자리가 갈릴 수 있어
 * (미결정 12), 그 칸에서 붉은 말을 하면 **정직한 학생을 지목한다.** 판정이 갈리는
 * 축은 알고리즘이 아니라 (알고리즘 × 엔진)이고, 등록부가 그것을 갖는다.
 */
describe('판정은 등록부가 정한다', () => {
  async function tamper(algorithm: string): Promise<Reproduction | undefined> {
    const experiment = await trained([algorithm])
    const tampered = await withRun(experiment, 0, {
      metrics: { ...experiment.runs[0]?.metrics, accuracy: 1 },
    })
    const [found] = await reproduceExperiment({ experiment: tampered, dataset, testDataset: null })
    return found
  }

  it('exact인 칸에서는 어긋났다고 말한다', async () => {
    expect((await tamper('decision_tree'))?.status).toBe('NOT_REPRODUCED')
  })

  it('advisory인 칸에서는 판정하지 않고 차이를 보인다', async () => {
    const found = await tamper('logistic_regression')
    expect(found?.status).toBe('NOT_JUDGED')
    // **차이는 그대로 준다.** 판정을 접는 것이지 사실을 감추는 것이 아니다.
    expect(found?.deltas?.['accuracy']).toBeDefined()
  })

  it('advisory라도 차이가 0이면 재현된 것이다', async () => {
    const experiment = await trained(['logistic_regression'])
    const [found] = await reproduceExperiment({ experiment, dataset, testDataset: null })
    expect(found?.status).toBe('REPRODUCED')
  })

  it('등록부에 없는 알고리즘은 학습 경로가 사유와 함께 세운다', async () => {
    // 남의 파일에서 온 모르는 모델이다. **실패 사유가 코드로 온다** - 옛 판은 무엇이든
    // `ENGINE_UNAVAILABLE`로 뭉갰고, 그러면 교사가 손쓸 것이 없다.
    const experiment = await trained(['decision_tree'])
    const unknown: Experiment = {
      ...(await withRun(experiment, 0, {
        algorithm: 'gradient_boosting',
        metrics: { ...experiment.runs[0]?.metrics, accuracy: 1 },
      })),
      settings: {
        ...experiment.settings,
        selectedAlgorithms: [{ algorithm: 'gradient_boosting', runtime: 'mljs' }],
      },
    }
    const [found] = await reproduceExperiment({ experiment: unknown, dataset, testDataset: null })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
    expect(found?.failure?.code).toBe('ALGORITHM_UNSUPPORTED')
  })
})

/**
 * **혼동 행렬은 지표가 못 가르는 것을 가른다** (R4 B-5).
 *
 * 분류 지표의 눈금은 `1/시험 행 수`라 한 칸 올린 변조와 한 행 뒤집힌 엔진 차이의 크기가
 * 같다. 행렬은 **어느 줄이 어디로 갔는지**를 들고 있어 그 둘을 가른다.
 */
describe('혼동 행렬', () => {
  const labels = ['a', 'b']

  it('다른 칸 질량의 절반이 뒤집힌 줄 수다', () => {
    const before = {
      labels,
      matrix: [
        [5, 0],
        [1, 4],
      ],
    }
    const after = {
      labels,
      matrix: [
        [4, 1],
        [1, 4],
      ],
    }
    expect(flippedRows(before, after)).toBe(1)
  })

  it('같은 행렬이면 0이다', () => {
    const matrix = {
      labels,
      matrix: [
        [5, 0],
        [1, 4],
      ],
    }
    expect(flippedRows(matrix, matrix)).toBe(0)
  })

  it('라벨이 다르면 셀 수 없다 - 지어내지 않는다', () => {
    expect(
      flippedRows(
        {
          labels,
          matrix: [
            [1, 0],
            [0, 1],
          ],
        },
        {
          labels: ['b', 'a'],
          matrix: [
            [1, 0],
            [0, 1],
          ],
        },
      ),
    ).toBeUndefined()
    expect(
      flippedRows(undefined, {
        labels,
        matrix: [
          [1, 0],
          [0, 1],
        ],
      }),
    ).toBeUndefined()
  })

  it('대조 결과에 실려 온다', async () => {
    const experiment = await trained(['decision_tree'])
    const [found] = await reproduceExperiment({ experiment, dataset, testDataset: null })
    expect(found?.flipped).toBe(0)
  })

  it('파일 안에서 스스로 어긋나는 것은 재실행 없이 잡힌다', () => {
    const run = {
      id: 'run-1',
      algorithm: 'decision_tree',
      hyperparameters: {},
      computedBy: 'browser',
      trainedAt: '2026-09-18T00:00:00.000Z',
      status: 'done',
      metrics: { accuracy: 0.9 },
      confusionMatrix: {
        labels,
        matrix: [
          [5, 0],
          [1, 4],
        ],
      },
    } as unknown as Run

    expect(storedMetricsMatchMatrix(run)).toBe(true)
    expect(storedMetricsMatchMatrix({ ...run, metrics: { accuracy: 1 } } as unknown as Run)).toBe(
      false,
    )
    // 재료가 없으면 말하지 않는다 - 회귀와 군집에는 행렬이 없다.
    expect(storedMetricsMatchMatrix({ ...run, confusionMatrix: undefined } as unknown as Run)).toBe(
      undefined,
    )
  })
})

/**
 * **잠그는 이유는 목록이다** (`reproduceBlockers`, CLAUDE.md §2).
 *
 * 화면이 "잠겼다"만 알면 교사에게 할 말이 하나뿐이고, 그 하나가 틀릴 수 있다.
 */
describe('대조를 막는 이유', () => {
  async function subject(overrides: Partial<Parameters<typeof reproduceBlockers>[0]> = {}) {
    return {
      experiment: await trained(['decision_tree']),
      dataType: 'tabular' as const,
      hasDataset: true,
      hasTestDataset: false,
      ...overrides,
    }
  }

  it('다 갖춰져 있으면 비어 있다', async () => {
    expect(reproduceBlockers(await subject())).toEqual([])
  })

  it('정본 표가 없으면 막는다', async () => {
    expect(reproduceBlockers(await subject({ hasDataset: false }))).toContain('NO_DATASET')
  })

  it('사진은 첫 판에서 안 연다', async () => {
    expect(reproduceBlockers(await subject({ dataType: 'image' }))).toContain('IMAGE_NOT_OPEN')
  })

  it('성공한 run이 없으면 거기서 멈춘다 - 근본적인 것이 먼저다', async () => {
    const experiment = await trained(['decision_tree'])
    const failed: Experiment = {
      ...experiment,
      runs: experiment.runs.map((run) => ({ ...run, status: 'failed' as const })),
    }
    // 엔진 이야기는 공집합에 대한 말이라 뜻이 없다. 그래서 그 뒤가 안 붙는다.
    expect(reproduceBlockers(await subject({ experiment: failed }))).toEqual(['NO_CLAIM'])
  })

  it('만든 엔진이 여기 없으면 막는다 - 버전만 달라도 그렇다', async () => {
    // **이번 학기까지의 파일이 전부 여기 걸린다** — `mljs@2`로 만들었고 지금은 3이다.
    // 버전이 다르면 같은 이름의 다른 계산기라, 돌려 봐야 숫자를 버리게 된다.
    const experiment = await trained(['decision_tree'])
    const older: Experiment = {
      ...experiment,
      runs: experiment.runs.map((run) => ({ ...run, engine: { kind: 'mljs', version: '2' } })),
    }
    expect(reproduceBlockers(await subject({ experiment: older }))).toContain('ENGINE_MISSING')

    const server: Experiment = {
      ...experiment,
      runs: experiment.runs.map((run) => ({ ...run, engine: { kind: 'sklearn', version: '1' } })),
    }
    expect(reproduceBlockers(await subject({ experiment: server }))).toContain('ENGINE_MISSING')
  })

  /**
   * **하나라도 여기 있으면 연다** (2026-09-18 R28 C-4). 엔진이 섞인 실험 — 한 run은
   * 이 브라우저의 엔진으로, 한 run은 서버로 돈 파일 — 이 자리에 검사가 없어서
   * `some`을 `every`로 바꿔도 아무 데서도 안 울었다.
   *
   * **막으면 대조할 수 있는 run까지 못 돌린다.** 서버로 돈 run은 `ENGINE_UNAVAILABLE`로
   * 와서 그 줄이 스스로 말하므로, 여기서 통째로 잠글 이유가 없다.
   */
  it('엔진이 섞여 있어도 하나가 여기 있으면 안 막는다', async () => {
    const experiment = await trained(['decision_tree', 'knn'])
    const mixed: Experiment = {
      ...experiment,
      runs: [
        experiment.runs[0]!,
        { ...experiment.runs[1]!, engine: { kind: 'sklearn', version: '1' } },
      ],
    }
    expect(reproduceBlockers(await subject({ experiment: mixed }))).toEqual([])
  })
})
