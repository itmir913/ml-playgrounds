/**
 * IndexedDB - 브라우저가 저장소다 (CLAUDE.md 1.2).
 *
 * 여기서 가장 중요한 것은 **덮어쓸 때 옛 모델이 남지 않는가**다.
 * 데이터셋을 바꿨는데 옛 모델이 살아남으면 참조형 모델이 엉뚱한 행을 가리켜
 * 조용히 틀린 예측을 한다. 학생은 그게 틀렸다는 것조차 모른다.
 */

import 'fake-indexeddb/auto'

import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import {
  DB_NAME,
  closeStorage,
  deleteProject,
  listProjects,
  loadProject,
  readPreferredLocale,
  saveProject,
  writePreferredLocale,
} from '../src/project/storage'
import { batch, manifest, projectFile, run } from './fixtures/project'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

function stubEstimate(quota: number, usage: number): void {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota, usage }) },
  })
}

function clearEstimate(): void {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
}

beforeEach(async () => {
  closeStorage()
  await deleteDatabase()
})

afterEach(() => {
  clearEstimate()
})

describe('언어 선택 저장', () => {
  it('저장한 적이 없으면 null을 돌려준다', async () => {
    await expect(readPreferredLocale()).resolves.toBeNull()
  })

  it('저장한 값을 다시 읽을 수 있다', async () => {
    await writePreferredLocale('ko')
    await expect(readPreferredLocale()).resolves.toBe('ko')
  })

  it('나중에 저장한 값이 이긴다', async () => {
    await writePreferredLocale('ko')
    await writePreferredLocale('en')
    await expect(readPreferredLocale()).resolves.toBe('en')
  })

  it('연결을 닫았다 열어도 값이 남아 있다', async () => {
    await writePreferredLocale('ko')
    closeStorage()
    await expect(readPreferredLocale()).resolves.toBe('ko')
  })
})

describe('프로젝트 저장', () => {
  it('저장한 것을 그대로 돌려준다', async () => {
    const project = projectFile()
    await saveProject(project)

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.document).toEqual(project.document)
    // Uint8Array는 realm이 달라 toEqual이 어긋난다. 바이트로 펴서 비교한다.
    expect(Array.from(loaded?.dataset ?? [])).toEqual(Array.from(project.dataset))
    expect([...(loaded?.models.keys() ?? [])].sort()).toEqual([...project.models.keys()].sort())
  })

  it('없는 프로젝트는 null이다', async () => {
    await expect(loadProject('없는-프로젝트')).resolves.toBeNull()
  })

  it('데이터셋 해시가 함께 남는다 - 목록에서 고를 때마다 다시 해싱하지 않는다', async () => {
    // 저장된 값을 그대로 돌려주는지 보려고 일부러 틀린 값을 넣는다.
    await saveProject(projectFile({ datasetHash: 'not-a-real-hash' }))
    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.datasetHash).toBe('not-a-real-hash')
  })

  it('연결을 닫았다 열어도 남아 있다', async () => {
    await saveProject(projectFile())
    closeStorage()
    await expect(loadProject(manifest.projectId)).resolves.not.toBeNull()
  })

  it('덮어쓰면 옛 모델이 남지 않는다 - 데이터셋 교체가 이 경로다', async () => {
    await saveProject(projectFile())

    // 데이터셋을 갈아끼우고 묶음을 전부 지운 상태 (mlpx-spec.md 5.2).
    const replaced = projectFile({
      dataset: new TextEncoder().encode('키,몸무게\n170,60\n'),
      models: new Map(),
    })
    replaced.document = {
      ...replaced.document,
      runs: { ...replaced.document.runs, batches: [] },
    }
    await saveProject(replaced)

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.models.size).toBe(0)
    expect(new TextDecoder().decode(loaded?.dataset)).toContain('몸무게')
  })

  it('모델이 줄면 줄어든 만큼만 남는다', async () => {
    const project = projectFile()
    project.document.runs.batches = [batch('batch-1', [run('run-1'), run('run-2')])]
    project.models.set('model/run-2.json', new TextEncoder().encode('{"tree":[1]}'))
    await saveProject(project)
    expect((await loadProject(manifest.projectId))?.models.size).toBe(3)

    project.models.delete('model/run-2.json')
    project.document.runs.batches = [batch('batch-1', [run('run-1')])]
    await saveProject(project)

    const loaded = await loadProject(manifest.projectId)
    expect([...(loaded?.models.keys() ?? [])]).not.toContain('model/run-2.json')
  })

  it('다른 프로젝트를 건드리지 않는다', async () => {
    await saveProject(projectFile())

    const other = projectFile()
    other.document = {
      ...other.document,
      manifest: { ...manifest, projectId: '11111111-2222-3333-4444-555555555555' },
    }
    await saveProject(other)
    await deleteProject('11111111-2222-3333-4444-555555555555')

    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })
})

describe('프로젝트 목록', () => {
  it('최근에 손댄 것이 먼저다', async () => {
    const older = projectFile()
    older.document = {
      ...older.document,
      manifest: {
        ...manifest,
        projectId: '11111111-2222-3333-4444-555555555555',
        name: '오래된 것',
        updatedAt: '2026-08-01T09:00:00Z',
      },
    }
    await saveProject(older)
    await saveProject(projectFile())

    const summaries = await listProjects()
    expect(summaries.map((summary) => summary.name)).toEqual(['붓꽃 품종 분류', '오래된 것'])
  })

  it('용량을 알려준다 - 학생이 무엇을 지울지 고를 수 있어야 한다', async () => {
    const project = projectFile()
    await saveProject(project)

    const [summary] = await listProjects()
    let expected = project.dataset.length
    for (const bytes of project.models.values()) expected += bytes.length
    expect(summary?.sizeBytes).toBe(expected)
    expect(summary?.taskType).toBe('classification')
  })
})

describe('프로젝트 삭제', () => {
  it('데이터셋과 모델까지 함께 사라진다', async () => {
    await saveProject(projectFile())
    await deleteProject(manifest.projectId)

    expect(await loadProject(manifest.projectId)).toBeNull()
    expect(await listProjects()).toEqual([])
  })
})

describe('여유 공간', () => {
  it('부족하면 저장을 거부하고 얼마나 필요한지 알려준다', async () => {
    stubEstimate(1024 * 1024, 1024 * 1024 - 10)
    try {
      await saveProject(projectFile())
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('STORAGE_QUOTA_EXCEEDED')
      expect(error.params.requiredMb).toBeGreaterThanOrEqual(0)
    }
  })

  it('여유가 있으면 저장한다', async () => {
    stubEstimate(1024 * 1024 * 1024, 0)
    await saveProject(projectFile())
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })

  it('estimate()가 없는 브라우저에서도 저장한다', async () => {
    clearEstimate()
    await saveProject(projectFile())
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })
})

describe('DB 업그레이드', () => {
  it('예전 버전에 저장한 언어 선택이 살아남는다', async () => {
    // v1에는 preferences store 하나뿐이었다.
    const first = await openDB(DB_NAME, 1, {
      upgrade(database) {
        database.createObjectStore('preferences')
      },
    })
    await first.put('preferences', 'ko', 'locale')
    first.close()
    closeStorage()

    await expect(readPreferredLocale()).resolves.toBe('ko')
    await saveProject(projectFile())
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })
})
