/**
 * 씨앗이 있는 섞기. **`ml/split.ts`와 `ml/sample.ts`가 함께 쓴다.**
 *
 * 두 곳으로 갈라 두지 않는 이유는 **같은 씨앗에서 같은 순서가 나와야 하기 때문**이다
 * (`open-decisions.md` #22 — 씨앗은 `split.randomState` 하나다). 셔플 구현이 둘이 되면
 * 한쪽만 고쳤을 때 재현이 조용히 깨지고, 그건 파일을 다시 열기 전까지 아무도 모른다.
 *
 * 여기 있는 것은 전부 **순수 함수**다. 같은 입력이면 언제나 같은 출력이고,
 * `Math.random`은 어디에도 없다.
 */

import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'

import { hashText } from '../hash'

/**
 * 결정적 셔플. 같은 시드면 언제나 같은 순서다.
 *
 * Math.random을 쓰면 안 된다 - 시드를 줄 수 없어서 재현이 불가능하다.
 */
export function shuffled(values: readonly number[], seed: number): number[] {
  const out = [...values]
  const rng = xoroshiro128plus(seed)
  // Fisher-Yates. 뒤에서부터 훑는다.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = uniformInt(rng, 0, i)
    const swap = out[i] as number
    out[i] = out[j] as number
    out[j] = swap
  }
  return out
}

/**
 * 라벨마다 시드를 흔든다.
 *
 * 라벨을 무시하고 randomState를 그대로 쓰면 **크기가 같은 두 라벨이 완전히 같은 순열을
 * 얻는다.** 데이터가 어떤 순서로 정렬돼 있으면(교실 CSV는 대개 정렬돼 있다) 그 상관이
 * 테스트 데이터에 그대로 새겨진다. 라벨 길이만 더하는 식으로는 'cat'과 'dog'가 또 겹친다.
 *
 * 해시를 쓰는 이유는 안전이 아니라 **고르게 흩어지고 버전이 바뀌어도 같기 때문**이다.
 */
export function labelSeed(randomState: number, label: string): number {
  return randomState ^ Number.parseInt(hashText(label).slice(0, 8), 16)
}

/**
 * `count`개 중 `size`개를 시드로 뽑는다. **오름차순으로 돌려준다.**
 *
 * 부분 Fisher-Yates다 — 앞에서부터 `size`번만 섞으면 전체를 섞을 필요가 없다.
 * `ml/split.ts`와 같은 난수원을 쓴다. `Math.random`을 쓰면 시드를 줄 수 없어 같은
 * 설정이 같은 그림을 못 준다.
 *
 * **오름차순으로 돌려주는 것이 계약의 일부다.** 부르는 쪽이 그림을 그리는데, 그리는
 * 순서가 겹침의 위아래를 정한다 — 표본 뽑기의 부산물로 그것이 흔들릴 이유가 없다.
 *
 * **부르는 곳이 둘이다** (2026-09-21). 군집 산점도(`ml/clusters.ts`)와 데이터 화면의
 * 산점도(`data/stats.ts`)이고, 한때 앞엣것 안의 private 함수였다. 베껴 두면 같은
 * 씨앗에서 두 그림의 표본이 갈릴 수 있고 **그 어긋남은 둘을 나란히 놓기 전에는 안
 * 보인다** — 이 파일 머리말이 셔플에 대해 적어 둔 것과 같은 이유다.
 */
export function sampleIndices(count: number, size: number, seed: number): number[] {
  const pool = Array.from({ length: count }, (_value, index) => index)
  const rng = xoroshiro128plus(seed)
  const take = Math.min(size, count)

  for (let i = 0; i < take; i += 1) {
    const j = uniformInt(rng, i, count - 1)
    const swap = pool[i] as number
    pool[i] = pool[j] as number
    pool[j] = swap
  }

  return pool.slice(0, take).sort((a, b) => a - b)
}

/** 라벨별로 원본 행 번호를 모은다. 등장 순서를 지켜야 결과가 결정적이다. */
export function groupByLabel(
  rows: readonly number[],
  labels: readonly string[],
): Map<string, number[]> {
  const groups = new Map<string, number[]>()
  rows.forEach((row, position) => {
    const label = labels[position] ?? ''
    const group = groups.get(label)
    if (group) group.push(row)
    else groups.set(label, [row])
  })
  return groups
}
