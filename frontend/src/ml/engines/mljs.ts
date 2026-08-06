/**
 * 순수 JS 학습 엔진 - **V1의 기본 실행 방법이다.**
 *
 * gzip 25KB에 시동이 없다. scikit-learn은 26.3MB에 시동만 15.4초라 기본값이 될 수 없다
 * (open-decisions.md "브라우저 학습 엔진은 둘 다 간다").
 *
 * **sklearn과 숫자가 다를 수 있고, 폭이 알고리즘마다 크게 다르다.**
 * 붓꽃 전체를 같은 분할로 돌린 실측:
 *
 *   결정트리        0.9333  =  0.9333   같다
 *   KNN             1.0000  =  1.0000   같다
 *   로지스틱 회귀    0.9667 -> 0.8667   여기는 정규화 없는 경사하강이다
 *   랜덤포레스트     0.9000 -> 0.9667   배깅 난수가 다르다 (여기가 더 높다)
 *   나이브 베이즈    0.9667 -> (붓꽃 전체는 미측정. 아래를 보라)
 *
 * **나이브 베이즈 행은 한 번 거짓말을 했다.** 예전에 0.7000이라 적혀 있었고 그 숫자가
 * "폭이 제일 크다"의 근거였는데, 실은 `ml-naivebayes`가 특성을 앞 2개만 읽은 결과였다.
 * 지금은 이 파일 안에서 계산한다(gaussianNaiveBayes). 픽스처 30행 기준으로 3/9에서
 * 8/9로 올랐다. 붓꽃 전체 150행 재측정은 아직 안 했으므로 **여기에 숫자를 적지 않는다** -
 * 안 잰 값을 적는 것이 애초에 이 행을 틀리게 만든 방식이다.
 *
 * **폭이 크다는 이유로 알고리즘을 빼지 않는다.** 어디까지가 "구현 차이"이고 어디부터가
 * "빼야 할 것"인지 그을 선이 없고, 그 선을 임의로 그으면 학생은 어떤 모델이 왜
 * 사라졌는지 알 수 없다. 대신 **무엇으로 만들었는지 기록하고**(run.engine)
 * **재실행 대조는 엔진을 넘지 않는다**(architecture.md 3.2).
 * 이 표가 그 규칙이 왜 필요한지 보여준다.
 *
 * 알고리즘 분기는 표로 한다. `if (algorithm === 'knn')` 을 만들지 마라 -
 * TRAINERS에 등록하면 늘어난다 (ml/algorithms.ts와 같은 방식).
 *
 * **여기 있는 것은 순수 함수다.** 실제로는 Web Worker 안에서 불린다 - 메인 스레드에서
 * 돌리면 진행률도 취소 버튼도 같이 얼어붙는다(open-decisions.md "학습은 언제나
 * 백그라운드다"). 워커는 이 함수들을 부르는 껍데기일 뿐이고, 로직이 순수해야 테스트로 덮인다.
 */

import { DecisionTreeClassifier } from 'ml-cart'
import KNN from 'ml-knn'
import LogisticRegression from 'ml-logistic-regression'
import { Matrix } from 'ml-matrix'
import { RandomForestClassifier } from 'ml-random-forest'
import MultivariateLinearRegression from 'ml-regression-multivariate-linear'

import { ClientError, failureDetail } from '../../errors'
import { resolveWith, type HyperparameterSpec } from '../hyperparams'
import type { Prediction } from '../metrics'
import type { ModelFile, Predict } from '../models/types'
import { MLJS_PARAMETERS } from './mljs-params'
import { serializeForest, serializeTree } from './mljs-serialize'

/**
 * 이 엔진의 이름과 버전. run.engine에 그대로 들어간다.
 *
 * **아직 밖에 나간 파일이 없으므로 올리지 않는다.** 이 값이 하는 일은 재실행 대조가
 * 옛 파일을 새 엔진으로 검사하지 않게 막는 것인데(architecture.md 3.2), 검사할 옛
 * 파일이 하나도 없으면 구분할 대상이 없다. 기본값을 바꿔도 마찬가지다 - 배포 전에는
 * 지금 엔진이 유일한 엔진이다. `batches`를 `experiments`로 바꾸면서 formatVersion을
 * 안 올린 것과 같은 논리다 (mlpx-spec.md 4).
 *
 * **첫 배포 뒤에는 규칙이 뒤집힌다.** 의존성이 바뀌어 숫자가 달라질 수 있으면
 * 반드시 여기를 올려야 한다. 잊지 않도록
 * tests/mljs.spec.ts가 설치된 ml.js 버전을 고정해 두었다 - Dependabot이 올리면
 * 테스트가 깨지고, 그때 숫자가 움직였는지 보고 결정하게 된다.
 */
export const MLJS_ENGINE = { kind: 'mljs', version: '2' } as const

export type { Predict } from '../models/types'

/**
 * 학습 한 번의 결과.
 *
 * **모델이 없는 것이 정상 경로다.** 이 엔진이 돌리는 알고리즘 여섯 중 우리 형식으로 담을
 * 수 있는 것은 아직 트리 둘뿐이고, 나머지는 지표만 남는다 - 파일에는 그 사유가
 * `modelOmitted: 'engineUnsupported'`로 적힌다 (mlpx-spec.md 4.2).
 *
 * **경로도 크기도 여기서 정하지 않는다.** zip 안의 자리를 아는 것은 저장 계층이고,
 * 여기서 없는 경로를 적으면 파일이 자기 자신에 대해 거짓말을 하게 된다 (ml/experiment.ts의
 * preprocessor와 같은 이유다).
 */
export interface FitResult {
  predict: Predict
  model?: ModelFile
  /**
   * 모델을 못 담았을 때 그 원문. **어휘가 아니라 기술 정보다** (mlpx-spec.md 5.0.1).
   *
   * 사유 어휘(modelOmitted)는 부르는 쪽이 붙인다 - 여기서는 무엇이 터졌는지만 전한다.
   */
  modelOmittedDetail?: string
}

export interface FitInput {
  /** 전처리를 마친 숫자 행렬 (ml/preprocess.ts). */
  features: readonly (readonly number[])[]
  /** 분류면 라벨 문자열, 회귀면 수치. */
  target: readonly Prediction[]
  hyperparameters: Record<string, unknown>
  /** 항상 저장하고 항상 쓴다. 재현 가능성이 교육용 도구의 생명이다. */
  randomState: number
}

type Trainer = (input: FitInput) => FitResult

const toRows = (features: readonly (readonly number[])[]): number[][] =>
  features.map((row) => [...row])

/**
 * 이 엔진이 이 알고리즘에 받는 손잡이들. 모르는 알고리즘이면 빈 배열이다.
 *
 * 표는 `mljs-params.ts`에 있다 - 전처리 화면이 같은 표를 읽어야 하는데 이 파일을
 * 거치면 ml.js 라이브러리가 통째로 첫 화면 번들에 딸려 온다.
 */
export function parameters(algorithm: string): readonly HyperparameterSpec[] {
  return MLJS_PARAMETERS[algorithm] ?? []
}

/**
 * 확정된 값에서 수치를 읽는다. **폴백 인자가 없다** - resolve()가 이미 채웠다.
 *
 * 그래도 0을 준비해 두는 이유는 타입 때문이지 기본값이 아니다. 여기까지 오는 값은
 * resolve()가 숫자로 만들어 둔 것이고, 그렇지 않다면 그건 등록부에 없는 키다.
 */
function numberOption(source: Record<string, unknown>, name: string): number {
  const value = source[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 라벨 부호기. ml.js 분류기는 숫자 클래스만 받는다.
 *
 * **등장 순서가 아니라 정렬 순서로 매긴다.** 등장 순서로 하면 같은 데이터인데 행 순서가
 * 바뀌면 클래스 번호가 달라지고, 같은 모델이 다른 모델처럼 보인다.
 */
function labelCodec(target: readonly Prediction[]): {
  encoded: number[]
  /** 정렬된 라벨 그대로. 직렬화한 모델의 classes가 이것이다 (mlpx-spec.md 5.3). */
  labels: string[]
  decode: (position: number) => string
} {
  const labels = [...new Set(target.map(String))].sort()
  const index = new Map(labels.map((label, position) => [label, position]))
  return {
    encoded: target.map((value) => index.get(String(value)) ?? 0),
    labels,
    // **범위를 벗어난 번호는 던진다.** 예전에는 첫 라벨로 조용히 떨어뜨렸는데, 그게
    // "예측 불능"을 확신에 찬 오답으로 위장했다 - 붓꽃 모델에 cm 대신 mm를 넣으면
    // 원시 번호가 -1이고 화면에는 setosa가 떴다 (open-decisions.md "범위 밖 클래스
    // 번호는 던진다"). 이 저장소가 규정한 최악은 실패가 아니라 조용히 틀린 숫자다.
    //
    // 자체 구현 나이브 베이즈는 -1을 내지 않으므로 지금은 도달하지 않는다. 방어선은
    // 남긴다 - 앞으로 들어올 엔진(pyodide·서버)의 출력도 이 decode를 지난다.
    decode: (position) => {
      const label = labels[position]
      if (label === undefined) {
        throw new ClientError('JOB_FAILED', { classIndex: position, classCount: labels.length })
      }
      return label
    },
  }
}

/**
 * 분산에 더하는 하한. sklearn의 `var_smoothing` 기본값과 같은 규칙이다.
 *
 * 값이 하나뿐인 클래스는 분산이 0이라 그대로 두면 0으로 나눈다. 전체 학습셋 분산의
 * 최댓값에 이 비율을 곱해 더한다 - 절대값으로 두면 열의 단위(cm와 원)에 따라 효과가
 * 달라진다.
 */
const VAR_SMOOTHING = 1e-9

/** 열별 평균. 그룹이 비어 있는 경우는 없다 - 라벨은 등장한 것만 부호화된다. */
function columnMeans(group: readonly (readonly number[])[], width: number): number[] {
  return Array.from(
    { length: width },
    (_, j) => group.reduce((sum, row) => sum + (row[j] ?? 0), 0) / group.length,
  )
}

/** 열별 분산. **모분산(n으로 나눈다)이다** - sklearn과 같다. */
function columnVariances(
  group: readonly (readonly number[])[],
  means: readonly number[],
  width: number,
): number[] {
  return Array.from(
    { length: width },
    (_, j) =>
      group.reduce((sum, row) => sum + ((row[j] ?? 0) - (means[j] ?? 0)) ** 2, 0) / group.length,
  )
}

/**
 * 가우시안 나이브 베이즈. **저장소 안에서 계산한다.**
 *
 * `ml-naivebayes@4.0.0`을 쓰지 않는 이유는 성능이 아니라 결함이다 - 그 구현은 예측할 때
 * 특성을 **앞의 2개만** 읽는다(예측 루프 상한을 특성 하나의 파라미터 쌍 길이에서 뽑는다).
 * 학습은 전부 받고 예측이 둘만 읽으므로 아무 에러 없이 "CSV의 처음 두 열만 쓴 모델"의
 * 숫자가 나왔다. 4.0.0이 최신이고 사실상 방치돼 있다
 * (open-decisions.md "가우시안 나이브 베이즈는 의존성을 빼고 우리가 구현한다").
 *
 * **로그 공간에서 끝까지 간다.** 확률로 되돌리지 않는다 - `exp`를 한 번 왕복하면
 * 지수 합이 대략 -745 아래일 때 0으로 언더플로해서 모든 클래스가 같아지고, 그 라이브러리는
 * 거기서 "예측 없음"(-1)을 냈다. 비교만 하면 되므로 되돌릴 이유가 없다.
 *
 * 정규화 상수도 그대로 둔다. argmax에는 영향이 없지만 빼면 이 함수가 무엇을 계산하는지
 * 식으로 안 읽힌다.
 */
function gaussianNaiveBayes(): TrainablePredictor {
  let priors: number[] = []
  let means: number[][] = []
  let variances: number[][] = []
  let width = 0

  return {
    train(features, target) {
      width = features[0]?.length ?? 0
      const classCount = target.reduce((max, value) => Math.max(max, value), -1) + 1

      const groups: number[][][] = Array.from({ length: classCount }, () => [])
      target.forEach((label, row) => {
        groups[label]?.push(features[row] ?? [])
      })

      // 전체 학습셋의 열 분산 최댓값. 클래스별이 아니라 전체에서 구한다 (sklearn과 같다).
      const overallMeans = columnMeans(features, width)
      const smoothing =
        VAR_SMOOTHING * Math.max(0, ...columnVariances(features, overallMeans, width))

      priors = groups.map((group) => Math.log(group.length / features.length))
      means = groups.map((group) => columnMeans(group, width))
      variances = groups.map((group, c) =>
        columnVariances(group, means[c] ?? [], width).map((value) => value + smoothing),
      )
    },

    predict(features) {
      return features.map((row) => {
        let best = -1
        let bestScore = Number.NEGATIVE_INFINITY

        priors.forEach((prior, c) => {
          let score = prior
          for (let j = 0; j < width; j += 1) {
            // 분산이 0이면 그 열은 정보를 주지 않는다. smoothing이 0을 막지만 학습셋 전체가
            // 상수인 극단은 남으므로 여기서도 건너뛴다 - 0으로 나누면 전부 NaN이 된다.
            const variance = variances[c]?.[j] ?? 0
            if (variance <= 0) continue
            const gap = (row[j] ?? 0) - (means[c]?.[j] ?? 0)
            score += -0.5 * (Math.log(2 * Math.PI * variance) + (gap * gap) / variance)
          }
          // 동점이면 번호가 작은 쪽이 이긴다. 라벨은 정렬 순서로 매겨지므로 결정적이다.
          if (score > bestScore) {
            bestScore = score
            best = c
          }
        })

        return best
      })
    },
  }
}

/** train/predict 모양을 가진 분류기들의 공통 껍데기. */
interface TrainablePredictor {
  train(features: number[][], target: number[]): void
  predict(features: number[][]): number[]
}

/**
 * 만들어진 분류기와, 그것을 우리 형식으로 담는 방법.
 *
 * **직렬화기를 클로저로 받는다.** 만든 자리에서 구체 타입을 잡고 있으므로 여기서 다시
 * 좁힐 일이 없다 - 공통 껍데기(TrainablePredictor)로는 랜덤포레스트의 toJSON()에 닿지
 * 못하고, 닿으려고 타입을 넓히면 그 넓힘이 다른 알고리즘에까지 번진다.
 */
interface Trained {
  readonly predictor: TrainablePredictor
  /** 우리 형식으로 담는다. 없으면 이 알고리즘에는 아직 직렬화기가 없다는 뜻이다. */
  readonly serialize?: (classes: readonly string[], featureCount: number) => ModelFile
}

/**
 * 직렬화가 실패해도 run은 살린다. **지표는 멀쩡하기 때문이다.**
 *
 * 여기서 던지면 학습이 성공한 run이 실패로 뒤집힌다. 여기 오는 경로는 하나뿐이고
 * (ml.js 내부 구조가 움직였다) 그건 tests/mljs.spec.ts가 버전을 고정해 CI에서 먼저 걸린다.
 *
 * **조용히 삼키는 것이 아니다.** 모델이 없으면 파일에 사유가 남고(modelOmitted) 화면은
 * "예측할 수 없습니다"를 말한다. 학생이 할 일은 직렬화기가 아예 없을 때와 같다.
 *
 * **그리고 원문을 버리지 않는다** (mlpx-spec.md 5.0.1). 사유 어휘는 "직렬화기 없음"과
 * 같지만, 그건 학생에게 할 말이 같다는 뜻이지 우리가 알 필요가 없다는 뜻이 아니다 -
 * 원문이 없으면 학생 환경에서 실제로 터졌을 때 진단 단서가 0이다.
 */
function serializeOrOmit(serialize: () => ModelFile): {
  model?: ModelFile
  detail?: string
} {
  try {
    return { model: serialize() }
  } catch (error) {
    const { detail } = failureDetail(error)
    return typeof detail === 'string' ? { detail } : {}
  }
}

function classifier(build: (input: FitInput) => Trained): Trainer {
  return (input) => {
    const { encoded, labels, decode } = labelCodec(input.target)
    const { predictor, serialize } = build(input)
    predictor.train(toRows(input.features), encoded)

    const predict: Predict = (features) =>
      [...predictor.predict(toRows(features))].map((value) => decode(Math.round(value)))
    if (!serialize) return { predict }

    // 전처리를 마친 행렬의 열 수. 모델이 이 값을 들고 있어야 다른 전처리기로 예측하는
    // 것을 막을 수 있다 (mlpx-spec.md 5.3).
    const featureCount = input.features[0]?.length ?? 0
    const attempted = serializeOrOmit(() => serialize(labels, featureCount))
    if (attempted.model) return { predict, model: attempted.model }
    return attempted.detail === undefined
      ? { predict }
      : { predict, modelOmittedDetail: attempted.detail }
  }
}

/**
 * 알고리즘 등록부. **기본값은 여기 없다** - DEFAULTS가 출처이고 트레이너는 resolve()가
 * 확정한 값을 읽기만 한다.
 *
 * 하이퍼파라미터 이름이 sklearn과 다르다(`maxDepth` / `max_depth`). 그래서 등록부 키가
 * (알고리즘, 실행 방법)이어야 한다 - 같은 이름으로 두 엔진을 먹이면 조용히 무시된다.
 */
const TRAINERS: Record<string, Trainer> = {
  decision_tree: classifier((input) => {
    const model = new DecisionTreeClassifier({
      gainFunction: 'gini',
      maxDepth: numberOption(input.hyperparameters, 'maxDepth'),
      minNumSamples: numberOption(input.hyperparameters, 'minNumSamples'),
    })
    return {
      predictor: model,
      serialize: (classes, featureCount) => serializeTree(model, classes, featureCount),
    }
  }),

  random_forest: classifier((input) => {
    const model = new RandomForestClassifier({
      nEstimators: numberOption(input.hyperparameters, 'nEstimators'),
      // 시드를 반드시 넘긴다. 안 넘기면 같은 설정으로 두 번 돌려도 결과가 다르다.
      seed: input.randomState,
      useSampleBagging: true,
      // **OOB 계산을 끈다. 안 끄면 나무를 적게 잡은 학습이 통째로 실패한다.**
      //
      // ml.js는 학습 끝에 out-of-bag 예측을 모으는데, 어떤 행이 모든 나무의 학습 표본에
      // 들어가면 그 행의 표가 빈 배열이 되고 거기서 던진다(ml-array-mode: "input must not
      // be empty"). 한 행이 그렇게 될 확률이 나무 하나당 약 0.632이므로 나무가 10그루면
      // 행마다 1%, 즉 수백 행짜리 데이터에서는 사실상 반드시 터진다. 100그루(기본값)에서는
      // 확률이 0에 수렴해서 안 보였다 - 나무 개수를 줄여 본 학생만 만나는 실패다.
      //
      // 우리는 OOB 결과를 쓰지 않는다(predictOOB도 getConfusionMatrix도 안 부른다).
      // 끄는 것이 기능을 빼는 것이 아니고, 이 블록은 난수를 소모하지 않으므로
      // **학습된 모델은 한 비트도 달라지지 않는다** - tests/mljs.spec.ts의 고정된 숫자가
      // 그것을 지킨다. 덤으로 학습이 빨라진다.
      noOOB: true,
    })
    return {
      predictor: model as TrainablePredictor,
      serialize: (classes, featureCount) => serializeForest(model, classes, featureCount),
    }
  }),

  naive_bayes: classifier(() => ({ predictor: gaussianNaiveBayes() })),

  knn: (input) => {
    const { encoded, decode } = labelCodec(input.target)
    // KNN은 생성자에서 학습한다 - 사실상 학습 데이터 전체가 모델이다 (mlpx-spec.md 5.1).
    const model = new KNN(toRows(input.features), encoded, {
      k: numberOption(input.hyperparameters, 'k'),
    })
    return {
      predict: (features) =>
        [...model.predict(toRows(features))].map((value) => decode(Math.round(value))),
    }
  },

  logistic_regression: (input) => {
    const { encoded, decode } = labelCodec(input.target)
    const model = new LogisticRegression({
      numSteps: numberOption(input.hyperparameters, 'numSteps'),
      learningRate: numberOption(input.hyperparameters, 'learningRate'),
    })
    model.train(new Matrix(toRows(input.features)), Matrix.columnVector(encoded))
    return {
      predict: (features) =>
        [...model.predict(new Matrix(toRows(features)))].map((value) => decode(Math.round(value))),
    }
  },

  linear_regression: (input) => {
    // 회귀는 부호화하지 않는다. 타깃이 이미 수치다.
    const model = new MultivariateLinearRegression(
      toRows(input.features),
      input.target.map((value) => [Number(value)]),
    )
    return {
      predict: (features) => toRows(features).map((row) => Number(model.predict(row)[0] ?? 0)),
    }
  },
}

/** 이 엔진이 돌릴 수 있는 알고리즘. ml/algorithms.ts의 runtimes와 맞아야 한다. */
export const MLJS_ALGORITHMS = Object.keys(TRAINERS)

/**
 * 이 엔진이 실제로 먹을 값을 확정한다. **학습보다 앞이다** (mlpx-spec.md 3).
 *
 * 확정을 fit 안으로 넣으면 fit이 던졌을 때 돌려줄 것이 없어서 **실패한 run에 아무 값도
 * 안 남는다.** 그러면 같은 필드가 성공과 실패에서 두 가지 뜻을 갖고, "실패한 run에도
 * 무엇을 시도했는지는 남아야 한다"(ml/experiment.ts)가 깨진다.
 *
 * 규칙은 ml/hyperparams.ts의 resolveWith에 있다. 여기서 하는 일은 서술을 고르는 것뿐이다.
 *
 * 모르는 알고리즘이면 서술이 빈 배열이라 준 값이 그대로 나온다. 던지지 않는다 -
 * 판정은 fit의 일이고, 여기서 던지면 실패 run을 만들기도 전에 실험이 죽는다.
 */
export function resolve(
  algorithm: string,
  given: Record<string, unknown>,
): Record<string, unknown> {
  return resolveWith(parameters(algorithm), given)
}

/**
 * 학습하고 예측 함수를 돌려준다.
 *
 * 모르는 알고리즘이면 실패한다. 화면이 고르게 하는 목록은 등록부에서 나오므로 여기
 * 도달하는 것은 버그이거나 남의 파일에 든 모르는 알고리즘이다 (mlpx-spec.md 5.2).
 */
export function fit(algorithm: string, input: FitInput): FitResult {
  const trainer = TRAINERS[algorithm]
  if (!trainer) throw new ClientError('ALGORITHM_UNSUPPORTED', { algorithm })
  // **여기서도 확정한다.** 부르는 쪽이 resolve를 거쳤는지에 기대지 않는다 - 안 거친
  // 호출은 k가 0인 KNN처럼 조용히 망가지고, 그 원인은 여기서 멀리 떨어진 곳에서 터진다.
  // resolve는 병합이라 두 번 걸어도 결과가 같다.
  return trainer({ ...input, hyperparameters: resolve(algorithm, input.hyperparameters) })
}
