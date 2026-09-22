// @vitest-environment jsdom
// 라우터와 Web Locks가 필요하다.
/**
 * **여는 도중에 학생이 다른 데로 간다** (2026-09-23, R37-V §1.3·§1.4).
 *
 * `open()`은 `await` 넷을 지난다. 그 사이에 `close()`나 다음 열기가 끼면 **자기 차례가
 * 지난 열기**가 되고, 그때 하면 안 되는 일이 셋이다 — 파일을 되살리는 것, *"다른 탭에서
 * 열려 있습니다"*를 띄우는 것, 잠금을 쥔 채 두는 것. R37 A-1이 그 셋을 고쳤는데
 * **지키는 검사가 0이었다**: 감사자가 세 줄을 각각 지우고 전체 스위트 3,838개를 돌렸는데
 * 전부 초록이었다. 코드만 들어가 있었다.
 *
 * **여기가 결정적인 이유는 허가 시점을 손에 쥐기 때문이다.** 진짜 Web Locks로는 그 창이
 * 언제 열리는지 모르니 `setTimeout`으로 겨눠야 하고, 그러면 기계가 바쁠 때 어긋난다.
 * 가짜 잠금이 **허가를 붙들고 있다가 우리가 말할 때 준다** — 장치는 감사자의 하니스에서
 * 가져왔고, 단언은 여기서 세웠다.
 *
 * **못 보는 것: 진짜 브라우저의 잠금.** 이 가짜는 우리가 부르는 모양만 흉내 낸다 —
 * *"가짜가 진짜보다 관대했다"*가 R26의 뿌리였으므로, 두 탭을 실제로 여는 확인은 여전히
 * 사람 몫이다.
 */

import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROUTE_PROJECTS, router } from '../src/router'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { releaseTabLock } from '../src/project/tab-lock'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { manifest, projectFile } from './fixtures/project'

/**
 * **읽기를 세는 자리.** `vi.spyOn`으로는 안 된다 — 스토어가 `loadProject`를 이름으로
 * 들여 놓았고 그 바인딩은 네임스페이스 객체를 고쳐도 안 바뀐다. **재 보고 알았다**:
 * 스파이를 걸고 가드를 지웠는데 호출이 0으로 보였다(2026-09-23). 모듈을 갈아야 보인다.
 */
const read = vi.hoisted(() => ({ ids: [] as string[], during: null as (() => void) | null }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...real,
    loadProject: async (id: string) => {
      read.ids.push(id)
      read.during?.()
      return await real.loadProject(id)
    },
  }
})

/** 잠금 열쇠. `tab-lock.ts`가 만드는 이름과 같아야 쥐고 있는지 볼 수 있다. */
const KEY = `ml-playgrounds:project:${manifest.projectId}`

/**
 * 허가를 붙들까. **켜는 것과 푸는 것을 가른다** — 하나로 두면 요청이 들어오기 **전에**
 * 푼 것이 조용히 아무 일도 안 하고, 그 뒤로는 아무도 못 푸는 영원한 기다림이 된다
 * (2026-09-23에 그렇게 다섯이 5초씩 시간 초과했다).
 */
let holdGrant = false
/** 붙들린 허가를 푸는 손잡이. **실제로 붙들렸을 때만** 채워진다. */
let releaseGrant: (() => void) | null = null
/** 허가가 난 직후에 부를 것. **잠금과 읽기 사이의 창**을 겨눈다. */
let onGranted: (() => void) | null = null

class FakeLocks {
  readonly held = new Set<string>()

  request = async (
    name: string,
    options: unknown,
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> => {
    if (holdGrant) {
      holdGrant = false
      await new Promise<void>((resolve) => {
        releaseGrant = resolve
      })
    }
    if (this.held.has(name)) {
      // 남이 쥐고 있다. `ifAvailable`이면 `null`로 부르고, 아니면 영원히 기다린다.
      if ((options as { ifAvailable?: boolean } | null)?.ifAvailable !== true) {
        return new Promise(() => {})
      }
      return callback(null)
    }
    this.held.add(name)
    try {
      const result = callback({ name })
      onGranted?.()
      return await result
    } finally {
      this.held.delete(name)
    }
  }
}

const locks = new FakeLocks()

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/**
 * 조건이 참이 될 때까지 태스크를 넘긴다. **가짜 타이머를 쓰지 않는다** — 진짜 큐를 돈다.
 *
 * **넉넉하게 센다.** 전체 스위트에서는 워커 여섯이 한 기계를 나눠 쓰므로 한 틱이 1ms로
 * 안 끝난다 — 60틱으로는 관문에서만 시간 초과가 났다(2026-09-23). 조건이 이미 참이면
 * 한 번도 안 기다리니 통과하는 경로가 느려지지는 않는다.
 */
async function until(condition: () => boolean, ticks = 600): Promise<void> {
  for (let turn = 0; turn < ticks && !condition(); turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

beforeEach(async () => {
  window.scrollTo = () => {}
  releaseTabLock()
  holdGrant = false
  releaseGrant = null
  onGranted = null
  locks.held.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  await saveProject(projectFile())
})

afterEach(async () => {
  onGranted = null
  holdGrant = false
  // **붙들린 것이 남아 있으면 푼다** — 안 풀면 다음 파일의 워커까지 매달릴 수 있다.
  releaseGrant?.()
  releaseGrant = null
  releaseTabLock()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

/**
 * **시간 여유를 준다.** 잠금과 IndexedDB와 라우터를 다 태우는 스펙이라, 전체 스위트에서
 * 워커 여섯이 한 기계를 나눠 쓰면 기본 5초로는 모자란다 — **격리하면 통과하고 관문에서만
 * 서는 그 모양**이었다(2026-09-23). 기다림은 조건이 참이 되면 끝나므로 평소에는 안 쓴다.
 */
describe('자기 차례가 지난 열기', { timeout: 30_000 }, () => {
  /**
   * **잠금을 잡기 전에 떠난다.** 여기서 `false`를 받는 것은 *"남이 쥐었다"*가 아니라
   * *"내 차례가 지났다"*인데, 가르지 않으면 **아무도 안 쥐었는데 다른 탭 이야기가 뜬다.**
   */
  it('취소당하면 다른 탭 알림을 안 띄운다', async () => {
    const project = useProjectStore()
    holdGrant = true

    const opening = project.open(manifest.projectId)
    // **붙들린 것을 확인하고 나서** 떠난다 — 요청 전에 풀면 아무 일도 안 한다.
    await until(() => releaseGrant !== null)
    project.close()
    releaseGrant?.()

    expect(await opening).toBe('cancelled')
    expect(useToastStore().items.map((toast) => toast.key)).toEqual([])
  })

  /** 남이 진짜로 쥐고 있으면 **알린다.** 위 갈래가 이것까지 삼키면 안 된다. */
  it('남이 쥐고 있으면 알린다', async () => {
    locks.held.add(KEY)
    const project = useProjectStore()

    expect(await project.open(manifest.projectId)).toBe('failed')
    expect(useToastStore().items.map((toast) => toast.key)).not.toEqual([])
  })

  /**
   * **읽는 동안 닫혔으면 되살리지 않는다.** 되살리면 목록으로 나간 학생의 화면에 옛
   * 프로젝트가 다시 뜨고 **자동 저장이 그것을 쓴다** (R20 감사가 실측한 사고).
   */
  it('읽는 동안 닫히면 파일을 되살리지 않는다', async () => {
    const project = useProjectStore()
    onGranted = () => {
      onGranted = null
      // 잠금은 잡혔고 아직 IndexedDB를 읽는 중이다. 그 창에서 학생이 목록으로 나간다.
      project.close()
    }

    expect(await project.open(manifest.projectId)).toBe('cancelled')
    await until(() => project.projectId !== null)
    expect(project.projectId).toBeNull()
  })

  /**
   * **잡고 보니 닫으라는 말이 와 있으면 놓는다.** 쥔 채로 두면 이 탭도 안 쓰고 다른
   * 탭도 못 쓰는 프로젝트가 된다 — 학생은 새로 고쳐도 안 열리는 것을 본다.
   */
  it('취소당한 열기가 잠금을 쥔 채로 두지 않는다', async () => {
    const project = useProjectStore()
    onGranted = () => {
      onGranted = null
      project.close()
    }

    await project.open(manifest.projectId)
    await until(() => !locks.held.has(KEY))
    expect(locks.held.has(KEY)).toBe(false)
  })

  /**
   * **읽기가 도는 중에** 닫힌다 — 잠금을 잡은 직후가 아니라 **그 뒤의 창**이다.
   *
   * **겨냥이 달라야 하는 이유를 재고 알았다.** 허가 직후에 닫으면 *"잡고 보니 닫힌"*
   * 가드가 먼저 잡아서 **되살림 가드까지 도달하지 않는다** — 그래서 되살림 가드를 지워도
   * 검사가 조용했다(2026-09-23 실측). 읽는 함수 안에서 닫아야 그 줄이 유일한 방어선이다.
   */
  it('읽기가 도는 중에 닫히면 파일을 되살리지 않는다', async () => {
    const project = useProjectStore()
    read.during = () => {
      read.during = null
      project.close()
    }

    expect(await project.open(manifest.projectId)).toBe('cancelled')
    expect(project.projectId).toBeNull()
  })

  /**
   * **다음 열기가 앞의 것을 밀어낸다.** 이때 앞의 열기는 `close()`를 안 지나므로
   * **자기가 잡은 잠금을 스스로 놓아야 한다** — 안 놓으면 이 탭도 안 쓰고 다른 탭도
   * 못 쓰는 프로젝트가 남는다.
   */
  it('다음 열기에 밀려난 열기가 잠금을 놓는다', async () => {
    const project = useProjectStore()
    holdGrant = true

    const first = project.open(manifest.projectId)
    await until(() => releaseGrant !== null)
    // 학생이 목록에서 다른 프로젝트를 눌렀다. `close()`는 안 지난다.
    const second = project.open('11111111-2222-3333-4444-555555555555')
    releaseGrant?.()

    expect(await first).toBe('cancelled')
    await second
    expect(locks.held.has(KEY)).toBe(false)
  })

  /**
   * **밀려난 열기는 읽기까지 가지 않는다.**
   *
   * **이 줄에 닿는 경로를 두 번 틀리고 나서 찾았다** (2026-09-23).
   *
   * 1. 처음에는 *"잠금이 샌다"*를 겨눴다 — **지워도 안 샜다.** 취소를 만드는 둘이 각자
   *    이미 놓는다(`close()`가 직접, 다음 열기는 R37 A-1′의 취소 경로가).
   * 2. 다음에는 `close()`로 겨눴다 — **그 가드까지 안 간다.** `close()`는 잠금 세대를
   *    올리므로 `acquireTabLock`이 `false`를 주고 **첫 갈래에서 나간다.**
   *
   * 남는 경로가 하나다: **학생이 목록에서 다른 프로젝트를 눌러 앞의 열기가 밀려난 것.**
   * 그때 앞의 열기는 잠금을 잡은 뒤에 자기 차례가 지난 것을 알고, 이 줄이 **버릴 것이
   * 정해진 프로젝트를 IndexedDB에서 읽는 일**을 막는다 — 50MB짜리 데이터셋을 읽고
   * 버리는 것은 교실 PC에서 공짜가 아니다.
   *
   * **조용함의 뜻은 "안 다친다"가 아니라 "내가 엉뚱한 것을 겨눴다"였다.**
   */
  it('밀려난 열기는 읽기까지 가지 않는다', async () => {
    const project = useProjectStore()
    read.ids.length = 0
    holdGrant = true

    const first = project.open(manifest.projectId)
    await until(() => releaseGrant !== null)
    const second = project.open('11111111-2222-3333-4444-555555555555')
    releaseGrant?.()
    await Promise.all([first, second])

    // 밀려난 프로젝트는 **한 번도 안 읽힌다.** 뒤엣것은 읽어도 된다 — 그게 학생이 누른 것이다.
    expect(read.ids).not.toContain(manifest.projectId)
  })

  /**
   * **학생이 누른 곳에 선다** (R37-V C-1).
   *
   * 프로젝트를 누르고 곧이어 [점검]을 누른다. 앞의 열기는 취소되는데, 그때 가드가 목록으로
   * 리다이렉트하면 **학생이 누른 [점검] 대신 목록이 선다** — 감사자가 그렇게 쟀다
   * (누른 곳 `inspect`, 선 곳 `projects`). 취소는 **중단**이지 리다이렉트가 아니다.
   */
  it('여는 중에 다른 화면을 누르면 그 화면에 선다', async () => {
    await router.replace('/')
    await router.isReady()
    holdGrant = true

    const entering = router.push(`/project/${manifest.projectId}/train`)
    await until(() => releaseGrant !== null)
    const leaving = router.push('/inspect')
    releaseGrant?.()
    await Promise.allSettled([entering, leaving])

    expect(router.currentRoute.value.name).toBe('inspect')
    expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS)
  })

  /** 취소 뒤에 다시 들어가면 **정상으로 열린다.** 한 번 취소된 것이 문을 잠그면 안 된다. */
  it('취소 뒤에 다시 열면 열린다', async () => {
    const project = useProjectStore()
    onGranted = () => {
      onGranted = null
      project.close()
    }
    await project.open(manifest.projectId)
    await until(() => !locks.held.has(KEY))

    expect(await project.open(manifest.projectId)).toBe('opened')
    expect(project.projectId).toBe(manifest.projectId)
  })
})
