// @vitest-environment jsdom
/**
 * **화면이 판정에 넘기는 UI 언어** (`composables/useUiLocale.ts`, 0.33.3 최종 감사 J-code C-1).
 *
 * 문자 코드 판정·zip 이름 되살리기는 언어를 손으로 받는 검사(`encoding.spec.ts`·`zip-names.spec.ts`)가
 * 지키므로, 화면이 **엉뚱한 언어**(늘 `FALLBACK_LOCALE`)를 넘겨도 그쪽은 초록이다. 사진 화면 셋이 실제로
 * 그래도 아무것도 안 울었다. 화면은 이제 모두 이 컴포저블로 좁히므로(`i18n-usage.spec.ts`), 여기서
 * 좁히기가 지금 선택을 따라가는지 컴포넌트를 띄워 잰다.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { useUiLocale } from '../src/composables/useUiLocale'
import { FALLBACK_LOCALE, i18n, setLocale, SUPPORTED_LOCALES } from '../src/i18n'

function probe() {
  let read: () => string = () => ''
  const Probe = defineComponent({
    setup() {
      const uiLocale = useUiLocale()
      read = () => uiLocale.value
      return () => h('span')
    },
  })
  mount(Probe, { global: { plugins: [i18n] } })
  return read
}

afterEach(async () => {
  await setLocale('ko')
})

describe('useUiLocale', () => {
  it.each(SUPPORTED_LOCALES)('지금 고른 언어(%s)를 준다', async (locale) => {
    const read = probe()
    await setLocale(locale)
    expect(read()).toBe(locale)
  })

  it('고른 언어가 바뀌면 따라간다 — 처음 값에 묶이지 않는다', async () => {
    await setLocale('ja')
    const read = probe()
    expect(read()).toBe('ja')
    await setLocale('ko')
    expect(read()).toBe('ko')
  })

  it('지원하지 않는 값이면 기본 언어로 좁힌다', () => {
    const read = probe()
    ;(i18n.global.locale as unknown as { value: string }).value = 'xx'
    expect(read()).toBe(FALLBACK_LOCALE)
  })
})
