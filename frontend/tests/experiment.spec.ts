/**
 * 실험 실행.
 *
 * 여기가 지키는 것 셋.
 *
 * 1. **조각을 엮어도 숫자가 그대로다.** mljs.spec.ts가 손으로 엮어 못 박은 값이 실험
 *    실행을 거쳐도 같아야 한다. 다르면 중간 어딘가가 데이터를 바꾸고 있는 것이다.
 * 2. **실험 하나가 통째로 실패하지 않는다** (mlpx-spec.md 4.1).
 * 3. **결과가 스키마를 통과한다.** 이 층의 산출물이 곧 runs.json이다.
 *
 * 임의의 하한선("0.8 이상")을 쓰지 마라 - 의존성이 올라가며 0.89가 0.82로 움직여도
 * 통과한다. 그런데 그 움직임이 곧 옛 .mlpx의 "재현되지 않음"이다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import type { RuntimeContext } from '../src/ml/backend'
import type { Dataset } from '../src/ml/preprocess'
import { experimentSchema, type Run, type RunsFile, type Settings } from '../src/project/schema'
import {
  IRIS_FEATURE_COLUMNS,
  IRIS_TARGET_COLUMN,
  irisDataset,
  IRIS_FEATURES,
} from './fixtures/iris'

/**
 * 모델 목록을 짧게 쓴다. 실행 방법을 안 적으면 실험 기본(settings.runtime)을 따른다 -
 * 학생 대부분이 그렇게 쓴다.
 */
const models = (...names: string[]) => names.map((algorithm) => ({ algorithm }))

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
    runtime: 'mljs',
    selectedAlgorithms: models('decision_tree', 'knn'),
    hyperparameters: {},
    ...overrides,
  }
}

function inputFor(overrides: Partial<ExperimentInput> = {}): ExperimentInput {
  return {
    dataset: irisDataset(),
    taskType: 'classification',
    dataType: 'tabular',
    settings: settingsFor(),
    context: BROWSER_ONLY,
    ...overrides,
  }
}

/** 시계를 고정한다. 같은 설정으로 두 번 돌린 결과를 통째로 비교하려면 필요하다. */
const FIXED_TIME = '2026-08-04T10:30:00.000Z'
const frozen = { now: () => FIXED_TIME }

describe('실험이 실제로 학습한다', () => {
  /**
   * **mljs.spec.ts의 PINNED와 같은 값이다.** 전처리가 무해할 때(스케일링 none,
   * 결측 없음) 실험 실행은 손으로 엮은 경로와 완전히 같은 것을 해야 한다.
   * 여기가 갈라지면 분할·전처리·타깃 추출 중 하나가 데이터를 건드리고 있는 것이다.
   */
  const PINNED: Record<string, number> = {
    decision_tree: 7 / 9,
    knn: 8 / 9,
    random_forest: 8 / 9,
    logistic_regression: 1,
    naive_bayes: 8 / 9,
  }

  const { experiment } = runExperiment(
    inputFor({ settings: settingsFor({ selectedAlgorithms: models(...Object.keys(PINNED)) }) }),
    frozen,
  )

  for (const [algorithm, accuracy] of Object.entries(PINNED)) {
    it(`${algorithm}의 정확도가 손으로 엮은 경로와 같다`, () => {
      const run = experiment.runs.find((candidate) => candidate.algorithm === algorithm)
      expect(run?.status, algorithm).toBe('done')
      expect(run?.metrics?.accuracy, algorithm).toBeCloseTo(accuracy, 10)
    })
  }

  it('결과가 스키마를 통과한다', () => {
    expect(() => experimentSchema.parse(experiment)).not.toThrow()
  })

  it('분류에는 혼동 행렬과 클래스별 지표가 있다', () => {
    const run = experiment.runs[0]
    expect(run?.confusionMatrix?.labels).toEqual(['setosa', 'versicolor', 'virginica'])
    expect(run?.perClass?.map((entry) => entry.label)).toEqual([
      'setosa',
      'versicolor',
      'virginica',
    ])
  })

  it('무엇으로 만들었는지 남는다 - 재실행 대조가 엔진을 넘지 않는다', () => {
    for (const run of experiment.runs) {
      expect(run.engine, run.algorithm).toEqual({ kind: 'mljs', version: '2' })
      expect(run.computedBy, run.algorithm).toBe('browser')
    }
  })

  it('전처리기는 실험 안이 아니라 따로 나온다', () => {
    const result = runExperiment(inputFor(), frozen)
    expect(result.preprocessor.format).toBe('mlpx-preprocess-v1')
    // zip 안의 경로를 가리키는 참조는 저장 계층이 채운다. 여기서 적으면 거짓말이 된다.
    expect(result.experiment.preprocessor).toBeUndefined()
  })
})

describe('실험 전체가 같은 분할과 전처리를 쓴다', () => {
  it('분할 인덱스가 실험에 남고 서로 겹치지 않는다', () => {
    const { experiment } = runExperiment(inputFor(), frozen)
    const { trainIndices, testIndices } = experiment.settings

    expect([...trainIndices, ...testIndices].sort((a, b) => a - b)).toEqual([
      ...IRIS_FEATURES.keys(),
    ])
    expect(trainIndices.filter((index) => testIndices.includes(index))).toEqual([])
  })

  it('전처리 파라미터가 학습셋에서만 나온다', () => {
    // 평가셋이 섞이면 지표가 조용히 부풀고, 학생은 자기 모델이 실제보다 좋다고 믿는다.
    const { experiment, preprocessor } = runExperiment(
      inputFor({
        settings: settingsFor({
          preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
        }),
      }),
      frozen,
    )

    const trainOnly = experiment.settings.trainIndices.map((row) => IRIS_FEATURES[row]?.[0] ?? 0)
    const expected = trainOnly.reduce((sum, value) => sum + value, 0) / trainOnly.length
    expect(preprocessor.columns[0]?.scale?.center).toBeCloseTo(expected, 10)

    // 전체 평균과 달라야 한다. 같으면 학습셋만 봤다는 증거가 되지 못한다.
    const all = IRIS_FEATURES.map((values) => values[0] ?? 0)
    expect(expected).not.toBeCloseTo(all.reduce((sum, v) => sum + v, 0) / all.length, 10)
  })
})

describe('재현 가능성', () => {
  it('같은 설정으로 두 번 돌리면 실험이 통째로 같다', () => {
    const first = runExperiment(inputFor(), frozen)
    const second = runExperiment(inputFor(), frozen)
    expect(second.experiment).toEqual(first.experiment)
    expect(second.preprocessor).toEqual(first.preprocessor)
  })

  it('randomState가 다르면 분할이 달라진다', () => {
    const other = runExperiment(
      inputFor({
        settings: settingsFor({
          split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 7 },
        }),
      }),
      frozen,
    )
    const base = runExperiment(inputFor(), frozen)
    expect(other.experiment.settings.testIndices).not.toEqual(base.experiment.settings.testIndices)
  })
})

describe('일부만 실패한다', () => {
  it('모르는 알고리즘이 섞여도 나머지 결과는 나온다', () => {
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('decision_tree', '없는알고리즘', 'knn'),
        }),
      }),
      frozen,
    )

    expect(experiment.runs.map((run) => run.status)).toEqual(['done', 'failed', 'done'])
    expect(experiment.runs[1]?.failure).toEqual({
      code: 'ALGORITHM_UNSUPPORTED',
      params: { algorithm: '없는알고리즘' },
    })
    expect(experiment.runs[1]?.metrics).toBeUndefined()
  })

  it('실행 방법에 맞는 하이퍼파라미터만 먹인다', () => {
    // ml.js는 maxDepth, sklearn은 max_depth다. 한 자리에 섞어 두면 학생이 실행 방법을
    // 바꿨을 때 맞춰 둔 값이 조용히 무시되고 화면에는 그 값이 그대로 떠 있다.
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('decision_tree'),
          hyperparameters: {
            decision_tree: { mljs: { maxDepth: 1 }, 'server-sklearn': { max_depth: 100 } },
          },
        }),
      }),
      frozen,
    )

    // 학생 값이 이기고, 안 건드린 자리는 엔진 기본값으로 채워진다. max_depth는 저쪽
    // 실행 방법의 어휘라 여기 오지 않는다.
    expect(experiment.runs[0]?.hyperparameters).toEqual({ maxDepth: 1, minNumSamples: 3 })

    // 실제로 먹혔는지까지 본다. 깊이 1이면 붓꽃 세 품종을 가를 수 없다.
    const deep = runExperiment(inputFor(), frozen).experiment.runs[0]
    expect(experiment.runs[0]?.metrics?.accuracy).toBeLessThan(deep?.metrics?.accuracy ?? 0)
  })

  it('svm은 순수 JS 구현이 없어 실패하고 사유가 남는다', () => {
    // 자동으로 넘어갈 곳이 없다 - pyodide는 안 켜져 있고 서버도 없다.
    const { experiment } = runExperiment(
      inputFor({ settings: settingsFor({ selectedAlgorithms: models('svm') }) }),
      frozen,
    )

    expect(experiment.runs[0]?.status).toBe('failed')
    expect(experiment.runs[0]?.failure?.code).toBe('ENGINE_NOT_READY')
    // 아무 엔진도 안 돌았으므로 확정할 주체가 없다. 학생이 준 것 그대로다.
    expect(experiment.runs[0]?.hyperparameters).toEqual({})
  })

  it('학습이 터져도 무엇을 먹였는지가 남는다', () => {
    // 나무 0그루는 라이브러리가 던진다. 확정이 fit 뒤였다면 실패한 run에는 아무 값도
    // 안 남고, 같은 필드가 성공과 실패에서 두 가지 뜻을 갖게 된다.
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('random_forest'),
          hyperparameters: { random_forest: { mljs: { nEstimators: 0 } } },
        }),
      }),
      frozen,
    )

    expect(experiment.runs[0]?.status).toBe('failed')
    expect(experiment.runs[0]?.hyperparameters).toEqual({ nEstimators: 0 })
  })

  it('학생이 안 건드려도 실제로 먹인 값이 남는다', () => {
    // 빈 객체가 남으면 교사가 파일을 열고 "이 결정트리는 깊이 몇이었나"에 답할 수 없다.
    const { experiment } = runExperiment(inputFor(), frozen)
    expect(experiment.runs[0]?.hyperparameters).toEqual({ maxDepth: 100, minNumSamples: 3 })
  })

  it('모델별로 고른 실행 방법이 사유를 바꾼다 - 덮어쓰기가 실제로 먹는다', () => {
    // 학생이 SVM만 학교 서버로 지정했다. 실험 기본은 순수 JS 그대로다.
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: [
            { algorithm: 'decision_tree' },
            { algorithm: 'svm', runtime: 'server-sklearn' },
          ],
        }),
      }),
      frozen,
    )

    expect(experiment.runs.map((run) => run.status)).toEqual(['done', 'failed'])
    // 기본을 따랐다면 pyodide가 먼저 걸려 ENGINE_NOT_READY였다. 서버를 콕 집었으므로
    // 서버가 없다는 사유가 나와야 한다 - 학생이 고른 것에 대해 답해야 한다.
    expect(experiment.runs[1]?.failure?.code).toBe('SERVER_UNAVAILABLE')

    // 스냅샷에는 기본값이 채워진 채로 남는다. 읽는 쪽이 규칙을 몰라도 된다.
    expect(experiment.settings.runtime).toBe('mljs')
    expect(experiment.settings.selectedAlgorithms).toEqual([
      { algorithm: 'decision_tree', runtime: 'mljs' },
      { algorithm: 'svm', runtime: 'server-sklearn' },
    ])
  })

  it('같은 알고리즘을 여러 실행 방법으로 나란히 고를 수 있다', () => {
    // "같은 SVM인데 엔진이 다르면 왜 숫자가 다른가"를 한 실험 안에서 볼 수 있어야 한다.
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: [
            { algorithm: 'svm', runtime: 'mljs' },
            { algorithm: 'svm', runtime: 'pyodide-sklearn' },
            { algorithm: 'svm', runtime: 'server-sklearn' },
          ],
        }),
      }),
      frozen,
    )

    expect(experiment.runs).toHaveLength(3)
    expect(experiment.runs.map((run) => run.id)).toEqual(['run-1', 'run-2', 'run-3'])

    // **콕 집어 고른 것은 자동으로 안 옮긴다.** 옮기면 셋이 같은 곳으로 몰려 똑같은
    // 줄 세 개가 나오고, 비교하려던 것이 사라진다. 대신 사유가 각각 다르다.
    expect(experiment.runs.map((run) => run.failure?.code)).toEqual([
      'ENGINE_NOT_READY', // 순수 JS에는 svm 구현이 없다 - 막다른 답 대신 준비 가능한 쪽을 준다
      'ENGINE_NOT_READY', // pyodide를 아직 안 켰다
      'SERVER_UNAVAILABLE', // 학교 서버가 없다
    ])
  })

  it('물려받은 것만 자동으로 옮긴다', () => {
    // 기본을 따른 SVM은 되는 곳을 찾아 나서고(여기서는 없어서 실패), 콕 집은 것은
    // 고른 자리에서 판정된다. 둘의 사유가 다른 것이 그 차이의 증거다.
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          runtime: 'server-sklearn',
          selectedAlgorithms: [{ algorithm: 'decision_tree' }],
        }),
      }),
      frozen,
    )

    // 기본이 학교 서버인데 없다 -> 순수 JS로 넘어가 실제로 돈다.
    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.engine).toEqual({ kind: 'mljs', version: '2' })
    // 요청은 그대로 남는다. 요청과 결과가 다른 것이 화면이 설명할 근거다.
    expect(experiment.settings.selectedAlgorithms).toEqual([
      { algorithm: 'decision_tree', runtime: 'server-sklearn' },
    ])
  })

  it('눈금 밖 손잡이는 그 모델만 실패시킨다', () => {
    /**
     * **나무 0그루는 범위 밖 값이 아니라 값이 아니다.** 화면이 이미 그 자리에서 말하지만
     * 학생은 그대로 [학습]을 누를 수 있고(막지 않는다), 그때 남아야 하는 것은
     * "이 모델은 이래서 안 돌았다"다
     * (open-decisions.md "하이퍼파라미터는 눈금을 주되 막지 않는다").
     *
     * **옆의 모델은 그대로 돈다.** 실험 하나가 통째로 실패하는 일은 없다 (mlpx-spec.md 4.1).
     *
     * 이 자리는 두 번 주인이 바뀌었다. 처음에는 `nEstimators: 3`이었고 **그건
     * ml-random-forest의 실제 결함이었다** - 학습 샘플이 모든 나무에서 in-bag이면 OOB
     * 예측이 비는데 그 경우를 검사하지 않았다. 우리가 OOB 계산을 끄면서(mljs.ts의 noOOB)
     * 안 터지게 됐고, 그다음 `nEstimators: 0`이 "남의 예외가 우리 형식으로 번역되는가"를
     * 대신했다. 이제는 그것도 눈금 검사에 먼저 걸린다.
     *
     * **그래서 지금 이 엔진에서 남의 예외를 부를 방법이 없다.** 트레이너가 등록부에 있는
     * 인자만 골라 넘기므로 모르는 키는 라이브러리에 닿지도 않는다. 번역 자체는
     * errors.spec.ts의 failureDetail이 덮고 있고, 두 번째 엔진이 들어오면 그때 이 자리에
     * 실물이 생긴다.
     */
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('random_forest', 'decision_tree'),
          hyperparameters: { random_forest: { mljs: { nEstimators: 0 } } },
        }),
      }),
      frozen,
    )

    const [forest, tree] = experiment.runs
    expect(forest?.status).toBe('failed')
    expect(forest?.failure?.code).toBe('HYPERPARAM_OUT_OF_RANGE')
    // 무엇이 왜 걸렸는지가 파일에 남는다. 이름은 엔진이 받는 키 그대로다.
    expect(forest?.failure?.params).toMatchObject({ name: 'nEstimators', min: 1, actual: 0 })
    // **시도한 값은 지워지지 않는다** - 실패한 run에도 무엇을 먹였는지가 남아야 한다.
    expect(forest?.hyperparameters).toEqual({ nEstimators: 0 })
    expect(tree?.status).toBe('done')
    expect(() => experimentSchema.parse(experiment)).not.toThrow()
  })

  it('정수 손잡이에 온 소수는 반올림해 확정한다', () => {
    /**
     * 나무 2.5그루는 거부할 값이 아니라 **값이 아니다.** 예전에는 그대로 라이브러리까지
     * 가서 RangeError가 됐다 (open-decisions.md #21).
     *
     * **확정이 곧 기록이므로** 파일에 남는 것도 반올림된 값이다 (mlpx-spec.md 3).
     */
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('random_forest'),
          hyperparameters: { random_forest: { mljs: { nEstimators: 2.5 } } },
        }),
      }),
      frozen,
    )

    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.hyperparameters).toEqual({ nEstimators: 3 })
  })

  it('실패한 run도 스키마를 통과한다 - 사유가 반드시 있다', () => {
    const { experiment } = runExperiment(
      inputFor({ settings: settingsFor({ selectedAlgorithms: models('svm', '없는알고리즘') }) }),
      frozen,
    )
    expect(() => experimentSchema.parse(experiment)).not.toThrow()
  })

  it('분할이 성립하지 않으면 실험 자체가 던진다', () => {
    // run을 만들어 봐야 전부 같은 사유로 실패한다. 학생이 같은 문장을 모델 수만큼 볼 뿐이다.
    const tiny: Dataset = { columns: [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN], rows: [] }
    expect(() => runExperiment(inputFor({ dataset: tiny }), frozen)).toThrow()
  })

  it('타깃을 안 골랐으면 TARGET_NOT_SELECTED로 던진다', () => {
    // 군집화에는 타깃이 없어서 스키마상 선택 항목이지만, 분류·회귀는 정답 열이 없으면
    // 학습도 채점도 못 한다. 열을 안 고른 것과 빈 문자열을 같게 다룬다.
    const withoutTarget = settingsFor()
    delete withoutTarget.target

    for (const settings of [withoutTarget, settingsFor({ target: '' })]) {
      try {
        runExperiment(inputFor({ settings }), frozen)
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
    const { experiment } = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('decision_tree', 'knn', 'naive_bayes'),
        }),
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
    expect(experiment.runs).toHaveLength(3)
  })

  it('실패한 모델도 보고한다 - 진행률이 거기서 멈추면 안 된다', () => {
    let calls = 0
    runExperiment(
      inputFor({ settings: settingsFor({ selectedAlgorithms: models('svm', 'knn') }) }),
      {
        ...frozen,
        onRun: () => {
          calls += 1
        },
      },
    )
    expect(calls).toBe(2)
  })
})

describe('id와 changed', () => {
  const first = runExperiment(inputFor(), frozen).experiment
  const history: RunsFile = { experiments: [first] }

  it('첫 실험은 experiment-1이고 run 번호가 1부터다', () => {
    expect(first.id).toBe('experiment-1')
    expect(first.runs.map((run) => run.id)).toEqual(['run-1', 'run-2'])
  })

  it('첫 실험에는 changed가 없다 - 빈 배열은 다른 뜻이다', () => {
    expect(first.changed).toBeUndefined()
  })

  it('run 번호는 프로젝트 전역으로 이어진다', () => {
    const second = runExperiment(inputFor(), { ...frozen, history }).experiment
    expect(second.id).toBe('experiment-2')
    expect(second.runs.map((run) => run.id)).toEqual(['run-3', 'run-4'])
  })

  it('바꾼 것이 없으면 changed가 비어 있다', () => {
    expect(runExperiment(inputFor(), { ...frozen, history }).experiment.changed).toEqual([])
  })

  it('바뀐 설정의 경로만 집는다', () => {
    const second = runExperiment(
      inputFor({
        settings: settingsFor({
          preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
        }),
      }),
      { ...frozen, history },
    ).experiment
    expect(second.changed).toEqual(['preprocessing.scaling'])
  })

  it('하이퍼파라미터는 바꾼 값 이름까지 집는다 - 학생이 가장 자주 바꾸는 것이다', () => {
    const second = runExperiment(
      inputFor({
        settings: settingsFor({
          selectedAlgorithms: models('decision_tree', 'knn'),
          hyperparameters: { knn: { mljs: { k: 3 } } },
        }),
      }),
      { ...frozen, history },
    ).experiment
    // 알고리즘만이 아니라 실행 방법까지 키에 들어간다. 같은 KNN이라도 순수 JS의 k와
    // sklearn의 n_neighbors는 다른 손잡이라 한 칸에 담으면 안 된다.
    expect(second.changed).toEqual(['hyperparameters.knn:mljs.k'])
  })

  it('고른 알고리즘이 바뀌면 잡는다', () => {
    const second = runExperiment(
      inputFor({ settings: settingsFor({ selectedAlgorithms: models('decision_tree') }) }),
      { ...frozen, history },
    ).experiment
    expect(second.changed).toEqual(['algorithms'])
  })

  it('실험이 과제 유형을 스냅샷하고 changed가 그것을 잡는다', () => {
    // manifest의 taskType은 현재 값만 남는다. 학생이 분류에서 회귀로 바꾸면 옛 실험의
    // accuracy와 새 실험의 r2가 비교표에서 같은 열에 서는데, 실험 자신이 무엇으로
    // 돌았는지 들고 있지 않으면 화면이 그걸 구분할 근거가 없다.
    expect(first.settings.taskType).toBe('classification')

    const regression = runExperiment(
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
          selectedAlgorithms: models('linear_regression'),
        }),
        context: { serverStatus: 'unavailable', rowCount: 10 },
      },
      { ...frozen, history },
    ).experiment

    expect(regression.settings.taskType).toBe('regression')
    expect(regression.changed).toContain('taskType')
  })

  it('분할 인덱스는 changed에 안 나온다 - 학생에게 아무 뜻이 없다', () => {
    const second = runExperiment(
      inputFor({
        settings: settingsFor({
          split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 7 },
        }),
      }),
      { ...frozen, history },
    ).experiment
    expect(second.changed).toEqual(['split.randomState'])
  })
})

describe('회귀', () => {
  /** y = 2x + 1. 완전히 맞히므로 값을 그대로 못 박을 수 있다. */
  const line: Dataset = {
    columns: ['x', 'y'],
    rows: [...Array(10).keys()].map((x) => [String(x), String(2 * x + 1)]),
  }

  const { experiment } = runExperiment(
    {
      dataset: line,
      taskType: 'regression',
      dataType: 'tabular',
      settings: settingsFor({
        features: ['x'],
        target: 'y',
        split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
        selectedAlgorithms: models('linear_regression'),
      }),
      context: { serverStatus: 'unavailable', rowCount: 10 },
    },
    frozen,
  )

  it('직선을 정확히 찾는다', () => {
    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.metrics?.r2).toBeCloseTo(1, 10)
    expect(experiment.runs[0]?.metrics?.mae).toBeCloseTo(0, 10)
  })

  it('혼동 행렬도 클래스별 지표도 없다', () => {
    expect(experiment.runs[0]?.confusionMatrix).toBeUndefined()
    expect(experiment.runs[0]?.perClass).toBeUndefined()
  })

  it('스키마를 통과한다', () => {
    expect(() => experimentSchema.parse(experiment)).not.toThrow()
  })
})

describe('회귀 + 범주형 타깃', () => {
  /** 성적 등급을 타깃으로 회귀를 고른 학생. 교실에서 아주 자연스러운 실수다. */
  const grades: Dataset = {
    columns: ['study_hours', 'grade'],
    rows: [
      ['1', '하'],
      ['2', '하'],
      ['3', '중'],
      ['4', '중'],
      ['5', '상'],
      ['6', '상'],
      ['7', '상'],
      ['8', '중'],
      ['9', '하'],
      ['10', '상'],
    ],
  }

  function runGrades(taskType: ExperimentInput['taskType'], algorithm: string) {
    return runExperiment(
      {
        dataset: grades,
        taskType,
        dataType: 'tabular',
        settings: settingsFor({
          features: ['study_hours'],
          target: 'grade',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models(algorithm),
        }),
        context: { serverStatus: 'unavailable', rowCount: grades.rows.length },
      },
      frozen,
    )
  }

  it('TARGET_NOT_NUMERIC으로 실험이 시작조차 하지 않는다', () => {
    // 넘기면 metrics가 전부 NaN인 채 status가 done이 되고, 저장할 때 JSON이 그것을
    // null로 바꿔 **다시 열리지 않는 .mlpx**가 된다.
    try {
      runGrades('regression', 'linear_regression')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('TARGET_NOT_NUMERIC')
        expect(error.params.target).toBe('grade')
      }
    }
  })

  it('같은 데이터라도 분류를 고르면 그대로 돈다 - 과제 유형을 판정하는 것이 아니다', () => {
    // 거부하는 것은 타깃의 자료형이 아니라 **성립하지 않는 조합**이다. 학생이 고른
    // 과제 유형은 그대로 존중된다 (mlpx-spec.md 0.1).
    const { experiment } = runGrades('classification', 'decision_tree')
    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.metrics?.accuracy).toBeGreaterThanOrEqual(0)
  })

  it('빈 칸이 섞인 수치 타깃은 거부하지 않는다 - 결측은 이미 걸러졌다', () => {
    const withGap: Dataset = {
      columns: ['x', 'y'],
      rows: [...Array(10).keys()].map((x) => [String(x), x === 3 ? '' : String(2 * x + 1)]),
    }
    const { experiment } = runExperiment(
      {
        dataset: withGap,
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models('linear_regression'),
        }),
        context: { serverStatus: 'unavailable', rowCount: withGap.rows.length },
      },
      frozen,
    )
    expect(experiment.runs[0]?.status).toBe('done')
  })

  it("'N/A'가 섞인 타깃은 거부한다 - 빈 칸이 아니라 값이다", () => {
    const withText: Dataset = {
      columns: ['x', 'y'],
      rows: [...Array(10).keys()].map((x) => [String(x), x === 3 ? 'N/A' : String(2 * x + 1)]),
    }
    try {
      runExperiment(
        {
          dataset: withText,
          taskType: 'regression',
          dataType: 'tabular',
          settings: settingsFor({
            features: ['x'],
            target: 'y',
            split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
            selectedAlgorithms: models('linear_regression'),
          }),
          context: { serverStatus: 'unavailable', rowCount: withText.rows.length },
        },
        frozen,
      )
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('TARGET_NOT_NUMERIC')
    }
  })
})

describe('데이터 타입·과제 유형에 안 맞는 모델', () => {
  /**
   * **세 축이 전부 판정에 들어가야 한다** (mlpx-spec.md 0.1). 실행 위치만 보면 회귀
   * 전용 모델이 분류 과제에서 그대로 학습되고, run은 done으로 끝나며 지표 칸에는
   * 아무 뜻 없는 숫자가 뜬다. 화면이 못 고르게 막아도 selectedAlgorithms는 파일에
   * 남으므로, 학생이 과제 유형만 바꿔 다시 학습하면 체크된 채로 도착한다.
   */
  const line: Dataset = {
    columns: ['x', 'y'],
    rows: [...Array(10).keys()].map((x) => [String(x), String(2 * x + 1)]),
  }

  function runLine(overrides: Partial<ExperimentInput>) {
    return runExperiment(
      {
        dataset: line,
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models('decision_tree'),
        }),
        context: { serverStatus: 'unavailable', rowCount: line.rows.length },
        ...overrides,
      },
      frozen,
    ).experiment
  }

  it('분류 전용 모델을 회귀에 고르면 학습하지 않는다', () => {
    const experiment = runLine({})
    expect(experiment.runs[0]?.status).toBe('failed')
    expect(experiment.runs[0]?.failure?.code).toBe('ALGORITHM_NOT_FOR_TASK_TYPE')
    expect(experiment.runs[0]?.metrics).toBeUndefined()
  })

  it('데이터 타입이 안 맞으면 그쪽 사유가 이긴다 - 더 근본적인 것이 먼저다', () => {
    const experiment = runLine({ dataType: 'image' })
    expect(experiment.runs[0]?.status).toBe('failed')
    expect(experiment.runs[0]?.failure?.code).toBe('ALGORITHM_NOT_FOR_DATA_TYPE')
  })

  it('실패해도 무엇을 시도했는지는 남는다', () => {
    const experiment = runLine({})
    // 엔진이 정해지지 않았으므로 확정할 주체가 없다 - 준 값 그대로다 (mlpx-spec.md 3).
    expect(experiment.runs[0]?.hyperparameters).toEqual({})
    expect(experiment.runs[0]?.algorithm).toBe('decision_tree')
    expect(experiment.runs[0]?.computedBy).toBe('browser')
  })

  it('맞는 조합은 그대로 학습된다', () => {
    const experiment = runLine({
      settings: settingsFor({
        features: ['x'],
        target: 'y',
        split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
        selectedAlgorithms: models('linear_regression'),
      }),
    })
    expect(experiment.runs[0]?.status).toBe('done')
  })

  it('실험 안에서 맞는 것만 돈다 - 하나가 안 맞아도 나머지는 나온다', () => {
    const experiment = runLine({
      settings: settingsFor({
        features: ['x'],
        target: 'y',
        split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
        selectedAlgorithms: models('decision_tree', 'linear_regression'),
      }),
    })
    expect(experiment.runs.map((run) => run.status)).toEqual(['failed', 'done'])
  })
})
