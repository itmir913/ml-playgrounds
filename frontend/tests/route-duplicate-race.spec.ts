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
import { useToastStore } from '../src/stores/toasts'
import { experiment, manifest, projectFile, run } from './fixtures/project'
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
  return { inspect: gate(), home: gate(), results: gate() }
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
vi.mock('../src/views/ResultsView.vue', async () => {
  gates.results.requested = true
  await gates.results.arrived
  return blank
})
vi.mock('../src/views/DataView.vue', () => blank)
vi.mock('../src/views/PredictView.vue', () => blank)

/**
 * **프로젝트 읽기를 붙드는 손잡이.** `hold`가 서 있으면 진짜 `loadProject`가 그것을 기다린 뒤 읽는다 — 열기가 도는 사이를
 * 세운다. 스토어가 `loadProject`를 이름으로 들여 놓아 스파이로는 안 보이므로 모듈을 간다(`project-open-cancel.spec.ts`와 같다).
 */
const reads = vi.hoisted(() => ({ hold: null as Promise<void> | null, entered: 0 }))
vi.mock('../src/project/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...real,
    loadProject: async (...args: Parameters<typeof real.loadProject>) => {
      reads.entered += 1
      if (reads.hold !== null) await reads.hold
      return real.loadProject(...args)
    },
  }
})

/** 모델이 예산에서 밀린 프로젝트 — 예측 단계가 잠겨, 주소로 가면 결과로 리다이렉트한다(결정 65). */
async function lockedPredictProject(): Promise<void> {
  const base = projectFile()
  const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
  await saveProject({
    ...base,
    document: { ...base.document, runs: { experiments: [experiment('experiment-1', [omitted])] } },
  })
}

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
  reads.hold = null
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
    // 학생이 아직 안 읽은 실패 알림 — 중복 이동은 화면을 안 떠나므로 남아야 한다(open-decisions.md 109, 0.35.3 최종 감사 C-1).
    useToastStore().push('danger', 'client.DATASET_PARSE_FAILED')

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
    expect(
      useToastStore().items.map((one) => one.key),
      'a duplicate move stays on the screen and keeps its notice',
    ).toEqual(['client.DATASET_PARSE_FAILED'])
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

  /**
   * **여는 사이에 눌러도 같다** (0.35.2 경계 감사 고침 라운드 A-1). 가드는 열기 뒤에 열기가 취소됐을 때만 차례를 보는데,
   * 중복 이동은 `close()`도 다음 열기도 안 불러 열기가 끝까지 `opened`로 돌아온다 — 목록 화면에 프로젝트가 열린 채
   * 남고 탭 잠금까지 쥔다.
   */
  it('프로젝트를 여는 사이 목록을 다시 누르면 프로젝트가 안 열린다', async () => {
    await saveProject(projectFile())
    const project = useProjectStore()
    let release = (): void => {}
    reads.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = reads.entered

    const first = router.push(`/project/${manifest.projectId}/data`).catch(() => undefined)
    await vi.waitFor(() => expect(reads.entered).toBe(entered + 1))
    const again = await router.push('/')
    expect(isNavigationFailure(again, NavigationFailureType.duplicated)).toBe(true)

    release()
    await first

    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(project.projectId, 'the abandoned open must not stay open').toBeNull()
  })

  /**
   * **리다이렉트의 둘째 통과가 받는 사이에 눌러도 같다** (같은 라운드). 첫 통과가 이미 프로젝트를 열고 잠긴 단계에서
   * 결과로 돌렸다 — 둘째 통과는 차례를 보고 접히지만 첫 통과가 연 것은 아무도 안 닫는다.
   */
  it('잠긴 단계에서 돌려진 화면을 받는 사이 목록을 다시 누르면 프로젝트가 안 열린다', async () => {
    await lockedPredictProject()
    const project = useProjectStore()

    const first = router.push(`/project/${manifest.projectId}/predict`).catch(() => undefined)
    await vi.waitFor(() => expect(gates.results.requested).toBe(true))
    expect(project.projectId, 'the first pass opened the project').toBe(manifest.projectId)
    const again = await router.push('/')
    expect(isNavigationFailure(again, NavigationFailureType.duplicated)).toBe(true)

    gates.results.open()
    await first

    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(project.projectId, 'the redirected move must not leave the project open').toBeNull()
  })
})
