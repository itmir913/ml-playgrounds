/**
 * 학습이 남긴 손실 곡선 (`open-decisions.md` "인공신경망을 넣는다").
 *
 * **이 모델만이 학습의 과정을 보여준다.** 결정트리는 다 자란 나무만 남고 SVM은 경계만
 * 남지만, 신경망은 **에폭마다 손실이 줄어드는 곡선**이 있다 — *"학습이란 무엇인가"*를
 * 숫자가 아니라 그림으로 말할 수 있는 자리가 여기뿐이다.
 *
 * **어느 형식이 곡선을 갖는지는 이 파일이 안다. 화면은 모른다** (§9.1) —
 * `ml/parameters.ts`와 같은 자리이고 같은 이유다.
 *
 * **여기서 숫자를 만들지 않는다.** 파일에 있는 값을 그대로 꺼낸다 — 평활하지도, 로그를
 * 씌우지도, 첫 점을 버리지도 않는다. 학생이 보는 곡선은 **엔진이 실제로 지나간 손실**
 * 이어야 하고, 우리가 손대는 순간 그것은 아무도 안 본 계산이 된다.
 */

import { NEURAL_FORMAT, parseNeural } from './models'

/** 곡선의 한 점. 에폭은 1부터 센다 — 학생이 세는 방식이다. */
export interface LossPoint {
  readonly epoch: number
  readonly loss: number
}

/**
 * 이 형식이 손실 곡선을 갖는가. **형식으로 판정한다. 알고리즘 이름이 아니다** —
 * 같은 알고리즘이 다른 형식으로 담길 수 있고(옛 파일), 우리가 읽을 수 있는지는 형식이
 * 답한다.
 */
export function showsLossCurve(format: string | undefined): boolean {
  return format === NEURAL_FORMAT
}

/**
 * 곡선을 꺼낸다. **하나라도 안 맞으면 `null`이고, 그때 화면은 아무것도 안 그린다**
 * (§9.2 "없는 것을 이름으로 말하지 않는다").
 *
 * `null`이 되는 자리는 셋이다 — 곡선을 안 갖는 형식 · 모델이 파일에 안 담긴 실행
 * (`run.modelOmitted`) · 남이 편집해 깨진 파일.
 *
 * **점이 하나뿐인 곡선도 안 그린다.** 선이 아니라 점이고, 그 그림은 "학습이 이렇게
 * 진행됐다"를 말하지 못한다.
 */
export function lossCurveOf(
  format: string | undefined,
  bytes: Uint8Array | undefined,
): readonly LossPoint[] | null {
  if (!showsLossCurve(format) || !bytes) return null

  try {
    const model = parseNeural(JSON.parse(new TextDecoder().decode(bytes)))
    if (model.lossCurve.length < 2) return null
    return model.lossCurve.map((loss, index) => ({ epoch: index + 1, loss }))
  } catch {
    // 못 읽는 파일이다. 이유를 말하는 자리는 다른 곳이고, 여기서는 안 그린다.
    return null
  }
}

/**
 * 곡선이 실제로 내려갔는가. **화면이 한 줄로 말할 사실이다.**
 *
 * 에폭 상한에 닿아 멈춘 실행에는 `NEURAL_NOT_CONVERGED` 경고가 이미 붙어 있고
 * (`ml/engines/mljs.ts`), 이 값은 그것과 **다른 질문**이다 — 경고는 *"더 갈 수 있었다"*를,
 * 이 값은 *"가긴 갔다"*를 말한다.
 */
export function lossDescended(points: readonly LossPoint[]): boolean {
  const first = points[0]?.loss
  const last = points[points.length - 1]?.loss
  return first !== undefined && last !== undefined && last < first
}
