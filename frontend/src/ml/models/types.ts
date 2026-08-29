/**
 * 모델 계층의 타입. **여기부터는 학습 라이브러리를 모른다.**
 *
 * 저장된 모델을 다시 여는 일은 그것을 만든 라이브러리와 무관해야 한다. ml.js를 갈아
 * 끼워도 학생이 지난 학기에 낸 `.mlpx`는 열려야 하고, 그러려면 **해석하는 쪽이 학습하는
 * 쪽을 참조하지 않아야 한다** (mlpx-spec.md 5.3).
 *
 * 그래서 Predict가 ml/engines/ 가 아니라 여기 산다. 반대로 두면 의존이
 * models -> engines -> ml-cart 로 이어지고, 그 순간 위 문장은 주석일 뿐이게 된다.
 */

import type { Prediction } from '../metrics'

/** 학습됐거나 파일에서 읽은 모델. 예측만 할 수 있으면 된다. */
export type Predict = (features: readonly (readonly number[])[]) => Prediction[]

/**
 * 클래스별 확률. **`classes`와 같은 순서·같은 길이이고 합은 1이다** (mlpx-spec.md §5.4).
 *
 * sklearn의 `predict_proba`가 `classes_` 순서로 열을 주는 것과 같은 모양이다. 이름 붙인
 * 사전이 아닌 이유가 둘이다 — 파이썬 관행을 따르는 것이 하나이고(CLAUDE.md §2), 일괄
 * 예측에서 셀마다 `Map`을 만들지 않아도 되는 것이 하나다.
 *
 * **낼 수 없는 행은 `null`이다.** 모든 점수가 포화해 분모가 0이 되는 자리이고, 균등분포로
 * 채우면 정반대의 거짓말이 된다 — 일대다 판별기가 전부 "나는 아니다"라고 답한 상태이지
 * 모르겠다는 뜻이 아니다 (mlpx-spec.md §5.4).
 */
export type PredictProba = (features: readonly (readonly number[])[]) => (Float64Array | null)[]

/**
 * 확률을 내는 모델. **칸 이름을 함께 준다.**
 *
 * 배열만 주면 어느 칸이 어느 범주인지 부르는 쪽이 모델 파일을 직접 뒤져야 하고, 그 순간
 * 화면이 그 형식의 필드 이름을 알게 된다 — 이 계층이 막으려는 것이 정확히 그것이다.
 * 어느 형식이든 **자기 라벨은 자기가 안다.**
 */
export interface ProbaModel {
  /** `predict`가 주는 배열의 칸 순서. sklearn의 `classes_`에 해당한다. */
  readonly classes: readonly string[]
  readonly predict: PredictProba
}

/**
 * 모델 파일 하나의 내용. **format이 나머지 필드의 스키마를 결정한다** (mlpx-spec.md 5).
 *
 * 공통으로 있는 것은 format 하나뿐이다. 여기에 필드를 더 올리면 형식마다 다른 것을
 * 공통으로 만드는 셈이고, 그러면 해석기가 그 필드를 보고 갈라질 자리가 생긴다.
 */
export interface ModelFile {
  readonly format: string
}

/**
 * 해석기가 예측을 만들 때 받는 것.
 *
 * **행을 만드는 것은 해석기가 아니라 부르는 쪽이다** (mlpx-spec.md 5.0). 모델의
 * trainIndices로 dataset/에서 원본 행을 찾고 그 실험의 전처리기로 변환하는 일은
 * zip과 CSV 파서와 전처리기를 아는 층의 몫이다 - 해석기가 그것들을 알기 시작하면
 * "해석기는 학습 라이브러리를 모른다"와 같은 이유로 경계가 무너진다.
 */
export interface LoadContext {
  /**
   * 전처리를 마친 훈련 행렬과 그 정답. **참조형만 쓴다.**
   *
   * needsTrainingRows가 false인 해석기는 이 값을 쳐다보지 않는다. 인자를 두 벌로
   * 나누거나 2단계 로딩으로 만들지 않는 이유는, 부르는 쪽이 형식마다 다른 호출 방법을
   * 알아야 하는 순간 그게 곧 분기이기 때문이다.
   */
  readonly trainingRows?: {
    /**
     * `features[i]`의 **원본 행 번호** (`dataset/data.csv` 기준, 헤더 제외 0부터).
     *
     * 이것이 있어야 참조형이 자기 `trainIndices`로 필요한 행만 고를 수 있다. 부르는 쪽은
     * 그 실험의 훈련 행을 통째로 주기만 하므로 **형식 지식을 갖지 않는다** (mlpx-spec.md 5.0).
     */
    readonly indices: readonly number[]
    readonly features: readonly (readonly number[])[]
    readonly target: readonly string[]
  }
}

/** 형식 하나를 읽는 해석기. 등록부의 항목이다. */
export interface ModelInterpreter {
  readonly format: string
  /**
   * 이 모델을 쓰는 데 전처리기가 필요한가 (mlpx-spec.md 5).
   *
   * **형식마다 정해지는 값이라 등록부에 있다.** run.model에 그대로 복사되고, 그다음부터
   * 포맷 계층은 그 불리언만 본다 - 형식 이름을 보고 가르지 않기 위해서다.
   * 자체 JSON은 전부 false이고, 전처리를 그래프에 담는 onnx-v1이 첫 true가 된다.
   */
  readonly includesPreprocessing: boolean
  /**
   * 원본 훈련 행이 있어야 예측하는가 (mlpx-spec.md 5.0).
   *
   * **`includesPreprocessing`과 나란한 축이다.** 참조형(KNN·SVM)은 모델이 사실상 훈련
   * 데이터라 행 번호만 담고(mlpx-spec.md 5.1), 그 행은 `dataset/`에 있다. 그래서
   * `dataset/`이 없는 파일에서는 그 모델만 못 쓴다 - 화면이 형식 이름을 보지 않고
   * 이 불리언 하나로 판정한다.
   */
  readonly needsTrainingRows: boolean
  /** 파일 내용을 예측 함수로. 내용이 형식과 안 맞으면 던진다. */
  load(file: unknown, context: LoadContext): Predict
  /**
   * 확률을 내는 형식만 구현한다. **있다는 것 자체가 선언이다** (architecture.md §8.13.1).
   *
   * **불리언 플래그를 나란히 두지 않는다** — 플래그와 구현이 갈라질 자리를 만들지 않기
   * 위해서다. 위 두 불리언이 불리언인 것은 그 둘이 **모델을 읽기 전에** 판정에 쓰이기
   * 때문이고(꺼진 줄을 그리려면 그 전에 알아야 한다), 확률에는 그런 사전 판정이 없다.
   *
   * **`load`와 라벨이 어긋나면 안 된다.** 점수 계산을 공유하고 라벨 판정은 `load` 쪽
   * 규칙 그대로 두어라 — 확률의 argmax로 라벨을 정하면 포화 구간에서 답이 갈린다
   * (mlpx-spec.md §5.4).
   */
  loadProba?(file: unknown, context: LoadContext): ProbaModel
}
