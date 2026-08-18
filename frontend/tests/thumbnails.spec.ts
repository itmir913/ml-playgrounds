// @vitest-environment jsdom
// 컴포저블이 마운트 생명주기에 매여 있어 실제로 태워야 한다.
/**
 * 썸네일 객체 URL (`composables/useThumbnails.ts`).
 *
 * **다섯 화면이 같은 모양을 각자 들고 있었다** (V11 R5 C-2). 그중 둘은 `경로 -> 해시`
 * 규칙까지 두 표기로 다시 썼다. 여기서 보는 것은 **놓아주는 시점**이다 — 만드는 것은
 * 한 줄이고, 안 놓으면 사진 수백 장이 탭을 닫을 때까지 남는다.
 */

import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useThumbnails, type Thumbnailable } from '../src/composables/useThumbnails'

const created: string[] = []
const revoked: string[] = []

function photo(hash: string): Thumbnailable {
  return { hash, bytes: new Uint8Array([1, 2, 3]), format: { mime: 'image/webp' } }
}

beforeEach(() => {
  created.length = 0
  revoked.length = 0
  let next = 0
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const url = `blob:${(next += 1)}`
      created.push(url)
      return url
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 컴포저블만 태우는 껍데기. 화면은 여기서 볼 것이 아니다. */
function host(entries: ReturnType<typeof ref<Thumbnailable[]>>) {
  let urls!: { value: Map<string, string> }
  const wrapper = mount(
    defineComponent({
      setup() {
        urls = useThumbnails(entries as never).urls
        return () => h('div')
      },
    }),
  )
  return {
    wrapper,
    state: {
      get urls() {
        return urls.value
      },
    },
  }
}

describe('만들고 놓아준다', () => {
  it('사진마다 하나씩 만든다', () => {
    const { state } = host(ref([photo('a'), photo('b')]))
    expect(state.urls.size).toBe(2)
    expect(created).toHaveLength(2)
  })

  it('남아 있는 사진의 주소는 다시 안 만든다 - 다시 만들면 그림이 깜빡인다', async () => {
    const entries = ref([photo('a'), photo('b')])
    const { state } = host(entries)
    const before = state.urls.get('a')

    entries.value = [photo('a'), photo('c')]
    await Promise.resolve()

    expect(state.urls.get('a')).toBe(before)
    expect(created).toHaveLength(3)
  })

  it('없어진 사진의 주소는 그 자리에서 놓아준다', async () => {
    const entries = ref([photo('a'), photo('b')])
    const { state } = host(entries)
    const gone = state.urls.get('b')!

    entries.value = [photo('a')]
    await Promise.resolve()

    expect(revoked).toContain(gone)
    expect(state.urls.has('b')).toBe(false)
  })

  it('떠날 때 남은 것을 전부 놓아준다 - 여기서 빠뜨리면 탭이 닫힐 때까지 남는다', () => {
    const { wrapper, state } = host(ref([photo('a'), photo('b')]))
    const all = [...state.urls.values()]

    wrapper.unmount()

    for (const url of all) expect(revoked).toContain(url)
  })
})
