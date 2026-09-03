/**
 * 순수 JS 학습 엔진 - **V1의 기본 실행 방법이다.**
 *
 * gzip 25KB에 시동이 없다. scikit-learn은 26.3MB에 시동만 15.4초라 기본값이 될 수 없다
 * (open-decisions.md "브라우저 학습 엔진은 둘 다 간다").
 *
 * **sklearn과 숫자가 다를 수 있고, 폭이 알고리즘마다 크게 다르다.**
 * 붓꽃 전체(150행, 분할 0.2·시드 42)를 같은 분할로 돌린 실측 (2026-08-10, V2 감사).
 * **왼쪽이 sklearn, 오른쪽이 우리다** - 대칭인 행이 많아 순서가 안 드러나므로 적어 둔다:
 *
 *   결정트리        0.9333  =  0.9333   같다 (동점 분할에서만 갈릴 수 있다)
 *   KNN             0.9333  =  0.9333   라벨까지 완전 일치
 *   나이브 베이즈    0.9667  =  0.9667   파라미터가 비트 일치한다
 *   로지스틱 회귀    0.9667  =  0.9667   수렴하면 같다 - maxIter가 물리면 경로가 갈리고
 *                                        경고가 그 사실을 말한다 (engines/logistic.ts)
 *   SVM             1.0000  =  1.0000   수렴 경로만 다르다
 *   랜덤포레스트     0.9667 vs 0.9333   배깅 난수가 다르다 - 분포로 비교하라
 *                                        (순서가 뒤집혀 적혀 있었다. 2026-08-11에 재측정)
 *
 * 이 표를 지키는 것이 tests/sklearn-parity.spec.ts다 - 아홉 가지 데이터 모양의
 * sklearn 기대값 픽스처가 CI 관문에 있다. 여기 숫자는 요약일 뿐이고 출처는 그 픽스처다.
 *
 * **나이브 베이즈 행은 한 번 거짓말을 했다.** 예전에 0.7000이라 적혀 있었고 그 숫자가
 * "폭이 제일 크다"의 근거였는데, 실은 `ml-naivebayes`가 특성을 앞 2개만 읽은 결과였다.
 * 지금은 이 파일 안에서 계산하고(gaussianNaiveBayes) 평균·분산·사전확률이 sklearn과
 * 비트 일치한다 - 평균이 1e5 규모인 데이터와 10만 행에서도 확인했다 (V2 감사 1단계).
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
import { RandomForestClassifier } from 'ml-random-forest'
import { Matrix, solve } from 'ml-matrix'

import { ClientError, failureDetail } from '../../errors'
import type { ClientWarningCode } from '../../errors'
import type { TaskType, Warning } from '../../project/schema'
import { resolveWith, type HyperparameterSpec } from '../hyperparams'
import type { Prediction } from '../metrics'
import {
  KMEANS_FORMAT,
  LINEAR_REGRESSION_FORMAT,
  LINEAR_V2_FORMAT,
  NEURAL_FORMAT,
  NEURAL_REGRESSION_FORMAT,
  REFERENCE_FORMAT,
  SVM_FORMAT,
  knnPredict,
  loadKMeansModel,
  loadLinearRegressionModel,
  loadLinearV2Model,
  loadNeuralModel,
  loadNeuralRegressionModel,
  svmPredict,
} from '../models'
import type {
  KMeansModel,
  LinearModelV2,
  LinearRegressionModel,
  NeuralModel,
  NeuralRegressionModel,
  PairwiseClassifier,
} from '../models'
import type { ModelFile, Predict } from '../models/types'
import type { ComputePools, ForestTree } from '../pools'
import { fitLogistic } from './logistic'
import { fitNeural } from './neural'
import { fitKMeans } from './mljs-kmeans'
import { SMO_DEFAULTS, seededRandom, trainLinearSvm } from './svm-smo'
import { MLJS_PARAMETERS } from './mljs-params'
import {
  serializeForest,
  serializeNaiveBayes,
  serializeTree,
  type NaiveBayesParameters,
} from './mljs-serialize'

/**
 * 이 엔진의 이름과 버전. run.engine에 그대로 들어간다.
 *
 * **한 번 올라갔고, 그 뒤로는 배포 전까지 안 움직인다.** 2026-08-05에 `d22eb2e`가
 * 1에서 2로 올렸다 — `ml-naivebayes`가 예측할 때 특성을 앞 2개만 읽고 있어서 걷어내고
 * 가우시안 나이브 베이즈를 저장소 안에서 계산하게 바꾼 변경이다. **숫자가 실제로
 * 달라졌으므로**(픽스처에서 3/9 → 8/9) 값 자체는 되돌리지 않는다. 다만 그 커밋은
 * 문서 커밋 없이 구현 안에서 올라갔고 **코드 소유자가 지시한 적이 없는 변경이었다.**
 *
 * **그래서 지금은 못이 박혀 있다 — `tests/versions.spec.ts`.** 이 값을 올리면 거기서
 * 시끄럽게 깨진다. **깨졌을 때 그 파일의 기대값을 고치지 마라.** 코드 소유자가
 * 명시적으로 지시하지 않았다면 되돌릴 것은 올린 쪽이다.
 *
 * **왜 안 올리는가.** 이 값이 하는 일은 재실행 대조가 옛 파일을 새 엔진으로 검사하지
 * 않게 막는 것인데(architecture.md 3.2), 검사할 옛 파일이 하나도 없으면 구분할 대상이
 * 없다. 기본값을 바꿔도 마찬가지다 - 배포 전에는 지금 엔진이 유일한 엔진이다.
 * 형식이 바뀌어 기존 테스트 프로젝트가 안 맞게 되면 마이그레이션을 설계하지 말고
 * 그 `.mlpx`를 지운다. `batches`를 `experiments`로 바꾸면서 formatVersion을 안 올린
 * 것과 같은 논리다 (mlpx-spec.md 4).
 *
 * **첫 배포 뒤에는 규칙이 뒤집힌다.** 의존성이 바뀌어 숫자가 달라질 수 있으면
 * 반드시 여기를 올려야 한다. 잊지 않도록
 * tests/mljs.spec.ts가 설치된 ml.js 버전을 고정해 두었다 - Dependabot이 올리면
 * 테스트가 깨지고, 그때 숫자가 움직였는지 보고 결정하게 된다.
 */
/**
 * **3이 된 이유 — 신경망 기울기 합산의 정본 순서가 바뀌었다** (2026-09-04,
 * open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다"). 배치를 고정
 * 조각으로 갈라 접으면서 부동소수점 합산 순서가 달라져 **같은 씨앗의 신경망이 2와 다른
 * 모델을 낸다.** 다른 알고리즘은 한 비트도 안 달라졌지만 버전은 엔진 하나에 하나다 —
 * 옛 파일의 재실행 대조가 전부 "대조 불가"로 빠지는 값을 치르고, 교사용 화면이 아직
 * 없는 지금이 가장 싼 시점이라는 판단까지 결정문에 있다. 코드 소유자 지시로 움직였다
 * (workflow.md §4).
 */
export const MLJS_ENGINE = { kind: 'mljs', version: '3' } as const

export type { Predict } from '../models/types'

/**
 * 엔진이 붙이는 경고. **`project/schema.ts`의 `Warning`과 코드 타입만 다르다.**
 *
 * 파일에서 읽는 쪽(`warningSchema.code`)은 `z.string()`이어야 한다 - 미래 버전이
 * 만든 코드가 든 `.mlpx`를 여는 것이 파싱 실패가 되면 안 된다. 그러나 **우리가
 * 만드는 쪽은 열거형이어야 한다.** V3에서 등록되지 않은 `KMEANS_NOT_CONVERGED`가
 * 화면까지 간 이유가 여기가 `string`이었기 때문이다 - 타입도, 로케일 검사도
 * (목록을 훑으므로 목록에 없는 코드는 대상이 아니다) 전부 비껴갔다.
 */
export type EngineWarning = Warning & { readonly code: ClientWarningCode }

/**
 * 학습 한 번의 결과.
 *
 * **이 엔진이 돌리는 알고리즘 일곱은 전부 우리 형식으로 담긴다** (2026-08-11에 고쳐 적는다).
 * 예전에는 "모델이 없는 것이 정상 경로다 - 담을 수 있는 것은 트리 둘뿐"이라고 적혀 있었는데,
 * 형식이 일곱으로 늘면서 그 문장이 통째로 낡았다. 지금 모델이 비는 것은 **직렬화가 실패할
 * 때뿐**이고(아래 serializeOrOmit), 파일에는 그 사유가 `modelOmitted: 'engineUnsupported'`로
 * 적힌다 (mlpx-spec.md 4.2). 지표만 남는 run은 이제 정상이 아니라 예외다.
 *
 * **경로도 크기도 여기서 정하지 않는다.** zip 안의 자리를 아는 것은 저장 계층이고,
 * 여기서 없는 경로를 적으면 파일이 자기 자신에 대해 거짓말을 하게 된다 (ml/experiment.ts의
 * preprocessor와 같은 이유다).
 */
export interface FitResult {
  predict: Predict
  /**
   * **채점 한 번을 코어로 갈라서 하는 길.** 있으면 실험 실행이 채점에 이것을 쓴다
   * (`ml/experiment.ts`) — 없으면 위 `predict`를 그대로 쓴다.
   *
   * **KNN 하나가 이것을 준다** (open-decisions.md "학습을 코어로 가른다 — 결과는 코어
   * 수와 무관하다"). 저쪽은 학습에 비용이 없고 **비용이 전부 예측**이라, 가를 것이
   * 학습이 아니라 채점이다. 행마다 독립이라 갈라도 답이 같다.
   *
   * **`predict`를 대신하지 않는다.** 예측 화면은 한 줄씩 즉시 답해야 하므로 동기인
   * `predict`를 그대로 쓴다 — 여기는 시험 몫 전체를 한 번에 채점하는 자리 전용이다.
   * 둘이 같은 답을 내는지는 `knn-parallel.spec.ts`가 못 박는다.
   */
  predictBatch?: (features: readonly (readonly number[])[]) => Promise<readonly Prediction[]>
  model?: ModelFile
  /**
   * 모델을 못 담았을 때 그 원문. **어휘가 아니라 기술 정보다** (mlpx-spec.md 5.0.1).
   *
   * 사유 어휘(modelOmitted)는 부르는 쪽이 붙인다 - 여기서는 무엇이 터졌는지만 전한다.
   */
  modelOmittedDetail?: string
  /**
   * 학습은 됐지만 학생이 알아야 하는 사실. run.warning이 된다 (mlpx-spec.md 5.9).
   *
   * **실패가 아니다.** 지표도 모델도 정상으로 나오고, 화면이 그 옆에 사실 하나를 덧붙인다.
   */
  warning?: EngineWarning
  /**
   * 군집 학습 결과. **군집 지표 계산에 쓴다** (architecture.md §3.7).
   *
   * 군집 지표(실루엣 계수, 이너셔)는 `(data, assignments, centroids)`를 받는다.
   * 분류·회귀의 `(actual, predicted)`와 시그니처가 다르므로 별도로 돌려준다.
   * 분류·회귀 트레이너에서는 없다.
   */
  clusterResult?: {
    readonly assignments: readonly number[]
    readonly centroids: readonly (readonly number[])[]
  }
}

export interface FitInput {
  /** 전처리를 마친 숫자 행렬 (ml/preprocess.ts). */
  features: readonly (readonly number[])[]
  /**
   * features[i]의 **원본 행 번호** (dataset/data.csv 기준). 실험의 trainIndices다.
   *
   * 참조형이 이걸 그대로 모델에 담고(mlpx-spec.md 5.1) 동점을 가르는 데도 쓴다.
   * 학습 쪽과 해석기 쪽이 **같은 규칙**을 쓰려면 양쪽이 같은 번호를 봐야 한다.
   */
  rowIndices: readonly number[]
  /** 분류면 라벨 문자열, 회귀면 수치. */
  target: readonly Prediction[]
  /**
   * 무엇을 학습하는가. **`target`이 무엇인지가 이 값에 달려 있다** — 지금까지는 트레이너
   * 이름이 그것을 암묵으로 말했고(`linear_regression`이 `.map(Number)`를 하는 것이 그
   * 가정이었다), **분류와 회귀를 함께 하는 알고리즘이 들어오면서 밖으로 나왔다**
   * (`neural_network`, 2026-09-03).
   *
   * **한 알고리즘이 한 유형만 하면 이 값을 안 본다.** 등록부의 축이 이미 짝을 맞춰 두므로
   * 어긋난 조합은 여기 도달하지 않는다 (`ml/algorithms.ts`).
   */
  taskType: TaskType
  hyperparameters: Record<string, unknown>
  /** 항상 저장하고 항상 쓴다. 재현 가능성이 교육용 도구의 생명이다. */
  randomState: number
  /**
   * 학습을 코어로 가르는 손들 (open-decisions.md "학습을 코어로 가른다 — 결과는 코어
   * 수와 무관하다"). **없으면 전부 직렬로 돌고 결과는 같다** — 그래서 검사와 재실행
   * 대조는 이 값을 아예 안 준다. 실물은 학습 워커만 준다 (ml/worker/handler.ts).
   *
   * 직렬화되는 요청(TrainRequest)이 아니라 **워커 안에서** 붙는 값이다 — 함수는
   * postMessage를 못 탄다.
   */
  pools?: ComputePools
}

type Trainer = (input: FitInput) => FitResult | Promise<FitResult>

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
 * 값이 하나뿐인 클래스는 분산이 0이라 그대로 두면 0으로 나눈다. 전체 훈련 데이터 분산의
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
 * **정규화 상수를 빼면 안 된다.** 흔히 상수라서 지워도 된다고들 하는데 그건 클래스마다
 * 분산이 같을 때 얘기다 - 여기서는 클래스마다 다르므로 `log(2π·분산)`이 **클래스마다
 * 다른 값**이고, 빼면 답이 갈린다. 입력이 두 클래스의 평균과 같을 때 거리 항이 0이라
 * 이 상수만 남고 분산이 작은 쪽이 이긴다 - tests/models.spec.ts가 그 경우를 못 박았다.
 */
/** 학습된 계수를 꺼낼 수 있는 분류기. 우리가 계산한 것이라 추측할 것이 없다. */
interface NaiveBayesPredictor extends TrainablePredictor {
  snapshot(): NaiveBayesParameters
}

function gaussianNaiveBayes(): NaiveBayesPredictor {
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

      // 전체 훈련 데이터의 열 분산 최댓값. 클래스별이 아니라 전체에서 구한다 (sklearn과 같다).
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
            // 분산이 0이면 그 열은 정보를 주지 않는다. smoothing이 0을 막지만 훈련 데이터 전체가
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

    // **우리가 들고 있는 값을 그대로 준다** (mlpx-spec.md 5.5). 이 알고리즘만 라이브러리가
    // 아니라 저장소 안에서 계산하므로, 직렬화기가 남의 구조를 추측할 일이 없다.
    snapshot: () => ({ logPriors: priors, means, variances }),
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

/**
 * 워커가 지은 나무들을 **라이브러리의 숲으로 되돌린다** (`RandomForestClassifier.load`).
 *
 * **여기 적힌 값들은 라이브러리가 직렬 학습에서 자기 필드에 넣는 그 값이다** —
 * `maxFeatures`·`replacement`는 `defaultOptions`에서, `n`은 `floor(열 수 × 1.0)`에서,
 * `isClassifier`는 `RandomForestClassifier`가 세운다. 손으로 옮겨 적은 것이므로
 * **`forest-parallel.spec.ts`가 라이브러리의 직렬 학습과 맞대어 지킨다** — 저쪽이
 * 필드를 하나 더 요구하게 되면 거기가 빨개진다.
 */
function loadForest(
  trees: readonly ForestTree[],
  treeCount: number,
  featureCount: number,
  randomState: number,
): RandomForestClassifier {
  const model = {
    name: 'RFClassifier',
    baseModel: {
      indexes: trees.map((one) => [...one.usedIndex]),
      n: featureCount,
      replacement: true,
      maxFeatures: 1.0,
      nEstimators: treeCount,
      // **패키지의 타입은 `object`라 적었지만 라이브러리가 실제로 담는 값은 `undefined`다** —
      // 손잡이를 안 주면 그대로 둔다. 직렬 학습이 낸 숲과 바이트 단위로 같아야 하므로
      // 여기서도 `undefined`를 담고, 좁게 적힌 타입을 아래에서 한 번 맞춰 준다.
      treeOptions: undefined,
      isClassifier: true,
      seed: randomState,
      estimators: trees.map((one) => one.tree),
      useSampleBagging: true,
    },
  }
  // 위 주석의 그 한 번이다. `any`가 아니라 **이 라이브러리가 자기 `load`에 받는 그 타입**으로
  // 좁힌다 — `unknown`을 거치는 이유는 패키지 타입이 `treeOptions`를 필수 `object`로 적어
  // 두어 직접 변환이 안 되기 때문이다. 모양이 실제로 맞는지는 `forest-parallel.spec.ts`가
  // 라이브러리의 직렬 학습과 맞대어 지킨다.
  return RandomForestClassifier.load(
    model as unknown as Parameters<typeof RandomForestClassifier.load>[0],
  )
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
/**
 * **센터링 + SVD 최소제곱.** sklearn `LinearRegression(fit_intercept=True)`의 구조다.
 *
 * `solve(A, B, useSVD)`가 `ml-matrix`의 최소제곱이다 — 열이 겹치거나(공선) 척도가 갈려도
 * 정규방정식처럼 조건수를 제곱하지 않는다.
 */
function fitLeastSquares(
  rows: number[][],
  values: number[],
  featureCount: number,
): LinearRegressionModel {
  const count = rows.length
  if (count === 0 || featureCount === 0) {
    return { format: LINEAR_REGRESSION_FORMAT, featureCount, coefficients: [], intercept: 0 }
  }
  const columnMeans = Array.from(
    { length: featureCount },
    (_, column) => rows.reduce((sum, row) => sum + (row[column] ?? 0), 0) / count,
  )
  const targetMean = values.reduce((sum, value) => sum + value, 0) / count
  const centeredRows = rows.map((row) =>
    Array.from(
      { length: featureCount },
      (_, column) => (row[column] ?? 0) - (columnMeans[column] as number),
    ),
  )
  const centeredTarget = values.map((value) => [value - targetMean])
  const beta = solve(new Matrix(centeredRows), new Matrix(centeredTarget), true)
  const coefficients = Array.from({ length: featureCount }, (_, column) => beta.get(column, 0))
  const intercept = coefficients.reduce(
    (sum, value, column) => sum - value * (columnMeans[column] as number),
    targetMean,
  )
  return { format: LINEAR_REGRESSION_FORMAT, featureCount, coefficients, intercept }
}

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

  random_forest: async (input) => {
    const { encoded, labels, decode } = labelCodec(input.target)
    const treeCount = numberOption(input.hyperparameters, 'nEstimators')
    const featureCount = input.features[0]?.length ?? 0
    const options = {
      nEstimators: treeCount,
      // 시드를 반드시 넘긴다. 안 넘기면 같은 설정으로 두 번 돌려도 결과가 다르다.
      seed: input.randomState,
      useSampleBagging: true,
      // **OOB 계산을 끈다. 안 끄면 나무를 적게 잡은 학습이 통째로 실패한다.**
      //
      // ml.js는 학습 끝에 out-of-bag 예측을 모으는데, 어떤 행이 모든 나무의 훈련 표본에
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
    }

    /**
     * **나무를 코어로 가른다** (open-decisions.md "학습을 코어로 가른다 — 결과는 코어
     * 수와 무관하다"). 손이 없거나 가를 만큼 크지 않으면 `null`이 오고 **라이브러리의
     * 직렬 학습을 그대로 쓴다** — 어느 쪽이든 같은 숲이 나온다.
     *
     * `featureSampleCount`와 `replacement`는 라이브러리가 기본값에서 정하는 그 값이다:
     * `maxFeatures`가 1.0이라 `n = floor(열 수 × 1.0)`이고, `replacement`는 참이다
     * (`RandomForestClassifier`의 `defaultOptions`).
     */
    const pool =
      input.pools?.forest?.({
        features: input.features,
        targets: encoded,
        treeCount,
        randomState: input.randomState,
        featureSampleCount: featureCount,
        replacement: true,
        treeOptions: undefined,
      }) ?? null

    let model: RandomForestClassifier
    if (pool === null) {
      model = new RandomForestClassifier(options)
      model.train(toRows(input.features), encoded)
    } else {
      try {
        model = loadForest(await pool.grow(), treeCount, featureCount, input.randomState)
      } finally {
        // 취소로 위가 던져도 워커가 남으면 안 된다.
        pool.dispose()
      }
    }

    const predict: Predict = (features) =>
      [...model.predict(toRows(features))].map((value) => decode(Math.round(value)))
    const attempted = serializeOrOmit(() => serializeForest(model, labels, featureCount))
    if (attempted.model) return { predict, model: attempted.model }
    return attempted.detail === undefined
      ? { predict }
      : { predict, modelOmittedDetail: attempted.detail }
  },

  naive_bayes: classifier(() => {
    const predictor = gaussianNaiveBayes()
    return {
      predictor,
      serialize: (classes, featureCount) =>
        serializeNaiveBayes(predictor.snapshot(), classes, featureCount),
    }
  }),

  /**
   * KNN. **라이브러리를 쓰지 않는다** (mlpx-spec.md 5.6).
   *
   * `ml-knn`은 동점을 KDTree 내부 힙 순서로 갈라서, 파일에서 읽은 모델이 그것을 재현하려면
   * 남의 자료구조를 통째로 옮겨 와야 했다. 그리고 그 동점 처리에는 아무 근거가 없다.
   * 여기서 해석기와 **같은 함수**를 쓰므로 재현이 구조로 보장된다.
   *
   * 학습이랄 것이 없다 - 담는 것은 행 번호뿐이다.
   */
  knn: (input) => {
    const { labels } = labelCodec(input.target)
    const k = numberOption(input.hyperparameters, 'k')
    const featureCount = input.features[0]?.length ?? 0
    const rows = input.features
    const rowLabels = input.target.map(String)

    const predict = knnPredict({
      k,
      featureCount,
      rows,
      labels: rowLabels,
      indices: input.rowIndices,
    })

    /**
     * **채점을 코어로 가른다** (open-decisions.md "학습을 코어로 가른다 — 결과는 코어
     * 수와 무관하다"). KNN은 담는 것이 행 번호뿐이라 학습에 비용이 없고 **비용이 전부
     * 예측**이다 — 그래서 가르는 자리가 학습이 아니라 채점이고, 행마다 독립이라 갈라도
     * 같은 답이 나온다(엔진 버전이 안 움직이는 이유).
     *
     * **`null`이 오면 직렬로 답한다** — 가를 만큼 크지 않거나 워커가 없다는 뜻이다.
     */
    const pool =
      input.pools?.knn?.({
        k,
        featureCount,
        rows,
        labels: rowLabels,
        indices: input.rowIndices,
      }) ?? null
    const predictBatch = pool
      ? async (features: readonly (readonly number[])[]): Promise<readonly Prediction[]> => {
          try {
            return (await pool.answer(features)) ?? predict(features)
          } finally {
            pool.dispose()
          }
        }
      : undefined

    const attempted = serializeOrOmit(() => ({
      format: REFERENCE_FORMAT,
      k,
      classes: labels,
      featureCount,
      trainIndices: [...input.rowIndices],
    }))
    const extra = {
      ...(predictBatch ? { predictBatch } : {}),
      ...(attempted.model ? { model: attempted.model } : {}),
      ...(attempted.model === undefined && attempted.detail !== undefined
        ? { modelOmittedDetail: attempted.detail }
        : {}),
    }
    return { predict, ...extra }
  },

  /**
   * 선형 SVM. **솔버는 벤더링한 SMO이고 다중 클래스는 여기서 감싼다** (mlpx-spec.md 5.8).
   *
   * 감싸는 것이 선택이 아니다 - 솔버는 이진 분류기이고, 라벨을 그대로 넘기면 던지지 않고
   * **전부 한 클래스로 답한다**(실측). one-vs-one인 이유는 sklearn `SVC`와 같은 방식이어야
   * 학생이 두 카드의 차이를 "엔진 차이"로 오해하지 않기 때문이다.
   *
   * KNN과 같이 **해석기의 예측 함수를 그대로 쓴다** - 왕복 동일성이 구조로 보장된다.
   */
  svm: (input) => {
    const { encoded, labels } = labelCodec(input.target)
    const featureCount = input.features[0]?.length ?? 0
    const rows = toRows(input.features)
    // 쌍마다 새로 만들지 않는다. 하나를 이어 쓰면 순서가 고정되어 있는 한 결정적이고,
    // 쌍마다 시드를 조합하면 그 조합 규칙이 또 하나의 재현 조건이 된다.
    const random = seededRandom(input.randomState)

    const classifiers: PairwiseClassifier[] = []
    let converged = true
    let iterations = 0

    for (let a = 0; a < labels.length; a += 1) {
      for (let b = a + 1; b < labels.length; b += 1) {
        const pairRows: number[][] = []
        // **b가 +1이다.** svmPredict가 "양수면 b"로 읽으므로 여기서 뒤집으면 답이 정확히
        // 반대가 되고, 지표만 보면 상쇄로 가려진다 (linear.ts가 겪은 그 자리다).
        const pairLabels: number[] = []
        encoded.forEach((label, row) => {
          if (label !== a && label !== b) return
          pairRows.push(rows[row] ?? [])
          pairLabels.push(label === b ? 1 : -1)
        })

        const fitted = trainLinearSvm(pairRows, pairLabels, {
          ...SMO_DEFAULTS,
          C: numberOption(input.hyperparameters, 'C'),
          random,
        })
        // **유한하지 않은 계수는 시끄럽게 실패한다.** 솔버가 폭주하면 NaN·Infinity가
        // 나오는데, 그대로 흘리면 svmPredict가 에러 없이 전부 한 클래스로 답한다 -
        // 이 저장소가 규정한 최악이 그것이다. 원본의 H 수식 결함(svm-smo.ts 머리말 4)이
        // 실제로 이 모양으로 터졌고, 고친 뒤에도 방어선은 남긴다.
        if (
          !fitted.weights.every((value) => Number.isFinite(value)) ||
          !Number.isFinite(fitted.intercept)
        ) {
          throw new ClientError('JOB_FAILED', { classA: a, classB: b, detail: 'svm not finite' })
        }
        classifiers.push({ a, b, weights: fitted.weights, intercept: fitted.intercept })
        converged &&= fitted.converged
        iterations = Math.max(iterations, fitted.iterations)
      }
    }

    const predict = svmPredict({ classes: labels, featureCount, classifiers })
    const attempted = serializeOrOmit(() => ({
      format: SVM_FORMAT,
      classes: labels,
      featureCount,
      classifiers,
    }))

    // **수렴하지 못한 것은 실패가 아니다** (mlpx-spec.md 5.9). 계수가 덜 다듬어졌을 뿐이고,
    // 그 사실을 숨기지 않는 것으로 충분하다 - sklearn도 같은 자리에서 경고만 낸다.
    const warning: EngineWarning | undefined = converged
      ? undefined
      : { code: 'SVM_NOT_CONVERGED', params: { iterations } }

    return {
      predict,
      ...(warning ? { warning } : {}),
      ...(attempted.model ? { model: attempted.model } : {}),
      ...(attempted.model === undefined && attempted.detail !== undefined
        ? { modelOmittedDetail: attempted.detail }
        : {}),
    }
  },

  /**
   * 로지스틱 회귀. **sklearn `LogisticRegression` 기본값의 목적함수를 그대로 푼다**
   * (open-decisions.md "로지스틱 회귀 솔버를 sklearn과 같은 구조로 바꾼다") -
   * L2(C)·절편(규제 제외)·수렴 판정 tol·반복 상한 maxIter. 솔버는 우리가 짠
   * L-BFGS다 (ml/engines/logistic.ts).
   *
   * L2가 최적점을 유한하고 유일하게 만들므로, 올바르게 수렴하면 계수 자체가 sklearn과
   * 같다 - 그 대조는 tests/sklearn-parity.spec.ts가 상시로 지킨다. 다중 클래스는
   * multinomial(softmax), 이진은 binomial로 풀어 ±절반 두 줄로 담는다 (mlpx-spec.md
   * 5.4.1). maxIter에 닿으면 sklearn의 ConvergenceWarning 자리에서 경고가 붙는다.
   *
   * **예측은 추가한 모델의 해석기를 그대로 쓴다** - KNN·SVM과 같은 방식이고, 그래서
   * 저장했다 읽은 모델의 예측이 원본과 같은 것이 구조로 보장된다.
   */
  logistic_regression: (input) => {
    const { encoded, labels } = labelCodec(input.target)
    const featureCount = input.features[0]?.length ?? 0

    const fitted = fitLogistic(input.features, encoded, labels.length, {
      C: numberOption(input.hyperparameters, 'C'),
      tol: numberOption(input.hyperparameters, 'tol'),
      maxIter: numberOption(input.hyperparameters, 'maxIter'),
    })

    const model: LinearModelV2 = {
      format: LINEAR_V2_FORMAT,
      classes: labels,
      featureCount,
      weights: fitted.weights,
      intercepts: fitted.intercepts,
    }

    // sklearn이 ConvergenceWarning을 내는 그 자리다 (mlpx-spec.md 5.9). L2 덕에
    // 최적점이 유한하므로 이 경고는 정말로 덜 배운 모델에서만 뜬다.
    const warning: EngineWarning | undefined = fitted.converged
      ? undefined
      : { code: 'LOGISTIC_NOT_CONVERGED', params: { iterations: fitted.iterations } }

    return {
      predict: loadLinearV2Model(model),
      model,
      ...(warning ? { warning } : {}),
    }
  },

  /**
   * 다층 퍼셉트론 (`open-decisions.md` "인공신경망을 넣는다").
   *
   * **손잡이 둘이 sklearn의 한 인자가 된다** — `hidden_layer_sizes=(뉴런 수,) * 층 수`.
   *
   * **경고 자리가 로지스틱과 같다.** sklearn이 `ConvergenceWarning`을 내는 그 자리이고,
   * 여기서는 손실이 더 안 줄어들기 전에 에폭 상한에 닿았다는 뜻이다 — 실패가 아니라
   * "덜 배웠다"이므로 지표도 모델도 정상으로 나온다 (mlpx-spec.md §5.9).
   */
  neural_network: async (input) => {
    const featureCount = input.features[0]?.length ?? 0
    const options = {
      hiddenLayers: numberOption(input.hyperparameters, 'hiddenLayers'),
      neuronsPerLayer: numberOption(input.hyperparameters, 'neuronsPerLayer'),
    }
    const regression = input.taskType === 'regression'
    // **회귀는 부호화하지 않는다. 타깃이 이미 수치다** (`linear_regression`과 같다).
    const { encoded, labels } = regression
      ? { encoded: input.target.map(Number), labels: [] }
      : labelCodec(input.target)

    const fitted = await fitNeural(
      input.features,
      encoded,
      regression ? { kind: 'regression' } : { kind: 'classification', classCount: labels.length },
      options,
      input.randomState,
      input.pools?.neural,
    )

    const layers = {
      featureCount,
      weights: fitted.weights,
      intercepts: fitted.intercepts,
      lossCurve: fitted.lossCurve,
    }
    /**
     * **형식이 갈린다** (mlpx-spec.md §5.11). 돌려주는 것이 라벨이냐 수치냐가 다르고,
     * `classes`를 선택 필드로 두면 해석기가 그 유무로 갈라진다.
     */
    const model: NeuralModel | NeuralRegressionModel = regression
      ? { format: NEURAL_REGRESSION_FORMAT, ...layers }
      : { format: NEURAL_FORMAT, classes: labels, ...layers }

    /**
     * **조건은 같고 코드는 갈린다.** 에폭 상한에 닿은 것은 유형과 무관하지만 **학생이 할
     * 일이 다르다** — 분류는 전처리 스케일링이 답이고(실측 0.40 → 1.00), 회귀에서는
     * 그것이 되레 해롭다(R² −0.20 → −10.2). 문구가 한쪽에 거짓말하지 않게 여기서 나눈다.
     */
    const warning: EngineWarning | undefined = fitted.converged
      ? undefined
      : {
          code: regression ? 'NEURAL_REGRESSION_NOT_CONVERGED' : 'NEURAL_NOT_CONVERGED',
          params: { iterations: fitted.epochs },
        }

    return {
      predict: regression ? loadNeuralRegressionModel(model) : loadNeuralModel(model),
      model,
      ...(warning ? { warning } : {}),
    }
  },

  linear_regression: (input) => {
    /**
     * **sklearn `LinearRegression`과 같은 구조로 푼다** (2026-09-03 R25 B-2,
     * CLAUDE.md §2 "구조는 표준 라이브러리를 따른다").
     *
     * X와 y를 **센터링한 뒤 SVD 최소제곱**으로 계수를 얻고 절편을 `ȳ - X̄·β`로
     * 되돌린다. sklearn이 `fit_intercept=True`에서 하는 그것이다.
     *
     * **여기 있던 것은 `ml-regression-multivariate-linear`의 정규방정식이었다** — 1로
     * 채운 열을 붙이고 `X'X`의 유사역행렬을 곱한다. 정규방정식은 **조건수를 제곱한다**
     * (`cond(X'X) = cond(X)²`). 열 척도가 갈리면 그 제곱이 배정밀도를 통째로 넘긴다.
     *
     * 실측(x1 ~ 10⁶ · x2 ~ 10⁻³ · 60행, `[X|1]`의 조건수 **2.0e9** → 제곱하면 4e18):
     *
     * | 풀이 | x1 | x2 | SSres |
     * |---|---|---|---|
     * | 참값(열을 표준화해 풀고 되돌림) | 0.5000000 | **3986.58** | 0.038 |
     * | 옛 정규방정식 | 0.4999997 | **−120.68** | 86.78 |
     * | sklearn 1.9.0 | 0.4999997 | −3.5e−11 | 81.75 |
     * | **지금(센터링 + SVD)** | 0.5000000 | **3986.58** | **0.038** |
     *
     * **재고 나서 안 것 하나 — 우리가 sklearn보다 정확해졌다** (2026-09-03). 구조는
     * 같은데 **절단이 다르다.** sklearn 1.9의 `LinearRegression`은 `scipy.linalg.lstsq`에
     * 자기 `tol` 인자(기본 1e-6)를 `cond`로 넘겨 그 비율 아래 특잇값의 방향을 0으로
     * 죽인다(`sklearn/linear_model/_base.py`, 1.9에서 dense에 처음 적용). **scipy·numpy의
     * `lstsq` 자체는 같은 행에서 3986.58을 맞힌다** — 절단의 주인은 scipy가 아니라
     * sklearn이다 (R25 재검토 C-7). `ml-matrix`의 SVD도 `(ε/2)·max(m,n)·s₀` 아래는
     * 죽이지만(`svd.js`) 이 표의 두 번째 특잇값은 그 문턱보다 다섯 자릿수 위라 산다.
     *
     * **그 갈림은 병든 표에서만 난다.** 정상 데이터에서는 `sklearn-parity.spec.ts`가
     * 계수·절편·R²를 `1e-6` 안에서 대조하고 실측이 1e-11 이하다 — 이 변경으로 못 박은
     * 값이 **하나도 안 움직였다**(276개 그대로 통과).
     *
     * **rcond 절단은 흉내 내지 않는다** (2026-09-03에 정했다). 흉내 내면 숫자가
     * 같아지지만 **맞는 답을 일부러 버리는 것**이고, 그 절단은 sklearn이 언젠가 고칠 수
     * 있는 정책이지 우리가 따라야 할 구조가 아니다. **구조는 따르고 절단은 안 따른다.**
     * → `open-decisions.md` #40. **파이썬으로 옮긴 학생은 기본 `tol`에서 x2 ≈ 0을 본다** —
     * 그 긴장을 #40이 적어 둔다.
     *
     * **열을 표준화하는 길은 안 골랐다.** 그건 sklearn이 **하지 않는 일**을 더하는 것이라
     * §2의 전제와 부딪친다(`#39`와 같은 자리). 지금 고른 것은 **sklearn이 하는 일을 그대로
     * 하는 것**이고, 남은 차이는 그쪽의 절단 정책 하나다.
     *
     * **상수 타깃도 이 구조가 정확히 맞힌다.** `y - ȳ`가 정확히 0이면 우변이 영벡터이라
     * 계수도 정확히 0이고 절편이 곧 `ȳ`다. `metrics.ts`의 R²가 분모 0일 때 **잔차가
     * 정확히 0인지**로 1과 0을 가르므로(sklearn과 같은 규칙), 그 정확함이 곧 1.000이다.
     * 옛 풀이는 1e-14 먼지를 남겨 그 점수를 0.000으로 뒤집고 있었다.
     */
    const values = input.target.map((value) => Number(value))
    const rows = toRows(input.features)
    const featureCount = input.features[0]?.length ?? 0
    /**
     * **못 만든 모델은 실패 run이다** (2026-09-03 R25 재검토 C-8). 이 풀이는 계수와
     * 절편을 우리 산수로 직접 만들므로 `serializeOrOmit`으로 감쌀 남의 직렬화기가 없다.
     * 여기서 던지는 것은 전부 우리 고장이고, 그것을 잡아 0을 답하면 **조용히 틀린 지표가
     * `done`으로 나간다** — 이 저장소가 가장 무서워하는 모양이다. 던지면 `trainOne`의
     * `catch`가 `JOB_FAILED`로 만들고 원문을 `failureDetail`에 남긴다.
     *
     * **닿는 길은 지금 없다** — 행렬을 여기서 같은 폭으로 짓는다. 사람 확인이다.
     */
    const model = fitLeastSquares(rows, values, featureCount)
    return {
      model,
      /**
       * **예측은 담기는 모델의 해석기를 그대로 쓴다** — KNN·SVM·로지스틱·K-평균과 같은
       * 방식이고, 그래서 **저장했다 읽은 예측이 원본과 같은 것이 구조로 보장된다.**
       * 같은 규칙을 두 번 적으면 저장 전후가 갈린다 — 실제로 `lifecycle.spec.ts`가
       * `0.1202292862280948` 대 `0.12022928622809483`로 빨개진 적이 있다.
       */
      predict: loadLinearRegressionModel(model),
    }
  },

  /**
   * K-Means 군집화. **타깃이 없다.**
   *
   * target은 비어 있거나 무시된다 — 군집화는 비지도학습이다. FitInput.target이
   * 인터페이스에 있는 이유는 분류·회귀와 같은 시그니처를 쓰기 위해서이고,
   * 여기서 target을 읽지 않는 것이 그 사실을 드러낸다.
   *
   * **예측은 추가한 모델의 해석기를 그대로 쓴다** — KNN·SVM·로지스틱과 같은 방식이고,
   * 그래서 저장했다 읽은 모델의 예측이 원본과 같은 것이 구조로 보장된다. 같은 규칙을
   * 두 번 적으면 동점 처리나 featureCount 취급이 한쪽만 바뀌었을 때 저장 전후 예측이
   * 갈라지고, 그 어긋남은 파일을 다시 열어야 보인다.
   */
  k_means: (input) => {
    const featureCount = input.features[0]?.length ?? 0
    const k = numberOption(input.hyperparameters, 'nClusters')

    const result = fitKMeans(input.features, k, input.randomState)

    const model: KMeansModel = {
      format: KMEANS_FORMAT,
      featureCount,
      k,
      centroids: result.centroids.map((c) => [...c]),
    }

    const warning: EngineWarning | undefined = result.converged
      ? undefined
      : { code: 'KMEANS_NOT_CONVERGED', params: { iterations: result.iterations } }

    return {
      predict: loadKMeansModel(model),
      model,
      clusterResult: { assignments: result.assignments, centroids: result.centroids },
      ...(warning ? { warning } : {}),
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
export async function fit(algorithm: string, input: FitInput): Promise<FitResult> {
  const trainer = TRAINERS[algorithm]
  if (!trainer) throw new ClientError('ALGORITHM_UNSUPPORTED', { algorithm })
  // **여기서도 확정한다.** 부르는 쪽이 resolve를 거쳤는지에 기대지 않는다 - 안 거친
  // 호출은 k가 0인 KNN처럼 조용히 망가지고, 그 원인은 여기서 멀리 떨어진 곳에서 터진다.
  // resolve는 병합이라 두 번 걸어도 결과가 같다.
  return await trainer({ ...input, hyperparameters: resolve(algorithm, input.hyperparameters) })
}
