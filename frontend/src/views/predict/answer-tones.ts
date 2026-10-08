/**
 * 답의 색과 갈림표의 차례 (architecture.md §8.13.1).
 *
 * **팔레트 차례는 모듈에서 한 번 뽑는다.** 컴포넌트의 `<script setup>`은 목록 하나마다
 * 다시 실행되므로 거기서 뽑으면 **사진 스무 장짜리 화면에서 스무 번 뽑는다** — 같은
 * 등수에 사진마다 다른 색이 배정된다. 모듈은 **페이지당 한 번** 평가되므로 세션 중에는
 * 고정이면서 매번 다른 성질은 그대로다.
 *
 * **카드와 그루터기가 같은 배열을 본다** (§8.13.4). `AnswerList`의 모듈 블록에 있던
 * 것을 옮겼다 — 사진 예측의 접힌 그루터기가 갈림표 칩을 그리는데, 두 곳이 따로 뽑으면
 * 같은 답이 카드와 그루터기에서 다른 색이 된다.
 */

import { CARD_ORDERS, pickOrder, reorder } from '@/palette'
import type { Prediction } from '@/ml/metrics'
import type { AnswerCount } from '@/ml/predict'

/**
 * 값마다 다른 색. **7개까지만 있다.** 값 종류가 이보다 늘면 8등부터는 전부 같은
 * 회색이다 - 갈림표는 "값별로 다른 색"이 필요하지 "무한히 다른 색"이 필요하지 않고,
 * 색이 여덟아홉 개를 넘으면 어차피 눈으로 못 가른다 (architecture.md 8.13.1).
 *
 * **문자열을 통째로 적는다.** `` `border-chart-${n}` `` 처럼 이어 붙이면 Tailwind가
 * 소스에서 클래스 이름을 못 찾아 그 색이 빌드에서 통째로 빠진다 - CLAUDE.md §4가 임의
 * 값을 막는 것과 같은 이유로, 만들어 붙인 이름도 안 된다.
 *
 * **등수와 색의 대응은 페이지가 뜰 때 한 번 정한다.** 색은 순위표가 아니라 "같은
 * 값이면 같은 색"만 보장하면 되므로, 1등이 매번 chart-1로 고정될 이유가 없다.
 * 고정하면 분류가 대개 두세 갈래라 chart-1·2만 늘 쓰이고 나머지 다섯은 안 쓰인
 * 채로 남는다. **답이 갱신되는 동안에는 다시 안 정한다** - [예측]을 다시 누를 때마다
 * 색이 바뀌면 방금 보던 카드를 못 찾는다.
 *
 * **그런데 무작위로 섞으면 안 된다** (#18). 셔플은 두 색이 얼마나 벌어졌는지를 안
 * 봐서, 두 갈래 분류에서 채움색 둘이 ΔE2000으로 2.4까지 붙었다. 첫 색만 무작위이고
 * 그다음부터는 거리가 정한다 (`palette.ts`). **카드는 `CARD_ORDERS`다** — 넓이를
 * 채우는 것이 `-soft` 쪽이라 옅은 색이 병목이다.
 */
const CHART_CLASSES = reorder(
  [
    'border-chart-1 bg-chart-1-soft',
    'border-chart-2 bg-chart-2-soft',
    'border-chart-3 bg-chart-3-soft',
    'border-chart-4 bg-chart-4-soft',
    'border-chart-5 bg-chart-5-soft',
    'border-chart-6 bg-chart-6-soft',
    'border-chart-7 bg-chart-7-soft',
  ],
  pickOrder(CARD_ORDERS),
)

/**
 * 카드 테두리·배경. `null`은 갈리지 않았거나(값이 하나뿐) 회귀 모델이다 - 이때는
 * 강조할 갈림이 없으므로 무채색이다.
 */
export function cardTone(rank: number | null): string {
  return (rank !== null && CHART_CLASSES[rank]) || 'border-line bg-surface-sunken'
}

/**
 * 집계 칩의 색. **카드와 같은 값이면 같은 색이어야 갈림표와 카드를 눈으로 맞춰
 * 볼 수 있다** - 전에는 최다 답만 강조하고 나머지는 전부 무채색이라, "이 색이 어느
 * 카드였더라"를 표에서 못 찾았다.
 */
export function tallyTone(
  value: Prediction,
  ranks: ReadonlyMap<Prediction, number> | null,
): string {
  const rank = ranks?.get(value) ?? null
  return (rank !== null && CHART_CLASSES[rank]) || 'border-line-strong bg-surface'
}

/** 갈림표는 많이 나온 답부터 늘어놓는다 - 카드 색의 1등이 표에서도 맨 앞이다. */
export function rankTally(
  tally: readonly AnswerCount[],
  ranks: ReadonlyMap<Prediction, number> | null,
): AnswerCount[] {
  if (ranks === null) return [...tally]
  return [...tally].sort((a, b) => (ranks.get(a.value) ?? 0) - (ranks.get(b.value) ?? 0))
}
