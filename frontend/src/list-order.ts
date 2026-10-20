/**
 * 목록의 순서 옮기기가 끝에 닿았는가. **잠금과 옮기기가 이 판정 하나를 본다** — 등록부의
 * `listTop`·`listBottom`(`locks.ts`)과 옮기는 함수(`project/portfolio.ts`의 `withSectionMoved`,
 * `ml/column-override.ts`의 `moveCategory`)가 함께 부른다(#31, `architecture.md` §10.7).
 *
 * **어느 화면의 것도 아니다.** 포트폴리오 문항과 범주 순서가 같은 판정을 쓴다 — 한 화면의 이름으로
 * 두면 다른 화면이 남의 판정을 빌려 쓰는 꼴이 된다(open-decisions.md 116 구현 중, 코드 소유자).
 * `locks.spec.ts`의 *"순서 옮기기는 잠금과 같은 판정으로 멈춘다"*가 문다.
 */

export function listTopBlockers(input: { readonly index: number }): readonly 'TOP'[] {
  return input.index <= 0 ? ['TOP'] : []
}

export function listBottomBlockers(input: {
  readonly index: number
  readonly count: number
}): readonly 'BOTTOM'[] {
  return input.index >= input.count - 1 ? ['BOTTOM'] : []
}
