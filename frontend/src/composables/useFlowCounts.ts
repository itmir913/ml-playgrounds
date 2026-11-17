/**
 * 프로젝트 흐름도가 **보일 때** 수를 구해 온다 (`architecture.md` §8.22, `ml/flow-counts.ts`).
 *
 * **그림이 보이기 전에는 계획 코드를 싣지 않는다.** `ml/flow-counts`는 계획 캐시와 전처리 코드를 끌고 오므로
 * 첫 화면 번들에 정적으로 실리면 안 된다 — 여기서만 `import()`로 부른다. 그리고 **윤곽을 먼저 그린 뒤**
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

/**
 * 다음 작업(task)까지 한 번 양보한다. 창을 세우는 렌더가 먼저 돌고 계산은 그 뒤에 도는 순서만 보장한다 —
 * `setTimeout(0)`이라 그림이 실제로 그려진 뒤(paint)임을 보장하지는 않는다. 무는 검사: `tests/use-flow-counts.spec.ts`가
 * 수 모듈이 돌아오는 때를 쥐고 낡은 회차와 실패를 본다.
 */
function nextTask(): Promise<void> {
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
        await nextTask()
        if (mine !== round) return
        const found = light ? module.flowCountsLite(target) : await module.flowCountsOf(target)
        if (mine !== round) return
        counts.value = found
        bars.value = module.barValuesOf(found)
      } catch (error) {
        // 수를 못 구하면 윤곽으로 둔다. 학생에게 알릴 일이 아니다 — 그림은 설정에서 선다. 그래도 조용히 삼키지
        // 않는다 — 청크를 못 받았는지 계산이 던졌는지 개발자가 콘솔에서 가른다.
        console.error('project flow counts failed', error)
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
