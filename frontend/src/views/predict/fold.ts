/**
 * 사진 예측의 모델 카드가 펼쳐져 있는가 (architecture.md §8.13.4).
 *
 * **전체 스위치 하나와 사진별 예외다.** 스위치는 이 기기에 남고(`prefs.ts`), 사진 한 장을
 * 손으로 여닫은 것은 이번 세션의 예외라 남지 않는다 — 예측 사진은 다시 올리면 그만인
 * 입력이다.
 *
 * **템플릿에서 조립하지 않는다** (§10.1). `overrides.get(hash) ?? all`이 화면에 흩어지면
 * 단추의 `aria-expanded`·화살표와 카드의 `v-show`가 서로 다른 판정을 하게 된다.
 */

export function photoCardsOpen(
  all: boolean,
  overrides: ReadonlyMap<string, boolean>,
  hash: string,
): boolean {
  return overrides.get(hash) ?? all
}

/**
 * 사진 한 장을 손으로 여닫았다. **스위치와 같아지면 예외가 아니다** — 지운다. 남겨 두면
 * 스위치를 바꿔도 그 사진만 따라오지 않는 것처럼 보일 이유가 하나 는다.
 */
export function overrideCards(
  all: boolean,
  overrides: ReadonlyMap<string, boolean>,
  hash: string,
  open: boolean,
): Map<string, boolean> {
  const next = new Map(overrides)
  if (open === all) next.delete(hash)
  else next.set(hash, open)
  return next
}
