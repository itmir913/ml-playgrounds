/**
 * 묶음 실행.
 *
 * 여기가 지키는 것 셋.
 *
 * 1. **조각을 엮어도 숫자가 그대로다.** mljs.spec.ts가 손으로 엮어 못 박은 값이 묶음
 *    실행을 거쳐도 같아야 한다. 다르면 중간 어딘가가 데이터를 바꾸고 있는 것이다.
 * 2. **묶음 하나가 통째로 실패하지 않는다** (mlpx-spec.md 4.1).
 * 3. **결과가 스키마를 통과한다.** 이 층의 산출물이 곧 runs.json이다.
 *
 * 임의의 하한선("0.8 이상")을 쓰지 마라 - 의존성이 올라가며 0.89가 0.82로 움직여도
 * 통과한다. 그런데 그 움직임이 곧 옛 .mlpx의 "재현되지 않음"이다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { runBatch, type BatchInput } from '../src/ml/batch'
import type { RuntimeContext } from '../src/ml/backend'
import type { Dataset } from '../src/ml/preprocess'
import { batchSchema, type Run, type RunsFile, type Settings } from '../src/project/schema'
import {
  IRIS_FEATURE_COLUMNS,
  IRIS_TARGET_COLUMN,
  irisDataset,
  IRIS_FEATURES,
} from './fixtures/iris'

/** 서버도 무거운 엔진도 없는 상태. 공식 배포(GitHub Pages)가 정확히 이렇다. */
const BROWSER_ONLY: RuntimeContext = { serverStatus: 'unavailable', rowCount: 30 }

function settingsFor(overrides: Partial<Settings> = {}): Settings {
  return {
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'iris.csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features: [...IRIS_FEATURE_COLUMNS],
    target: IRIS_TARGET_COLUMN,
    preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    selectedAlgorithms: ['decision_tree', 'knn'],
    hyperparameters: {},
    ...overrides,
  }
}

function inputFor(overrides: Partial<BatchInput> = {}): BatchInput {
  return {
    dataset: irisDataset(),
    taskType: 'classification',
    dataType: 'tabular',
    settings: settingsFor(),
    runtime: 'mljs',
    context: BROWSER_ONLY,
    ...overrides,
  }
}

/** 시계를 고정한다. 같은 설정으로 두 번 돌린 결과를 통째로 비교하려면 필요하다. */
const FIXED_TIME = '2026-08-04T10:30:00.000Z'
const frozen = { now: () => FIXED_TIME }

describe('묶음이 실제로 학습한다', () => {
  /**
   * **mljs.spec.ts의 PINNED와 같은 값이다.** 전처리가 무해할 때(스케일링 none,
   * 결측 없음) 묶음 실행은 손으로 엮은 경로와 완전히 같은 것을 해야 한다.
   * 여기가 갈라지면 분할·전처리·타깃 추출 중 하나가 데이터를 건드리고 있는 것이다.
   */
  const PINNED: Record<string, number> = {
    decision_tree: 7 / 9,
    knn: 8 / 9,
    random_forest: 8 / 9,
    logistic_regression: 1,
    naive_bayes: 3 / 9,
  }

  const { batch } = runBatch(
    inputFor({ settings: settingsFor({ selectedAlgorithms: Object.keys(PINNED) }) }),
    frozen,
  )

  for (const [algorithm, accuracy] of Object.entries(PINNED)) {
    it(`${algorithm}의 정확도가 손으로 엮은 경로와 같다`, () => {
      const run = batch.runs.find((candidate) => candidate.algorithm === algorithm)
      expect(run?.status, algorithm).toBe('done')
      expect(run?.metrics?.accuracy, algorithm).toBeCloseTo(accuracy, 10)
    })
  }

  it('결과가 스키마를 통과한다', () => {
    expect(() => batchSchema.parse(batch)).not.toThrow()
  })

  it('분류에는 혼동 행렬과 클래스별 지표가 있다', () => {
    const run = batch.runs[0]
    expect(run?.confusionMatrix?.labels).toEqual(['setosa', 'versicolor', 'virginica'])
    expect(run?.perClass?.map((entry) => entry.label)).toEqual([
      'setosa',
      'versicolor',
      'virginica',
    ])
  })

  it('무엇으로 만들었는지 남는다 - 재실행 대조가 엔진을 넘지 않는다', () => {
    for (const run of batch.runs) {
      expect(run.engine, run.algorithm).toEqual({ kind: 'mljs', version: '1' })
      expect(run.computedBy, run.algorithm).toBe('browser')
    }
  })

  it('전처리기는 묶음 안이 아니라 따로 나온다', () => {
    const result = runBatch(inputFor(), frozen)
    expect(result.preprocessor.format).toBe('mlpx-preprocess-v1')
    // zip 안의 경로를 가리키는 참조는 저장 계층이 채운다. 여기서 적으면 거짓말이 된다.
    expect(result.batch.preprocessor).toBeUndefined()
  })
})

describe('묶음 전체가 같은 분할과 전처리를 쓴다', () => {
  it('분할 인덱스가 묶음에 남고 서로 겹치지 않는다', () => {
    const { batch } = runBatch(inputFor(), frozen)
    const { trainIndices, testIndices } = batch.settings

    expect([...trainIndices, ...testIndices].sort((a, b) => a - b)).toEqual([
      ...IRIS_FEATURES.keys(),
    ])
    expect(trainIndices.filter((index) => testIndices.includes(index))).toEqual([])
  })

  it('전처리 파라미터가 학습셋에서만 나온다', () => {
    // 평가셋이 섞이면 지표가 조용히 부풀고, 학생은 자기 모델이 실제보다 좋다고 믿는다.
    const { batch, preprocessor } = runBatch(
      inputFor({
        settings: settingsFor({
          preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
        }),
      }),
      frozen,
    )

    const trainOnly = batch.settings.trainIndices.map((row) => IRIS_FEATURES[row]?.[0] ?? 0)
    const expected = trainOnly.reduce((sum, value) => sum + value, 0) / trainOnly.length
    expect(preprocessor.columns[0]?.scale?.center).toBeCloseTo(expected, 10)

    // 전체 평균과 달라야 한다. 같으면 학습셋만 봤다는 증거가 되지 못한다.
    const all = IRIS_FEATURES.map((values) => values[0] ?? 0)
    expect(expected).not.toBeCloseTo(all.reduce((sum, v) => sum + v, 0) / all.length, 10)
  })
})

describe('재현 가능성', () => {
  it('같은 설정으로 두 번 돌리면 묶음이 통째로 같다', () => {
    const first = runBatch(inputFor(), frozen)
    const second = runBatch(inputFor(), frozen)
    expect(second.batch).toEqual(first.batch)
    expect(second.preprocessor).toEqual(first.preprocessor)
  })

  it('randomState가 다르면 분할이 달라진다', () => {
    const other = runBatch(
      inputFor({
        settings: settingsFor({
          split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 7 },
        }),
      }),
      frozen,
    )
    const base = runBatch(inputFor(), frozen)
    expect(other.batch.settings.testIndices).not.toEqual(base.batch.settings.testIndices)
  })
})

describe('일부만 실패한다', () => {
  it('모르는 알고리즘이 섞여도 나머지 결과는 나온다', () => {
    const { batch } = runBatch(
      inputFor({
        settings: settingsFor({ selectedAlgorithms: ['decision_tree', '없는알고리즘', 'knn'] }),
      }),
      frozen,
    )

    expect(batch.runs.map((run) => run.status)).toEqual(['done', 'failed', 'done'])
    expect(batch.runs[1]?.failure).toEqual({
      code: 'ALGORITHM_UNSUPPORTED',
      params: { algorithm: '없는알고리즘' },
    })
    expect(batch.runs[1]?.metrics).toBeUndefined()
  })

  it('svm은 순수 JS 구현이 없어 실패하고 사유가 남는다', () => {
    // 자동으로 넘어갈 곳이 없다 - pyodide는 안 켜져 있고 서버도 없다.
    const { batch } = runBatch(
      inputFor({ settings: settingsFor({ selectedAlgorithms: ['svm'] }) }),
      frozen,
    )

    expect(batch.runs[0]?.status).toBe('failed')
    expect(batch.runs[0]?.failure?.code).toBe('ENGINE_NOT_READY')
  })

  it('엔진 내부에서 터진 것도 사유와 원문을 남긴다', () => {
    /**
     * **ml-random-forest는 나무가 적으면 터진다.** 어떤 학습 샘플이 모든 나무에서
     * in-bag이면 OOB 예측이 하나도 없는데 그 경우를 검사하지 않는다. 붓꽃 30행에서
     * nEstimators 5 이하는 시드를 바꿔도 전부 실패했고, 15부터 안정적이다.
     * 데이터가 클수록 더 잘 터진다 - 그런 샘플이 하나라도 나올 확률이 올라간다.
     *
     * "나무 개수"는 학생이 가장 먼저 줄여 볼 손잡이다. 그래서 이 실패는 이론이 아니라
     * 교실에서 일어난다. 어휘를 늘리는 대신 JOB_FAILED에 원문을 실어 보낸다 -
     * 학생은 못 읽어도 **옆에 있는 교사는 읽고 대처할 수 있고**, 이 값은 runs.json에
     * 그대로 들어가 .mlpx를 여는 교사에게까지 따라간다.
     *
     * **여기가 통과로 뒤집히면 ml-random-forest가 고쳐진 것이다.** 그때 이 테스트를
     * 지우고 위 설명도 함께 지워라.
     */
    const { batch } = runBatch(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: ['random_forest'],
          hyperparameters: { random_forest: { nEstimators: 3 } },
        }),
      }),
      frozen,
    )

    const [run] = batch.runs
    expect(run?.status).toBe('failed')
    expect(run?.failure?.code).toBe('JOB_FAILED')
    expect(typeof run?.failure?.params?.detail).toBe('string')
    expect(() => batchSchema.parse(batch)).not.toThrow()
  })

  it('실패한 run도 스키마를 통과한다 - 사유가 반드시 있다', () => {
    const { batch } = runBatch(
      inputFor({ settings: settingsFor({ selectedAlgorithms: ['svm', '없는알고리즘'] }) }),
      frozen,
    )
    expect(() => batchSchema.parse(batch)).not.toThrow()
  })

  it('분할이 성립하지 않으면 묶음 자체가 던진다', () => {
    // run을 만들어 봐야 전부 같은 사유로 실패한다. 학생이 같은 문장을 모델 수만큼 볼 뿐이다.
    const tiny: Dataset = { columns: [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN], rows: [] }
    expect(() => runBatch(inputFor({ dataset: tiny }), frozen)).toThrow()
  })

  it('타깃을 안 골랐으면 TARGET_NOT_SELECTED로 던진다', () => {
    // 군집화에는 타깃이 없어서 스키마상 선택 항목이지만, 분류·회귀는 정답 열이 없으면
    // 학습도 채점도 못 한다. 열을 안 고른 것과 빈 문자열을 같게 다룬다.
    const withoutTarget = settingsFor()
    delete withoutTarget.target

    for (const settings of [withoutTarget, settingsFor({ target: '' })]) {
      try {
        runBatch(inputFor({ settings }), frozen)
        expect.unreachable()
      } catch (error) {
        expect(isClientError(error)).toBe(true)
        if (isClientError(error)) expect(error.code).toBe('TARGET_NOT_SELECTED')
      }
    }
  })
})

describe('진행 보고', () => {
  it('모델 하나가 끝날 때마다 부른다', () => {
    const seen: { algorithm: string; completed: number; total: number }[] = []
    const { batch } = runBatch(
      inputFor({
        settings: settingsFor({ selectedAlgorithms: ['decision_tree', 'knn', 'naive_bayes'] }),
      }),
      {
        ...frozen,
        onRun: (run: Run, completed: number, total: number) =>
          seen.push({ algorithm: run.algorithm, completed, total }),
      },
    )

    expect(seen).toEqual([
      { algorithm: 'decision_tree', completed: 1, total: 3 },
      { algorithm: 'knn', completed: 2, total: 3 },
      { algorithm: 'naive_bayes', completed: 3, total: 3 },
    ])
    expect(batch.runs).toHaveLength(3)
  })

  it('실패한 모델도 보고한다 - 진행률이 거기서 멈추면 안 된다', () => {
    let calls = 0
    runBatch(inputFor({ settings: settingsFor({ selectedAlgorithms: ['svm', 'knn'] }) }), {
      ...frozen,
      onRun: () => {
        calls += 1
      },
    })
    expect(calls).toBe(2)
  })
})

describe('id와 changed', () => {
  const first = runBatch(inputFor(), frozen).batch
  const history: RunsFile = { batches: [first] }

  it('첫 묶음은 batch-1이고 run 번호가 1부터다', () => {
    expect(first.id).toBe('batch-1')
    expect(first.runs.map((run) => run.id)).toEqual(['run-1', 'run-2'])
  })

  it('첫 묶음에는 changed가 없다 - 빈 배열은 다른 뜻이다', () => {
    expect(first.changed).toBeUndefined()
  })

  it('run 번호는 프로젝트 전역으로 이어진다', () => {
    const second = runBatch(inputFor(), { ...frozen, history }).batch
    expect(second.id).toBe('batch-2')
    expect(second.runs.map((run) => run.id)).toEqual(['run-3', 'run-4'])
  })

  it('바꾼 것이 없으면 changed가 비어 있다', () => {
    expect(runBatch(inputFor(), { ...frozen, history }).batch.changed).toEqual([])
  })

  it('바뀐 설정의 경로만 집는다', () => {
    const second = runBatch(
      inputFor({
        settings: settingsFor({
          preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
        }),
      }),
      { ...frozen, history },
    ).batch
    expect(second.changed).toEqual(['preprocessing.scaling'])
  })

  it('하이퍼파라미터는 바꾼 값 이름까지 집는다 - 학생이 가장 자주 바꾸는 것이다', () => {
    const second = runBatch(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: ['decision_tree', 'knn'],
          hyperparameters: { knn: { k: 3 } },
        }),
      }),
      { ...frozen, history },
    ).batch
    // 'hyperparameters.knn'이 아니라 여기까지 온다. 학생이 실제로 돌린 손잡이가 k이고,
    // 비교표 옆에 "KNN의 k를 바꿨다"로 그대로 쓸 수 있다.
    expect(second.changed).toEqual(['hyperparameters.knn.k'])
  })

  it('고른 알고리즘이 바뀌면 잡는다', () => {
    const second = runBatch(
      inputFor({ settings: settingsFor({ selectedAlgorithms: ['decision_tree'] }) }),
      { ...frozen, history },
    ).batch
    expect(second.changed).toEqual(['algorithms'])
  })

  it('묶음이 과제 유형을 스냅샷하고 changed가 그것을 잡는다', () => {
    // manifest의 taskType은 현재 값만 남는다. 학생이 분류에서 회귀로 바꾸면 옛 묶음의
    // accuracy와 새 묶음의 r2가 비교표에서 같은 열에 서는데, 묶음 자신이 무엇으로
    // 돌았는지 들고 있지 않으면 화면이 그걸 구분할 근거가 없다.
    expect(first.settings.taskType).toBe('classification')

    const regression = runBatch(
      {
        dataset: {
          columns: ['x', 'y'],
          rows: [...Array(10).keys()].map((x) => [`${x}`, `${2 * x + 1}`]),
        },
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: ['linear_regression'],
        }),
        runtime: 'mljs',
        context: { serverStatus: 'unavailable', rowCount: 10 },
      },
      { ...frozen, history },
    ).batch

    expect(regression.settings.taskType).toBe('regression')
    expect(regression.changed).toContain('taskType')
  })

  it('분할 인덱스는 changed에 안 나온다 - 학생에게 아무 뜻이 없다', () => {
    const second = runBatch(
      inputFor({
        settings: settingsFor({
          split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 7 },
        }),
      }),
      { ...frozen, history },
    ).batch
    expect(second.changed).toEqual(['split.randomState'])
  })
})

describe('회귀', () => {
  /** y = 2x + 1. 완전히 맞히므로 값을 그대로 못 박을 수 있다. */
  const line: Dataset = {
    columns: ['x', 'y'],
    rows: [...Array(10).keys()].map((x) => [String(x), String(2 * x + 1)]),
  }

  const { batch } = runBatch(
    {
      dataset: line,
      taskType: 'regression',
      dataType: 'tabular',
      settings: settingsFor({
        features: ['x'],
        target: 'y',
        split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
        selectedAlgorithms: ['linear_regression'],
      }),
      runtime: 'mljs',
      context: { serverStatus: 'unavailable', rowCount: 10 },
    },
    frozen,
  )

  it('직선을 정확히 찾는다', () => {
    expect(batch.runs[0]?.status).toBe('done')
    expect(batch.runs[0]?.metrics?.r2).toBeCloseTo(1, 10)
    expect(batch.runs[0]?.metrics?.mae).toBeCloseTo(0, 10)
  })

  it('혼동 행렬도 클래스별 지표도 없다', () => {
    expect(batch.runs[0]?.confusionMatrix).toBeUndefined()
    expect(batch.runs[0]?.perClass).toBeUndefined()
  })

  it('스키마를 통과한다', () => {
    expect(() => batchSchema.parse(batch)).not.toThrow()
  })
})
