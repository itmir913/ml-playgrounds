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
import { beforeEach, describe, expect, it } from 'vitest'

import ProjectPicker from '../src/components/ProjectPicker.vue'
import { i18n, setLocale } from '../src/i18n'
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
  it('the readable row opens and the unreadable one is locked with a reason', async () => {
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
    expect(broken?.attributes('disabled')).toBeDefined()
    expect(broken?.attributes('title')).toBe('열 수 없는 프로젝트')
    await broken?.trigger('click')
    expect(wrapper.emitted('open')).toEqual([['readable-1']])
  })

  it('while a file is opening every row is locked, and it says so', async () => {
    const wrapper = mount(ProjectPicker, {
      props: { summaries: SUMMARIES, disabled: true },
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
