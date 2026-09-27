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

import { saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { manifest, projectFile } from './fixtures/project'

const acquireTabLock = vi.fn<(id: string) => Promise<boolean>>()
const releaseTabLock = vi.fn()

vi.mock('../src/project/tab-lock', () => ({
  acquireTabLock: (id: string) => acquireTabLock(id),
  releaseTabLock: () => {
    releaseTabLock()
  },
}))

const loadProject = vi.fn()
const readExportedAt = vi.fn<(id: string) => Promise<string | null>>(async () => null)

vi.mock('../src/project/storage', () => ({
  loadProject: (id: string) => loadProject(id) as Promise<unknown>,
  markExported: vi.fn(),
  readExportedAt: (id: string) => readExportedAt(id),
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

    expect(await project.open('p-1')).toBe('failed')

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

    expect(await project.open('p-1')).toBe('failed')
    expect(releaseTabLock).toHaveBeenCalledTimes(1)
  })

  it('읽기가 던져도 잠금을 놓는다', async () => {
    acquireTabLock.mockResolvedValue(true)
    loadProject.mockRejectedValue(new Error('broken record'))
    const project = useProjectStore()

    expect(await project.open('p-1')).toBe('failed')
    expect(releaseTabLock).toHaveBeenCalledTimes(1)
  })

  /**
   * **내보낸 시각을 읽는 동안 닫힌다** (0.30.0 최종 승인 감사 C-11). `open()`의 마지막 `await`
   * 뒤에는 차례 확인이 없어서, 그 사이 `close()`가 끼면 파일은 비었는데 `'opened'`를 돌려주고 닫힌
   * 프로젝트의 시각을 앉혔다 — 라우터는 `'opened'`를 믿고 빈 사실로 단계를 판정해 **잠긴 단계 알림을
   * 헛되이** 띄운다. 이 창은 진짜 저장소로는 겨누지 못해 읽기를 가로챈다.
   */
  it('내보낸 시각을 읽는 동안 닫히면 열렸다고 하지 않는다', async () => {
    acquireTabLock.mockResolvedValue(true)
    loadProject.mockResolvedValue(projectFile())
    const project = useProjectStore()
    readExportedAt.mockImplementationOnce(async () => {
      project.close()
      return '2026-09-27T00:00:00.000Z'
    })

    expect(await project.open(manifest.projectId)).toBe('cancelled')
    expect(project.file).toBeNull()
    expect(project.exportedAt).toBeNull()
  })

  /**
   * **쓰는 동안 닫히면 닫힌 상태를 건드리지 않는다** (0.30.0 최종 승인 감사 C-11의 이웃). 전에는
   * `write()`가 저장을 기다린 뒤 차례를 안 재서, 닫힌 스토어에 `dirty`가 참으로 서고 `savedAt`이
   * 앉았다 — 목록 화면의 상태 표시가 "안 저장됨"을 말한다.
   */
  it('쓰는 동안 닫히면 안 쓴 상태로도, 저장한 시각으로도 남지 않는다', async () => {
    acquireTabLock.mockResolvedValue(true)
    loadProject.mockResolvedValue(projectFile())
    const project = useProjectStore()
    expect(await project.open(manifest.projectId)).toBe('opened')

    vi.mocked(saveProject).mockImplementationOnce(async () => {
      project.close()
    })
    await project.save(projectFile())

    expect(project.file).toBeNull()
    expect(project.dirty).toBe(false)
    expect(project.savedAt).toBeNull()
  })
})

describe('닫기', () => {
  it('프로젝트를 떠나면 잠금을 놓는다 — 라우터 가드가 목록으로 나갈 때 부르는 그 close다', () => {
    const project = useProjectStore()
    project.close()
    expect(releaseTabLock).toHaveBeenCalledTimes(1)
  })
})
