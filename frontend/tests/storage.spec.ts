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
  DB_VERSION,
  closeStorage,
  deleteProject,
  listProjects,
  loadProject,
  readPreferredLocale,
  saveProject,
  writePreferredLocale,
} from '../src/project/storage'
import { hashBytes } from '../src/hash'
import {
  experiment,
  datasetBytes,
  emptyProjectFile,
  manifest,
  projectFile,
  projectFileWithTestDataset,
  run,
  testDatasetBytes,
} from './fixtures/project'

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
    expect(Array.from(loaded?.dataset?.bytes ?? [])).toEqual(
      Array.from(project.dataset?.bytes ?? []),
    )
    expect([...(loaded?.models.keys() ?? [])].sort()).toEqual([...project.models.keys()].sort())
  })

  it('없는 프로젝트는 null이다', async () => {
    await expect(loadProject('없는-프로젝트')).resolves.toBeNull()
  })

  /**
   * **정본 셋이 다 살아남아야 한다** (mlpx-spec.md §1.1). 브라우저가 저장소이므로
   * (CLAUDE.md §1.2) 여기서 빠지면 새로고침 한 번에 평가 데이터가 사라지고, 참조만
   * 남은 프로젝트는 **저장도 내보내기도 안 된다**(writeProject가 거부한다).
   */
  it('평가 데이터가 왕복한다', async () => {
    const project = projectFileWithTestDataset()
    await saveProject(project)

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.document.settings.data.testDataset).toBeDefined()
    expect(Array.from(loaded?.testDataset?.bytes ?? [])).toEqual(Array.from(testDatasetBytes))
    expect(loaded?.testDataset?.hash).toBe(project.testDataset?.hash)
  })

  it('예측 데이터가 왕복한다', async () => {
    const bytes = new TextEncoder().encode('꽃받침\n5.1\n')
    const base = projectFile()
    const project = {
      ...base,
      document: {
        ...base.document,
        settings: {
          ...base.document.settings,
          data: {
            ...base.document.settings.data,
            predictDataset: {
              path: 'dataset/predict.csv',
              originalFileName: 'predict.csv',
              hasHeader: true,
              encoding: 'utf-8',
            },
          },
        },
      },
      predictDataset: { bytes, hash: hashBytes(bytes) },
    }
    await saveProject(project)

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.document.settings.data.predictDataset).toBeDefined()
    expect(Array.from(loaded?.predictDataset?.bytes ?? [])).toEqual(Array.from(bytes))
  })

  it('평가 데이터를 떼면 남아 있던 것도 함께 사라진다', async () => {
    await saveProject(projectFileWithTestDataset())
    await saveProject(projectFile())

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.testDataset).toBeUndefined()
    expect(loaded?.document.settings.data.testDataset).toBeUndefined()
  })

  it('표를 아직 안 올린 프로젝트도 저장되고 다시 열린다', async () => {
    await saveProject(emptyProjectFile())

    const loaded = await loadProject(manifest.projectId)
    expect(loaded).not.toBeNull()
    expect(loaded?.dataset).toBeUndefined()
  })

  it('데이터셋을 떼면 남아 있던 표가 함께 사라진다', async () => {
    await saveProject(projectFile())
    await saveProject(emptyProjectFile())

    // 옛 표가 남으면 새 설정과 짝이 맞지 않는 데이터로 학습하게 된다.
    expect((await loadProject(manifest.projectId))?.dataset).toBeUndefined()
  })

  it('데이터셋 해시가 함께 남는다 - 목록에서 고를 때마다 다시 해싱하지 않는다', async () => {
    // 저장된 값을 그대로 돌려주는지 보려고 일부러 틀린 값을 넣는다.
    await saveProject(projectFile({ dataset: { bytes: datasetBytes, hash: 'not-a-real-hash' } }))
    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.dataset?.hash).toBe('not-a-real-hash')
  })

  it('연결을 닫았다 열어도 남아 있다', async () => {
    await saveProject(projectFile())
    closeStorage()
    await expect(loadProject(manifest.projectId)).resolves.not.toBeNull()
  })

  it('덮어쓰면 옛 모델이 남지 않는다 - 데이터셋 교체가 이 경로다', async () => {
    await saveProject(projectFile())

    // 데이터셋을 갈아끼우고 실험을 전부 지운 상태 (mlpx-spec.md 5.2).
    const swapped = new TextEncoder().encode('키,몸무게\n170,60\n')
    const replaced = projectFile({
      dataset: { bytes: swapped, hash: hashBytes(swapped) },
      models: new Map(),
    })
    replaced.document = {
      ...replaced.document,
      runs: { ...replaced.document.runs, experiments: [] },
    }
    await saveProject(replaced)

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.models.size).toBe(0)
    expect(new TextDecoder().decode(loaded?.dataset?.bytes)).toContain('몸무게')
  })

  it('모델이 줄면 줄어든 만큼만 남는다', async () => {
    const project = projectFile()
    project.document.runs.experiments = [experiment('experiment-1', [run('run-1'), run('run-2')])]
    project.models.set('model/run-2.json', new TextEncoder().encode('{"tree":[1]}'))
    await saveProject(project)
    expect((await loadProject(manifest.projectId))?.models.size).toBe(3)

    project.models.delete('model/run-2.json')
    project.document.runs.experiments = [experiment('experiment-1', [run('run-1')])]
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
    let expected = project.dataset?.bytes.length ?? 0
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

describe('읽는 경로가 .mlpx와 같은 문을 지난다', () => {
  /**
   * 스키마를 거치지 않고 레코드를 직접 심는다. 옛 형식과 손상을 흉내 낸다.
   *
   * 앱 경로로 한 번 저장해 **오브젝트 스토어를 먼저 만든다.** 빈 DB에 곧장 붙으면
   * 스토어가 없어 매달린다.
   */
  async function plant(document: unknown, projectId = 'planted'): Promise<void> {
    await saveProject(emptyProjectFile())
    closeStorage()

    const database = await openDB(DB_NAME, DB_VERSION)
    await database.put('projects', {
      projectId,
      document,
      updatedAt: '2026-08-05T00:00:00.000Z',
      sizeBytes: 0,
    })
    database.close()
    closeStorage()
  }

  it('옛 모양이 저장돼 있어도 스키마 기본값으로 살아난다', async () => {
    // 리네임 전에는 runs가 batches를 들고 있었다. experiments가 없으면 화면이
    // .some(...)에서 던지고, 렌더 중 예외라 앱 전체가 멈춘다.
    const old = emptyProjectFile().document as unknown as Record<string, unknown>
    await plant({ ...old, runs: { batches: [] } })

    const loaded = await loadProject('planted')
    expect(loaded?.document.runs.experiments).toEqual([])
  })

  it('못 읽는 레코드는 던진다 - 없는 것과 다른 사실이다', async () => {
    await plant({ manifest: { name: '망가진 것' } })
    await expect(loadProject('planted')).rejects.toSatisfy(isClientError)
  })

  it('못 읽어도 목록에서 빼지 않는다 - 학생 눈에 사라진 것으로 보이면 안 된다', async () => {
    await plant({ manifest: { name: '망가진 것' } })

    const listed = await listProjects()
    const found = listed.find((one) => one.projectId === 'planted')
    expect(found).toBeDefined()
    expect(found?.readable).toBe(true)
  })

  it('manifest조차 없으면 열 수 없는 것으로 표시한다', async () => {
    await plant({ runs: {} })

    const found = (await listProjects()).find((one) => one.projectId === 'planted')
    expect(found).toBeDefined()
    expect(found?.readable).toBe(false)
  })
})
