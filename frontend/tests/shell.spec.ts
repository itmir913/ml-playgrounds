/**
 * 셸이 실제로 그려지는지.
 *
 * 여기 있는 것들은 **눈으로만 보이는 결함**이라 순수 함수 테스트가 못 잡는다.
 * 언어를 바꿨는데 화면이 안 따라오거나, 열려 있어야 할 단계가 레일에 없거나 하는 것들이다.
 * 실제로 그 둘 다 일어났다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'

import StepRail from '../src/components/StepRail.vue'
import { i18n, setLocale } from '../src/i18n'
import { STEP_IDS } from '../src/router/steps'
import { useProjectStore } from '../src/stores/project'
import { emptyProjectFile, projectFile } from './fixtures/project'

/** 레일만 띄우면 되므로 라우트는 이름만 맞으면 된다. */
function stubRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'projects', component: { template: '<div />' } },
      ...STEP_IDS.map((step) => ({
        path: `/project/:projectId/${step}`,
        name: step,
        component: { template: '<div />' },
      })),
    ],
  })
}

async function mountRail() {
  const router = stubRouter()
  await router.push({ name: 'data', params: { projectId: 'p1' } })
  await router.isReady()
  return mount(StepRail, { global: { plugins: [router, i18n] } })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('단계 레일', () => {
  it('여섯 단계가 전부 있다 - 못 가는 것도 지우지 않는다', async () => {
    const rail = await mountRail()
    // 목록에서 사라지면 학생은 그런 단계가 있다는 것조차 모른다.
    expect(rail.findAll('a, span[aria-disabled]').length).toBeGreaterThanOrEqual(STEP_IDS.length)
  })

  it('프로젝트를 열면 데이터 단계로 갈 수 있다', async () => {
    // 만들자마자 데이터 화면이 뜨는데 레일에서 그 자리를 못 누르면 앞뒤가 안 맞는다.
    useProjectStore().file = emptyProjectFile()
    const rail = await mountRail()

    const links = rail.findAll('a')
    expect(links.some((link) => link.attributes('href')?.endsWith('/data'))).toBe(true)
  })

  it('프로젝트가 없으면 어디로도 못 간다', async () => {
    const rail = await mountRail()
    expect(rail.findAll('a')).toHaveLength(0)
  })

  it('갖춰진 프로젝트는 여섯 곳이 전부 열린다', async () => {
    useProjectStore().file = projectFile()
    const rail = await mountRail()
    expect(rail.findAll('a')).toHaveLength(STEP_IDS.length)
  })
})

describe('언어 바꾸기', () => {
  it('t()로 그린 글자가 즉시 따라온다', async () => {
    useProjectStore().file = projectFile()
    const rail = await mountRail()

    const korean = rail.text()
    await setLocale('en')
    await rail.vm.$nextTick()

    expect(rail.text()).not.toBe(korean)
    expect(rail.text()).toContain('Data')
  })

  it('<html lang>도 따라온다 - CJK 글꼴과 줄바꿈이 여기 달려 있다', async () => {
    await setLocale('en')
    expect(document.documentElement.lang).toBe('en')
    await setLocale('ko')
    expect(document.documentElement.lang).toBe('ko')
  })
})
