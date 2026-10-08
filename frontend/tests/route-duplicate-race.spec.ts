// @vitest-environment jsdom
/**
 * **화면을 받는 사이에 지금 칸을 다시 눌러도 앞 이동은 아무것도 안 한다** (0.35.2 경계 감사 A A-1).
 *
 * 지금 주소로 가는 이동은 vue-router가 가드를 안 돌리고 중복(DUPLICATED)으로 접는다. 그래도 받는 중이던 앞 이동은
 * vue-router 쪽에서 버려진다 — 그런데 우리 가드의 차례는 가드가 돌 때만 오르므로, 앞 이동이 버려진 줄 모르고
 * 끝까지 돌아 프로젝트를 닫거나 연다. 레일의 지금 칸과 도구 막대의 목록 링크는 지금 주소로도 눌린다.
 *
 * **진짜 입구로 잰다** — 실제 라우터를 태우고, 느린 청크는 그 화면 모듈의 `import()`가 손잡이를 기다리게 한다.
 * 화면 모듈은 처음 받을 때만 기다리므로 **검사마다 다른 화면의 손잡이를 쓴다**(`route-chunk-race.spec.ts`와 같다).
 */
import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'

import { setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { manifest, projectFile } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

const gates = vi.hoisted(() => {
  function gate(): { arrived: Promise<void>; open: () => void; requested: boolean } {
    let open: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      open = resolve
    })
    // `requested`는 라우터가 이 청크를 부른 순간 선다 — 검사는 시간 대신 이것을 기다린다.
    return { arrived, open: () => open(), requested: false }
  }
  return { inspect: gate(), home: gate() }
})

/** 빈 화면. 느린 것은 받는 일이지 화면이 아니다. */
const blank = { default: { render: () => null } }

vi.mock('../src/views/InspectView.vue', async () => {
  gates.inspect.requested = true
  await gates.inspect.arrived
  return blank
})
vi.mock('../src/views/ProjectHomeView.vue', async () => {
  gates.home.requested = true
  await gates.home.arrived
  return blank
})
vi.mock('../src/views/DataView.vue', () => blank)

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  await router.replace('/')
  closeStorage()
  await resetDatabase()
})

describe('화면을 받는 사이 지금 칸을 다시 누른다', { timeout: 20_000 }, () => {
  it('점검 화면을 받는 사이 지금 단계를 다시 누르면 프로젝트는 열린 채다', async () => {
    await saveProject(projectFile())
    const here = `/project/${manifest.projectId}/data`
    await router.push(here)
    const project = useProjectStore()
    expect(project.projectId).toBe(manifest.projectId)

    // 앞 이동: 점검(프로젝트를 떠난다). 청크가 아직 안 왔다.
    const first = router.push('/inspect').catch(() => undefined)
    await vi.waitFor(() => expect(gates.inspect.requested).toBe(true))
    // 레일의 지금 칸 — 가드를 안 도는 중복 이동이다.
    const again = await router.push(here)
    expect(isNavigationFailure(again, NavigationFailureType.duplicated)).toBe(true)

    gates.inspect.open()
    await first

    expect(router.currentRoute.value.fullPath).toBe(here)
    expect(project.projectId, 'the abandoned move must not close the project').toBe(
      manifest.projectId,
    )
  })

  it('프로젝트 첫 화면을 받는 사이 목록을 다시 누르면 프로젝트가 안 열린다', async () => {
    await saveProject(projectFile())
    const project = useProjectStore()

    // 앞 이동: 목록에서 프로젝트로. 청크가 아직 안 왔다.
    const first = router.push(`/project/${manifest.projectId}`).catch(() => undefined)
    await vi.waitFor(() => expect(gates.home.requested).toBe(true))
    // 도구 막대의 목록 링크 — 지금 주소라 중복 이동이다.
    const again = await router.push('/')
    expect(isNavigationFailure(again, NavigationFailureType.duplicated)).toBe(true)

    gates.home.open()
    await first

    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(project.projectId, 'the abandoned move must not open the project').toBeNull()
  })
})
