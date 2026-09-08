/**
 * 값을 구분하는 색을 **고르는 차례** (`architecture.md` §8.13.1 "그 대응은 셔플이
 * 아니라 거리순이다").
 *
 * **색 자체는 여기 없다.** 일곱 색의 정본은 `styles/theme.css`·`styles/dark.css`의
 * `--color-chart-N`이고, 이 파일이 갖는 것은 **그중 무엇을 먼저 꺼내는가**뿐이다.
 * 값을 여기 복사해 두면 배색을 한 번 손대는 순간 두 벌이 갈린다.
 *
 * **왜 순서가 필요한가.** 한때 팔레트를 그냥 섞어서 앞에서부터 줬다. 셔플은 색이
 * 골고루 쓰이게는 하지만 **두 색이 얼마나 벌어졌는지를 안 본다** — 두 갈래 분류에서
 * 카드 채움색 둘이 ΔE2000으로 2.4까지 붙을 수 있었고(#18), 실제로 학생이 못 갈랐다.
 *
 * **아래 표는 greedy farthest-point(max-min ΔE2000)의 결과다.** 시작 색마다 한 줄이고,
 * 그다음부터는 **이미 고른 색들에서 가장 먼 것**이 온다. 시작 색이 일곱 중 아무거나
 * 이므로 "색이 골고루 쓰인다"는 그대로 지켜진다.
 *
 * **표가 둘인 이유는 병목이 다르기 때문이다.** 카드는 `border + bg-soft`인데 넓이를
 * 채우는 것은 `-soft` 쪽이라 옅은 색이 병목이고, 표·산점도는 `text-chart-N`이라 진한
 * 색만 본다. 라이트·다크 넷을 다 재서 **가장 나쁜 쪽**으로 잡았다.
 *
 * **숫자를 손으로 고치지 마라.** `tests/palette.spec.ts`가 CSS를 직접 읽어 ΔE를 다시
 * 재고 아래 바닥값을 지키는지 본다 — 토큰이 바뀌면 그 검사가 먼저 운다.
 */

/** 팔레트의 색 수. `--color-chart-1`~`-7`이 일곱이다 (`open-decisions.md` #28-3). */
export const CHART_COLORS = 7

/**
 * 카드용 차례 (`border-chart-N` + `bg-chart-N-soft`). 0부터 세는 색 번호다.
 *
 * **바닥값(k갈래일 때의 최악 ΔE2000): 2→11.9 · 3→9.8 · 4→5.2 · 5→2.9 · 6→2.8 · 7→2.4.**
 * 다섯째부터 무너지는 것은 순서 탓이 아니라 라이트의 `-soft` 일곱이 전부 L\* 95~98이기
 * 때문이다 (`open-decisions.md` "카드 채움색은 다섯 갈래까지다").
 */
export const CARD_ORDERS: readonly (readonly number[])[] = [
  [0, 4, 6, 2, 3, 5, 1],
  [1, 6, 0, 2, 3, 5, 4],
  [2, 6, 0, 4, 3, 5, 1],
  [3, 6, 4, 2, 5, 0, 1],
  [4, 0, 6, 2, 3, 5, 1],
  [5, 4, 6, 2, 3, 0, 1],
  [6, 2, 0, 4, 3, 5, 1],
]

/**
 * 글자·점용 차례 (`text-chart-N`, 산점도의 점). 진한 색만 보므로 훨씬 여유가 있다.
 *
 * **바닥값: 2→47.8 · 3→34.3 · 4→26.7 · 5→17.4 · 6→10.7 · 7→9.3.**
 */
export const INK_ORDERS: readonly (readonly number[])[] = [
  [0, 4, 6, 2, 5, 1, 3],
  [1, 3, 6, 5, 2, 4, 0],
  [2, 6, 0, 4, 5, 1, 3],
  [3, 4, 6, 2, 5, 1, 0],
  [4, 3, 6, 2, 5, 1, 0],
  [5, 2, 6, 4, 3, 1, 0],
  [6, 2, 0, 4, 5, 1, 3],
]

/**
 * 무작위를 쓸 수 없는 자리의 고정 차례. **군집이 그렇다** — 군집 번호는 그 모델이
 * 매긴 이름이고, 같은 프로젝트를 다시 열었을 때 0번 군집의 색이 바뀌면 학생이
 * 어제 본 그림과 오늘 본 그림을 못 맞춘다.
 *
 * `INK_ORDERS` 중 바닥값이 가장 높은 줄이다 (2갈래 56.9).
 */
export const INK_ORDER: readonly number[] = INK_ORDERS[3] ?? [0, 1, 2, 3, 4, 5, 6]

/**
 * 이번 화면이 쓸 차례를 뽑는다. **첫 색만 무작위다** (위 설명).
 *
 * **부를 때마다 다르다.** 화면이 뜰 때 한 번만 부르고 붙들어야 한다 — 답이 갱신될
 * 때마다 다시 부르면 방금 보던 카드의 색이 바뀐다 (`architecture.md` §8.13.1).
 */
export function pickOrder(orders: readonly (readonly number[])[]): readonly number[] {
  const picked = orders[Math.floor(Math.random() * orders.length)]
  return picked ?? orders[0] ?? []
}

/**
 * 차례대로 다시 늘어놓는다. **길이가 안 맞으면 원본을 그대로 돌려준다** — 색 수가
 * 팔레트와 다른 자리(대체값이 모자란 경우 등)에서 조용히 색을 잃는 것보다 낫다.
 */
export function reorder<T>(items: readonly T[], order: readonly number[]): readonly T[] {
  if (items.length !== order.length) return items
  const placed: T[] = []
  for (const index of order) {
    const item = items[index]
    if (item === undefined) return items
    placed.push(item)
  }
  return placed
}
