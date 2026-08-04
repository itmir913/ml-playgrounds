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

/**
 * 알고리즘별 기본 하이퍼파라미터. **이 엔진에서 이 값들의 유일한 출처다.**
 *
 * 트레이너 안에 폴백으로 두면 같은 숫자가 두 군데 살고, 한쪽만 고쳤을 때 파일이 조용히
 * 거짓말을 한다 - run.hyperparameters에는 100이라 적혀 있는데 50으로 돈 상태다.
 * 그래서 resolve()가 여기서 값을 확정하고 트레이너는 확정된 값을 그냥 읽는다.
 *
 * **실측한 값 그대로다** - 이 값에서 파일 머리말의 붓꽃 숫자가 나왔고 tests/mljs.spec.ts가
 * 그것을 고정한다. 바꾸면 학생의 결과가 바뀐다.
 *
 * 여기 없는 생성자 인자가 둘 있다 - 결정트리의 gainFunction('gini')과 랜덤포레스트의
 * useSampleBagging(true). **구멍이 아니라 범위다.** 둘 다 진짜 손잡이지만(sklearn의
 * criterion, bootstrap) 표에 넣는 순간 학생이 바꿀 수 있는 값이 되고, 그건 하이퍼파라미터
 * 화면을 만들 때 입력 범위와 함께 볼 일이다(open-decisions.md "학습 실패는 교사가 읽을 수
 * 있게 전달한다"의 마지막 줄). 그때 여기로 옮긴다.
 *
 * randomState도 없다. 출처가 settings.split 하나이고 파일 두 곳에 같은 값이 있으면
 * 어긋났을 때 어느 쪽이 진짜인지 판정할 근거가 없다 (mlpx-spec.md 3).
 */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  decision_tree: { maxDepth: 100, minNumSamples: 3 },
  random_forest: { nEstimators: 100 },
  naive_bayes: {},
  knn: { k: 5 },
  logistic_regression: { numSteps: 1000, learningRate: 5e-3 },
  linear_regression: {},
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
 * 알고리즘 등록부. **기본값은 여기 없다** - DEFAULTS가 출처이고 트레이너는 resolve()가
 * 확정한 값을 읽기만 한다.
 *
 * 하이퍼파라미터 이름이 sklearn과 다르다(`maxDepth` / `max_depth`). 그래서 등록부 키가
 * (알고리즘, 실행 방법)이어야 한다 - 같은 이름으로 두 엔진을 먹이면 조용히 무시된다.
 */
const TRAINERS: Record<string, Trainer> = {
  decision_tree: classifier(
    (input) =>
      new DecisionTreeClassifier({
        gainFunction: 'gini',
        maxDepth: numberOption(input.hyperparameters, 'maxDepth'),
        minNumSamples: numberOption(input.hyperparameters, 'minNumSamples'),
      }),
  ),

  random_forest: classifier(
    (input) =>
      new RandomForestClassifier({
        nEstimators: numberOption(input.hyperparameters, 'nEstimators'),
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
      k: numberOption(input.hyperparameters, 'k'),
    })
    return (features) =>
      [...model.predict(toRows(features))].map((value) => decode(Math.round(value)))
  },

  logistic_regression: (input) => {
    const { encoded, decode } = labelCodec(input.target)
    const model = new LogisticRegression({
      numSteps: numberOption(input.hyperparameters, 'numSteps'),
      learningRate: numberOption(input.hyperparameters, 'learningRate'),
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
 * 이 엔진이 실제로 먹을 값을 확정한다. **학습보다 앞이다** (mlpx-spec.md 3).
 *
 * 확정을 fit 안으로 넣으면 fit이 던졌을 때 돌려줄 것이 없어서 **실패한 run에 아무 값도
 * 안 남는다.** 그러면 같은 필드가 성공과 실패에서 두 가지 뜻을 갖고, "실패한 run에도
 * 무엇을 시도했는지는 남아야 한다"(ml/batch.ts)가 깨진다.
 *
 * 규칙 셋.
 *
 * 1. **학생이 준 값이 이긴다.** 기본값은 안 준 자리만 채운다.
 * 2. **기본값이 있는 키는 여기서 숫자로 만든다.** 못 쓰는 값이면 기본값으로 돌아간다 -
 *    파일에 적힌 값과 엔진이 쓴 값이 갈리면 안 되므로 확정이 곧 기록이다.
 * 3. **모르는 키는 손대지 않고 통과시킨다.** 엔진이 받고 무시한 것까지가 "먹인 것"의
 *    사실이고, 버리면 실패한 run에서 학생이 무엇을 시도했는지가 지워진다. 재실행 때
 *    같은 것을 먹이면 같은 결과가 나오므로 재현도 깨지지 않는다.
 *
 * 모르는 알고리즘이면 채울 기본값이 없다. 던지지 않는다 - 판정은 fit의 일이고,
 * 여기서 던지면 실패 run을 만들기도 전에 묶음이 죽는다.
 */
export function resolve(
  algorithm: string,
  given: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = DEFAULTS[algorithm]
  if (!defaults) return { ...given }

  const resolved: Record<string, unknown> = { ...defaults, ...given }
  for (const [name, fallback] of Object.entries(defaults)) {
    const value = resolved[name]
    if (typeof value !== 'number' || !Number.isFinite(value)) resolved[name] = fallback
  }
  return resolved
}

/**
 * 학습하고 예측 함수를 돌려준다.
 *
 * 모르는 알고리즘이면 실패한다. 화면이 고르게 하는 목록은 등록부에서 나오므로 여기
 * 도달하는 것은 버그이거나 남의 파일에 든 모르는 알고리즘이다 (mlpx-spec.md 5.2).
 */
export function fit(algorithm: string, input: FitInput): Predict {
  const trainer = TRAINERS[algorithm]
  if (!trainer) throw new ClientError('ALGORITHM_UNSUPPORTED', { algorithm })
  // **여기서도 확정한다.** 부르는 쪽이 resolve를 거쳤는지에 기대지 않는다 - 안 거친
  // 호출은 k가 0인 KNN처럼 조용히 망가지고, 그 원인은 여기서 멀리 떨어진 곳에서 터진다.
  // resolve는 병합이라 두 번 걸어도 결과가 같다.
  return trainer({ ...input, hyperparameters: resolve(algorithm, input.hyperparameters) })
}
