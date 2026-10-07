// @vitest-environment jsdom
/**
 * **[저장하지 않고 이동]으로 허락한 이동이 화면을 받는 사이 학생이 다른 데로 가면, 그 이동은 아무것도 안 한다** (R43-2 감사 C-6).
 *
 * 전역 가드는 화면을 받은 직후(`router/index.ts`의 첫 차례 검사)와 저장을 기다린 뒤(둘째 차례 검사) 버려진 이동을 접는다. 보통
 * 이동은 둘째 검사가 첫째를 대신 잡지만, **허락받은 이동(`leave.consume`)은 저장 블록을 건너뛰어** 둘째 검사를 안 지난다 — 첫째
 * 검사가 없으면 버려진 이동의 `close()`가 학생이 머문 프로젝트를 닫는다. 그 갈래에 검사가 없었다(첫째 검사를 지워도 라우터 관련
 * 55개가 초록이었다).
 *
 * **진짜 라우터를 태운다.** 확인 창의 단추 대신 `useLeaveStore`의 `ask`·`allow`로 허락을 세운다 — 단추가 하는 일이 그 둘이다
 * (`components/LeaveGuard.vue`의 `leaveAnyway`).
 */
import 'fake-indexeddb/auto'

import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useLeaveStore } from '../src/stores/leave'
import { useProjectStore } from '../src/stores/project'
import { manifest, projectFile } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

const gate = vi.hoisted(() => {
  let open: () => void = () => {}
  const arrived = new Promise<void>((resolve) => {
    open = resolve
  })
  return { arrived, open: () => open(), requested: false }
})

const blank = { default: { render: () => null } }

vi.mock('../src/views/InspectView.vue', async () => {
  gate.requested = true
  await gate.arrived
  return blank
})
vi.mock('../src/views/DataView.vue', () => blank)
vi.mock('../src/views/PreprocessView.vue', () => blank)

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
  useLeaveStore().forget()
  await router.replace('/')
  closeStorage()
  await resetDatabase()
})

describe('허락한 이동이 화면을 받는 사이의 두 번째 이동', { timeout: 20_000 }, () => {
  it('허락받고 점검으로 가는 사이 같은 프로젝트의 다른 단계로 가면 프로젝트는 열린 채다', async () => {
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}/data`)
    const project = useProjectStore()
    expect(project.projectId).toBe(manifest.projectId)

    // [저장하지 않고 이동]이 하는 일 — 목적지를 세우고 한 번 통과시킨다.
    const leave = useLeaveStore()
    leave.ask('/inspect')
    expect(leave.allow()).toBe('/inspect')

    const first = router.push('/inspect').catch(() => undefined)
    await vi.waitFor(() => expect(gate.requested).toBe(true))
    await router.push(`/project/${manifest.projectId}/preprocess`)
    expect(router.currentRoute.value.name).toBe('preprocess')

    gate.open()
    await first
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('preprocess')
    expect(project.projectId, 'the abandoned allowed move closed the project').toBe(
      manifest.projectId,
    )
  })
})
