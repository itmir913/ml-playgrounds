/**
 * 배색 토큰의 **실제 값**을 읽어 온다. **캔버스는 CSS 클래스를 못 쓴다.**
 *
 * 데이터 화면의 그림 넷이 같은 일을 필요로 하면서 나왔다 (2026-09-21). **베껴 두면
 * 배색을 바꿨을 때 어느 그림이 안 따라오는지가 우연이 된다** — 그리고 그 어긋남은
 * 어두운 배색으로 바꿔서 그림을 하나하나 열어 보기 전까지 아무도 모른다.
 *
 * **그런데 지금 같은 일을 하는 자리가 셋이다** (2026-09-22 감사가 셌다) — 여기,
 * `components/ClusterScatter.vue`, `views/results/panels/LossCurvePanel.vue`. 이 파일이
 * 태어날 때 저 둘을 **안 데려왔다.** 위 문단이 경고한 위험이 그대로 살아 있다는 뜻이고,
 * 고치는 값이 큰 것도 아니다 — 저쪽 둘을 여기로 옮기면 된다(`LossCurvePanel`은
 * `--color-brand`를 더 쓰므로 이 계약이 한 칸 넓어진다).
 *
 * **안 옮긴 이유는 시간이 아니라 확인이다** — 그 둘은 모델을 학습해야 화면에 서는
 * 자리라, 옮긴 뒤 눈으로 볼 수 없는 채로 건드리지 않았다. 다음에 그 화면을 만질 때
 * 함께 옮겨라.
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
 */
/**
 * 지금 배색의 토큰 값. **배색이 바뀌면 다시 읽는다.**
 *
 * **DOM이 없으면 대체값 그대로다** — 검사 환경(jsdom 아님)에서 이 컴포저블을 부르는
 * 컴포넌트가 터지지 않아야 한다.
 */
export function useChartTokens(): ComputedRef<ChartTokens> {
  const palette = ref<readonly string[]>(FALLBACK_PALETTE)
  const softPalette = ref<readonly string[]>(FALLBACK_PALETTE)
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
    surface.value = token('--color-surface', '#ffffff')
    ink.value = token('--color-ink-soft', '#475569')
    line.value = token('--color-line', '#e2e8f0')
  }

  onMounted(read)
  watch(theme, read)

  return computed(() => ({
    palette: palette.value,
    softPalette: softPalette.value,
    surface: surface.value,
    ink: ink.value,
    line: line.value,
  }))
}
