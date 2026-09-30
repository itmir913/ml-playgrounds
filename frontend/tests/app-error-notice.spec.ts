// @vitest-environment jsdom
/**
 * **화면 부품이 오류로 멈추면 알린다** (open-decisions.md 85).
 *
 * 전역 오류 처리기가 없을 때 배포판 Vue는 렌더에서 던진 부품을 빈 주석으로 바꾸고 콘솔에만 남겼다 — 표 데이터
 * 화면의 판 전체가 **말없이** 사라졌다(N6 야간 감사 #1). 화면 안의 지연 부품이 청크를 못 받아도 그 칸이
 * 말없이 비었다(N4 야간 감사 C-1).
 *
 * **마지막 검사는 진짜 진입점을 태운다** — `main.ts`가 처리기를 다는지는 모듈을 들여 봐야 안다. 앞의 검사는
 * 같은 처리기를 단 작은 앱으로 모양을 잰다. **진입점을 맨 뒤에 두는 이유**: 처리기가 없으면 개발판 Vue가
 * 렌더 오류를 다시 던지면서 렌더 중인 부품 표지를 되돌리지 못해, 뒤따르는 검사의 `inject`가 그 앱을 가리킨다(맨 앞에 두고 재 보니
 * 뒤 검사가 전부 남의 스토어를 읽었다).
 */
import 'fake-indexeddb/auto'

import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  createApp,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  ref,
  type Component,
} from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installErrorNotice } from '../src/app-errors'
import { ClientError, errorMessageKey } from '../src/errors'
import { useToastStore } from '../src/stores/toasts'

/** 진입점이 띄우는 루트. 그리는 순간 던진다. */
vi.mock('../src/App.vue', () => ({
  default: {
    render() {
      throw new Error('render exploded')
    },
  },
}))
// 진입점의 곁일은 이 검사와 무관하다 — 라우터가 첫 화면 청크를 받거나 저장소를 읽지 않게 둔다.
vi.mock('../src/router', () => ({ router: { install: () => {} } }))
vi.mock('../src/limits-switch', () => ({ initLimitsOff: () => Promise.resolve() }))
vi.mock('../src/theme', () => ({ initTheme: () => {} }))

/** 콘솔에 남기는 원문. 검사 출력을 덮지 않게 받아 둔다. */
let logged: unknown[][] = []

beforeEach(() => {
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const UNEXPECTED = errorMessageKey('UNEXPECTED_ERROR')

describe('전역 오류 처리기', () => {
  /** 처리기를 단 새 앱에 그 부품을 띄운다. */
  function mountWithNotice(root: Component) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(root)
    app.use(pinia)
    installErrorNotice(app)
    app.mount(host)
    return { app, toasts: useToastStore() }
  }

  it('우리 오류는 그 문장으로 알린다', () => {
    const { app, toasts } = mountWithNotice({
      render() {
        throw new ClientError('DATASET_PARSE_FAILED')
      },
    })
    expect(toasts.items.map((one) => one.key)).toEqual([errorMessageKey('DATASET_PARSE_FAILED')])
    app.unmount()
  })

  it('지연 부품을 못 받으면 알린다', async () => {
    const Lazy = defineAsyncComponent(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/gone.js')),
    )
    const { app, toasts } = mountWithNotice({ render: () => h('div', [h(Lazy)]) })
    await flushPromises()
    expect(toasts.items.map(({ key, params }) => ({ key, params }))).toEqual([
      {
        key: UNEXPECTED,
        params: { detail: 'Failed to fetch dynamically imported module: /assets/gone.js' },
      },
    ])
    app.unmount()
  })

  it('같은 오류가 되풀이되어도 알림은 하나다', async () => {
    const turn = ref(0)
    const { app, toasts } = mountWithNotice({
      render() {
        void turn.value
        throw new Error('again')
      },
    })
    for (let at = 0; at < 3; at += 1) {
      turn.value += 1
      await nextTick()
    }
    expect(toasts.items.map((one) => one.params)).toEqual([{ detail: 'again' }])
    app.unmount()
  })

  /**
   * **알림 목록을 읽는 부품이 던지면 고리가 된다.** 스토어는 같은 알림을 빼고 새 id로 다시 미는데
   * 그것이 목록을 바꿔 그 부품을 다시 그리게 한다. 이미 떠 있으면 안 밀어야 고리가 끊긴다.
   */
  it('알림 목록을 읽는 부품이 던져도 알림을 끝없이 밀지 않는다', async () => {
    const pushes = { count: 0 }
    const Reader = defineComponent({
      setup() {
        const toasts = useToastStore()
        return () => {
          void toasts.items.length
          throw new Error('reads toasts')
        }
      },
    })
    const { app, toasts } = mountWithNotice(Reader)
    // 첫 알림은 이미 떠 있다. 닫아서 부품을 다시 그리게 하고, 그 뒤로 미는 수를 센다.
    toasts.$onAction(({ name }) => {
      if (name === 'push' || name === 'pushError') pushes.count += 1
    })
    toasts.dismiss(toasts.items[0]?.id ?? -1)
    await flushPromises()
    expect(pushes.count).toBe(1)
    expect(toasts.items).toHaveLength(1)
    app.unmount()
  })

  /** **같은 알림은 키만이 아니라 원문까지 같은 것이다.** 우리 코드가 아닌 오류는 전부 같은 키로 온다. */
  it('다른 오류는 따로 알린다', () => {
    const throwing = (message: string) => ({
      render() {
        throw new Error(message)
      },
    })
    const First = throwing('first')
    const Second = throwing('second')
    const { app, toasts } = mountWithNotice({ render: () => h('div', [h(First), h(Second)]) })
    expect(toasts.items.map(({ key, params }) => ({ key, params }))).toEqual([
      { key: UNEXPECTED, params: { detail: 'first' } },
      { key: UNEXPECTED, params: { detail: 'second' } },
    ])
    app.unmount()
  })

  it('닫은 뒤 다시 나면 다시 알린다', async () => {
    const turn = ref(0)
    const { app, toasts } = mountWithNotice({
      render() {
        void turn.value
        throw new Error('later')
      },
    })
    toasts.dismiss(toasts.items[0]?.id ?? -1)
    turn.value += 1
    await nextTick()
    expect(toasts.items.map((one) => one.params)).toEqual([{ detail: 'later' }])
    app.unmount()
  })
})

describe('진입점', () => {
  it('앱 진입점이 화면 부품의 렌더 오류를 알린다', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    await import('../src/main')
    // `main.ts`의 `app.use(createPinia())`가 활성 스토어를 세웠다 — 같은 스토어를 읽는다.
    const toasts = useToastStore()
    expect(toasts.items.map(({ tone, key, params }) => ({ tone, key, params }))).toEqual([
      { tone: 'danger', key: UNEXPECTED, params: { detail: 'render exploded' } },
    ])
    // 원문은 어디서 났는가(Vue의 info)와 함께 콘솔에도 남는다 — 처리기가 있으면 Vue는 콘솔에 안 남긴다.
    expect(logged).toContainEqual([new Error('render exploded'), expect.any(String)])
  })
})
