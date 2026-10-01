// @vitest-environment jsdom
/**
 * **화면 청크를 못 받은 이동은 아무것도 바꾸지 않고 말한다.**
 *
 * 라우트의 화면은 첫 화면(`/`)을 빼고 전부 지연 로딩이다(`router/index.ts`의 `STEP_VIEWS`, `architecture.md` §7.4.1). 배포 뒤 열어 둔 옛 탭은 옛 해시의
 * 청크를 부르고 그것은 이제 없다 — `import()`가 거절된다. 오프라인이 된 탭도 같다. vue-router는 전역
 * `beforeEach`를 **다 돈 뒤에** 화면을 받으므로, 가드가 프로젝트를 닫거나(`close()`) 갈아 끼운(`open()`)
 * 다음에 이동이 실패하면 **화면은 옛 프로젝트인데 스토어는 비었거나 다른 프로젝트**가 된다 — 그 화면에서
 * 고친 것은 아무 데도 안 가거나 다른 프로젝트에 앉는다. 그리고 이동은 말없이 선다.
 *
 * **진짜 입구로 잰다** — 실제 라우터를 태우고, 청크 실패는 그 화면 모듈을 들이는 `import()`가 던지게 한다
 * (네트워크를 막는 대신 모듈 흉내가 거절한다).
 */
import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { manifest, projectFile } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

/**
 * 배포 뒤 옛 탭이 부르는 없는 청크. 브라우저가 내는 것과 같은 문장으로 거절한다.
 *
 * **팩터리에서 곧장 던지지 않는다** — 그러면 vitest가 자기 문장으로 감싸 원문이 안 보인다. 모듈은 돌려주고
 * 화면(`default`)을 꺼내는 순간 던지게 해서, 라우터가 받는 거절이 브라우저의 것과 같은 문장이 되게 한다.
 */
function missingChunk(): { readonly default: never } {
  return {
    get default(): never {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/gone.js')
    },
  }
}

vi.mock('../src/views/InspectView.vue', () => missingChunk())
vi.mock('../src/views/ProjectHomeView.vue', () => missingChunk())
vi.mock('../src/views/PredictView.vue', () => missingChunk())

/**
 * **잠금을 잡으려 한 프로젝트를 센다.** jsdom에는 잠글 수단이 없어 진짜 잠금은 늘 "열린다"를 준다
 * (`tab-lock.ts` "잠그지 못하는 환경에서는 연다") — 쥐었는지를 결과로는 못 재므로 잡으러 간 것을 잰다.
 */
const claimed = vi.hoisted(() => [] as string[])
vi.mock('../src/project/tab-lock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/tab-lock')>()
  return {
    ...actual,
    acquireTabLock: (id: string) => {
      claimed.push(id)
      return actual.acquireTabLock(id)
    },
  }
})

/** 둘째 프로젝트. 매니페스트 스키마가 `projectId`를 UUID로 받는다. */
const OTHER_ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'

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

async function seedTwo(): Promise<void> {
  await saveProject(projectFile())
  const other = projectFile()
  await saveProject({
    ...other,
    document: {
      ...other.document,
      manifest: { ...other.document.manifest, projectId: OTHER_ID, name: '다른 프로젝트' },
    },
  })
}

/** 이동을 부르고 거절돼도 삼킨다 — 학생의 클릭(`void router.push`)과 같은 모양이다. */
async function tryPush(to: string): Promise<void> {
  await router.push(to).catch(() => undefined)
}

describe('화면 청크를 못 받은 이동', { timeout: 20_000 }, () => {
  it('프로젝트에서 점검으로 가다 실패하면 프로젝트는 열린 채 남고 편집이 앉는다', async () => {
    await seedTwo()
    await router.push(`/project/${manifest.projectId}/data`)
    const project = useProjectStore()
    expect(project.projectId).toBe(manifest.projectId)

    await tryPush('/inspect')

    expect(router.currentRoute.value.name, 'the screen must stay').toBe('data')
    expect(project.projectId, 'the project on screen must stay open').toBe(manifest.projectId)
    project.update((live) => ({
      ...live,
      document: { ...live.document, manifest: { ...live.document.manifest, name: '뒤 편집' } },
    }))
    expect(project.name, 'an edit on the screen must land').toBe('뒤 편집')
  })

  it('목록에서 프로젝트를 열다 실패하면 아무것도 안 열고 탭 잠금을 잡으러 가지도 않는다', async () => {
    await seedTwo()
    claimed.length = 0

    await tryPush(`/project/${manifest.projectId}`)

    expect(router.currentRoute.value.name).toBe('projects')
    expect(useProjectStore().projectId, 'nothing may open behind the list').toBeNull()
    expect(claimed, 'the tab lock must not be taken for a screen that never came').toEqual([])
  })

  it('다른 프로젝트의 단계로 가다 실패하면 화면과 스토어가 같은 프로젝트다', async () => {
    await seedTwo()
    await router.push(`/project/${manifest.projectId}/data`)

    await tryPush(`/project/${OTHER_ID}/predict`)

    expect(router.currentRoute.value.params.projectId).toBe(manifest.projectId)
    expect(useProjectStore().projectId, 'the store must match the screen').toBe(manifest.projectId)
  })

  it('실패를 말없이 삼키지 않는다', async () => {
    await seedTwo()
    await router.push(`/project/${manifest.projectId}/data`)
    const toasts = useToastStore()

    await tryPush('/inspect')

    const told = toasts.items.filter((one) => one.key === 'client.SCREEN_LOAD_FAILED')
    expect(told, 'the student must be told the screen could not load, once').toHaveLength(1)
    expect(told[0]?.tone).toBe('danger')
    expect(String(told[0]?.params.detail), 'the original error must travel as detail').toContain(
      'Failed to fetch dynamically imported module',
    )
  })

  /**
   * **화면 안의 부품이 이미 같은 알림을 띄웠어도 이동 실패는 사라지지 않는다** (open-decisions.md 85).
   * 그 알림은 코드만으로 하나가 되는데, 옛 것을 그대로 두면 이동 전에 잡은 수위선 아래라 `afterEach`가
   * 걷어 가서 이동이 말없이 선다. 스토어가 새 id로 다시 밀어 하나로 남는다.
   */
  it('화면 안 부품의 새로고침 알림이 떠 있어도 이동 실패를 말하고 알림은 하나다', async () => {
    await seedTwo()
    await router.push(`/project/${manifest.projectId}/data`)
    const toasts = useToastStore()
    toasts.pushError(
      new TypeError('Failed to fetch dynamically imported module: /assets/panel-gone.js'),
    )

    await tryPush('/inspect')

    const told = toasts.items.filter((one) => one.key === 'client.SCREEN_LOAD_FAILED')
    expect(told, 'one reload notice must survive the failed move').toHaveLength(1)
  })
})
