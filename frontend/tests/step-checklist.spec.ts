// @vitest-environment jsdom
/**
 * **체크리스트의 완료 판정** (2026-09-02 R24 B-8).
 *
 * `every`를 `some`으로 바꿔도 관문이 초록이었다. **여섯 화면이 전부 이 부품을 쓴다** —
 * 하나만 끝나도 "이 단계에서 할 일을 모두 마쳤습니다"가 뜬다는 뜻이고, 학생은 안 한
 * 일을 한 것으로 알고 다음 화면으로 간다.
 *
 * **잠금과 같은 사실에서 나온다** — 체크는 다 됐는데 다음 단계가 잠겨 있으면 학생이
 * 고칠 방법이 없다. 그래서 이 스펙은 사실을 손으로 만들지 않고 **프로젝트 파일을
 * 세워** 스토어가 세게 한다.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import StepChecklist from '../src/components/StepChecklist.vue'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { useProjectStore } from '../src/stores/project'
import { projectFile } from './fixtures/project'

const ALL_DONE = '이 단계에서 할 일을 모두 마쳤습니다.'

/** 타깃과 특성 중 무엇이 정해졌는지를 바꾼 표 프로젝트. */
function tabularWith({ features }: { features: string[] }): ProjectFile {
  const file = projectFile()
  return {
    ...file,
    document: {
      ...file.document,
      settings: { ...file.document.settings, data: { ...file.document.settings.data, features } },
    },
  }
}

function mountChecklist(file: ProjectFile) {
  useProjectStore().file = file
  return mount(StepChecklist, { props: { step: 'preprocess' }, global: { plugins: [i18n] } })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('R24 B-8: "all done" means all of them', () => {
  it('one of two done: the list stands and nothing says it is finished', () => {
    const wrapper = mountChecklist(tabularWith({ features: [] }))

    expect(wrapper.text()).toContain('타깃(Target) 선택하기')
    expect(wrapper.text()).toContain('특성(Feature) 선택하기')
    // 끝난 것 하나에 체크가 있고, 안 끝난 것 하나에 빈 칸이 있다.
    expect(wrapper.text()).toContain('☑')
    expect(wrapper.text()).toContain('☐')
    expect(wrapper.text()).not.toContain(ALL_DONE)
  })

  it('both done: it says so', () => {
    const wrapper = mountChecklist(tabularWith({ features: ['꽃받침'] }))

    expect(wrapper.text()).not.toContain('☐')
    expect(wrapper.text()).toContain(ALL_DONE)
  })
})
