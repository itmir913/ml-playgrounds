// @vitest-environment jsdom
/**
 * **점검 화면의 머리가 CSV 경고를 말한다** (open-decisions.md 110, 0.35.3 최종 감사 C-4).
 *
 * `.mlpx`의 CSV는 학생이 올린 칸을 그대로 싣는다 — 가리지 않기로 정했고, 그 대신 교사가 학생 파일을 여는 이 화면이 엑셀의
 * 수식·외부 연결 경고를 허용하지 말라고 말한다. 전에는 그 문장을 지워도 *"안 불리는 키"* 검사만 겨냥과 다른 이유로 울었다.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale, SUPPORTED_LOCALES } from '../src/i18n'
import InspectView from '../src/views/InspectView.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('점검 화면의 CSV 경고', () => {
  it.each(SUPPORTED_LOCALES)('%s — 안내 아래에 선다', async (locale) => {
    await setLocale(locale)
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })

    const header = wrapper.find('header')
    expect(header.text(), 'the header must carry the caution').toContain(
      i18n.global.t('inspect.csvFormulaCaution'),
    )
    wrapper.unmount()
  })
})
