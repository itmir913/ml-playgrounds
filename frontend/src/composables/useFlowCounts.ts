/**
 * 프로젝트 흐름도가 **보일 때** 수를 구해 온다 (`architecture.md` §8.22, `ml/flow-counts.ts`).
 *
 * **그림이 보이기 전에는 계획 코드를 싣지 않는다.** `ml/flow-counts`는 계획 캐시와 전처리 코드를 끌고 오므로
 * 첫 화면의 꾸러미에 정적으로 실리면 안 된다 — 여기서만 `import()`로 부른다. 그리고 **윤곽을 먼저 그린 뒤**
 * 다음 틱에 구한다: 창이 열리는 순간 계획이 돌면 창이 뜨는 것까지 늦어진다.
 *
 * 구하지 못하면(데이터가 없다, 계획이 안 선다) 수를 비워 둔다 — 그림은 설정 비율의 윤곽이다. 숫자를 지어내지
 * 않는다. 점검(`lite`)은 계획을 거치지 않는 입구로 행 수 없이 구한다.
 */

import { onBeforeUnmount, shallowRef, watch, type ShallowRef } from 'vue'

import type { FlowCounts } from '@/ml/flow-counts'
import type { FlowBarValues } from '@/ml/flow-layout'
import type { ProjectFile } from '@/project/format'

export interface FlowCountsState {
  readonly counts: ShallowRef<FlowCounts | null>
  readonly bars: ShallowRef<FlowBarValues | null>
}

/** 한 번 양보해 윤곽이 먼저 화면에 서게 한다. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * @param file 읽을 파일. 바뀌면 다시 구한다.
 * @param lite 점검이다.
 * @param enabled 그림이 보이는가. 거짓인 동안은 아무것도 싣지 않는다.
 */
export function useFlowCounts(
  file: () => ProjectFile | null,
  lite: () => boolean,
  enabled: () => boolean,
): FlowCountsState {
  const counts = shallowRef<FlowCounts | null>(null)
  const bars = shallowRef<FlowBarValues | null>(null)
  let round = 0

  watch(
    [file, lite, enabled],
    async ([target, light, visible]) => {
      const mine = (round += 1)
      if (!visible || target === null) {
        counts.value = null
        bars.value = null
        return
      }
      try {
        const module = await import('@/ml/flow-counts')
        await afterPaint()
        if (mine !== round) return
        const found = light ? module.flowCountsLite(target) : await module.flowCountsOf(target)
        if (mine !== round) return
        counts.value = found
        bars.value = module.barValuesOf(found)
      } catch {
        // 수를 못 구하면 윤곽으로 둔다. 학생에게 알릴 일이 아니다 — 그림은 설정에서 선다.
        if (mine !== round) return
        counts.value = null
        bars.value = null
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    round += 1
  })

  return { counts, bars }
}
