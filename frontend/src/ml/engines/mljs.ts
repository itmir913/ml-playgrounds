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
 *   나이브 베이즈    0.9667 -> 0.7000   폭이 제일 크다
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
import { GaussianNB } from 'ml-naivebayes'
import { RandomForestClassifier } from 'ml-random-forest'
import MultivariateLinearRegression from 'ml-regression-multivariate-linear'

import { ClientError } from '../../errors'
import type { Prediction } from '../metrics'

/**
 * 이 엔진의 이름과 버전. run.engine에 그대로 들어간다.
 *
 * **의존성이 바뀌어 숫자가 달라질 수 있으면 여기를 올려야 한다.** 잊지 않도록
 * tests/mljs.spec.ts가 설치된 ml.js 버전을 고정해 두었다 - Dependabot이 올리면
 * 테스트가 깨지고, 그때 숫자가 움직였는지 보고 결정하게 된다.
 */
export const MLJS_ENGINE = { kind: 'mljs', version: '1' } as const

/** 학습된 모델. 예측만 할 수 있으면 된다 - 포맷 계층은 모델 안을 안 들여다본다. */
export type Predict = (features: readonly (readonly number[])[]) => Prediction[]

export interface FitInput {
  /** 전처리를 마친 숫자 행렬 (ml/preprocess.ts). */
  features: readonly (readonly number[])[]
  /** 분류면 라벨 문자열, 회귀면 수치. */
  target: readonly Prediction[]
  hyperparameters: Record<string, unknown>
  /** 항상 저장하고 항상 쓴다. 재현 가능성이 교육용 도구의 생명이다. */
  randomState: number
}

type Trainer = (input: FitInput) => Predict

const toRows = (features: readonly (readonly number[])[]): number[][] =>
  features.map((row) => [...row])

function numberOption(source: Record<string, unknown>, name: string, fallback: number): number {
  const value = source[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 라벨 부호기. ml.js 분류기는 숫자 클래스만 받는다.
 *
 * **등장 순서가 아니라 정렬 순서로 매긴다.** 등장 순서로 하면 같은 데이터인데 행 순서가
 * 바뀌면 클래스 번호가 달라지고, 같은 모델이 다른 모델처럼 보인다.
 */
function labelCodec(target: readonly Prediction[]): {
  encoded: number[]
  decode: (position: number) => string
} {
  const labels = [...new Set(target.map(String))].sort()
  const index = new Map(labels.map((label, position) => [label, position]))
  return {
    encoded: target.map((value) => index.get(String(value)) ?? 0),
    // 범위를 벗어난 번호가 나오면 첫 라벨로 떨어진다. 예측을 통째로 실패시키지 않는다.
    decode: (position) => labels[position] ?? labels[0] ?? '',
  }
}

/** train/predict 모양을 가진 분류기들의 공통 껍데기. */
interface TrainablePredictor {
  train(features: number[][], target: number[]): void
  predict(features: number[][]): number[]
}

function classifier(build: (input: FitInput) => TrainablePredictor): Trainer {
  return (input) => {
    const { encoded, decode } = labelCodec(input.target)
    const model = build(input)
    model.train(toRows(input.features), encoded)
    return (features) =>
      [...model.predict(toRows(features))].map((value) => decode(Math.round(value)))
  }
}

/**
 * 알고리즘 등록부. **기본값은 실측한 값 그대로다** - 이 값에서 붓꽃 숫자가 나왔고
 * tests/mljs.spec.ts가 그것을 고정한다. 바꾸면 학생의 결과가 바뀐다.
 *
 * 하이퍼파라미터 이름이 sklearn과 다르다(`maxDepth` / `max_depth`). 그래서 등록부 키가
 * (알고리즘, 실행 방법)이어야 한다 - 같은 이름으로 두 엔진을 먹이면 조용히 무시된다.
 */
const TRAINERS: Record<string, Trainer> = {
  decision_tree: classifier(
    (input) =>
      new DecisionTreeClassifier({
        gainFunction: 'gini',
        maxDepth: numberOption(input.hyperparameters, 'maxDepth', 100),
        minNumSamples: numberOption(input.hyperparameters, 'minNumSamples', 3),
      }),
  ),

  random_forest: classifier(
    (input) =>
      new RandomForestClassifier({
        nEstimators: numberOption(input.hyperparameters, 'nEstimators', 100),
        // 시드를 반드시 넘긴다. 안 넘기면 같은 설정으로 두 번 돌려도 결과가 다르다.
        seed: input.randomState,
        useSampleBagging: true,
      }) as TrainablePredictor,
  ),

  naive_bayes: classifier(() => new GaussianNB() as TrainablePredictor),

  knn: (input) => {
    const { encoded, decode } = labelCodec(input.target)
    // KNN은 생성자에서 학습한다 - 사실상 학습 데이터 전체가 모델이다 (mlpx-spec.md 5.1).
    const model = new KNN(toRows(input.features), encoded, {
      k: numberOption(input.hyperparameters, 'k', 5),
    })
    return (features) =>
      [...model.predict(toRows(features))].map((value) => decode(Math.round(value)))
  },

  logistic_regression: (input) => {
    const { encoded, decode } = labelCodec(input.target)
    const model = new LogisticRegression({
      numSteps: numberOption(input.hyperparameters, 'numSteps', 1000),
      learningRate: numberOption(input.hyperparameters, 'learningRate', 5e-3),
    })
    model.train(new Matrix(toRows(input.features)), Matrix.columnVector(encoded))
    return (features) =>
      [...model.predict(new Matrix(toRows(features)))].map((value) => decode(Math.round(value)))
  },

  linear_regression: (input) => {
    // 회귀는 부호화하지 않는다. 타깃이 이미 수치다.
    const model = new MultivariateLinearRegression(
      toRows(input.features),
      input.target.map((value) => [Number(value)]),
    )
    return (features) => toRows(features).map((row) => Number(model.predict(row)[0] ?? 0))
  },
}

/** 이 엔진이 돌릴 수 있는 알고리즘. ml/algorithms.ts의 runtimes와 맞아야 한다. */
export const MLJS_ALGORITHMS = Object.keys(TRAINERS)

/**
 * 학습하고 예측 함수를 돌려준다.
 *
 * 모르는 알고리즘이면 실패한다. 화면이 고르게 하는 목록은 등록부에서 나오므로 여기
 * 도달하는 것은 버그이거나 남의 파일에 든 모르는 알고리즘이다 (mlpx-spec.md 5.2).
 */
export function fit(algorithm: string, input: FitInput): Predict {
  const trainer = TRAINERS[algorithm]
  if (!trainer) throw new ClientError('ALGORITHM_UNSUPPORTED', { algorithm })
  return trainer(input)
}
