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

import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { isClientError } from '../src/errors'
import { ALGORITHMS, type Algorithm } from '../src/ml/algorithms'
import { fit } from '../src/ml/engines/mljs'
import { runExperiment as runExperimentRaw, type ExperimentInput } from '../src/ml/experiment'
import { dataSnapshot } from '../src/project/schema'
import { trainableRowCount } from '../src/ml/selection'
import { NOT_FOR_TABULAR_ALGORITHM } from './fixtures/algorithms'
import type { RuntimeContext } from '../src/ml/backend'
import type { Dataset } from '../src/ml/preprocess'
import {
  DATA_SCHEMAS,
  DATA_TYPES,
  experimentSchema,
  settingsSchema,
  type Experiment,
  type Run,
  type RunsFile,
  type Settings,
  type TabularSettings,
  dataSettings,
} from '../src/project/schema'
import {
  IRIS_FEATURE_COLUMNS,
  IRIS_TARGET_COLUMN,
  irisDataset,
  IRIS_FEATURES,
  IRIS_LABELS,
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

/**
 * 모델 목록을 짧게 쓴다. 실행 방법을 안 적으면 실험 기본(settings.runtime)을 따른다 -
 * 학생 대부분이 그렇게 쓴다.
 */
const models = (...names: string[]) => names.map((algorithm) => ({ algorithm }))

/** 서버도 무거운 엔진도 없는 상태. 공식 배포(GitHub Pages)가 정확히 이렇다. */
const BROWSER_ONLY: RuntimeContext = {
  serverStatus: 'unavailable',
  limitsOff: false,
  rowCount: 30,
  dataType: 'tabular',
}

/**
 * **표의 설정은 `settings.data` 안이지만 여기서는 평평하게 받는다** (mlpx-spec.md §3).
 *
 * 검사가 실제로 넘기는 것은 아래에서 조립한 진짜 `Settings`다. 평평하게 받는 이유는
 * `Settings`가 looseObject라 **`Partial<Settings>`에 `features`를 얹어도 타입이 안
 * 울고 조용히 무시되기 때문이다** — 스키마를 가르던 날 실제로 그렇게 통과했다.
 * 여기서 갈라 넣으면 그 자리가 컴파일에 걸린다.
 */
type SettingsOverrides = Partial<Omit<Settings, 'data'>> & Partial<TabularSettings>

function splitOverrides(overrides: SettingsOverrides) {
  const { dataset, testDataset, predictDataset, features, target, preprocessing, ...common } =
    overrides
  const data = {
    ...(dataset === undefined ? {} : { dataset }),
    ...(testDataset === undefined ? {} : { testDataset }),
    ...(predictDataset === undefined ? {} : { predictDataset }),
    ...(features === undefined ? {} : { features }),
    ...('target' in overrides ? { target } : {}),
    ...(preprocessing === undefined ? {} : { preprocessing }),
  }
  return { data, common }
}

const baseData: TabularSettings = {
  dataset: {
    path: 'dataset/data.csv',
    originalFileName: 'iris.csv',
    hasHeader: true,
    encoding: 'utf-8',
  },
  features: [...IRIS_FEATURE_COLUMNS],
  target: IRIS_TARGET_COLUMN,
  preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
}

function settingsFor(overrides: SettingsOverrides = {}): Settings {
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: models('decision_tree', 'knn'),
    hyperparameters: {},
    ...splitOverrides(overrides).common,
    data: { ...baseData, ...splitOverrides(overrides).data },
  }
}

function inputFor(
  overrides: Partial<Omit<ExperimentInput, 'snapshot'>> = {},
): Omit<ExperimentInput, 'snapshot'> {
  return {
    dataset: irisDataset(),
    testDataset: null,
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
    // 내부 표준화+절편이 들어오면서 mljs.spec.ts의 PINNED와 함께 움직였다 (2026-08-10).
    logistic_regression: 8 / 9,
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
    // 바닥. 목록이 비면 아래 순회가 0회 돌고 초록이다.
    expect(experiment.runs).not.toHaveLength(0)
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

  it('전처리 파라미터가 훈련 데이터에서만 나온다', () => {
    // 테스트 데이터가 섞이면 지표가 조용히 부풀고, 학생은 자기 모델이 실제보다 좋다고 믿는다.
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

    // 전체 평균과 달라야 한다. 같으면 훈련 데이터만 봤다는 증거가 되지 못한다.
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

  it('svm도 순수 JS에서 돈다 - 서버가 없어도 지표가 나온다', () => {
    // 예전에는 여기서 ENGINE_NOT_READY로 실패했다. 그 상태가 공식 배포의 기본값이라
    // 대부분의 학생에게 SVM은 없는 물건이었다 (open-decisions.md).
    const { experiment } = runExperiment(
      inputFor({ settings: settingsFor({ selectedAlgorithms: models('svm') }) }),
      frozen,
    )

    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.computedBy).toBe('browser')
    // 손잡이는 하나뿐이고, 학생이 안 건드려도 확정된 값이 남는다.
    expect(experiment.runs[0]?.hyperparameters).toEqual({ C: 1 })
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
      undefined, // 순수 JS는 돈다 - 벤더링한 SMO가 여기 있다
      'ENGINE_NOT_WIRED', // pyodide는 켤 자리조차 아직 없다
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
    delete withoutTarget.data.target

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
        testDataset: null,
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models('linear_regression'),
        }),
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: 10,
          dataType: 'tabular',
        },
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

  /**
   * **뽑는 수를 바꾸면 지표가 크게 움직인다.** 붓꽃 30행에서 12행만 뽑으면 정확도가
   * 0.7778에서 1.0으로, 24행이면 0.8333으로 간다. 그런데 이력이 침묵하면 화면은
   * "직전과 같은 설정"이라고 말하면서 숫자만 딴판인 상태가 된다 — 결과 화면이
   * 순위표가 아니라 **변경 이력**이라는 것이 이 도구의 차별점이다
   * (`architecture.md` §8.9).
   */
  it('뽑는 수를 바꾸면 changed에 뜬다', () => {
    const sampled = runExperiment(inputFor({ settings: settingsFor({ nSamples: 12 }) }), {
      ...frozen,
      history,
    }).experiment
    expect(sampled.changed).toEqual(['nSamples'])
  })

  /**
   * **`comparable()`은 손으로 관리하는 목록이고, 손으로 관리하는 목록은 새 필드를
   * 놓친다.** 실제로 `nSamples`가 그렇게 빠졌다 — 검사를 하나 더 쓰는 것으로는 **다음**
   * 필드를 못 막는다 (2026-08-12 감사 A-1).
   *
   * 그래서 **설정의 모든 필드를 스키마에서 훑어** 둘 중 하나이기를 요구한다.
   *
   * - 바꾸면 `changed`가 뜬다 (아래 `MUTATIONS`)
   * - 안 뜨는 이유가 적혀 있다 (아래 `NOT_COMPARED`)
   *
   * 새 필드를 넣는 사람은 **둘 중 어디에 넣을지 정해야 한다.** 아무 데도 안 넣으면
   * 첫 번째 검사가 운다.
   */
  describe('설정 필드가 늘면 변경 이력이 따라온다', () => {
    /**
     * 이 필드를 바꾸면 학생이 한 변경이다. 값은 `settingsFor()`의 기본과 달라야 한다.
     */
    const MUTATIONS: Readonly<
      Record<string, { readonly patch: SettingsOverrides; readonly path: string }>
    > = {
      features: { patch: { features: [IRIS_FEATURE_COLUMNS[0] as string] }, path: 'features' },
      // **타깃만 바꿀 수 없다.** 붓꽃 픽스처에서 범주형 열은 `species` 하나뿐이라, 다른
      // 열로 옮기면 값이 거의 다 달라 층화가 거부한다. 그래서 층화를 함께 끄고 —
      // 그 대신 **`target` 경로가 실제로 떴는지**를 본다. "비어 있지 않다"로는 곁다리
      // 변경이 대신 떠 준 것을 못 가른다.
      target: {
        patch: {
          target: IRIS_FEATURE_COLUMNS[0] as string,
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
        },
        path: 'target',
      },
      preprocessing: {
        patch: {
          preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
        },
        path: 'preprocessing',
      },
      split: {
        patch: { split: { method: 'holdout', testSize: 0.4, stratify: true, randomState: 42 } },
        path: 'split',
      },
      nSamples: { patch: { nSamples: 12 }, path: 'nSamples' },
      runtime: { patch: { runtime: 'server-sklearn' }, path: 'runtime' },
      // 스냅샷에서는 `algorithms`라는 이름으로 눕는다 - 모델과 실행 방법을 함께 보기
      // 때문이다. **이름이 갈리는 자리라 경로를 손으로 적는다.**
      selectedAlgorithms: { patch: { selectedAlgorithms: models('knn') }, path: 'algorithms' },
      hyperparameters: {
        patch: { hyperparameters: { decision_tree: { mljs: { maxDepth: 1 } } } },
        path: 'hyperparameters',
      },
    }

    /** 견주지 않는 필드와 그 이유. */
    const NOT_COMPARED: Readonly<Record<string, string>> = {
      // 데이터셋을 바꾸면 그 위의 실험이 통째로 지워진다 (mlpx-spec.md §4.3).
      // 견줄 직전 실험 자체가 없으므로 이력에 뜰 일이 없다.
      dataset: '바꾸면 기존 실험이 지워진다',
      testDataset: '바꾸면 기존 실험이 지워진다',
      // 예측 화면에서만 쓴다. 학습에 안 들어가므로 지표를 움직이지 않는다.
      predictDataset: '학습에 들어가지 않는다',
    }

    /**
     * **이미지의 넷.** 위 `MUTATIONS`와 나누는 이유는 **바꾸는 자리가 다르기** 때문이다 —
     * 저기는 계산에 쓰는 설정을 바꾸고, 이 넷은 **스냅샷에만 있다**
     * (open-decisions.md "이미지 학습은 표 문제로 바꿔서 푼다"). 같은 표에 넣으면
     * `settingsFor()`가 만들 수 없는 값을 요구하게 된다.
     *
     * 2026-08-12까지 이 넷은 `NOT_COMPARED`에 "이미지 학습이 아직 이 함수로 안 온다"로
     * 있었다. **이제 온다.**
     */
    const IMAGE_SNAPSHOT = {
      categories: ['개', '고양이'],
      backboneId: DEFAULT_BACKBONE_ID,
      categoryCounts: [2, 2],
      unlabeledCount: 0,
    }

    const IMAGE_MUTATIONS: Readonly<Record<string, Record<string, unknown>>> = {
      // 범주를 바꾸면 라벨이 통째로 달라진다.
      categories: { categories: ['개', '고양이', '토끼'] },
      // 백본을 바꾸면 특성이 통째로 달라진다.
      backboneId: { backboneId: 'other-backbone' },
      // 사진을 더하고 빼고 옮긴 것이 여기서 잡힌다.
      categoryCounts: { categoryCounts: [3, 1] },
      unlabeledCount: { unlabeledCount: 5 },
      /**
       * **라벨 맞바꾸기가 걸리는 유일한 칸이다** (R6 감사 A-1). 위 셋은 두 방향 이동에서
       * 하나도 안 움직인다 — 이 칸을 이력에서 빼면 훈련 데이터가 달라졌는데 화면이
       * "설정을 바꾸지 않고 다시 학습했습니다"라고 말한다.
       */
      rowsHash: { rowsHash: 'deadbeefdeadbeef' },
    }

    /**
     * 훑을 필드. **`data`는 그릇이라 이름 대신 속을 편다** (mlpx-spec.md §3).
     *
     * 종류별 스키마를 등록부에서 꺼내는 것이 핵심이다 — 이미지가 등록되는 날 그 칸들도
     * 자동으로 이 목록에 들어오고, 선언 안 하면 아래 첫 검사가 운다.
     */
    const FIELDS = [
      ...new Set([
        ...Object.keys(settingsSchema.shape).filter((key) => key !== 'data'),
        ...DATA_TYPES.flatMap((dataType) => Object.keys(DATA_SCHEMAS[dataType].settings.shape)),
        // **스냅샷 쪽도 훑는다.** 스냅샷에만 있는 필드가 실재한다 — 이미지의 장수는
        // 설정이 아니라 학습 시점에 세는 값이라 `settings.data`에 없다. 설정 쪽만
        // 훑으면 그 필드가 이 선언을 통째로 빠져나간다.
        ...DATA_TYPES.flatMap((dataType) => Object.keys(DATA_SCHEMAS[dataType].snapshot.shape)),
      ]),
    ]

    it('스키마의 모든 필드가 셋 중 하나에 적혀 있다', () => {
      const declared = new Set([
        ...Object.keys(MUTATIONS),
        ...Object.keys(IMAGE_MUTATIONS),
        ...Object.keys(NOT_COMPARED),
      ])
      const missing = FIELDS.filter((key) => !declared.has(key))
      expect(missing, 'put a new settings field in MUTATIONS or NOT_COMPARED').toEqual([])
    })

    it('적힌 것 말고 다른 것이 없다 - 필드가 사라지면 표도 따라간다', () => {
      const fields = new Set(FIELDS)
      const extra = [
        ...Object.keys(MUTATIONS),
        ...Object.keys(IMAGE_MUTATIONS),
        ...Object.keys(NOT_COMPARED),
      ].filter((key) => !fields.has(key))
      expect(extra).toEqual([])
    })

    /**
     * **이미지 실험 둘을 견준다.** 계산에 쓰는 표는 그대로 두고 스냅샷만 바꾼다 — 실제
     * 앱에서 갈리는 자리가 정확히 거기다.
     */
    for (const [field, patch] of Object.entries(IMAGE_MUTATIONS)) {
      it(`이미지: ${field}를 바꾸면 changed에 뜬다`, () => {
        const of = (snapshot: Record<string, unknown>): Experiment =>
          runExperimentRaw(
            {
              ...inputFor({ dataType: 'image' }),
              snapshot: snapshot as Experiment['settings']['data'],
            },
            frozen,
          ).experiment

        const base = of(IMAGE_SNAPSHOT)
        const next = runExperimentRaw(
          {
            ...inputFor({ dataType: 'image' }),
            snapshot: { ...IMAGE_SNAPSHOT, ...patch } as Experiment['settings']['data'],
          },
          { ...frozen, history: { experiments: [base] } },
        ).experiment

        expect(
          next.changed,
          `${field} is missing from the change list: ${JSON.stringify(next.changed)}`,
        ).toContain(field)
      })
    }

    for (const [field, { patch, path }] of Object.entries(MUTATIONS)) {
      it(`${field}를 바꾸면 changed에 ${path}가 뜬다`, () => {
        const base = runExperiment(inputFor(), frozen).experiment
        const next = runExperiment(inputFor({ settings: settingsFor(patch) }), {
          ...frozen,
          history: { experiments: [base] },
        }).experiment
        const hit = (next.changed ?? []).some((one) => one === path || one.startsWith(`${path}.`))
        expect(
          hit,
          `${field} is missing from the change list: ${JSON.stringify(next.changed)}`,
        ).toBe(true)
      })
    }

    /**
     * **위 표가 못 가르는 축이다.** `selectedAlgorithms` 항목은 알고리즘 자체를 바꾸므로
     * (`models('knn')`) "목록이 달라졌다"만 확인한다. `comparable`이 알고리즘을
     * `알고리즘:실행방법`으로 눕히는 이유는 **알고리즘은 그대로인데 엔진만 바꾼 것도
     * 학생이 한 변경이고, 숫자가 움직이는 가장 흔한 이유**여서다. 그 표본이 없었다.
     */
    it('알고리즘은 그대로고 실행 방법만 바꿔도 changed에 뜬다', () => {
      const base = runExperiment(
        inputFor({ settings: settingsFor({ selectedAlgorithms: models('decision_tree') }) }),
        frozen,
      ).experiment
      const next = runExperiment(
        inputFor({
          settings: settingsFor({
            selectedAlgorithms: [{ algorithm: 'decision_tree', runtime: 'server-sklearn' }],
          }),
        }),
        { ...frozen, history: { experiments: [base] } },
      ).experiment

      expect(next.changed).toContain('algorithms')
    })
  })

  it('뽑기를 껐다 켜는 것도 잡는다 - 없다가 생긴 것이 변경이 아닐 수 없다', () => {
    const sampled = runExperiment(
      inputFor({ settings: settingsFor({ nSamples: 12 }) }),
      frozen,
    ).experiment
    const back = runExperiment(inputFor(), {
      ...frozen,
      history: { experiments: [sampled] },
    }).experiment
    expect(back.changed).toEqual(['nSamples'])
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
      testDataset: null,
      taskType: 'regression',
      dataType: 'tabular',
      settings: settingsFor({
        features: ['x'],
        target: 'y',
        split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
        selectedAlgorithms: models('linear_regression'),
      }),
      context: { limitsOff: false, serverStatus: 'unavailable', rowCount: 10, dataType: 'tabular' },
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
        testDataset: null,
        taskType,
        dataType: 'tabular',
        settings: settingsFor({
          features: ['study_hours'],
          target: 'grade',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models(algorithm),
        }),
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: grades.rows.length,
          dataType: 'tabular',
        },
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
        testDataset: null,
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models('linear_regression'),
        }),
        context: {
          serverStatus: 'unavailable',
          limitsOff: false,
          rowCount: withGap.rows.length,
          dataType: 'tabular',
        },
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
          testDataset: null,
          taskType: 'regression',
          dataType: 'tabular',
          settings: settingsFor({
            features: ['x'],
            target: 'y',
            split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
            selectedAlgorithms: models('linear_regression'),
          }),
          context: {
            serverStatus: 'unavailable',
            limitsOff: false,
            rowCount: withText.rows.length,
            dataType: 'tabular',
          },
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

  function runLine(overrides: Partial<ExperimentInput>, algorithms?: readonly Algorithm[]) {
    return runExperiment(
      {
        dataset: line,
        testDataset: null,
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models('decision_tree'),
        }),
        context: {
          limitsOff: false,
          serverStatus: 'unavailable',
          rowCount: line.rows.length,
          dataType: 'tabular',
        },
        ...overrides,
      },
      algorithms ? { ...frozen, algorithms } : frozen,
    ).experiment
  }

  it('분류 전용 모델을 회귀에 고르면 학습하지 않는다', () => {
    const experiment = runLine({})
    expect(experiment.runs[0]?.status).toBe('failed')
    expect(experiment.runs[0]?.failure?.code).toBe('ALGORITHM_NOT_FOR_TASK_TYPE')
    expect(experiment.runs[0]?.metrics).toBeUndefined()
  })

  it('데이터 타입이 안 맞으면 그쪽 사유가 이긴다 - 더 근본적인 것이 먼저다', () => {
    // **표본은 가짜다.** 어휘에는 지금 되는 종류만 있어서(open-decisions.md "어휘에는
    // 지금 되는 것만 넣는다") 안 맞는 종류를 넘길 수 없다. 확인하는 것은 어휘가 아니라
    // unavailableReason이 데이터 타입 사유를 먼저 가로채는가다.
    const experiment = runLine({}, [{ ...NOT_FOR_TABULAR_ALGORITHM, id: 'decision_tree' }])
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

describe('전처리와 분할을 끌 수 있다', () => {
  /**
   * **"빈 칸을 그대로 두기"는 빈 칸이 있으면 거부한다.** 조용히 두는 길이 없어서다 -
   * 수치 열의 빈 칸은 결국 0이 되고, 그러면 그 이름으로 0 채우기를 하는 셈이 된다
   * (open-decisions.md "전처리도 분할도 끌 수 있다").
   */
  const keepBlanks = { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' } as const

  it('깨끗한 데이터면 아무 일도 안 일어난다', () => {
    const { experiment } = runExperiment(
      inputFor({ settings: settingsFor({ preprocessing: keepBlanks }) }),
      frozen,
    )
    expect(experiment.runs.every((run) => run.status === 'done')).toBe(true)
  })

  it('빈 칸이 하나라도 있으면 실험이 통째로 거부된다', () => {
    // 분할·전처리의 실패는 run 하나가 아니라 실험 자체가 성립하지 않는 것이다.
    const holed = irisDataset()
    const rows = holed.rows.map((row) => [...row])
    rows[3] = (rows[3] ?? []).map((cell, column) => (column === 0 ? '' : cell))

    try {
      runExperiment(
        inputFor({
          dataset: { columns: holed.columns, rows },
          settings: settingsFor({ preprocessing: keepBlanks }),
        }),
        frozen,
      )
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('FEATURE_HAS_MISSING')
      // 어느 열인지 말해 준다. 그게 없으면 학생이 고칠 자리를 못 찾는다.
      expect(error.params.feature).toBe(IRIS_FEATURE_COLUMNS[0])
    }
  })

  it('테스트 데이터의 빈 칸도 잡는다 - 훈련 데이터만 보면 조용히 0이 되어 지나간다', () => {
    const holed = irisDataset()
    const rows = holed.rows.map((row) => [...row])
    // 어느 행이 테스트 데이터로 가든 하나는 걸린다. 전체를 보므로 분할과 무관하다.
    const testRow = runExperiment(inputFor(), frozen).experiment.settings.testIndices[0] ?? 0
    rows[testRow] = (rows[testRow] ?? []).map((cell, column) => (column === 0 ? '' : cell))

    expect(() =>
      runExperiment(
        inputFor({
          dataset: { columns: holed.columns, rows },
          settings: settingsFor({ preprocessing: keepBlanks }),
        }),
        frozen,
      ),
    ).toThrow()
  })

  /**
   * **테스트 표의 라벨을 한 칸씩 밀어 두었다.** 그래서 올바른 표로 채점하면 정확도가 **0**이고,
   * 실수로 `data.csv`를 되짚으면 그 여섯 줄은 전부 setosa라 **1**이 나온다. 두 답이 양 끝이라
   * 이 검사는 어느 표를 봤는지를 확실히 가른다.
   *
   * **예전 픽스처는 테스트 데이터로 훈련 데이터의 사본을 썼다.** 두 표가 같으니 어느 쪽을 봐도
   * 숫자가 같았고, 확인하는 것도 길이 둘뿐인데 그 둘마저 같은 값이었다 — `testSource`를
   * `dataset`으로 바꾸는 돌연변이가 **저장소 전체 1,820개 검사를 통과했다**
   * (V11 R2 감사 B-1). `provided`가 두 표를 가리킨다는 것이 이 포맷의 유일한 자리인데
   * (mlpx-spec.md §1.1) 그것을 무는 검사가 하나도 없었다.
   */
  it('테스트 데이터가 파일로 오면 그 표로 채점한다 - 훈련 표를 되짚지 않는다', () => {
    // 특성은 붓꽃에서 가져오되 라벨을 한 품종씩 민다. 모델이 맞히면 라벨과 어긋난다.
    const SHIFTED: Record<string, string> = {
      setosa: 'versicolor',
      versicolor: 'virginica',
      virginica: 'setosa',
    }
    const picked = [0, 1, 10, 11, 20, 21]
    const testDataset = {
      columns: [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN],
      rows: picked.map((row) => [
        ...(IRIS_FEATURES[row] ?? []).map(String),
        SHIFTED[IRIS_LABELS[row] ?? ''] ?? '',
      ]),
    }

    const { experiment } = runExperiment(
      inputFor({
        testDataset,
        settings: settingsFor({
          selectedAlgorithms: models('decision_tree'),
          split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
        }),
      }),
      frozen,
    )

    const { trainIndices, testIndices } = experiment.settings
    // trainIndices는 훈련 데이터(dataset) 전부, testIndices는 테스트 데이터(testDataset)
    // 전부다 - 두 배열이 서로 다른 표를 가리킨다 (mlpx-spec.md §1.1).
    expect(trainIndices.length).toBe(IRIS_FEATURES.length)
    expect(testIndices.length).toBe(testDataset.rows.length)
    // **행 수부터 다르다.** 사본을 쓰면 이 둘이 같아져서 뒤바뀐 것을 못 본다.
    expect(testIndices.length).not.toBe(trainIndices.length)
    expect(experiment.runs[0]?.status).toBe('done')

    // 여기가 이 검사의 알맹이다. 밀어 둔 라벨이라 맞힐수록 0에 가깝다.
    expect(experiment.runs[0]?.metrics?.accuracy).toBe(0)
  })

  /**
   * **테스트 데이터를 안 넘긴 것과 훈련 데이터가 빈 것은 다른 실패다.**
   *
   * 화면이 `testDataset`을 안 넘겨서 실제로 났던 고장이다 - 그때 학생이 본 문장은
   * "학습에 쓸 수 있는 데이터가 0줄뿐"이었고, 멀쩡한 훈련 데이터를 들여다보게 만들었다.
   * 인자를 필수로 바꿔 그 경로는 타입이 막지만, 손으로 고친 파일에서는 여전히 올 수 있다.
   */
  it('테스트 데이터 없이 provided로 돌리면 테스트 데이터를 가리켜 실패한다', () => {
    try {
      runExperiment(
        inputFor({
          testDataset: null,
          settings: settingsFor({
            selectedAlgorithms: models('decision_tree'),
            split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
          }),
        }),
        frozen,
      )
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      // 훈련 데이터를 탓하는 SPLIT_TOO_FEW_ROWS가 아니어야 한다.
      if (isClientError(error)) expect(error.code).toBe('TEST_DATASET_NO_USABLE_ROWS')
    }
  })

  /**
   * **씨앗이 분할만이 아니라 `fit`까지 가야 한다** (CLAUDE.md §2). 배깅·SMO·K-평균
   * 초기화가 그 값을 먹는다. **여기서 도는 것은 앞의 둘이다** — K-평균은 타깃이 없어
   * 이 하니스에 못 올라가고 `mljs-kmeans.spec.ts`가 맡는다.
   *
   * **지금까지 이것을 무는 검사가 없었다** — `trainContext.randomState`를 `0`으로 못 박아도
   * 저장소 전체 1,820개 검사가 통과했다 (V11 R2 감사 B-2). `experiment.spec.ts`가
   * `randomState`로 하던 주장 둘은 **분할** 이야기였고, `rule-coverage.md`는 파수꾼으로
   * `mljs-kmeans.spec.ts`를 적어 두었는데 그 파일에는 그 낱말이 한 글자도 없었다.
   *
   * **`provided`로 돌리는 것이 이 검사의 설계다.** 분할이 씨앗과 무관해지므로
   * (`trainIndices`는 훈련 표 전부, `testIndices`는 테스트 표 전부) 모델이 갈리면 그 원인은
   * `fit` 하나뿐이다. **지표가 아니라 모델을 견준다** — 30행 붓꽃은 너무 잘 갈려서 지표가
   * 씨앗에 둔감하고, 그 둔함이 바로 예전 픽스처가 무뎠던 이유다.
   */
  /**
   * **머리말이 셋을 호명하면 셋을 돌아야 한다.**
   *
   * 한때 배깅 하나만 돌았고, 그래서 SMO의 씨앗을 상수로 못 박아도 저장소 전체가
   * 초록이었다 (R9 감사 A-4·§7). K-평균 초기화는 여기서 못 돈다 — 군집화에는 타깃이
   * 없어 `provided` 분할 자체가 안 선다. **그쪽 축은 `mljs-kmeans.spec.ts`의
   * "다른 씨앗이면 초기화가 갈린다"가 잡는다.**
   */
  for (const [algorithm, hyperparameters] of [
    ['random_forest', { random_forest: { mljs: { nEstimators: 5 } } }],
    ['svm', {}],
  ] as const) {
    it(`씨앗이 분할만이 아니라 fit까지 간다 - ${algorithm}이 그 값을 먹는다`, () => {
      const modelFor = (randomState: number): string => {
        const { models: fitted } = runExperiment(
          inputFor({
            testDataset: irisDataset(),
            settings: settingsFor({
              selectedAlgorithms: models(algorithm),
              hyperparameters,
              split: { method: 'provided', testSize: 0.3, stratify: true, randomState },
            }),
          }),
          frozen,
        )
        const [model] = [...fitted.values()]
        expect(model).toBeDefined()
        return JSON.stringify(model)
      }

      // 같은 씨앗은 같은 모델이다 - 재현 가능성이 이 도구의 생명이다.
      expect(modelFor(42)).toBe(modelFor(42))
      // 다른 씨앗은 다른 모델이다. 같다면 그 값이 fit에 안 닿은 것이다.
      expect(modelFor(42)).not.toBe(modelFor(7))
    })
  }

  it('테스트 데이터가 전처리에서 통째로 걸러져도 같은 코드다', () => {
    // 타깃이 빈 행은 어떤 전략에서도 채점에 못 쓴다 - 전부 그러면 채점할 것이 없다.
    const empty = irisDataset()
    const blanked = {
      columns: empty.columns,
      rows: empty.rows.map((row) =>
        row.map((cell, column) =>
          column === empty.columns.indexOf(IRIS_TARGET_COLUMN) ? '' : cell,
        ),
      ),
    }

    try {
      runExperiment(
        inputFor({
          testDataset: blanked,
          settings: settingsFor({
            selectedAlgorithms: models('decision_tree'),
            split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
          }),
        }),
        frozen,
      )
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('TEST_DATASET_NO_USABLE_ROWS')
    }
  })
})

describe('군집', () => {
  /**
   * 세 뭉치가 뚜렷한 2차원 표. 타깃 열이 없다 — 군집화에는 정답이 없다.
   *
   * 값은 결정적이고 뭉치 사이 거리가 커서 K-Means가 확실히 분리한다.
   * 실루엣이 1에 가깝게 나오는 것을 그대로 못 박을 수 있다.
   */
  const clusters: Dataset = {
    columns: ['x', 'y'],
    rows: [
      // 뭉치 A (0 근처)
      ['0', '0'],
      ['1', '0'],
      ['0', '1'],
      // 뭉치 B (10 근처)
      ['10', '10'],
      ['11', '10'],
      ['10', '11'],
      // 뭉치 C (20 근처)
      ['20', '20'],
      ['21', '20'],
      ['20', '21'],
    ],
  }

  function clusterSettings(overrides: Partial<Settings> = {}): Settings {
    return {
      data: {
        dataset: {
          path: 'dataset/data.csv',
          originalFileName: 'clusters.csv',
          hasHeader: true,
          encoding: 'utf-8',
        },
        features: ['x', 'y'],
        // 군집화에는 타깃이 없다 (architecture.md §3.6).
        preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
      },
      split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
      runtime: 'mljs',
      selectedAlgorithms: models('k_means'),
      hyperparameters: {},
      ...overrides,
    }
  }

  const { experiment, preprocessor } = runExperiment(
    {
      dataset: clusters,
      testDataset: null,
      taskType: 'clustering',
      dataType: 'tabular',
      settings: clusterSettings(),
      context: BROWSER_ONLY,
    },
    frozen,
  )

  it('학습이 성공한다', () => {
    expect(experiment.runs[0]?.status).toBe('done')
  })

  /**
   * **타깃으로 고른 열은 군집에 안 들어간다.** 붓꽃을 군집하는 표준 수업이 `품종`을 빼고
   * 측정값으로 묶은 뒤 그 결과를 `품종`과 대조하는 것이기 때문이다 — sklearn에서도
   * `X = df.drop(columns=['species'])`다. 넣으면 답을 보고 답을 맞히는 것이 된다.
   *
   * **규칙은 코드에도 주석에도 있었는데 무는 검사가 없었다** — 군집일 때 타깃 열을
   * `fitPreprocessor`의 특성 목록에 얹는 돌연변이가 저장소 전체 1,820개 검사를 통과했다
   * (V11 R2 감사 B-4). 위 픽스처에 타깃 열이 아예 없어 규칙을 말할 재료가 없었다.
   *
   * **오늘 무너지는 것이 아니라 되살아나는 것이 문제다.** 실루엣은 올라가므로 숫자만 보면
   * 더 좋아 보인다.
   */
  it('타깃 열이 있어도 군집의 전처리기에는 안 들어간다', () => {
    const labeled: Dataset = {
      columns: [...clusters.columns, 'label'],
      rows: clusters.rows.map((row, index) => [
        ...row,
        ['A', 'B', 'C'][Math.floor(index / 3)] ?? '',
      ]),
    }

    const { preprocessor: fitted } = runExperiment(
      {
        dataset: labeled,
        testDataset: null,
        taskType: 'clustering',
        dataType: 'tabular',
        settings: clusterSettings({
          data: {
            ...clusterSettings().data,
            // 학생이 앞 화면에서 골라 둔 타깃. 군집에서는 뜻이 없다.
            target: 'label',
          },
        }),
        context: BROWSER_ONLY,
      },
      frozen,
    )

    expect(fitted.columns.map((column) => column.name)).toEqual(['x', 'y'])
    expect(fitted.featureNames).not.toContain('label')
  })

  it('실루엣 계수와 이너셔가 나온다', () => {
    expect(experiment.runs[0]?.metrics?.silhouette).toBeDefined()
    expect(experiment.runs[0]?.metrics?.inertia).toBeDefined()
  })

  it('뚜렷한 뭉치를 정확히 분리한다', () => {
    // 거리가 멀어 실루엣이 0.9 이상이 아니면 엔진이 잘못된 것이다.
    expect(experiment.runs[0]?.metrics?.silhouette).toBeGreaterThan(0.9)
  })

  it('혼동 행렬도 클래스별 지표도 없다 — 정답이 없다', () => {
    expect(experiment.runs[0]?.confusionMatrix).toBeUndefined()
    expect(experiment.runs[0]?.perClass).toBeUndefined()
  })

  it('설정에 타깃이 없다', () => {
    expect(experiment.settings.data.target).toBeUndefined()
  })

  it('전체 데이터로 학습하고 테스트 데이터는 비어 있다', () => {
    // architecture.md §3.6: 군집화는 나누지 않는다.
    expect(experiment.settings.trainIndices).toEqual([...clusters.rows.keys()])
    expect(experiment.settings.testIndices).toEqual([])
  })

  it('스키마를 통과한다', () => {
    expect(() => experimentSchema.parse(experiment)).not.toThrow()
  })

  it('같은 설정으로 두 번 돌리면 결과가 같다', () => {
    const second = runExperiment(
      {
        dataset: clusters,
        testDataset: null,
        taskType: 'clustering',
        dataType: 'tabular',
        settings: clusterSettings(),
        context: BROWSER_ONLY,
      },
      frozen,
    )
    expect(second.experiment.runs[0]?.metrics).toEqual(experiment.runs[0]?.metrics)
  })

  it('전처리기가 따로 나온다', () => {
    expect(preprocessor.format).toBe('mlpx-preprocess-v1')
  })

  it('하이퍼파라미터가 확정된다', () => {
    // 학생이 안 건드려도 nClusters의 확정 값이 남아야 한다.
    expect(experiment.runs[0]?.hyperparameters).toHaveProperty('nClusters')
  })

  it('타깃 없이도 TARGET_NOT_SELECTED가 나지 않는다', () => {
    // 분류·회귀는 타깃이 없으면 TARGET_NOT_SELECTED로 거부한다. 군집화는 타깃이 없는
    // 것이 정상이므로 같은 검사에 걸리면 안 된다.
    expect(() =>
      runExperiment(
        {
          dataset: clusters,
          testDataset: null,
          taskType: 'clustering',
          dataType: 'tabular',
          settings: clusterSettings(),
          context: BROWSER_ONLY,
        },
        frozen,
      ),
    ).not.toThrow()
  })

  /**
   * **군집 전용 실패 경로.** 성공 경로만 덮여 있었고, 군집에서만 나는 실패는 어느
   * 검사에도 없었다 (V3 감사의 "확인 필요").
   *
   * 실험 하나가 통째로 죽지 않고 **그 모델만 failed로 남는 것**이 여기서 확인할
   * 것이다 (mlpx-spec.md §4.1) — 데이터보다 군집이 많은 것은 학생이 손잡이로 만들 수
   * 있는 상태이고, 그때 다른 모델까지 사라지면 안 된다.
   */
  it('데이터보다 군집이 많으면 그 모델만 failed로 남는다', () => {
    const twoRows: Dataset = {
      columns: ['x', 'y'],
      rows: [
        ['0', '0'],
        ['1', '1'],
      ],
    }
    const { experiment: failed } = runExperiment(
      {
        dataset: twoRows,
        testDataset: null,
        taskType: 'clustering',
        dataType: 'tabular',
        settings: clusterSettings({ hyperparameters: { k_means: { mljs: { nClusters: 5 } } } }),
        context: BROWSER_ONLY,
      },
      frozen,
    )

    const run = failed.runs[0]
    expect(run?.status).toBe('failed')
    expect(run?.failure?.code).toBe('CLUSTER_TOO_FEW_ROWS')
    expect(run?.failure?.params).toEqual({ rows: 2, clusters: 5 })
    // 실패한 run에도 무엇을 시도했는지는 남는다 (ml/experiment.ts).
    expect(run?.hyperparameters).toHaveProperty('nClusters', 5)
    expect(run?.metrics).toBeUndefined()
  })
})

/**
 * 행 표본 뽑기 (open-decisions.md #22).
 *
 * **여기가 지키는 것은 하나다 — 화면이 세는 수와 학습이 실제로 쓰는 행 수가 같은가.**
 * 이 축은 과거에 한 번 어긋난 적이 있다: 전처리로 걸러진 뒤라면 상한 아래인데도 **CSV
 * 원본의 행 수로 잠근** 것이다. 그래서 손으로 조립하지 않고 `runExperiment`를 실제로
 * 돌려, 파일에 남은 `trainIndices + testIndices`와 `trainableRowCount`를 견준다 —
 * 저 둘이 곧 "학습이 본 행"과 "화면이 센 행"이다.
 */
describe('표본 뽑기', () => {
  const gateFor = (settings: Settings): number =>
    trainableRowCount(
      irisDataset(),
      dataSettings('tabular', settings).features,
      dataSettings('tabular', settings).target,
      dataSettings('tabular', settings).preprocessing.missing,
      settings.nSamples,
    )

  const usedBy = (settings: Settings): number => {
    const { experiment } = runExperiment(inputFor({ settings }), frozen)
    return experiment.settings.trainIndices.length + experiment.settings.testIndices.length
  }

  it('화면이 센 행 수가 학습이 실제로 쓴 행 수와 같다', () => {
    // 붓꽃 픽스처는 30행이다. 안 뽑는 경우 · 딱 맞는 경우 · 넘치는 경우 · 뽑는 경우.
    for (const nSamples of [undefined, 30, 60, 24, 12]) {
      const settings = settingsFor(nSamples === undefined ? {} : { nSamples })
      expect({ nSamples, gate: gateFor(settings) }).toEqual({ nSamples, gate: usedBy(settings) })
    }
  })

  /**
   * **가장 작은 표본은 층화를 끄고 본다** (2026-09-01 R18 감사 B-4).
   *
   * 6행에 범주 셋이면 시험이 2장이라 **층화가 성립하지 않는다** — 이제 그 자리에서
   * `SPLIT_STRATIFY_SHARE_TOO_SMALL`이 뜬다. **sklearn 1.9도 같은 입력을 같은 말로
   * 거부한다**(`test_size = 2 should be greater or equal to the number of classes = 3`).
   *
   * **세는 것이 맞는지는 층화와 무관하다.** 이 검사가 보려는 것은 화면의 수와 학습이 쓴
   * 수가 같은가이고, 가장 작은 표본에서도 그것을 봐야 한다.
   */
  it('가장 작은 표본에서도 센 수가 맞는다 - 층화 없이', () => {
    const settings = settingsFor({
      nSamples: 6,
      split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
    })
    expect(gateFor(settings)).toBe(usedBy(settings))
  })

  /** 그 조합에 층화를 켜면 이제 이유를 말하고 멈춘다. 조용히 나누지 않는다. */
  it('가장 작은 표본에 층화를 켜면 이유를 말한다', () => {
    const settings = settingsFor({ nSamples: 6 })
    expect(() => usedBy(settings)).toThrow(
      expect.objectContaining({ code: 'SPLIT_STRATIFY_SHARE_TOO_SMALL' }),
    )
  })

  it('뽑은 실험도 끝까지 돈다 - 세는 것만 맞고 학습이 죽으면 소용없다', () => {
    const settings = settingsFor({ nSamples: 12 })
    const { experiment } = runExperiment(inputFor({ settings }), frozen)
    // 바닥. run이 하나도 안 나오면 "끝까지 돈다"가 공허하게 참이 된다.
    expect(experiment.runs).not.toHaveLength(0)
    for (const run of experiment.runs) expect(run.status).toBe('done')
  })

  it('뽑은 값이 실험 스냅샷에 남는다 - 없으면 재현이 성립하지 않는다', () => {
    const { experiment } = runExperiment(
      inputFor({ settings: settingsFor({ nSamples: 12 }) }),
      frozen,
    )
    expect(experiment.settings.nSamples).toBe(12)

    // 안 뽑았으면 키 자체가 없다. undefined가 파일에 null로 남으면 안 된다.
    const { experiment: whole } = runExperiment(inputFor(), frozen)
    expect(whole.settings).not.toHaveProperty('nSamples')
  })

  it('같은 씨앗이면 뽑은 실험도 통째로 같다', () => {
    const settings = settingsFor({ nSamples: 12 })
    const first = runExperiment(inputFor({ settings }), frozen).experiment
    const second = runExperiment(inputFor({ settings }), frozen).experiment
    expect(second.settings.trainIndices).toEqual(first.settings.trainIndices)
    expect(second.settings.testIndices).toEqual(first.settings.testIndices)
  })

  it('뽑힌 행은 원본 행 번호이고 파일 안에 있다', () => {
    const { experiment } = runExperiment(
      inputFor({ settings: settingsFor({ nSamples: 12 }) }),
      frozen,
    )
    const used = [...experiment.settings.trainIndices, ...experiment.settings.testIndices]
    // **바닥이 특히 중요한 자리다.** 두 인덱스가 둘 다 비는 것이 곧 통과가 된다.
    expect(used).toHaveLength(12)
    for (const row of used) {
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(irisDataset().rows.length)
    }
  })
})

/**
 * **스위치는 워커까지 간다** (`limits-switch.ts`, `open-decisions.md` "상한은 누가
 * 정했느냐" §2).
 *
 * 상한 판정은 화면에만 있는 것이 아니라 **이 함수 안에도 있다** — 워커에서 도는 쪽이
 * 여기다. 메인 스레드의 스위치만 풀면 카드는 열리는데 여기서 run이 실패로 끝나고,
 * 학생이 보는 것은 "상한을 껐는데 학습이 실패한다"가 된다.
 */
describe('상한 off 스위치가 학습까지 간다', () => {
  const line: Dataset = {
    columns: ['x', 'y'],
    rows: [...Array(10).keys()].map((x) => [String(x), String(2 * x + 1)]),
  }

  /** **상한이 작은 가짜 등록부.** 진짜 값(수만 행)으로는 검사가 못 도는 크기다. */
  function tinyLimit(rows: number): readonly Algorithm[] {
    const entry = ALGORITHMS.find((one) => one.id === 'linear_regression')
    if (!entry) throw new Error('linear_regression missing from the registry')
    return [
      {
        ...entry,
        maxRows: { ...entry.maxRows, tabular: { ...entry.maxRows.tabular, mljs: rows } },
      },
    ]
  }

  function run(limitsOff: boolean) {
    return runExperiment(
      {
        dataset: line,
        testDataset: null,
        taskType: 'regression',
        dataType: 'tabular',
        settings: settingsFor({
          features: ['x'],
          target: 'y',
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          selectedAlgorithms: models('linear_regression'),
        }),
        context: {
          serverStatus: 'unavailable',
          limitsOff,
          rowCount: line.rows.length,
          dataType: 'tabular',
        },
      },
      { ...frozen, algorithms: tinyLimit(1) },
    ).experiment
  }

  it('켠 채로는 그 run이 실패한다', () => {
    const experiment = run(false)
    expect(experiment.runs[0]?.status).toBe('failed')
    expect(experiment.runs[0]?.failure?.code).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('끄면 같은 데이터가 학습된다 - 값이 워커까지 실려 온다', () => {
    const experiment = run(true)
    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.failure).toBeUndefined()
  })
})

/**
 * **갈라 볼 것이 없는 학습에 경고가 붙는다** (2026-09-03 교실 판단, `errors.ts`의
 * `TARGET_TOO_FEW_CLASSES`).
 *
 * 값이 한 종류인 열을 타깃으로 놓고 분류를 돌리면 **아무도 안 막는다** — 전처리 화면이
 * *"타깃에 값이 한 종류뿐이라 예측할 것이 없습니다"*로 주의를 주지만 그것을 지나치면
 * 학생이 받는 것은 **정확도 100%**다. 교실에서 100%는 실패가 아니라 성공으로 읽힌다.
 *
 * **거절하지 않는 것이 결정이다** — *"정확도 100%인데 왜 쓸모없을까"*가 좋은 수업
 * 장면이라서다. 그래서 점수는 그대로 나오고 경고가 그 옆에 선다.
 */
describe('타깃에 값이 한 종류뿐이면', () => {
  /** 특성은 갈리는데 타깃만 상수인 표. 교실에서 "전원 합격"이 이 모양이다. */
  function constantTarget(label: string, rows = 10): Dataset {
    return {
      columns: ['키', '몸무게', '결과'],
      rows: Array.from({ length: rows }, (_, index) => [
        String(150 + index * 3),
        String(45 + index * 2),
        label,
      ]),
    }
  }

  /** 절반씩 갈리는 같은 모양의 표. 문턱이 문턱으로 사는지 재는 쪽이다. */
  function twoClasses(rows = 10): Dataset {
    return {
      columns: ['키', '몸무게', '결과'],
      rows: Array.from({ length: rows }, (_, index) => [
        String(150 + index * 3),
        String(45 + index * 2),
        index % 2 === 0 ? '합격' : '불합격',
      ]),
    }
  }

  function runOn(
    dataset: Dataset,
    overrides: Partial<Omit<ExperimentInput, 'snapshot'>> = {},
  ): Experiment {
    const settings = settingsFor()
    return runExperiment(
      {
        ...inputFor({ dataset, ...overrides }),
        settings: {
          ...settings,
          selectedAlgorithms: models('decision_tree'),
          data: { ...baseData, features: ['키', '몸무게'], target: '결과' },
        },
      },
      frozen,
    ).experiment
  }

  it('학습은 성공하고 경고가 붙는다 - 실패로 뒤집지 않는다', () => {
    const run = runOn(constantTarget('합격')).runs[0]
    expect(run?.status).toBe('done')
    expect(run?.failure).toBeUndefined()
    expect(run?.warning?.code).toBe('TARGET_TOO_FEW_CLASSES')
  })

  /** **문장이 그 값을 든다.** 학생이 어느 열의 무엇인지 알아야 고칠 수 있다. */
  it('경고가 그 한 종류의 값을 들고 온다', () => {
    const run = runOn(constantTarget('합격')).runs[0]
    expect(run?.warning?.params).toEqual({ value: '합격' })
  })

  /**
   * **이 줄이 경고가 있어야 하는 이유 그 자체다.** 지표는 멀쩡히 나오고 100%다 —
   * dev 서버에서 손으로 밟았을 때와 같은 값이다(정확도 100% · 혼동 행렬 1×1).
   * 이 숫자가 안 나오게 되는 날은 경고의 근거도 달라진 것이니 함께 읽어야 한다.
   */
  it('그래도 정확도는 100%로 나온다 - 그것이 위험한 것이다', () => {
    const run = runOn(constantTarget('합격')).runs[0]
    expect(run?.metrics?.accuracy).toBe(1)
  })

  it('값이 두 종류면 경고가 없다 - 문턱이 문턱으로 산다', () => {
    const run = runOn(twoClasses()).runs[0]
    expect(run?.status).toBe('done')
    expect(run?.warning).toBeUndefined()
  })

  /**
   * **회귀에는 회귀의 코드가 붙는다** (2026-09-03 R25 §5). 판정은 한 함수이고 학생이
   * 할 일이 갈린다 — 분류는 *"갈라 볼 것이 없다"*, 회귀는 **"오차로 판단하라"**다.
   *
   * **분류의 문장을 그대로 내면 회귀 학생에게 틀린 말이 간다.**
   */
  function regressionRun(dataset: Dataset) {
    return runExperiment(
      {
        ...inputFor({ dataset, taskType: 'regression' }),
        settings: {
          ...settingsFor(),
          selectedAlgorithms: models('linear_regression'),
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          data: { ...baseData, features: ['키', '몸무게'], target: '결과' },
        },
      },
      frozen,
    ).experiment.runs[0]
  }

  it('회귀는 회귀의 코드로 붙는다 - 분류 문장이 가면 안 된다', () => {
    const run = regressionRun(constantTarget('42'))
    expect(run?.status).toBe('done')
    expect(run?.warning?.code).toBe('TARGET_NO_VARIANCE')
  })

  /**
   * **이 줄이 그 경고가 필요한 이유다.** sklearn과 맞춘 뒤로 완벽히 맞힌 회귀는 분모가
   * 0인 자리에서 **1.000**을 받는다 — 만점이라 성공으로 읽힌다.
   */
  it('그래도 결정계수는 1.000으로 나온다 - 그것이 위험한 것이다', () => {
    expect(regressionRun(constantTarget('42'))?.metrics?.r2).toBe(1)
  })

  /**
   * **회귀는 수치로 센다** (R25가 잡은 모서리). `42`와 `42.0`은 **문자열로 두 종류**인데
   * 엔진은 `Number()`로 읽어 **한 종류**로 학습한다. 그 열에서 R²의 분모는 정확히 0이라
   * 1.0/0.0 규칙이 켜지는데, 문자열로 세면 경고만 안 붙는다.
   */
  it('42와 42.0은 회귀에서 한 종류다 - 문자열로 세면 이 줄이 빨개진다', () => {
    const mixed: Dataset = {
      columns: ['키', '몸무게', '결과'],
      rows: Array.from({ length: 10 }, (_, index) => [
        String(150 + index * 3),
        String(45 + index * 2),
        index % 2 === 0 ? '42' : '42.0',
      ]),
    }
    const run = regressionRun(mixed)
    expect(run?.status).toBe('done')
    expect(run?.warning?.code).toBe('TARGET_NO_VARIANCE')
  })

  /**
   * **데이터 경고가 엔진 경고를 이긴다** (2026-09-03 R25 B-3).
   *
   * `Run.warning`이 하나뿐이라 둘이 겹치면 골라야 한다. 감사가 **우선순위만 뒤집는**
   * 돌연변이를 심었더니 조용했다 — 둘이 함께 나는 픽스처가 없었기 때문이다. 재 보니
   * **인공신경망 회귀가 상수 타깃에서 실제로 `NEURAL_REGRESSION_NOT_CONVERGED`를 낸다.**
   *
   * 타깃이 상수면 그 점수 자체에 뜻이 없으므로 *"덜 다듬어진 계수에서 나온 숫자다"*보다
   * 먼저 할 말이다.
   */
  it('엔진 경고와 겹치면 데이터 경고가 이긴다', () => {
    const rows = 30
    const constant: Dataset = {
      columns: ['키', '몸무게', '결과'],
      rows: Array.from({ length: rows }, (_, index) => [
        String(index * 0.7),
        String((index % 5) * 3),
        '42',
      ]),
    }
    const experiment = runExperiment(
      {
        ...inputFor({ dataset: constant, taskType: 'regression' }),
        settings: {
          ...settingsFor(),
          selectedAlgorithms: models('neural_network'),
          split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
          data: { ...baseData, features: ['키', '몸무게'], target: '결과' },
        },
      },
      frozen,
    ).experiment
    const run = experiment.runs[0]
    expect(run?.status).toBe('done')
    // 이 픽스처가 엔진 경고를 실제로 내야 이 검사가 우선순위를 잰다.
    expect(
      fit('neural_network', {
        features: constant.rows.map((row) => [Number(row[0]), Number(row[1])]),
        rowIndices: constant.rows.map((_, index) => index),
        target: constant.rows.map(() => '42'),
        taskType: 'regression',
        hyperparameters: {},
        randomState: 42,
      }).warning?.code,
      'the engine must warn here, or this test does not measure priority',
    ).toBe('NEURAL_REGRESSION_NOT_CONVERGED')
    expect(run?.warning?.code).toBe('TARGET_NO_VARIANCE')
  })

  it('회귀 타깃이 실제로 변하면 경고가 없다 - 문턱이 문턱으로 산다', () => {
    const varying: Dataset = {
      columns: ['키', '몸무게', '결과'],
      rows: Array.from({ length: 10 }, (_, index) => [
        String(150 + index * 3),
        String(45 + index * 2),
        String(40 + index),
      ]),
    }
    const run = regressionRun(varying)
    expect(run?.status).toBe('done')
    expect(run?.warning).toBeUndefined()
  })

  /**
   * **군집은 정답이 없는 것이 전제라 타깃이 비어 있다.** 개수가 0이라 문턱(1)에 안 걸린다 —
   * 위 회귀 검사와 달리 이것은 유형 가드를 물지 않는다. 그래도 두는 이유는 **군집 학습마다
   * 경고가 붙는 상태**를 다른 무엇이 만들어도 여기서 걸리기 때문이다.
   */
  it('군집에는 안 붙는다 - 타깃이 없는 것이 전제다', () => {
    const experiment = runExperiment(
      {
        ...inputFor({ dataset: constantTarget('합격'), taskType: 'clustering' }),
        settings: {
          ...settingsFor(),
          selectedAlgorithms: models('k_means'),
          data: { ...baseData, features: ['키', '몸무게'], target: '결과' },
        },
      },
      frozen,
    ).experiment
    expect(experiment.runs[0]?.status).toBe('done')
    expect(experiment.runs[0]?.warning).toBeUndefined()
  })
})
