// @vitest-environment jsdom
/**
 * 프로젝트 스토어가 두 탭 잠금을 옳게 배선했는가 (stores/project.ts의 open·close,
 * open-decisions.md "프로젝트는 한 번에 하나만 연다").
 *
 * 수단 자체는 tab-lock.spec.ts가 잰다. 여기서 재는 것은 배선 셋이다 —
 * 못 잡으면 **읽기 전에** 돌아서는가(반쯤 열린 화면이 자동 저장을 물고 들어오면 안
 * 된다), 못 읽었으면 잡은 것을 놓는가, 닫으면 놓는가.
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'

const acquireTabLock = vi.fn<(id: string) => Promise<boolean>>()
const releaseTabLock = vi.fn()

vi.mock('../src/project/tab-lock', () => ({
  acquireTabLock: (id: string) => acquireTabLock(id),
  releaseTabLock: () => {
    releaseTabLock()
  },
}))

const loadProject = vi.fn()

vi.mock('../src/project/storage', () => ({
  loadProject: (id: string) => loadProject(id) as Promise<unknown>,
  markExported: vi.fn(),
  readExportedAt: vi.fn(async () => null),
  requestPersistence: vi.fn(async () => false),
  saveProject: vi.fn(),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('열기', () => {
  it('다른 탭이 쥐고 있으면 읽기 전에 돌아서고 그 사실을 말한다', async () => {
    acquireTabLock.mockResolvedValue(false)
    const project = useProjectStore()

    expect(await project.open('p-1')).toBe(false)

    // 읽기 자체가 시작되면 안 된다 — 반쯤 연 상태가 자동 저장을 물고 들어온다.
    expect(loadProject).not.toHaveBeenCalled()
    expect(project.file).toBeNull()
    const toasts = useToastStore().items
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ tone: 'danger', key: 'client.PROJECT_OPEN_ELSEWHERE' })
  })

  it('잡았는데 못 읽었으면 잠금을 놓는다 — 안 열린 프로젝트가 다른 탭을 막으면 안 된다', async () => {
    acquireTabLock.mockResolvedValue(true)
    loadProject.mockResolvedValue(null)
    const project = useProjectStore()

    expect(await project.open('p-1')).toBe(false)
    expect(releaseTabLock).toHaveBeenCalledTimes(1)
  })

  it('읽기가 던져도 잠금을 놓는다', async () => {
    acquireTabLock.mockResolvedValue(true)
    loadProject.mockRejectedValue(new Error('broken record'))
    const project = useProjectStore()

    expect(await project.open('p-1')).toBe(false)
    expect(releaseTabLock).toHaveBeenCalledTimes(1)
  })
})

describe('닫기', () => {
  it('프로젝트를 떠나면 잠금을 놓는다 — 라우터 가드가 목록으로 나갈 때 부르는 그 close다', () => {
    const project = useProjectStore()
    project.close()
    expect(releaseTabLock).toHaveBeenCalledTimes(1)
  })
})
