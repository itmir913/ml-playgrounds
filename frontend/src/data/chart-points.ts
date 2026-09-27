/**
 * Chart.js에 넘기는 점의 차례.
 *
 * **`parsing: false`는 "x로 정렬돼 있다"는 약속이다.** Chart.js는 그 옵션을 받으면
 * 데이터를 정렬된 것으로 치고(`meta._sorted = true`), x축 범위를 **갈래마다 첫 점과 끝
 * 점에서만** 잡는다(`getMinMax`). 행 순서 그대로 넘기면 그 사이를 벗어난 점이 축 밖으로
 * 나가 **안 보인다** — 수학·성별 20행에서 x축이 88~91로 잡혀 3점만 찍혔다(2026-09-27
 * 교사 제보). 색 열을 고르면 갈래마다 점이 하나라 전부 보여서, 색을 넣으니 점이 늘었다.
 *
 * **그래서 넘기기 전에 x로 정렬한다.** 파싱을 켜서 푸는 길도 있으나 20만 점에서 다시
 * 그리기가 40% 느려진다(`chart-config.ts`의 `parsing` 머리말).
 */

/** x 오름차순으로 새 배열을 돌려준다. 원본은 안 건드린다. */
export function sortedByX<T extends { readonly x: number }>(points: readonly T[]): T[] {
  return [...points].sort((a, b) => a.x - b.x)
}
