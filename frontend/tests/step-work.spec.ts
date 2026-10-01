// @vitest-environment jsdom
/**
 * 단추로 도는 결과 화면의 계산 (`composables/useStepWork.ts`).
 *
 * **떠나거나 실행이 바뀌면 도는 계산을 멈추고 늦게 온 결과를 버린다**를 문다 — 안 그러면 다른
 * 실행의 결정 경계가 이 실행의 자리에 선다.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { useStepWork, type StepWork } from '../src/composables/useStepWork'
import { pause, type StepControl } from '../src/ml/predict-in-steps'

/** 양보를 `steps`번 하고 `value`를 낸다. 멈추라면 양보에서 던진다. */
function slow(value: string, steps = 3) {
  return async (control: StepControl) => {
    for (let step = 0; step < steps; step += 1) await pause(control)
    return value
  }
}

function host(work: (control: StepControl) => Promise<string>) {
  let exposed: StepWork<string> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        exposed = useStepWork(work)
        return () => h('div')
      },
    }),
  )
  if (!exposed) throw new Error('expected work')
  return { wrapper, work: exposed }
}

describe('useStepWork', () => {
  it('누르기 전에는 undefined이고, 끝나면 결과가 선다', async () => {
    const { work } = host(slow('a'))
    expect(work.result.value).toBeUndefined()
    await work.start()
    expect(work.result.value).toBe('a')
  })

  it('도는 중에 reset하면 그 결과를 버린다', async () => {
    const { work } = host(slow('a'))
    const running = work.start()
    work.reset()
    await running
    expect(work.result.value).toBeUndefined()
  })

  it('화면을 떠나면 도는 계산이 멈춘다', async () => {
    let finished = false
    const { wrapper, work } = host(async (control) => {
      await slow('a')(control)
      finished = true
      return 'a'
    })
    const running = work.start()
    wrapper.unmount()
    await running
    expect(finished).toBe(false)
  })

  it('멈춤이 아닌 실패는 그대로 던진다', async () => {
    const { work } = host(() => Promise.reject(new Error('boom')))
    await expect(work.start()).rejects.toThrow('boom')
  })
})
