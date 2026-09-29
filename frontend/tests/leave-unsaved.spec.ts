// @vitest-environment jsdom
/**
 * **브라우저 저장이 실패한 채 프로젝트를 떠나면 멈추고 묻는다** (open-decisions.md 74).
 *
 * 쿼터로 저장이 실패한 뒤 목록이나 다른 프로젝트로 가면 라우터 가드가 알림만 띄우고 `close()`했다 —
 * 브라우저에도 파일에도 없는 편집이 메모리째 버려졌다(2026-09-28 감사 C/A-1). 이제 떠나는 이동은
 * 멈추고 확인 창(`LeaveGuard.vue`)이 [머무르기] / [파일로 저장] / [그래도 나가기]를 묻는다.
 *
 * **진짜 입구로 잰다** — 라우터를 실제로 태우고, 저장의 거절은 실제 쓰기가 던지는
 * `QuotaExceededError`다(`fixtures/storage-refusal.ts`). 판정은 메모리 상태라 저장소를 흉내 내지 않는다.
 *
 * **회귀도 잰다** — 저장이 성공하는 정상 상태에서는 묻지도, 탭 닫기에 경고하지도 않는다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import LeaveGuard from '../src/components/LeaveGuard.vue'
import { useUnloadWarning } from '../src/composables/useUnloadWarning'
import { i18n, setLocale } from '../src/i18n'
import { closeStorage, DB_NAME, loadProject, saveProject } from '../src/project/storage'
import { ROUTE_PROJECTS, router } from '../src/router'
import { useLeaveStore } from '../src/stores/leave'
import { useProjectStore } from '../src/stores/project'
import { stubDialogElement } from './fixtures/image-workers'
import { manifest, projectFile } from './fixtures/project'
import { refuseWrites } from './fixtures/storage-refusal'

const downloads: string[] = []

/**
 * **저장을 붙드는 손잡이.** `until`이 서 있으면 진짜 `saveProject`가 그것을 기다린 뒤 쓴다 — 쓰기가
 * 도는 사이에 다른 프로젝트를 여는 경합을 세운다. 저장 자체는 흉내 내지 않는다.
 */
const hold = vi.hoisted(() => ({ until: null as Promise<void> | null, entered: 0 }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (...args: Parameters<typeof actual.saveProject>) => {
      hold.entered += 1
      if (hold.until !== null) await hold.until
      return actual.saveProject(...args)
    },
  }
})

vi.mock('../src/project/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/download')>()
  return {
    ...actual,
    // jsdom에는 쓸 수 있는 객체 URL이 없다. 파일이 나갔다는 것만 센다.
    downloadBlob: (_blob: Blob, fileName: string) => {
      downloads.push(fileName)
    },
  }
})

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

let refusal: { restore: () => void } | null = null

beforeEach(async () => {
  window.scrollTo = () => {}
  downloads.length = 0
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  hold.until = null
  refusal?.restore()
  refusal = null
  useLeaveStore().stay()
  useProjectStore().close()
  await router.replace('/')
  closeStorage()
  await deleteDatabase()
})

/** 둘째 프로젝트. **실제로 열 수 있어야 한다** — 매니페스트 스키마가 `projectId`를 UUID로 받는다. */
const OTHER_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'

/** 저장된 두 프로젝트 중 첫째를 열고, 이름을 고친다(자동 저장은 아직 안 돌았다). */
async function openAndEdit(name: string): Promise<void> {
  await saveProject(projectFile())
  const other = projectFile()
  await saveProject({
    ...other,
    document: {
      ...other.document,
      manifest: { ...other.document.manifest, projectId: OTHER_ID, name: '다른 프로젝트' },
    },
  })
  await router.push(`/project/${manifest.projectId}/data`)
  const project = useProjectStore()
  expect(project.projectId).toBe(manifest.projectId)
  project.update((live) => ({
    ...live,
    document: { ...live.document, manifest: { ...live.document.manifest, name } },
  }))
}

/** 여기서부터 저장이 거절된다 — 가드의 flush가 실제 쓰기에서 `QuotaExceededError`를 받는다. */
function refuse(): void {
  refusal = refuseWrites()
}

describe('결정 74: 저장이 실패한 채 떠나는 이동', { timeout: 20_000 }, () => {
  it('목록으로 가려 하면 멈추고 묻는다 — 편집은 메모리에 남는다', async () => {
    await openAndEdit('저장 못 한 이름')
    refuse()

    await router.push({ name: ROUTE_PROJECTS })

    const project = useProjectStore()
    expect(router.currentRoute.value.name, 'the move must stop').toBe('data')
    expect(useLeaveStore().target).toBe('/')
    expect(project.name, 'the unsaved edit must survive').toBe('저장 못 한 이름')
    expect(project.stranded).toBe(true)
  })

  it('다른 프로젝트로 가려 해도 멈춘다', async () => {
    await openAndEdit('저장 못 한 이름')
    refuse()

    await router.push(`/project/${OTHER_ID}`)

    expect(router.currentRoute.value.params.projectId).toBe(manifest.projectId)
    expect(useLeaveStore().target).toBe(`/project/${OTHER_ID}`)
    expect(useProjectStore().name).toBe('저장 못 한 이름')
  })

  it('같은 프로젝트 안의 단계 이동은 통과한다', async () => {
    await openAndEdit('저장 못 한 이름')
    refuse()

    await router.push(`/project/${manifest.projectId}/preprocess`)

    expect(router.currentRoute.value.name).toBe('preprocess')
    expect(useLeaveStore().target).toBeNull()
    expect(useProjectStore().dirty).toBe(true)
  })

  it('파일로 내보낸 뒤에는 그냥 떠난다', async () => {
    await openAndEdit('내보낸 이름')
    refuse()
    const project = useProjectStore()
    await project.exportFile('# 정리\n')
    expect(downloads).toHaveLength(1)

    await router.push({ name: ROUTE_PROJECTS })

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    expect(useLeaveStore().target).toBeNull()
  })

  /** **내보낸 판에서 벗어나면 다시 묻는다** — 내보낸 뒤 고친 것은 파일에도 브라우저에도 없다. */
  it('내보낸 뒤 또 고치면 다시 멈춘다', async () => {
    await openAndEdit('내보낸 이름')
    refuse()
    const project = useProjectStore()
    await project.exportFile('# 정리\n')
    project.update((live) => ({
      ...live,
      document: { ...live.document, manifest: { ...live.document.manifest, name: '그 뒤 편집' } },
    }))

    await router.push({ name: ROUTE_PROJECTS })

    expect(router.currentRoute.value.name).toBe('data')
    expect(useLeaveStore().target).toBe('/')
  })

  /**
   * **내보내는 도중에 고친 것은 그 파일에 없다** (P 재검토 B-3). 파일을 쥔 뒤 만드는 사이에 편집이
   * 들어오면 지금 판은 내보낸 판이 아니므로 "내보냄"으로 세우면 안 된다(`exportFile`의
   * `file.value === current`).
   */
  it('내보내는 사이에 고친 것은 파일에 없으므로 여전히 멈춘다', async () => {
    await openAndEdit('쥔 판의 이름')
    refuse()
    const project = useProjectStore()

    const exporting = project.exportFile('# 정리\n')
    // 파일을 쥔 뒤, 만들어 내려보내기 전에 고친다.
    project.update((live) => ({
      ...live,
      document: {
        ...live.document,
        manifest: { ...live.document.manifest, name: '내보내는 중 편집' },
      },
    }))
    await exporting
    expect(downloads).toHaveLength(1)
    await vi.waitFor(() => expect(project.saveFailed).toBe(true))

    expect(project.stranded, 'the edit made while exporting is not in the file').toBe(true)
    await router.push({ name: ROUTE_PROJECTS })
    expect(router.currentRoute.value.name).toBe('data')
    expect(useLeaveStore().target).toBe('/')
  })

  it('저장이 다시 성공하면 그냥 떠난다', async () => {
    await openAndEdit('나중에 저장된 이름')
    refuse()
    await router.push({ name: ROUTE_PROJECTS })
    expect(useLeaveStore().target).toBe('/')
    useLeaveStore().stay()

    refusal?.restore()
    refusal = null
    await router.push({ name: ROUTE_PROJECTS })

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      '나중에 저장된 이름',
    )
  })

  it('저장이 성공하는 정상 상태에서는 묻지 않는다 (회귀)', async () => {
    await openAndEdit('정상 저장')

    await router.push({ name: ROUTE_PROJECTS })

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    expect(useLeaveStore().target).toBeNull()
  })

  /**
   * **[그래도 나가기]의 통과는 그 목적지에만 쓰인다** (P 검토 B-2, `useLeaveStore.consume`). 통과가
   * 다른 이동으로 새면 학생이 고르지 않은 곳으로 가며 편집을 버린다.
   */
  it('허락한 목적지와 다른 이동은 여전히 멈춘다', async () => {
    await openAndEdit('저장 못 한 이름')
    refuse()
    await router.push({ name: ROUTE_PROJECTS })
    const leave = useLeaveStore()
    expect(leave.target).toBe('/')

    // [그래도 나가기]가 '/'를 허락한 사이 다른 데로 먼저 간다.
    expect(leave.allow()).toBe('/')
    await router.push('/inspect')

    expect(router.currentRoute.value.name, 'a pass for "/" must not open "/inspect"').toBe('data')
    expect(leave.target).toBe('/inspect')
    expect(useProjectStore().name).toBe('저장 못 한 이름')
  })
})

/** 확인 창을 실제로 누른다 — 창은 앱 껍데기에 하나다(`App.vue`). */
describe('결정 74: 확인 창', { timeout: 20_000 }, () => {
  async function guard() {
    const wrapper = mount(LeaveGuard, { global: { plugins: [router, i18n] } })
    await flushPromises()
    return wrapper
  }

  function button(wrapper: Awaited<ReturnType<typeof guard>>, key: string) {
    const found = wrapper.findAll('button').find((one) => one.text() === i18n.global.t(key))
    expect(found, key).toBeDefined()
    return found!
  }

  it('멈춘 이동에서 창이 열리고, [그래도 나가기]는 그 목적지로 가며 편집을 버린다', async () => {
    await openAndEdit('버릴 이름')
    refuse()
    const wrapper = await guard()
    await router.push({ name: ROUTE_PROJECTS })
    await flushPromises()

    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    await button(wrapper, 'project.leaveAnyway').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS))

    expect(useProjectStore().projectId).toBeNull()
    expect(useLeaveStore().target).toBeNull()
    wrapper.unmount()
  })

  it('[머무르기]는 창만 닫고 그 자리에 남는다', async () => {
    await openAndEdit('남길 이름')
    refuse()
    const wrapper = await guard()
    await router.push({ name: ROUTE_PROJECTS })
    await flushPromises()

    await button(wrapper, 'project.leaveStay').trigger('click')
    await flushPromises()

    expect(useLeaveStore().target).toBeNull()
    expect(router.currentRoute.value.name).toBe('data')
    expect(useProjectStore().name).toBe('남길 이름')
    wrapper.unmount()
  })

  it('[파일로 저장]은 내보내고 머문다 — 다음 떠나기는 묻지 않는다', async () => {
    await openAndEdit('파일로 건질 이름')
    refuse()
    const wrapper = await guard()
    await router.push({ name: ROUTE_PROJECTS })
    await flushPromises()

    await button(wrapper, 'project.export').trigger('click')
    await vi.waitFor(() => expect(downloads).toHaveLength(1))
    await vi.waitFor(() => expect(useLeaveStore().target).toBeNull())
    expect(router.currentRoute.value.name).toBe('data')

    await router.push({ name: ROUTE_PROJECTS })
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    wrapper.unmount()
  })
})

/** 탭 닫기·새로고침은 가드를 안 지난다. 브라우저 기본 경고만 쓸 수 있다. */
describe('결정 74: 탭을 닫을 때', { timeout: 20_000 }, () => {
  const Host = defineComponent({
    setup() {
      useUnloadWarning()
      return () => h('div')
    },
  })

  function unload(): boolean {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('메모리에만 있는 편집이 있으면 경고한다', async () => {
    const host = mount(Host)
    await openAndEdit('닫으면 잃을 이름')
    refuse()
    await expect(useProjectStore().flush()).rejects.toThrow()

    expect(unload()).toBe(true)
    host.unmount()
  })

  it('미뤄 둔 저장을 기다리는 정상 상태에서는 경고하지 않는다 (회귀)', async () => {
    const host = mount(Host)
    await openAndEdit('곧 저장될 이름')
    expect(useProjectStore().dirty).toBe(true)

    expect(unload()).toBe(false)
    host.unmount()
  })

  /**
   * **저장이 다시 성공하면 실패 표지가 내려간다.** 안 내려가면 그 뒤의 평범한 편집(미뤄 둔 저장을
   * 기다리는 짧은 사이)마다 탭 닫기에 경고가 뜬다 — 정상 상태의 회귀다.
   */
  it('실패 뒤 저장이 다시 성공하면 다음 편집에는 경고하지 않는다 (회귀)', async () => {
    const host = mount(Host)
    await openAndEdit('한때 저장 못 한 이름')
    refuse()
    const project = useProjectStore()
    await expect(project.flush()).rejects.toThrow()
    refusal?.restore()
    refusal = null
    await project.flush()

    project.update((live) => ({
      ...live,
      document: { ...live.document, manifest: { ...live.document.manifest, name: '그다음 편집' } },
    }))
    expect(project.dirty).toBe(true)

    expect(unload()).toBe(false)
    host.unmount()
  })

  /**
   * **실패 표지는 그 프로젝트의 것이다** (P 검토 B-2). 저장이 실패한 프로젝트에서 [그래도 나가기]로
   * 다른 프로젝트를 열었는데 표지가 따라오면, 그 프로젝트의 평범한 편집(저장을 기다리는 사이)마다
   * 탭 닫기에 경고가 뜬다 — 정상 상태의 회귀다. `open()`이 표지를 내린다.
   */
  it('실패한 프로젝트에서 다른 프로젝트로 넘어가 편집하면 저장을 기다리는 사이 경고하지 않는다', async () => {
    const host = mount(Host)
    await openAndEdit('버리고 갈 이름')
    refuse()
    await router.push({ name: ROUTE_PROJECTS })
    const leave = useLeaveStore()
    expect(leave.target).toBe('/')
    leave.stay()
    await router.push(`/project/${OTHER_ID}`)
    const to = leave.allow()
    expect(to).toBe(`/project/${OTHER_ID}`)
    await router.push(to ?? '')
    refusal?.restore()
    refusal = null

    const project = useProjectStore()
    expect(project.projectId).toBe(OTHER_ID)
    project.update((live) => ({
      ...live,
      document: { ...live.document, manifest: { ...live.document.manifest, name: '새 편집' } },
    }))
    expect(project.dirty).toBe(true)

    expect(unload()).toBe(false)
    host.unmount()
  })

  /**
   * **늦게 실패한 옛 쓰기는 새 프로젝트에 표지를 세우지 않는다** (P 검토 B-2, `writeNow`의 세대 검사).
   * 쓰기가 도는 사이 다른 프로젝트가 열리고 그 뒤에 쓰기가 거절되면, 그 실패는 닫힌 프로젝트의 것이다.
   */
  it('쓰는 사이 다른 프로젝트가 열린 뒤 그 쓰기가 실패해도 새 프로젝트에 표지가 안 선다', async () => {
    await openAndEdit('붙든 쓰기의 이름')
    const project = useProjectStore()
    let release = (): void => {}
    hold.until = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = hold.entered
    const writing = project.flush().catch((error: unknown) => error)
    // **쓰기가 실제로 돌기 시작한 뒤에** 연다 — 라우터 가드처럼 쓰기의 차례가 온 다음이다.
    await vi.waitFor(() => expect(hold.entered).toBe(entered + 1))

    expect(await project.open(OTHER_ID)).toBe('opened')
    refuse()
    hold.until = null
    release()
    expect(await writing, 'the held write must fail').toBeInstanceOf(Error)

    expect(project.projectId).toBe(OTHER_ID)
    expect(project.saveFailed).toBe(false)
  })

  it('내보낸 뒤에는 경고하지 않는다', async () => {
    const host = mount(Host)
    await openAndEdit('내보낸 이름')
    refuse()
    await useProjectStore().exportFile('# 정리\n')
    await vi.waitFor(() => expect(useProjectStore().saveFailed).toBe(true))

    expect(unload()).toBe(false)
    host.unmount()
  })
})
