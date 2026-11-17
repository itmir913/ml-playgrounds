// @vitest-environment jsdom
/**
 * **흐름도가 수를 구해 오는 길** (`composables/useFlowCounts.ts`, `architecture.md` §8.22).
 *
 * 수 계산 자체는 `flow-counts.spec.ts`가 본다. 여기서는 그 길의 **방어선 셋**을 문다 — 구하다 던지면 윤곽으로 두되
 * 콘솔에 남기고, 파일이 바뀌어 낡은 회차가 늦게 돌아와도 새 수를 덮지 않고, 그림이 안 보이면 수를 비운다.
 * 수 모듈은 대역이다 — 돌아오는 때를 검사가 쥔다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'

import { useFlowCounts, type FlowCountsState } from '../src/composables/useFlowCounts'
import type { FlowCounts } from '../src/ml/flow-counts'
import type { ProjectFile } from '../src/project/format'
import { projectFile } from './fixtures/project'

/** 수 모듈 대역. 돌아오는 때와 던지는 것을 검사가 정한다. */
const control = vi.hoisted(() => ({
  of: null as null | ((file: unknown) => Promise<unknown>),
  lite: null as null | ((file: unknown) => unknown),
}))

vi.mock('@/ml/flow-counts', () => ({
  flowCountsOf: (file: unknown) => control.of?.(file),
  flowCountsLite: (file: unknown) => control.lite?.(file),
  barValuesOf: (counts: unknown) =>
    counts === null ? null : { train: 1, test: 1, gray: 0, testFile: null },
}))

/** 지금 보이는 수를 구별할 표지만 다른 수. */
function counts(total: number): FlowCounts {
  return {
    total,
    usable: null,
    sampled: null,
    train: null,
    test: null,
    unusable: null,
    notDrawn: null,
    featureCount: null,
    prep: 'unknown',
    testFile: null,
  }
}

interface Handles {
  readonly file: Ref<ProjectFile | null>
  readonly lite: Ref<boolean>
  readonly enabled: Ref<boolean>
  readonly state: FlowCountsState
  unmount: () => void
}

function mountHook(): Handles {
  const file = ref<ProjectFile | null>(projectFile())
  const lite = ref(false)
  const enabled = ref(true)
  let state!: FlowCountsState
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useFlowCounts(
          () => file.value,
          () => lite.value,
          () => enabled.value,
        )
        return () => h('div')
      },
    }),
  )
  return { file, lite, enabled, state, unmount: () => wrapper.unmount() }
}

let errors: ReturnType<typeof vi.spyOn>

// 수 모듈의 첫 `import()`는 느리다 — 미리 한 번 받아 두어 검사가 기다리는 시간이 모듈 로딩에 좌우되지 않게 한다.
beforeAll(async () => {
  await import('@/ml/flow-counts')
})

beforeEach(() => {
  control.of = async () => counts(1)
  control.lite = () => counts(2)
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errors.mockRestore()
})

/** 수 모듈을 싣고 다음 작업을 지나 결과가 선 뒤까지 기다린다. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10))
  await flushPromises()
}

describe('수를 구해 온다', () => {
  it('보이면 구하고, 점검(lite)이면 가벼운 입구로 구한다', async () => {
    const hook = mountHook()
    await settled()
    expect(hook.state.counts.value?.total).toBe(1)
    hook.lite.value = true
    await settled()
    expect(hook.state.counts.value?.total).toBe(2)
    hook.unmount()
  })

  it('구하다 던지면 윤곽으로 두되 콘솔에 남긴다 — 삼키지 않는다', async () => {
    // 무는 대상: `useFlowCounts`의 `catch`의 `console.error`. 지우면 청크를 못 받은 것과 계산이 던진 것을 아무도 못 가른다.
    control.of = async () => {
      throw new Error('counts exploded')
    }
    const hook = mountHook()
    await settled()
    expect(hook.state.counts.value).toBeNull()
    expect(hook.state.bars.value).toBeNull()
    expect(errors, 'failure must be logged').toHaveBeenCalledWith(
      'project flow counts failed',
      expect.any(Error),
    )
    hook.unmount()
  })
})

describe('낡은 회차는 새 수를 덮지 않는다', () => {
  it('파일이 바뀐 뒤에 먼저 시작한 계산이 늦게 돌아와도 버린다', async () => {
    // 무는 대상: `if (mine !== round) return` 가드 둘. 없으면 느린 옛 파일의 수가 새 파일의 그림을 덮는다.
    const releases: ((value: FlowCounts) => void)[] = []
    control.of = () => new Promise<FlowCounts>((resolve) => releases.push(resolve))
    const hook = mountHook()
    await settled()
    expect(releases.length, 'first round is waiting').toBe(1)
    hook.file.value = projectFile()
    await settled()
    expect(releases.length, 'second round is waiting').toBe(2)
    releases[1]!(counts(20))
    await settled()
    expect(hook.state.counts.value?.total).toBe(20)
    releases[0]!(counts(10))
    await settled()
    expect(hook.state.counts.value?.total, 'late old round must be dropped').toBe(20)
    hook.unmount()
  })

  it('계산을 시작하기 전에 파일이 바뀌면 낡은 회차는 계산을 돌리지 않는다', async () => {
    // 무는 대상: 수 모듈을 싣고 한 번 양보한 직후의 `mine !== round` 가드. 없으면 바로 버려질 계산이 돈다(표는 계획까지 짓는다).
    const calls: unknown[] = []
    control.of = async (file) => {
      calls.push(file)
      return counts(1)
    }
    // 한 번 양보하는 자리(`setTimeout`)만 가짜 시계로 잡는다 — 첫 회차가 거기서 기다리는 동안 파일을 바꾼다.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const hook = mountHook()
      await flushPromises()
      hook.file.value = projectFile()
      await flushPromises()
      expect(calls.length, 'nothing computes before the yield').toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
      expect(calls.length, 'only the latest round computes').toBe(1)
      hook.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('낡은 회차가 던져도 새 수를 비우지 않는다', async () => {
    // 무는 대상: `catch` 안의 가드. 없으면 늦게 실패한 옛 계산이 잘 구한 새 수를 지운다.
    const fail: (() => void)[] = []
    let calls = 0
    control.of = () => {
      calls += 1
      if (calls === 1) {
        return new Promise((_, reject) => fail.push(() => reject(new Error('late failure'))))
      }
      return Promise.resolve(counts(30))
    }
    const hook = mountHook()
    await settled()
    hook.file.value = projectFile()
    await settled()
    expect(hook.state.counts.value?.total).toBe(30)
    fail[0]!()
    await settled()
    expect(hook.state.counts.value?.total, 'late failure must not clear').toBe(30)
    hook.unmount()
  })

  it('부품이 거두어진 뒤에 돌아온 수는 버린다', async () => {
    // 무는 대상: `onBeforeUnmount`의 `round += 1`.
    let release: (value: FlowCounts) => void = () => {}
    control.of = () => new Promise<FlowCounts>((resolve) => (release = resolve))
    const hook = mountHook()
    await settled()
    hook.unmount()
    release(counts(40))
    await settled()
    expect(hook.state.counts.value).toBeNull()
  })
})

describe('그림이 안 보이면 수를 비운다', () => {
  it('보이다가 안 보이면 수와 막대를 비우고, 다시 보이면 구한다', async () => {
    // 무는 대상: `watch`의 `!visible || target === null` 갈래. 없으면 닫은 창의 옛 수가 다음에 열 때 먼저 비친다.
    const hook = mountHook()
    await settled()
    expect(hook.state.counts.value).not.toBeNull()
    expect(hook.state.bars.value).not.toBeNull()
    hook.enabled.value = false
    await nextTick()
    expect(hook.state.counts.value).toBeNull()
    expect(hook.state.bars.value).toBeNull()
    hook.enabled.value = true
    await settled()
    expect(hook.state.counts.value?.total).toBe(1)
    hook.unmount()
  })
})
