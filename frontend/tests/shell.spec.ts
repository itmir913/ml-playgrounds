// @vitest-environment jsdom
// 셸을 실제로 mount해서 그려진 것을 본다.
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
      { path: '/project/:projectId', name: 'project', component: { template: '<div />' } },
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

  it('주소가 아직 목록인데 프로젝트가 열려 있어도 던지지 않는다', async () => {
    // 라우터 가드가 프로젝트를 여는 그 순간이 정확히 이 상태다 - 스토어에는 있고
    // 주소는 아직 옛것이다. 링크를 route.params로 만들면 여기서 RouterLink가
    // "Missing required param"으로 던지고, 레일이 깨지면 화면 전체가 갱신을 멈춘다.
    useProjectStore().file = projectFile()

    const router = stubRouter()
    await router.push('/')
    await router.isReady()

    const rail = mount(StepRail, { global: { plugins: [router, i18n] } })
    // 단계 여섯에 프로젝트 홈 하나가 더 있다.
    const links = rail.findAll('a')
    expect(links).toHaveLength(STEP_IDS.length + 1)
    // 링크는 스토어가 아는 프로젝트를 가리킨다.
    for (const link of links) {
      expect(link.attributes('href')).toContain(projectFile().document.manifest.projectId)
    }
  })

  it('프로젝트가 없으면 어디로도 못 간다', async () => {
    const rail = await mountRail()
    expect(rail.findAll('a')).toHaveLength(0)
  })

  it('갖춰진 프로젝트는 여섯 곳이 전부 열린다', async () => {
    useProjectStore().file = projectFile()
    const rail = await mountRail()
    expect(rail.findAll('a')).toHaveLength(STEP_IDS.length + 1)
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

/**
 * 붙박이 바가 자기 높이를 문서 루트에 내놓고 **떠날 때 지운다**.
 *
 * 소스 주석이 *"화면 하나에 바는 하나뿐이고 떠날 때 지운다"*고 그 정리를 못 박아
 * 두었는데, `removeProperty` 한 줄을 지워도 저장소 전체가 조용했다 —
 * **`shell.spec.ts`가 이 부품을 실제로 마운트하는데도** 그랬다
 * (2026-08-31 사각 감사 A-4).
 *
 * 안 지우면 그 값이 문서에 남아 **다음 화면의 바닥 여백이 그만큼 밀린다.**
 * 눈으로만 보이는 종류라 더 나쁘다.
 */
describe('붙박이 바의 높이는 떠날 때 치운다', () => {
  const VAR = '--rail-bar-height'
  const value = () => document.documentElement.style.getPropertyValue(VAR)

  beforeEach(() => {
    document.documentElement.style.removeProperty(VAR)
  })

  it('서면 자기 높이를 내놓는다', async () => {
    await mountRail()
    expect(value()).not.toBe('')
  })

  it('떠나면 지운다 - 남으면 다음 화면이 그만큼 밀린다', async () => {
    const view = await mountRail()
    expect(value()).not.toBe('')

    view.unmount()

    expect(value()).toBe('')
  })
})
