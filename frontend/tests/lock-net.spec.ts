// @vitest-environment jsdom
/**
 * **실행 중의 잠금 그물을 검사한다** (`tests/setup/lock-net.ts`, `open-decisions.md` 65,
 * `architecture.md` §10.7).
 *
 * 그물은 모든 jsdom 스펙의 `afterEach`에서 돈다 — 그런데 **그물 자신을 무는 검사가 없었다.** 구조 뒤
 * 감사(B-1·C-4)가 그 사이로 여섯 길을 지나갔다: `classList.add`·`setAttributeNS`·
 * `style['pointer-events']`·`attributes.setNamedItem`·`innerHTML`·`v-html`, 그리고 변종 클래스
 * (`md:pointer-events-none`·`pointer-events-none!`). 여기서는 **기본 부품이 아닌 부품**이 길마다 잠금을
 * 쓰고, 그물이 그 잠금을 **그 부품의 이름으로** 잡는지 본다. 잡은 것은 `__lockNet.take()`가 가져가므로
 * 이 검사들이 그물에 걸려 실패하지는 않는다.
 */

import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h, nextTick, onMounted, ref } from 'vue'

/**
 * 검사용 부품. **`defineComponent`를 안 쓴다** — 한 파일에 둘이 되면 `vue/one-component-per-file`이
 * 운다(`predict-lines.spec.ts`와 같은 이유). 맨 객체도 Vue가 부품으로 받는다.
 */
const probe = <T extends object>(options: T): T => options

const net = (): string[] =>
  (globalThis as unknown as { __lockNet: { take: () => string[] } }).__lockNet.take()

/** 뿌리 요소에 무엇인가를 쓰는 부품. **기본 부품이 아니다.** */
function writer(write: (element: HTMLElement) => void, attach = false): VueWrapper {
  const Writer = probe({
    name: 'LockWriter',
    setup() {
      const root = ref<HTMLElement | null>(null)
      onMounted(() => {
        if (root.value !== null) write(root.value)
      })
      return () => h('div', { ref: root }, [h('button', { type: 'button' }, 'x')])
    },
  })
  return mount(Writer, attach ? { attachTo: document.body } : {})
}

const WAYS: readonly { readonly name: string; readonly write: (element: HTMLElement) => void }[] = [
  { name: 'classList.add', write: (element) => element.classList.add('pointer-' + 'events-none') },
  {
    name: 'setAttributeNS',
    write: (element) => element.setAttributeNS(null, 'dis' + 'abled', ''),
  },
  {
    name: "style['pointer-events']",
    write: (element) => {
      ;(element.style as unknown as Record<string, string>)['pointer-' + 'events'] = 'none'
    },
  },
  {
    name: 'style.setProperty',
    write: (element) => element.style.setProperty('cur' + 'sor', 'not-' + 'allowed'),
  },
  {
    name: 'attributes.setNamedItem',
    write: (element) => {
      const attribute = document.createAttribute('in' + 'ert')
      element.attributes.setNamedItem(attribute)
    },
  },
  {
    name: 'innerHTML',
    write: (element) => {
      element.innerHTML = `<button ${'dis' + 'abled'}>x</button>`
    },
  },
  {
    name: 'variant class (md:)',
    write: (element) => element.classList.add('md:pointer-' + 'events-none'),
  },
  {
    name: 'important class (!)',
    write: (element) => element.classList.add('pointer-' + 'events-none!'),
  },
  {
    name: 'inert property (jsdom lacks it, the net reflects it)',
    write: (element) => {
      ;(element as unknown as Record<string, boolean>)['in' + 'ert'] = true
    },
  },
  {
    name: 'ariaDisabled property',
    write: (element) => {
      ;(element as unknown as Record<string, string>)['aria' + 'Disabled'] = 'true'
    },
  },
  {
    name: 'tabIndex property on a child',
    write: (element) => {
      const button = element.querySelector('button')
      if (button !== null) button.tabIndex = -1
    },
  },
]

describe('실행 중 그물이 잡는다 (구조 뒤 감사 B-1·C-4)', () => {
  for (const way of WAYS) {
    it(`문서 밖 그릇: ${way.name}`, async () => {
      const wrapper = writer(way.write)
      await nextTick()
      expect(net().join('\n')).toMatch(/LockWriter/)
      wrapper.unmount()
    })
  }

  it('문서에 붙은 그릇도 본다', async () => {
    const wrapper = writer((element) => element.classList.add('cursor-' + 'not-allowed'), true)
    await nextTick()
    expect(net().join('\n')).toMatch(/LockWriter/)
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('v-html로 부은 잠금은 부은 부품의 것이다', async () => {
    const Poured = probe({
      name: 'LockPourer',
      render: () => h('div', { innerHTML: `<span ${'aria-dis' + 'abled'}="true">x</span>` }),
    })
    const wrapper = mount(Poured)
    await nextTick()
    expect(net().join('\n')).toMatch(/LockPourer/)
    wrapper.unmount()
  })

  it('나중에 바뀐 속성도 본다 — 처음 그릴 때만 보는 것이 아니다', async () => {
    const locked = ref(false)
    const Later = probe({
      name: 'LockLater',
      render: () => h('div', locked.value ? { ['dis' + 'abled']: '' } : {}),
    })
    const wrapper = mount(Later)
    await nextTick()
    expect(net()).toEqual([])
    locked.value = true
    await nextTick()
    expect(net().join('\n')).toMatch(/LockLater/)
    wrapper.unmount()
  })

  /**
   * **기본 부품은 전체 경로로 견준다** (구조 뒤 감사 C-2). 이름만 견주면 다른 폴더의 `AppButton`이
   * 기본 부품 행세를 한다.
   */
  it('기본 부품과 이름만 같은 부품은 기본 부품이 아니다', async () => {
    const Impostor = probe({
      name: 'AppButton',
      __name: 'AppButton',
      __file: '/elsewhere/src/views/AppButton.vue',
      render: () => h('button', { ['dis' + 'abled']: '' }, 'x'),
    })
    const wrapper = mount(Impostor)
    await nextTick()
    expect(net().join('\n')).toMatch(/views\/AppButton\.vue/)
    wrapper.unmount()
  })

  it('잠금이 아닌 쓰기는 안 잡는다 — 위가 무엇이든 잡아서 초록인 것이 아니다', async () => {
    writer((element) => {
      element.classList.add('pointer-events-auto', 'w-full')
      element.setAttribute('aria-disabled', 'false')
      element.style.setProperty('cursor', 'pointer')
    })
    await nextTick()
    expect(net()).toEqual([])
  })
})
