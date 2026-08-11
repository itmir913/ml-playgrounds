/**
 * 행 표본 뽑기 — **`usableRows` 다음, 분할 앞이다** (`open-decisions.md` #22).
 *
 * **왜 있는가.** 등록부가 알고리즘마다 행 상한을 갖고(`limits.ts`) 넘으면 카드가 잠기는데,
 * 잠근 다음에 학생이 둘 수 있는 수가 없었다. 1만 행짜리 CSV를 올리면 랜덤포레스트·SVM·
 * KNN이 전부 잠기고 화면은 이유만 말한다. **분할로는 못 푼다** — `trainableRowCount`가
 * 분할을 일부러 안 빼고 세기 때문이다(`ml/selection.ts`). 여기가 그 카드를 여는 자리다.
 *
 * **씨앗도 층화 여부도 새로 만들지 않는다.** `split.randomState`와 `split.stratify`를
 * 그대로 따라간다. 씨앗이 둘이면 재실행 대조가 무엇을 믿어야 하는지 모르게 되고, 층화
 * 손잡이가 둘이면 **학생이 만지지도 않은 분할 단계에서** 오류가 난다.
 *
 * **뽑히지 않은 행의 목록은 아무도 저장하지 않는다.** `trainIndices ∪ testIndices`의
 * 여집합이 곧 그것이다 (`mlpx-spec.md` §3).
 *
 * 돌려주는 것은 **정본 CSV의 행 번호**다. 걸러낸 뒤 0부터 다시 세면 참조형 모델(KNN·SVM)이
 * 가리키는 행이 조용히 달라진다 — `ml/split.ts`의 머리말과 같은 규칙이다.
 */

import { ClientError } from '../errors'
import { MIN_SPLIT_ROWS } from '../limits'
import type { Split } from '../project/schema'
import { groupByLabel, labelSeed, shuffled } from './shuffle'

export interface SampleInput {
  /** 학습에 쓸 수 있는 행의 **원본 번호**. `usableRows`의 결과다. */
  rows: readonly number[]
  /**
   * rows와 같은 길이의 타깃 값. 층화할 때만 쓴다.
   *
   * 군집화에는 타깃이 없으므로 넘어오지 않는다 — 그때는 층화 없이 뽑는다.
   */
  labels?: readonly string[]
}

const ascending = (a: number, b: number): number => a - b

/** 그 라벨이 표본에 최소한 남겨야 하는 개수. 가진 것보다 많이 요구하지 않는다. */
const floorFor = (size: number): number => Math.min(size, MIN_SPLIT_ROWS)

/**
 * 라벨마다 몇 개를 뽑을지 정한다. **합이 정확히 `nSamples`여야 한다.**
 *
 * **두 단계다. 순서가 뜻을 갖는다.**
 *
 * 1. **비례 배분** — 몫을 내림한 뒤 남은 자리를 소수부가 큰 라벨부터 준다(최대잉여법).
 *    `Math.round`를 라벨마다 따로 쓰면 합이 `nSamples`에서 어긋나고, 그러면 학생이
 *    3,000을 넣었는데 2,998행으로 학습하는 일이 생긴다.
 * 2. **바닥 올리기** — 1에서 `MIN_SPLIT_ROWS`에 못 미친 라벨을 끌어올리고, 그만큼을
 *    여유 있는 라벨에서 되받는다. 층화 분할이 라벨마다 학습셋과 평가셋에 하나씩은
 *    보내야 하기 때문이다.
 *
 * **순서를 뒤집으면 안 된다.** 바닥을 먼저 깔고 나머지를 비례로 나누면, 바닥이 필요
 * 없는 정상 데이터에서도 비율이 틀어진다 — 600:300:100에서 200줄을 뽑을 때
 * 120:60:20이 아니라 119:60:21이 나온다. 비례가 먼저이고 바닥은 **예외 처리**다.
 *
 * 원래부터 `MIN_SPLIT_ROWS`보다 적던 라벨은 가진 것을 다 가져간다. **그 라벨의 사정은
 * 여기서 판정하지 않는다** — 분할이 `SPLIT_STRATIFY_IMPOSSIBLE`로 말하고, 샘플링을
 * 켜든 안 켜든 같은 말이 나와야 한다.
 */
function allocate(
  groups: Map<string, number[]>,
  nSamples: number,
  total: number,
): Map<string, number> {
  // 바닥의 합조차 안 되면 층화가 성립하지 않는다. **조용히 층화를 풀지 않는다** -
  // 학생이 할 일은 뽑을 줄 수를 늘리거나 층화를 끄는 것이고, 그건 학생이 골라야 하는
  // 갈림이다.
  let floors = 0
  for (const group of groups.values()) floors += floorFor(group.length)
  if (floors > nSamples) {
    throw new ClientError('SAMPLE_STRATIFY_IMPOSSIBLE', {
      nSamples,
      labels: groups.size,
      minRows: MIN_SPLIT_ROWS,
    })
  }

  // 1단계 — 비례 배분.
  const takes = new Map<string, number>()
  const remainders: { label: string; remainder: number }[] = []
  let assigned = 0
  for (const [label, group] of groups) {
    const quota = (nSamples * group.length) / total
    const take = Math.min(group.length, Math.floor(quota))
    takes.set(label, take)
    assigned += take
    if (take < group.length) remainders.push({ label, remainder: quota - Math.floor(quota) })
  }

  // 소수부가 큰 순. 같으면 등장 순서를 지킨다 - sort가 stable이므로 remainders에 담은
  // 순서가 그대로 남는다. **동점에서 순서가 흔들리면 같은 씨앗에서 다른 표본이 나온다.**
  remainders.sort((a, b) => b.remainder - a.remainder)
  for (const { label } of remainders) {
    if (assigned >= nSamples) break
    const group = groups.get(label) as number[]
    const current = takes.get(label) as number
    if (current >= group.length) continue
    takes.set(label, current + 1)
    assigned += 1
  }

  // 2단계 — 바닥에 못 미친 라벨을 끌어올린다. 여기서 합이 nSamples를 넘어간다.
  for (const [label, group] of groups) {
    const floor = floorFor(group.length)
    const current = takes.get(label) as number
    if (current >= floor) continue
    takes.set(label, floor)
    assigned += floor - current
  }

  // 넘어간 만큼을 여유 있는 라벨에서 한 개씩 되받는다. **가장 많이 가진 라벨부터** -
  // 되받는 비용을 비율이 가장 덜 흔들리는 쪽에 물린다. 동점이면 등장 순서가 이긴다.
  while (assigned > nSamples) {
    let donor: string | undefined
    let most = -1
    for (const [label, group] of groups) {
      const current = takes.get(label) as number
      if (current <= floorFor(group.length)) continue
      if (current > most) {
        most = current
        donor = label
      }
    }
    // 바닥의 합이 nSamples 이하임을 위에서 확인했으므로 여기서 donor가 없을 수 없다.
    if (donor === undefined) break
    takes.set(donor, most - 1)
    assigned -= 1
  }

  return takes
}

/**
 * `nSamples`개만 남긴다. 없거나 가진 행보다 크면 **그대로 돌려준다.**
 *
 * 상한을 넘지 않는 학생은 이 함수를 지나가도 아무것도 달라지지 않아야 한다 —
 * 옛 `.mlpx`에는 이 필드가 아예 없다(`mlpx-spec.md` §3).
 */
export function sampleRows(
  input: SampleInput,
  split: Split,
  nSamples: number | undefined,
): number[] {
  const { rows, labels } = input
  if (nSamples === undefined || nSamples >= rows.length) return [...rows]

  if (split.stratify && labels) {
    const groups = groupByLabel(rows, labels)
    const takes = allocate(groups, nSamples, rows.length)
    const picked: number[] = []
    for (const [label, group] of groups) {
      // 분할과 **같은 씨앗으로 같은 함수**를 부른다 (ml/shuffle.ts).
      const order = shuffled(group, labelSeed(split.randomState, label))
      picked.push(...order.slice(0, takes.get(label) ?? 0))
    }
    return picked.sort(ascending)
  }

  return shuffled(rows, split.randomState).slice(0, nSamples).sort(ascending)
}
