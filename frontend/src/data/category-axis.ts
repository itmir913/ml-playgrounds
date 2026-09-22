/**
 * 산점도가 **범주를 축으로 세울 때** 쓰는 것 두 가지 — 흩뿌림과 눈금.
 *
 * **두 화면이 같은 규칙을 쓴다** (`open-decisions.md` "군집 산점도의 축"의 2026-09-22
 * 문단). 결과 화면의 군집 산점도(`ml/cluster-chart.ts`)와 데이터 화면의 산점도
 * (`data/chart-config.ts`)다.
 *
 * **재료는 못 나눈다. 그리는 방식만 나눈다.** 저쪽은 학습된 행렬에서 범주 번호를 얻고
 * (원-핫·순서 인코딩) 이쪽은 원본 셀에서 얻는다 — 번호를 얻는 길은 애초에 다르다.
 * **번호를 얻은 뒤가 같아야 한다**: 복사해 두면 한쪽의 흩뿌림 폭을 고칠 때 다른 쪽이
 * 안 따라오고, 그때 **같은 데이터가 두 화면에서 다르게 보인다.**
 */

/**
 * 범주 칸 안에서 점을 흩뿌리는 폭 (`open-decisions.md` "군집 산점도의 축").
 *
 * **한 칸이 1이다.** ±0.3이면 이웃 칸의 구름과 0.4가 벌어져서 **눈이 여전히 칸으로
 * 묶어 읽는다** — 그보다 넓히면 어느 범주인지가 흐려지고, 좁히면 흩뿌리는 뜻이 없다.
 * 반올림하면 원래 칸으로 정확히 돌아오므로 툴팁은 참값을 말한다.
 *
 * **분류: 상한이 아니다.** `limits.ts`가 아니라 여기 사는 이유는 이 값이 **그리는
 * 규격**이고 그 규격을 쓰는 두 곳이 이 파일을 통해서만 만나기 때문이다.
 */
export const JITTER_SPREAD = 0.3

/**
 * 그 행의 흩뿌림. **행 번호에서 나오므로 언제나 같다.**
 *
 * 같은 파일이 같은 그림을 줘야 학생이 어제 본 것을 오늘도 본다 (#28-5가 표본에 시드를
 * 준 것과 같은 이유). **축을 바꿔도 점이 안 튀는 것**도 여기서 온다 — 흩뿌림이 축이
 * 아니라 행에 매여 있다.
 *
 * 난수원을 새로 들이지 않는다. 필요한 것은 "행마다 다르고 언제나 같은 수" 하나뿐이고,
 * 정수 해시로 충분하다.
 */
export function jitterOf(row: number): number {
  const mixed = Math.sin(row * 12.9898) * 43758.5453
  return ((mixed - Math.floor(mixed)) * 2 - 1) * JITTER_SPREAD
}

/** 범주 축이면 흩뿌리고, 아니면 그대로. */
export function placed(
  value: number,
  row: number,
  categories: readonly string[] | undefined,
): number {
  return categories === undefined ? value : value + jitterOf(row)
}

/**
 * 범주 축의 눈금. **선형 축에 정수 눈금을 세우고 이름을 붙인다** — Chart.js의
 * `category` 축은 칸 사이(흩뿌린 자리)에 점을 놓을 수 없다.
 *
 * `min`·`max`가 반 칸씩 밖으로 나가는 이유는 **양 끝 칸의 구름이 잘리지 않게** 하려는
 * 것이다. 흩뿌림이 ±0.3이라 그 안에 들어온다.
 */
export function categoryScale(
  categories: readonly string[],
  ink: string,
): {
  min: number
  max: number
  ticks: {
    color: string
    stepSize: number
    autoSkip: boolean
    callback: (value: string | number) => string
  }
} {
  return {
    min: -0.5,
    max: categories.length - 0.5,
    ticks: {
      color: ink,
      stepSize: 1,
      autoSkip: false,
      callback: (value: string | number) => categories[Math.round(Number(value))] ?? '',
    },
  }
}

/** 축의 한 칸이 무엇으로 읽히는가. 화면은 이 결과를 글자로만 바꾼다. */
export type AxisCell =
  | { readonly kind: 'category'; readonly name: string }
  /** 범주 축인데 그 번호에 이름이 없다. 화면이 "없음"이라고 말한다. */
  | { readonly kind: 'unknownCategory' }
  | { readonly kind: 'number'; readonly value: number }

/**
 * **흩뿌린 것을 되돌린다.** 위 `placed()`가 더한 만큼을 걷어내면 원래 칸이 나온다 —
 * 반올림이 이 판정의 전부다(`JITTER_SPREAD`가 반 칸을 못 넘는다).
 *
 * **여기 사는 이유는 흩뿌리는 자리가 여기이기 때문이다** (2026-09-22 R37 A-3). 한때 이
 * 함수가 `ml/clusters.ts`에 있었고, 그 사이 새로 생긴 데이터 화면의 산점도가 **되돌리는
 * 것을 잊었다** — 툴팁이 `여` 대신 `1.02`를 말했다. 2026-08-31 사각 감사 A-3이 닫은 병이
 * 새 화면에서 되살아난 것이라, **더하는 곳과 빼는 곳을 한 파일에 둔다.**
 *
 * `ml/clusters.ts`가 이것을 다시 내보낸다 — 축을 들고 있는 자리는 그쪽 이름으로 부른다.
 */
export function axisCellOf(
  categories: readonly string[] | undefined,
  value: number | null,
): AxisCell {
  // **값이 없는 칸은 범주도 수도 아니다.** 툴팁은 그 자리에 "없음"을 적는다.
  if (value === null) return { kind: 'unknownCategory' }
  if (categories === undefined) return { kind: 'number', value }
  const name = categories[Math.round(value)]
  return name === undefined ? { kind: 'unknownCategory' } : { kind: 'category', name }
}
