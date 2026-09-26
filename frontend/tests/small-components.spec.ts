// @vitest-environment jsdom
/**
 * **아무 스펙도 가리키지 않던 부품 다섯** (R39b C-6). 작아서 눈으로만 보던 것들인데, 각자
 * 학생·교사가 기대는 약속이 하나씩 있다 — 그 약속만 문다. 모양은 사람 확인이다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import AppToast from '../src/components/AppToast.vue'
import TermPopover from '../src/components/TermPopover.vue'
import { i18n, setLocale } from '../src/i18n'
import { useToastStore } from '../src/stores/toasts'
import StudentEditor from '../src/views/inspect/StudentEditor.vue'
import OrphanAnswers from '../src/views/portfolio/OrphanAnswers.vue'
import PhotoCards from '../src/views/portfolio/PhotoCards.vue'

const global = { plugins: [i18n] }

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('알림', () => {
  it('밀어 넣은 알림을 보이고, 닫으면 사라진다', async () => {
    const toasts = useToastStore()
    toasts.push('danger', 'common.dismiss', { detail: 'disk full' })
    const wrapper = mount(AppToast, { global })

    expect(wrapper.text()).toContain(i18n.global.t('common.dismiss'))
    expect(wrapper.text(), 'detail line').toContain('disk full')

    await wrapper.get(`button[aria-label="${i18n.global.t('common.dismiss')}"]`).trigger('click')
    expect(toasts.items, 'dismissed toast left in the store').toHaveLength(0)
  })
})

describe('용어 설명', () => {
  it('용어 자체가 누르는 글자다', () => {
    const wrapper = mount(TermPopover, { global, props: { title: '표준화', body: '평균 0' } })
    expect(wrapper.text()).toContain('표준화')
  })
})

describe('포트폴리오 사진', () => {
  const photos = [{ path: 'portfolio/a.webp', url: 'blob:a' }]

  it('뗄 수 있을 때만 떼는 버튼이 있고, 누르면 그 사진의 경로를 낸다', async () => {
    const readOnly = mount(PhotoCards, { global, props: { photos } })
    expect(readOnly.findAll('button'), 'remove button on the read-only copy').toHaveLength(0)

    const editable = mount(PhotoCards, { global, props: { photos, removable: true } })
    await editable.get('button').trigger('click')
    expect(editable.emitted('remove')).toEqual([['portfolio/a.webp']])
  })

  it('사진이 없으면 아무것도 안 그린다', () => {
    expect(
      mount(PhotoCards, { global, props: { photos: [] } })
        .find('ul')
        .exists(),
    ).toBe(false)
  })
})

describe('문항 없이 떠도는 답', () => {
  it('답마다 한 단락이고 앞뒤 공백은 걷는다', () => {
    const wrapper = mount(OrphanAnswers, {
      global,
      props: {
        orphans: [
          { id: 'x', answer: '  첫째 답  ' },
          { id: 'y', answer: '둘째 답' },
        ],
      },
    })
    const paragraphs = wrapper.findAll('p').map((one) => one.text())
    expect(paragraphs).toContain('첫째 답')
    expect(paragraphs).toContain('둘째 답')
  })
})

describe('학생 정보 고치기', () => {
  it('고친 칸 하나만 올린다', async () => {
    const wrapper = mount(StudentEditor, {
      global,
      props: { studentId: '10101', studentName: '홍길동' },
      attachTo: document.body,
    })
    await wrapper.get('button').trigger('click')
    // 패널은 `body`로 옮겨 뜬다(`AppPopover`의 `Teleport`) — 감싸개 밖에서 찾는다.
    const inputs = [...(document.querySelector('.popover-panel')?.querySelectorAll('input') ?? [])]
    expect(inputs.length, 'editor fields not rendered').toBe(2)

    inputs[1]!.value = '김철수'
    inputs[1]!.dispatchEvent(new Event('input'))
    expect(wrapper.emitted('correct')?.at(-1)).toEqual([{ studentName: '김철수' }])
    wrapper.unmount()
  })
})
