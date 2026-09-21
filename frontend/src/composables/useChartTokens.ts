/**
 * 배색 토큰의 **실제 값**을 읽어 온다. **캔버스는 CSS 클래스를 못 쓴다.**
 *
 * 데이터 화면의 그림 넷이 같은 일을 필요로 하면서 나왔다 (2026-09-21). **베껴 두면
 * 배색을 바꿨을 때 어느 그림이 안 따라오는지가 우연이 된다** — 그리고 그 어긋남은
 * 어두운 배색으로 바꿔서 그림을 하나하나 열어 보기 전까지 아무도 모른다.
 *
 * **캔버스에 색을 먹이는 자리는 이제 여기 하나다** (2026-09-22). 한때 셋이었다 —
 * 여기, `ClusterScatter`, `LossCurvePanel` — 그리고 그 셋은 같은 날 태어나지 않아서
 * 계약이 조금씩 달랐다. 저 둘을 데려오며 `brand`가 한 칸 늘었다.
 * **`ui-rules.spec.ts`가 새 복사본을 막는다** — 토큰을 직접 읽는 파일이 여기 말고
 * 생기면 운다.
 *
 * **`theme` ref를 본다.** 한때 `data-theme` 속성을 게터로 읽었는데, 그것은 반응형 원본이
 * 없는 DOM 읽기라 **감시자가 한 번도 안 깨어났다** — 배색을 바꾼 학생의 산점도는 이전
 * 배색의 값을 그대로 들고 있었고, 밝은 화면에 어두운 배색의 선이 검게 그려졌다
 * (2026-08-29 전 경로 감사).
 */

import { computed, onMounted, ref, watch, type ComputedRef } from 'vue'

import { FALLBACK_PALETTE } from '@/ml/cluster-chart'
import { theme } from '@/theme'

/** 캔버스가 쓰는 색 한 벌. `ml/cluster-chart.ts`의 `ClusterChartTokens`와 같은 모양이다. */
export interface ChartTokens {
  /** `--color-chart-1`~`-7`. 일곱 개다 (`open-decisions.md` #28-3). */
  readonly palette: readonly string[]
  /**
   * 같은 일곱의 **옅은 쪽**(`--color-chart-N-soft`).
   *
   * **넓이를 채우는 자리에 쓴다** — 박스 플롯의 상자가 그렇다. 진한 색으로 채우면
   * 그림의 절반이 한 색 덩어리가 되어, 그 안의 중앙값 선이 묻힌다. 카드가
   * `border + bg-soft`로 서는 것과 같은 규칙이다 (`palette.ts`).
   */
  readonly softPalette: readonly string[]
  /**
   * `--color-brand`. **한 갈래짜리 그림이 쓰는 색이다** — 손실 곡선이 그렇다.
   *
   * 배색 일곱과 다른 물건이다. 저쪽은 **서로 구분되려고** 있고, 이것은 화면의 다른
   * 강조와 **같아 보이려고** 있다.
   */
  readonly brand: string
  readonly surface: string
  readonly ink: string
  readonly line: string
}

/**
 * 지금 배색의 토큰 값. **배색이 바뀌면 다시 읽는다.**
 *
 * 못 읽을 때 쓰는 색은 `ml/cluster-chart.ts`의 `FALLBACK_PALETTE`를 그대로 빌린다 —
 * **색마다 달라야 하고**(전부 같으면 토큰을 못 읽는 순간 모든 갈래가 한 색이 되는데
 * **그림은 멀쩡해 보인다**), 그 목록이 이미 거기 있다.
 *
 * **DOM이 없으면 대체값 그대로다** — 검사 환경(jsdom 아님)에서 이 컴포저블을 부르는
 * 컴포넌트가 터지지 않아야 한다.
 */
export function useChartTokens(): ComputedRef<ChartTokens> {
  const palette = ref<readonly string[]>(FALLBACK_PALETTE)
  const softPalette = ref<readonly string[]>(FALLBACK_PALETTE)
  const brand = ref('#2563eb')
  const surface = ref('#ffffff')
  const ink = ref('#475569')
  const line = ref('#e2e8f0')

  function read(): void {
    if (typeof document === 'undefined') return
    const styles = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback

    palette.value = FALLBACK_PALETTE.map((fallback, index) =>
      token(`--color-chart-${index + 1}`, fallback),
    )
    // **대체값이 진한 쪽과 같다.** 옅은 색을 못 읽으면 진한 색으로 채워지는데, 그쪽이
    // 무거울 뿐 **안 보이지는 않는다** — 옅은 대체값을 지어내면 밝은 배경에서 사라진다.
    softPalette.value = FALLBACK_PALETTE.map((fallback, index) =>
      token(`--color-chart-${index + 1}-soft`, fallback),
    )
    brand.value = token('--color-brand', '#2563eb')
    surface.value = token('--color-surface', '#ffffff')
    ink.value = token('--color-ink-soft', '#475569')
    line.value = token('--color-line', '#e2e8f0')
  }

  onMounted(read)
  watch(theme, read)

  return computed(() => ({
    palette: palette.value,
    softPalette: softPalette.value,
    brand: brand.value,
    surface: surface.value,
    ink: ink.value,
    line: line.value,
  }))
}
