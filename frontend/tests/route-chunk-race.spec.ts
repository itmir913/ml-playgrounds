// @vitest-environment jsdom
/**
 * **화면을 받는 사이에 다른 데로 가면 앞 이동은 아무것도 안 한다** (architecture.md §8.1).
 *
 * 전역 가드는 저장·닫기·열기 전에 가는 화면을 받는다(`route-chunk-failure.spec.ts`). 받기는 학교 회선에서
 * 몇 초가 걸릴 수 있고, 그 사이 학생이 레일의 다른 칸을 누르면 뒤 이동이 먼저 끝난다. 앞 이동은 이미
 * 버려졌는데 가드가 이어 돌면 **뒤 이동이 연 프로젝트를 앞 이동의 `close()`가 닫는다** — 화면은 학습인데
 * 스토어가 비었다.
 *
 * **진짜 입구로 잰다** — 실제 라우터를 태우고, 느린 청크는 그 화면 모듈의 `import()`가 손잡이를 기다리게 한다.
 */
import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { NavigationFailureType, type NavigationFailure } from 'vue-router'

import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { manifest, projectFile } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

/**
 * 청크가 도착하는 순간. 풀기 전까지 `import()`가 기다리고, `fail`이면 청크를 못 받은 원문으로 거절된다.
 * **검사마다 제 손잡이를 쓴다** — 순서를 섞어 돌려도 앞 검사가 연 손잡이 때문에 뒤 검사의 청크가 이미
 * 와 있거나 이미 실패해 있는 일이 없다.
 */
const gates = vi.hoisted(() => {
  function gate(): {
    arrived: Promise<void>
    open: () => void
    fail: () => void
    requested: boolean
  } {
    let open: () => void = () => {}
    let fail: () => void = () => {}
    const arrived = new Promise<void>((resolve, reject) => {
      open = resolve
      fail = () => {
        reject(new TypeError('Failed to fetch dynamically imported module: /assets/Gone-1a2b3c.js'))
      }
    })
    // `requested`는 라우터가 이 청크를 부른 순간 선다 — 검사는 시간 대신 이것을 기다린다.
    return { arrived, open: () => open(), fail: () => fail(), requested: false }
  }
  return { inspect: gate(), results: gate(), portfolio: gate(), predict: gate() }
})

/** 다음 popstate 한 번. jsdom은 `history.back()`의 popstate를 비동기로 보낸다 — 시간 대신 이것을 기다린다. */
function popstate(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })
}

/** 빈 화면. 느린 것은 받는 일이지 화면이 아니다. */
const blank = { default: { render: () => null } }

vi.mock('../src/views/InspectView.vue', async () => {
  await gates.inspect.arrived
  return blank
})
vi.mock('../src/views/ResultsView.vue', async () => {
  gates.results.requested = true
  await gates.results.arrived
  return blank
})
vi.mock('../src/views/PortfolioView.vue', async () => {
  gates.portfolio.requested = true
  await gates.portfolio.arrived
  return blank
})
vi.mock('../src/views/PredictView.vue', async () => {
  gates.predict.requested = true
  await gates.predict.arrived
  return blank
})
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
  await router.replace('/')
  closeStorage()
  await resetDatabase()
})

describe('화면을 받는 사이의 두 번째 이동', { timeout: 20_000 }, () => {
  it('점검 화면을 받는 사이 같은 프로젝트의 다른 단계로 가면 프로젝트는 열린 채다', async () => {
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}/data`)
    const project = useProjectStore()
    expect(project.projectId).toBe(manifest.projectId)

    // 앞 이동: 점검(프로젝트를 떠난다). 청크가 아직 안 왔다.
    const first = router.push('/inspect').catch(() => undefined)
    await flushPromises()
    // 뒤 이동: 같은 프로젝트의 전처리. 먼저 끝난다.
    await router.push(`/project/${manifest.projectId}/preprocess`)
    expect(router.currentRoute.value.name).toBe('preprocess')

    // 이제 점검의 청크가 도착한다 — 버려진 이동이다.
    gates.inspect.open()
    await first
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('preprocess')
    expect(project.projectId, 'the abandoned move must not close the project').toBe(
      manifest.projectId,
    )
  })

  /**
   * **접힌 이동은 취소(CANCELLED)로 끝나야 한다** (N4 검토 B-1). 가드가 `false`를 돌려주면 ABORTED가 되고,
   * 그 이동이 [뒤로]에서 왔으면 vue-router가 주소를 되돌리려 `history.go`를 부른다 — 되돌아갈 칸이 없어
   * 리스너의 멈춤이 남고 **다음 [뒤로]가 삼켜져 주소와 화면이 갈린다.** 새로고침 뒤 [뒤로]로 아직 안 받은
   * 화면에 가는 동안 다른 곳을 누르면 난다.
   */
  it('뒤로 가기로 가던 화면을 받는 사이 다른 데로 가면 그 이동은 취소로 끝나고 다음 뒤로 가기가 산다', async () => {
    await saveProject(projectFile())
    const id = manifest.projectId
    await router.push(`/project/${id}/data`)
    // 새로고침 뒤처럼 — 결과 화면을 이 탭에서 받은 적 없이 기록에만 둔다.
    const position = (window.history.state as { position: number }).position
    window.history.pushState(
      {
        back: `/project/${id}/data`,
        current: `/project/${id}/results`,
        forward: null,
        position: position + 1,
        replaced: false,
        scroll: null,
      },
      '',
      `#/project/${id}/results`,
    )
    await router.push(`/project/${id}/preprocess`)
    const failures: (NavigationFailure | undefined)[] = []
    const stop = router.afterEach((to, _from, failure) => {
      if (to.name === 'results') failures.push(failure ?? undefined)
    })

    // [뒤로] — 결과 화면의 청크를 라우터가 부를 때까지 기다린다(아직 안 왔다). 그 사이 목록을 누른다.
    const back = popstate()
    window.history.back()
    await back
    await vi.waitFor(() => expect(gates.results.requested).toBe(true))
    await router.push('/')
    gates.results.open()
    await vi.waitFor(() => expect(failures).toHaveLength(1))
    stop()

    // 둘을 다 보인다 — 종류가 틀리면 다음 [뒤로]도 갈린다(돌연변이로 둘 다 운다). 중단(ABORTED)이면
    // vue-router가 `history.go`를 부르는데 되돌아갈 칸이 없어 popstate도 안 온다 — 기다릴 사건이 없으므로
    // 그 부름을 기다리지 않는다. 남는 것은 리스너의 멈춤이고, 아래 [뒤로]가 그것을 드러낸다.
    expect
      .soft(failures[0]?.type, 'an abandoned move must end as cancelled, not aborted')
      .toBe(NavigationFailureType.cancelled)

    // 다음 [뒤로]가 산다 — 주소와 화면이 같은 곳에 닿는다.
    const next = popstate()
    window.history.back()
    await next
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath, 'the address and the screen must agree').toBe(
        window.location.hash.slice(1),
      ),
    )
  })

  /**
   * **버려진 이동의 청크가 실패해도 같다** (2026-09-30 감사 a3 A-1). 실패 갈래가 차례를 보기 전에 알림을 밀고
   * `false`를 돌려주면, 학생이 이미 떠난 화면의 실패가 새 화면에 남고 [뒤로]에서 온 이동은 중단(ABORTED)이
   * 되어 다음 [뒤로]를 삼킨다.
   */
  it('뒤로 가기로 가던 화면을 받는 사이 다른 데로 갔고 그 청크가 실패해도 취소로 끝나고 알림이 없고 다음 뒤로 가기가 산다', async () => {
    await saveProject(projectFile())
    const id = manifest.projectId
    await router.push(`/project/${id}/data`)
    // 새로고침 뒤처럼 — 포트폴리오 화면을 이 탭에서 받은 적 없이 기록에만 둔다.
    const position = (window.history.state as { position: number }).position
    window.history.pushState(
      {
        back: `/project/${id}/data`,
        current: `/project/${id}/portfolio`,
        forward: null,
        position: position + 1,
        replaced: false,
        scroll: null,
      },
      '',
      `#/project/${id}/portfolio`,
    )
    await router.push(`/project/${id}/preprocess`)
    const failures: (NavigationFailure | undefined)[] = []
    const stop = router.afterEach((to, _from, failure) => {
      if (to.name === 'portfolio') failures.push(failure ?? undefined)
    })

    const back = popstate()
    window.history.back()
    await back
    await vi.waitFor(() => expect(gates.portfolio.requested).toBe(true))
    await router.push('/')
    gates.portfolio.fail()
    await vi.waitFor(() => expect(failures).toHaveLength(1))
    stop()

    expect
      .soft(failures[0]?.type, 'an abandoned move must end as cancelled, not aborted')
      .toBe(NavigationFailureType.cancelled)
    expect
      .soft(
        useToastStore().items.map((toast) => toast.key),
        'an abandoned move must not leave a failure notice',
      )
      .toEqual([])

    const next = popstate()
    window.history.back()
    await next
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath, 'the address and the screen must agree').toBe(
        window.location.hash.slice(1),
      ),
    )
  })

  it('누른 이동이 화면을 받는 사이 다른 데로 갔고 그 청크가 실패해도 알림이 없다', async () => {
    await saveProject(projectFile())
    const id = manifest.projectId
    await router.push(`/project/${id}/data`)

    const first = router.push(`/project/${id}/predict`).catch(() => undefined)
    await vi.waitFor(() => expect(gates.predict.requested).toBe(true))
    await router.push(`/project/${id}/preprocess`)
    gates.predict.fail()
    await first

    expect(router.currentRoute.value.name).toBe('preprocess')
    expect(
      useToastStore().items.map((toast) => toast.key),
      'an abandoned move must not leave a failure notice',
    ).toEqual([])
  })
})
