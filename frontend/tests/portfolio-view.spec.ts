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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PortfolioView from '../src/views/PortfolioView.vue'
import TemplateSourceList from '../src/views/portfolio/TemplateSourceList.vue'
import TemplateSourceMenu from '../src/views/portfolio/TemplateSourceMenu.vue'
import { i18n, setLocale } from '../src/i18n'
import { MAX_PORTFOLIO_BYTES } from '../src/limits'
import { newProjectDocument } from '../src/project/create'
import { portfolioTextBytes, withImportedSections } from '../src/project/portfolio'
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

    // **눈에 보이는 것은 수뿐이다.** 무엇의 수인지는 자리가 말한다 (architecture.md §8.18).
    expect(view.text()).toContain('0 / 1')

    // **문장은 사라지지 않고 막대의 이름이 된다** - 자리가 말해 주는 것을 귀로는 못 듣는다.
    // 막대는 한 화면에 둘이다(담긴 양·진행). 세는 것이 문항인 쪽을 고른다.
    const progress = view
      .findAll('[role="progressbar"]')
      .find((bar) => bar.attributes('aria-valuemax') === '1')
    expect(progress?.attributes('aria-label')).toBe('1개 중 0개를 썼습니다.')
    expect(progress?.attributes('aria-valuenow')).toBe('0')
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

  /**
   * **정확히 상한인 글은 받아들인다.** 검사가 쓰는 값이 언제나 `MAX + 1`이라
   * `>`를 `>=`로 바꿔도 조용했다 — 경계에서 어느 쪽인지를 아무도 안 정했다
   * (2026-08-31 사각 감사 C-2).
   */
  it('정확히 상한인 글은 받아들인다', async () => {
    const store = useProjectStore()
    const view = mountView()
    await view
      .findAll('button')
      .find((one) => one.text().includes('빈 양식'))
      ?.trigger('click')

    const id = store.file?.document.portfolio.template.sections[0]?.id ?? ''
    const textarea = view.find('textarea')
    // 답 말고 다른 것이 몇 바이트 더 있으므로, 상한에 딱 맞는 답의 길이를 되짚어 만든다.
    const room = MAX_PORTFOLIO_BYTES - portfolioTextBytes(store.file!.document.portfolio)
    const exact = 'a'.repeat(room)
    ;(textarea.element as HTMLTextAreaElement).value = exact
    await textarea.trigger('input')

    expect(portfolioTextBytes(store.file!.document.portfolio)).toBe(MAX_PORTFOLIO_BYTES)
    expect(store.file?.document.portfolio.answers[id]).toBe(exact)
  })
})

/**
 * **포트폴리오를 쓴 것도 프로젝트를 고친 것이다** (코드 소유자 판정, 2026-08-18).
 *
 * 프로젝트를 고치는 열두 자리 중 여기만 `manifest.updatedAt`을 안 찍고 있었다
 * (V11 R5 A-1). 그러면 화면의 "수정한 날짜"가 지난 차시로 남고, 목록이 `updatedAt`
 * 인덱스로 정렬하므로 **한 시간을 쓴 프로젝트가 아무것도 안 한 프로젝트 아래로
 * 가라앉는다.** 값이 틀린 것이 아니라 **안 움직이는 것**이라 어느 검사도 안 봤다.
 */
describe('포트폴리오를 고치면 수정 시각이 움직인다', () => {
  it('빈 양식으로 시작하는 것도 고친 것이다', async () => {
    const store = useProjectStore()
    const view = mountView()
    const before = store.file?.document.manifest.updatedAt

    await view
      .findAll('button')
      .find((one) => one.text().includes('빈 양식'))
      ?.trigger('click')

    const after = store.file?.document.manifest.updatedAt
    expect(after).toBeDefined()
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!))
  })

  it('답을 쓰는 것도 고친 것이다', async () => {
    const store = useProjectStore()
    const view = mountView()
    await view
      .findAll('button')
      .find((one) => one.text().includes('빈 양식'))
      ?.trigger('click')
    const before = store.file?.document.manifest.updatedAt

    // 픽스처가 만들어진 시각. 답을 쓰면 여기서 떠나 있어야 한다.
    const created = project().document.manifest.createdAt

    const box = view.find('textarea')
    await box.setValue('오늘 한 시간 동안 쓴 글이다')
    await box.trigger('input')

    const after = store.file?.document.manifest.updatedAt
    expect(store.file?.document.portfolio.answers).not.toEqual({})
    expect(after).not.toBe(created)
    expect(Date.parse(after!)).toBeGreaterThanOrEqual(Date.parse(before!))
  })
})

/**
 * **되보내는 부품이 같은 것을 보내는가** (mlpx-spec.md §8.5).
 *
 * `ui-rules.spec.ts`가 두 부품의 `pick` **선언**을 견주고 있는데, 선언을 그대로 두고
 * **되보내는 값만** 떨어뜨리면 저장소가 조용했다 - 그리고 그 결과는 2026-08-15에
 * 아이패드에서 만든 실물 파일이 `template.locale`을 잃은 것과 똑같다 (R14-1 감사 A-3).
 *
 * 그래서 여기서는 선언이 아니라 **실제로 흘려보낸 값**을 본다.
 */
describe('양식 메뉴는 받은 것을 그대로 되보낸다', () => {
  it('언어까지 함께 간다', async () => {
    const menu = mount(TemplateSourceMenu, {
      props: { pickFile: () => Promise.resolve(null) },
      global: { plugins: [i18n] },
    })
    await menu.find('button').trigger('click')

    const list = menu.findComponent(TemplateSourceList)
    expect(list.exists(), 'opening the popover attaches the list').toBe(true)
    list.vm.$emit('pick', '## 주제\n안내문\n', 'ko')
    await menu.vm.$nextTick()

    expect(menu.emitted('pick')).toEqual([['## 주제\n안내문\n', 'ko']])
  })
})

/**
 * 목차가 "지금 여기"를 말하는 판정 (`measure()` · `active` · `SectionIndex`).
 *
 * **잴 수 없다고 보고 접혔던 자리다.** jsdom에서 `getBoundingClientRect`가 0을
 * 돌려주는 것은 **스텁을 안 줘서지 못 줘서가 아니다** — `screen.spec.ts`가
 * `getComputedStyle`을 갈아 끼워 같은 결의 판정을 이미 잰다 (2026-08-31 사각 감사 A-3).
 *
 * `grep -rn "aria-current" tests/`가 0건이었다. 이 자리는 **이미 한 번 사용자에게
 * 잡혔다** — *"목차에서 8번을 눌렀는데 7번이 표시되던 것"*(2026-08-15).
 */
describe('목차는 지금 보고 있는 문항을 가리킨다', () => {
  /**
   * 앵커마다 `top`을 준다. 나머지 요소는 0을 그대로 준다.
   *
   * **`DOMRect`를 스프레드로 복사하면 빈 객체가 된다** - 값이 전부 프로토타입의
   * 게터라서다. 그러면 `top`이 `undefined`가 되고 비교가 `NaN`이 되어 **판정이
   * 언제나 한쪽으로 기운다.** 여기서 실제로 한 번 그렇게 헛돌았다.
   */
  function pretendScroll(tops: Record<string, number>): () => void {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function stub(this: Element): DOMRect {
      const top = tops[this.id] ?? 0
      return {
        top,
        bottom: top + 100,
        left: 0,
        right: 0,
        width: 0,
        height: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }
    }
    return () => {
      Element.prototype.getBoundingClientRect = original
    }
  }

  /**
   * 문항 하나짜리 양식을 세우고, 준 `top`으로 다시 재게 한 뒤 목차가 몇을
   * 가리키는지 센다.
   *
   * 둘을 조심해야 한다. **문서에 붙여야** `measure()`의 `getElementById`가 앵커를
   * 찾고, **프레임을 비워야** 스크롤이 실제로 다시 잰다 — `schedule()`이
   * `requestAnimationFrame`으로 미루므로 `nextTick`만으로는 마운트 때의 값이 남는다.
   */
  async function withSections(tops: (ids: string[]) => Record<string, number>) {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    // **문항이 셋이어야 순회가 뜻을 갖는다.** 하나면 비교 방향을 뒤집어도 결과가 같다.
    const file = project()
    const store = useProjectStore()
    store.file = {
      ...file,
      document: {
        ...file.document,
        portfolio: withImportedSections(file.document.portfolio, [
          { title: '첫 문항' },
          { title: '둘째 문항' },
          { title: '셋째 문항' },
        ]),
      },
    }
    const view = mount(PortfolioView, { global: { plugins: [i18n] }, attachTo: document.body })

    const sections = store.file!.document.portfolio.template.sections
    expect(sections.length, 'starts with three questions').toBe(3)
    const ids = sections.map((section) => `portfolio-section-${section.id}`)

    /**
     * **마운트 측정을 먼저 흘려보낸다.** 문항 목록이 서면 `watch`가 `nextTick`으로
     * 한 번 재는데, 그것을 안 흘리면 **아래 스크롤이 아니라 그 측정이 값을 만든다** —
     * 스케줄링을 통째로 죽여도 초록이었던 이유다 (2026-08-31 검증 감사 A-2).
     */
    const settle = pretendScroll(Object.fromEntries(ids.map((id) => [id, 5000])))
    await view.vm.$nextTick()
    await view.vm.$nextTick()
    settle()

    const restore = pretendScroll(tops(ids))
    try {
      // 여기부터가 스크롤 경로다 — 사건을 쏘고 프레임을 비워야 다시 잰다.
      window.dispatchEvent(new Event('scroll'))
      expect(frames.length, 'scrolling must schedule a frame').toBeGreaterThan(0)
      for (const frame of frames.splice(0)) frame(0)
      await view.vm.$nextTick()
      // 목차 줄은 번호와 상태를 함께 담는다. 어느 문항인가만 본다.
      return view.findAll('[aria-current]').map((one) => /[가-힣]+ 문항/.exec(one.text())?.[0])
    } finally {
      restore()
      vi.unstubAllGlobals()
    }
  }

  it('맨 위에서는 첫 문항을 가리킨다 - 아무것도 안 가리키면 안 된다', async () => {
    // 문항이 전부 선보다 아래다 - 순회가 곧장 멈춰 `current`가 `null`로 남는다.
    // 떨어지는 갈래가 없으면 목차가 아무것도 안 가리킨다.
    expect(await withSections((ids) => Object.fromEntries(ids.map((id) => [id, 5000])))).toEqual([
      '첫 문항',
    ])
  })

  it('선을 지난 마지막 문항을 가리킨다 - 그 아래는 아직 안 왔다', async () => {
    // 첫째와 둘째는 선 위로 지나갔고 셋째는 아직 아래다. 지금 보는 것은 둘째다.
    const active = await withSections((ids) => ({
      [ids[0]!]: -600,
      [ids[1]!]: -20,
      [ids[2]!]: 400,
    }))
    expect(active).toEqual(['둘째 문항'])
  })
})
