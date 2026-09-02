// @vitest-environment jsdom
/**
 * **도구 막대의 프로젝트 이름** (2026-09-02 R24 B-9).
 *
 * **이 부품을 마운트하는 스펙이 0이었다.** 빈 이름 거부를 지워도 관문이 초록이었다.
 *
 * **다만 이름은 안 사라진다** — 감사자의 결과 서술은 반만 맞다. `withIdentity`가
 * *"이름이 비면 옛 이름을 지킨다"*를 이미 쥐고 있어(`project/identity.ts`), 화면의
 * 거부를 지워도 파일의 이름은 그대로다. **새는 것은 쓰기 자체다** — 아무 이름도 안
 * 정한 채 `update`가 돌면 `updatedAt`이 지금으로 찍히고, 저장된 프로젝트 목록이
 * 보여 주는 "마지막 저장"이 학생이 안 한 일을 한 것처럼 말한다.
 *
 * 그래서 여기서 재는 것은 **이름이 지켜지는가**와 **안 한 일이 안 찍히는가** 둘이다.
 * Esc는 되돌린다 — 잘못 눌러 이름을 지운 학생이 돌아갈 곳이 있어야 한다.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import ProjectName from '../src/components/ProjectName.vue'
import { i18n, setLocale } from '../src/i18n'
import { useProjectStore } from '../src/stores/project'
import { projectFile } from './fixtures/project'

async function open() {
  useProjectStore().file = projectFile()
  const wrapper = mount(ProjectName, { global: { plugins: [i18n] } })
  await wrapper.find('button').trigger('click')
  return wrapper
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('R24 B-9: the project keeps a name', () => {
  it('a new name is written', async () => {
    const wrapper = await open()
    await wrapper.find('input').setValue('무궁화 분류')
    await wrapper.find('input').trigger('keydown.enter')

    expect(useProjectStore().name).toBe('무궁화 분류')
  })

  it('an empty name is refused and the old one stands', async () => {
    const wrapper = await open()
    const before = useProjectStore().file?.document.manifest.updatedAt
    await wrapper.find('input').setValue('   ')
    await wrapper.find('input').trigger('keydown.enter')

    expect(useProjectStore().name).toBe('붓꽃 품종 분류')
    // **쓰기 자체가 안 일어난다.** 돌면 `updatedAt`이 지금으로 찍힌다.
    expect(useProjectStore().file?.document.manifest.updatedAt).toBe(before)
    // 편집은 끝난다 — 거부가 학생을 칸에 가두지는 않는다.
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('Esc puts the old name back', async () => {
    const wrapper = await open()
    await wrapper.find('input').setValue('실수로 지움')
    await wrapper.find('input').trigger('keydown.esc')

    expect(useProjectStore().name).toBe('붓꽃 품종 분류')
  })
})
