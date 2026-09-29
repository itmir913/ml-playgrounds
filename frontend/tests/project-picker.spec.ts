// @vitest-environment jsdom
/**
 * **저장된 프로젝트 목록의 열기 잠금** (2026-09-02 R24 B-7).
 *
 * 판정을 **뒤집어도**(읽을 수 있는 줄을 잠그고 못 읽는 줄을 열어) 관문이 초록이었다.
 * `welcome-fail`·`newproject` 스펙이 이 부품을 그리기는 해도 **목록의 줄을 안 누른다.**
 * 학생이 잃는 것: 가정 PC에서 저장된 프로젝트를 못 연다.
 *
 * **이유가 둘이라는 것이 이 부품의 요점이다** (`architecture.md` §10) — 못 읽는 줄과
 * 파일을 여는 동안 잠긴 줄은 다른 사유이고, 둘을 `||`로 이으면 화면에서 그 구분이
 * 사라진다. 그래서 잠긴 것만이 아니라 **뭐라고 말하는지**까지 잰다.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectPicker from '../src/components/ProjectPicker.vue'
import { i18n, setLocale } from '../src/i18n'
import { issueBusyLock } from '../src/locks'
import type { ProjectSummary } from '../src/project/storage'

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    projectId: 'readable-1',
    name: '붓꽃 품종 분류',
    taskType: 'classification',
    updatedAt: '2026-09-02T09:00:00.000Z',
    sizeBytes: 1024,
    readable: true,
    ...overrides,
  }
}

const SUMMARIES: readonly ProjectSummary[] = [
  summary(),
  summary({ projectId: 'broken-1', name: '깨진 것', readable: false }),
]

/** 줄의 이름 자리 단추들. 첫 단추는 목록을 여는 것이라 뺀다. */
function rows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('li button[class*="flex-1"]')
}

beforeEach(async () => {
  await setLocale('ko')
})

describe('R24 B-7: opening a saved project', () => {
  /**
   * **못 읽는 줄은 잠그지 않는다** (`open-decisions.md` 65 ②). 누르면 열기가 실패를 알린다 —
   * 그 알림은 화면을 띄워 재는 `welcome-fail.spec.ts`의 *"못 읽는 줄을 누르면 …"*이 문다.
   */
  it('both rows open; the unreadable one keeps its label and is not locked', async () => {
    const wrapper = mount(ProjectPicker, {
      props: { summaries: SUMMARIES },
      global: { plugins: [i18n] },
    })
    const [readable, broken] = rows(wrapper)

    expect(readable?.attributes('disabled')).toBeUndefined()
    expect(readable?.text()).toContain('붓꽃 품종 분류')
    await readable?.trigger('click')
    expect(wrapper.emitted('open')).toEqual([['readable-1']])

    // **못 읽는 줄도 목록에 남는다** — 빼면 학생 눈에는 프로젝트가 사라진 것이다.
    expect(broken?.text()).toContain('열 수 없는 프로젝트')
    expect(broken?.attributes('disabled')).toBeUndefined()
    await broken?.trigger('click')
    expect(wrapper.emitted('open')).toEqual([['readable-1'], ['broken-1']])
  })

  it('while a file is opening every row is locked, and it says so', async () => {
    const wrapper = mount(ProjectPicker, {
      // 여는 중의 잠금은 작업 상태에서 온다(`useWork`) — 검사는 그 문을 직접 부른다.
      props: { summaries: SUMMARIES, lock: issueBusyLock(true) },
      global: { plugins: [i18n] },
    })

    for (const row of rows(wrapper)) {
      expect(row.attributes('disabled')).toBeDefined()
      // **이유 없는 회색은 학생에게 고장이다** (`docs/copy.md` §4).
      expect(row.attributes('title')).toBe('파일을 여는 중입니다.')
      await row.trigger('click')
    }
    expect(wrapper.emitted('open')).toBeUndefined()
  })
})

/**
 * **목록 판은 화면을 쓰고, 머리와 [닫기]는 굴러가지 않는다** (`open-decisions.md` 79, #35).
 *
 * jsdom에는 배치가 없어서 **실제로 95%가 되는지, 낮은 창에서 제목이 남는지는 여기서 못 잰다**
 * (사람 확인). 여기서 무는 것은 그 모양을 만드는 뼈대다 — 판이 옛 좁은 상한으로 돌아가는 것,
 * 굴리는 자리가 판 전체로 옮겨 제목과 [닫기]가 함께 밀려 올라가는 것, [닫기]가 판을 안 닫는 것.
 */
describe('decision 79: the saved-project panel uses the screen', () => {
  function mountPicker() {
    return mount(ProjectPicker, {
      props: { summaries: SUMMARIES },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
  }

  it('the panel reaches 95% of the screen and caps its width, not the old narrow box', () => {
    const wrapper = mountPicker()
    const panel = wrapper.find('[popover]')
    expect(panel.classes()).toEqual(expect.arrayContaining(['w-19/20', 'max-h-19/20', 'max-w-2xl']))
    expect(panel.classes()).not.toContain('max-w-lg')
    expect(wrapper.find('ul').classes()).not.toContain('max-h-96')
    wrapper.unmount()
  })

  it('only the list scrolls; the title and [close] stay outside it', () => {
    const wrapper = mountPicker()
    const panel = wrapper.find('[popover]')
    // 판 자신이 굴러가면 제목과 [닫기]가 함께 밀려 올라간다.
    expect(panel.classes()).not.toContain('overflow-y-auto')

    const scrollers = panel.findAll('.overflow-y-auto')
    expect(scrollers).toHaveLength(1)
    const scroller = scrollers[0]
    // **줄어드는 것은 목록 하나다** — 목록은 최소 높이를 풀고, 나머지 칸은 안 줄어든다.
    expect(scroller?.classes()).toContain('min-h-0')
    expect(scroller?.classes()).not.toContain('shrink-0')
    expect(scroller?.findAll('li')).toHaveLength(SUMMARIES.length)
    for (const child of panel.element.children) {
      if (child !== scroller?.element) expect(child.classList.contains('shrink-0')).toBe(true)
    }

    const title = panel.find('h3').element
    const close = panel.findAll('button').find((one) => one.text() === '닫기')
    expect(close, 'close button').toBeDefined()
    expect(scroller?.element.contains(title)).toBe(false)
    expect(close !== undefined && scroller?.element.contains(close.element)).toBe(false)
    wrapper.unmount()
  })

  it('[close] hides the panel', async () => {
    const wrapper = mountPicker()
    const panel = wrapper.find('[popover]').element
    const hide = vi.fn()
    Object.defineProperty(panel, 'hidePopover', { value: hide, configurable: true })

    const close = wrapper.findAll('button').find((one) => one.text() === '닫기')
    expect(close, 'close button').toBeDefined()
    await close?.trigger('click')
    expect(hide).toHaveBeenCalledTimes(1)
    // 닫는 것뿐이다. 줄을 연 것이 아니다.
    expect(wrapper.emitted('open')).toBeUndefined()
    wrapper.unmount()
  })
})
