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
   * 전처리를 마친 학습 행렬과 그 정답. **참조형만 쓴다.**
   *
   * needsTrainingRows가 false인 해석기는 이 값을 쳐다보지 않는다. 인자를 두 벌로
   * 나누거나 2단계 로딩으로 만들지 않는 이유는, 부르는 쪽이 형식마다 다른 호출 방법을
   * 알아야 하는 순간 그게 곧 분기이기 때문이다.
   */
  readonly trainingRows?: {
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
   * 원본 학습 행이 있어야 예측하는가 (mlpx-spec.md 5.0).
   *
   * **`includesPreprocessing`과 나란한 축이다.** 참조형(KNN·SVM)은 모델이 사실상 학습
   * 데이터라 행 번호만 담고(mlpx-spec.md 5.1), 그 행은 `dataset/`에 있다. 그래서
   * `dataset/`이 없는 파일에서는 그 모델만 못 쓴다 - 화면이 형식 이름을 보지 않고
   * 이 불리언 하나로 판정한다.
   */
  readonly needsTrainingRows: boolean
  /** 파일 내용을 예측 함수로. 내용이 형식과 안 맞으면 던진다. */
  load(file: unknown, context: LoadContext): Predict
}
