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

/** 형식 하나를 읽는 해석기. 등록부의 항목이다. */
export interface ModelInterpreter {
  readonly format: string
  /** 파일 내용을 예측 함수로. 내용이 형식과 안 맞으면 던진다. */
  load(file: unknown): Predict
}
