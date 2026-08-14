// @vitest-environment jsdom
// 화면을 실제로 마운트한다 - 여기서 잡으려는 것은 화면과 파일이 갈리는 자리다.
/**
 * 포트폴리오 화면 (`views/PortfolioView.vue`, mlpx-spec.md §8.3).
 *
 * **빈 프로젝트에서 열어도 화면이 비지 않는다**는 것과, **상한에 걸렸을 때 화면이 파일과
 * 다른 글자를 들고 있지 않다**는 것 둘을 본다. 뒤엣것은 눈으로는 안 보인다 - 값이
 * 안 바뀌면 Vue가 DOM을 다시 안 쓰기 때문에 거절당한 글자가 칸에 그대로 남는다
 * (architecture.md §8.15.1).
 *
 * 나머지 판단(문항을 지우면 답도 지운다 등)은 `portfolio.spec.ts`가 화면 없이 덮는다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import PortfolioView from '../src/views/PortfolioView.vue'
import { i18n, setLocale } from '../src/i18n'
import { MAX_PORTFOLIO_BYTES } from '../src/limits'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { useProjectStore } from '../src/stores/project'

function project(): ProjectFile {
  const document = newProjectDocument(
    { name: '테스트', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-14T00:00:00.000Z',
      randomState: 42,
    },
  )
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

function mountView() {
  useProjectStore().file = project()
  return mount(PortfolioView, { global: { plugins: [i18n] } })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('양식이 없어도 화면이 비지 않는다', () => {
  it('시작할 두 갈래를 준다', () => {
    const view = mountView()
    const labels = view.findAll('button').map((button) => button.text())
    expect(labels).toContain('빈 양식에서 시작')
    expect(labels).toContain('양식 가져오기')
  })

  it('빈 양식은 네트워크 없이 선다 - 문항 하나로 시작한다', async () => {
    const view = mountView()
    const start = view.findAll('button').find((button) => button.text() === '빈 양식에서 시작')
    await start?.trigger('click')

    const sections = useProjectStore().file?.document.portfolio.template.sections ?? []
    expect(sections).toHaveLength(1)
    expect(view.find('textarea').exists()).toBe(true)
  })

  it('로케일 키가 화면에 그대로 뜨지 않는다', () => {
    expect(mountView().text()).not.toMatch(/portfolio[.]\w+/)
  })
})

describe('목차는 어디까지 왔는지 말한다', () => {
  it('진행과 문항 줄이 함께 뜬다', async () => {
    const view = mountView()
    const start = view.findAll('button').find((button) => button.text() === '빈 양식에서 시작')
    await start?.trigger('click')

    const index = view.findAll('ol > li')
    expect(index).toHaveLength(1)
    // 안 쓴 문항을 색으로만 말하지 않는다 - 읽어 주는 문장이 함께 있다.
    expect(index[0]?.text()).toContain('아직 쓰지 않았습니다.')
    expect(view.text()).toContain('1개 중 0개를 썼습니다.')
  })
})

describe('완성본에서도 목차가 데려간다', () => {
  it('문항마다 같은 자리 이름을 갖는다', async () => {
    // **작성 화면에만 이름이 있었다** (2026-08-14, 사용자가 잡았다). 완성본에서 목차를
    // 눌러도 아무 일도 안 일어났다.
    const view = mountView()
    const start = view.findAll('button').find((button) => button.text() === '빈 양식에서 시작')
    await start?.trigger('click')

    const id = useProjectStore().file?.document.portfolio.template.sections[0]?.id ?? ''
    expect(view.find(`#portfolio-section-${id}`).exists()).toBe(true)

    const toPreview = view.findAll('button').find((button) => button.text() === '완성본 보기')
    await toPreview?.trigger('click')

    expect(view.find(`#portfolio-section-${id}`).exists()).toBe(true)
  })

  it('프로젝트 요약은 완성본에 없다 - 도구 막대에 이미 붙박이로 있다', async () => {
    const view = mountView()
    const start = view.findAll('button').find((button) => button.text() === '빈 양식에서 시작')
    await start?.trigger('click')
    const toPreview = view.findAll('button').find((button) => button.text() === '완성본 보기')
    await toPreview?.trigger('click')

    expect(view.text()).not.toContain('기계학습 유형')
  })
})

describe('안내문을 고칠 때 칸이 되돌아가지 않는다', () => {
  it('줄바꿈을 쳐도 칸에 남는다', async () => {
    // **실제로 안 쳐졌다** (2026-08-14, 사용자가 잡았다). 저장할 때 다듬으면 화면의
    // 값과 달라지고, Vue는 DOM의 지금 값과 새 값을 견주므로 칸을 다시 써 버린다.
    const view = mountView()
    const start = view.findAll('button').find((button) => button.text() === '빈 양식에서 시작')
    await start?.trigger('click')

    const edit = view
      .findAll('button')
      .find((button) => button.attributes('aria-label') === '문항 고치기')
    await edit?.trigger('click')

    const guidance = view.findAll('textarea')[0]
    const element = guidance?.element as HTMLTextAreaElement
    element.value = '첫 줄\n'
    await guidance?.trigger('input')

    expect(element.value).toBe('첫 줄\n')
  })
})

describe('상한에 걸리면 화면이 파일과 갈리지 않는다', () => {
  it('거절한 글이 칸에 남지 않는다', async () => {
    const view = mountView()
    const start = view.findAll('button').find((button) => button.text() === '빈 양식에서 시작')
    await start?.trigger('click')

    const store = useProjectStore()
    const id = store.file?.document.portfolio.template.sections[0]?.id ?? ''
    const textarea = view.find('textarea')

    // 먼저 받아들여지는 글 하나. 이것이 되돌아갈 자리다.
    ;(textarea.element as HTMLTextAreaElement).value = '짧은 글'
    await textarea.trigger('input')
    expect(store.file?.document.portfolio.answers[id]).toBe('짧은 글')

    // 그다음 상한을 넘기는 붙여넣기. **거절하고 칸을 파일의 값으로 되돌린다.**
    ;(textarea.element as HTMLTextAreaElement).value = 'a'.repeat(MAX_PORTFOLIO_BYTES + 1)
    await textarea.trigger('input')

    expect(store.file?.document.portfolio.answers[id]).toBe('짧은 글')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('짧은 글')
  })
})
