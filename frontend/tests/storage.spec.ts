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
  totalBytes,
  writePreferredLocale,
} from '../src/project/storage'
import { hashBytes } from '../src/hash'
import type { ProjectFile } from '../src/project/format'
import { dataSettings } from '../src/project/schema'
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
            ...dataSettings('tabular', base.document.settings),
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
    expect(dataSettings('tabular', loaded!.document.settings).predictDataset).toBeDefined()
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

  /**
   * 목록은 일부러 zod를 안 돌린다(빠르기 위해서다). 그러면 레코드에 든 아무 문자열이
   * `TaskType`이라고 선언된 채 나가고, 화면이 그것으로 문구 키를 조립한다.
   */
  it('어휘에 없는 taskType은 내보내지 않는다', async () => {
    await plant({ manifest: { name: '이상한 것', taskType: '없는유형' } })

    const found = (await listProjects()).find((one) => one.projectId === 'planted')
    expect(found?.readable).toBe(true)
    expect(found?.taskType).toBeUndefined()
  })

  it('어휘에 있는 taskType은 그대로 나간다', async () => {
    await plant({ manifest: { name: '멀쩡한 것', taskType: 'clustering' } })

    const found = (await listProjects()).find((one) => one.projectId === 'planted')
    expect(found?.taskType).toBe('clustering')
  })

  it('manifest조차 없으면 열 수 없는 것으로 표시한다', async () => {
    await plant({ runs: {} })

    const found = (await listProjects()).find((one) => one.projectId === 'planted')
    expect(found).toBeDefined()
    expect(found?.readable).toBe(false)
  })
})

/**
 * A-1이 나가 있는 동안 만들어진 상태다 - 문서는 사진을 가리키는데 레코드에는 없다.
 * **여기서 참조를 안 떼면** 화면이 없는 사진의 자리를 그리고, 내보낼 때 `document.md`에
 * 깨진 그림이 적힌다 (open-decisions.md "본체 없는 첨부는 저장을 막지 않고 참조를 떼어낸다").
 */
describe('본체 없는 첨부 참조', () => {
  const path = 'portfolio/attachments/1.webp'

  /** 참조만 있고 본체가 없는 프로젝트. 지금은 만들 수 없고, 옛 버그가 남긴 모양이다. */
  function damaged(): ProjectFile {
    const project = projectFile()
    return {
      ...project,
      document: {
        ...project.document,
        portfolio: { ...project.document.portfolio, attachments: { motivation: [path] } },
      },
      attachments: new Map(),
    }
  }

  it('열 때 떼어낸다', async () => {
    await saveProject(damaged())

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.document.portfolio.attachments).toEqual({})
  })

  it('짝이 맞으면 아무것도 안 뗀다', async () => {
    const project = damaged()
    await saveProject({ ...project, attachments: new Map([[path, new Uint8Array([1, 2])]]) })

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.document.portfolio.attachments).toEqual({ motivation: [path] })
    expect(loaded?.attachments.get(path)).toEqual(new Uint8Array([1, 2]))
  })
})

/**
 * **참조와 본체가 어긋난 레코드는 열어 주지 않는다** (storage.ts의 `paired`). 열어 주면
 * 그 프로젝트는 저장도 내보내기도 못 하는 상태가 되고(writeProject가 거부한다) 학생은
 * 왜인지 모른 채 다음 차시에 그걸 안다. 정상 경로로는 안 생긴다 - 저장이 한 트랜잭션이다.
 */
describe('참조와 본체가 어긋난 레코드', () => {
  /** 문서만 심는다. datasets 레코드는 안 만든다 - 참조만 남은 모양이다. */
  async function plantWithoutBody(document: unknown): Promise<void> {
    await saveProject(emptyProjectFile())
    closeStorage()

    const database = await openDB(DB_NAME, DB_VERSION)
    await database.put('projects', {
      projectId: 'dangling',
      document,
      updatedAt: '2026-08-05T00:00:00.000Z',
      sizeBytes: 0,
    })
    database.close()
    closeStorage()
  }

  it('정본 참조만 남았으면 던진다 - null은 "없다"는 뜻이라 화면이 잘못 말한다', async () => {
    await plantWithoutBody(projectFile().document)
    await expect(loadProject('dangling')).rejects.toSatisfy(isClientError)
  })

  it('평가 데이터 참조만 남았으면 던진다', async () => {
    const base = emptyProjectFile().document
    await plantWithoutBody({
      ...base,
      settings: {
        ...base.settings,
        data: {
          ...dataSettings('tabular', base.settings),
          testDataset: {
            path: 'dataset/test.csv',
            originalFileName: 't.csv',
            hasHeader: true,
            encoding: 'utf-8',
          },
        },
      },
    })
    await expect(loadProject('dangling')).rejects.toSatisfy(isClientError)
  })

  it('예측 데이터 참조만 남았으면 던진다', async () => {
    const base = emptyProjectFile().document
    await plantWithoutBody({
      ...base,
      settings: {
        ...base.settings,
        data: {
          ...dataSettings('tabular', base.settings),
          predictDataset: {
            path: 'dataset/predict.csv',
            originalFileName: 'p.csv',
            hasHeader: true,
            encoding: 'utf-8',
          },
        },
      },
    })
    await expect(loadProject('dangling')).rejects.toSatisfy(isClientError)
  })
})

/**
 * `hash`는 나중에 생긴 필드다. 없는 레코드에서 다시 계산하지 않으면 무결성 대조와
 * 재실행 대조가 정본을 못 짚는다. **그 자리는 옛 레코드에서만 도므로 새로 저장하는
 * 검사로는 영영 안 닿는다.**
 */
describe('해시가 없던 시절의 레코드', () => {
  it('열 때 정본 해시를 다시 계산한다', async () => {
    const project = projectFile()
    await saveProject(project)
    closeStorage()

    // 레코드에서 hash 칸만 걷어낸다. 이 필드가 생기기 전의 모양이다.
    const database = await openDB(DB_NAME, DB_VERSION)
    const record = await database.get('datasets', manifest.projectId)
    delete (record as { hash?: string }).hash
    await database.put('datasets', record)
    database.close()
    closeStorage()

    const loaded = await loadProject(manifest.projectId)
    expect(loaded?.dataset?.hash).toBe(hashBytes(project.dataset!.bytes))
  })
})

/**
 * 표도 사진도 없지만 포트폴리오에 사진을 붙인 프로젝트가 있다. **레코드를 지우면 그
 * 사진이 새로고침에 사라진다** - 주석이 그 시나리오를 들어 두고도 검사가 없었다.
 */
describe('첨부만 있는 프로젝트', () => {
  const path = 'portfolio/attachments/1.webp'

  it('저장했다 열면 사진이 있다', async () => {
    const base = emptyProjectFile()
    const project: ProjectFile = {
      ...base,
      document: {
        ...base.document,
        portfolio: {
          ...base.document.portfolio,
          template: { sections: [{ id: 'motivation', title: '이유' }] },
          attachments: { motivation: [path] },
        },
      },
      attachments: new Map([[path, new Uint8Array([1, 2, 3])]]),
    }
    await saveProject(project)

    const loaded = await loadProject(base.document.manifest.projectId)
    expect(loaded?.attachments.get(path)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('아무것도 없으면 레코드가 사라진다', async () => {
    await saveProject(projectFile())
    await saveProject(emptyProjectFile())

    closeStorage()
    const database = await openDB(DB_NAME, DB_VERSION)
    const record = await database.get('datasets', manifest.projectId)
    database.close()
    expect(record).toBeUndefined()
  })
})

describe('이미지 프로젝트', () => {
  /**
   * **표 정본이 없는 프로젝트다.** `datasets` 레코드가 사진만 들고 있어야 하고,
   * 그 모양이 어긋나면 `loadProject`가 `null`을 준다 — 학생 입장에서는 프로젝트가
   * 사라진 것과 같다 (open-decisions.md "파일 계층은 '파일 참조인가'를 묻는다").
   */
  function imageProjectFile(): ProjectFile {
    const base = emptyProjectFile()
    const bytes = new TextEncoder().encode('가짜jpg')
    return {
      ...base,
      document: {
        ...base.document,
        manifest: { ...base.document.manifest, dataType: 'image' },
        settings: {
          ...base.document.settings,
          data: {
            dataset: { path: 'dataset/data/', canonicalSize: 224, format: 'webp', quality: 0.65 },
            categories: ['개'],
            backboneId: 'mobilenet-v2',
          },
        },
      },
      images: new Map([[`dataset/data/개/${hashBytes(bytes)}.jpg`, bytes]]),
    }
  }

  /**
   * **여유 공간 검사와 화면의 "용량"이 같은 것을 센다.** 이미지 프로젝트에서는 그 값이
   * 사실상 전부 사진이라(사진 5,000장 = 80~100MB) 사진 몫이 빠지면 ensureRoom이 0으로
   * 검사하고 목록이 0byte라고 말한다.
   */
  it('용량이 사진 바이트를 센다', () => {
    const project = imageProjectFile()
    const photos = [...project.images.values()].reduce((sum, bytes) => sum + bytes.length, 0)

    expect(photos).toBeGreaterThan(0)
    expect(totalBytes(project)).toBeGreaterThanOrEqual(photos)
    expect(totalBytes({ ...project, images: new Map() })).toBe(totalBytes(project) - photos)
  })

  it('임베딩도 용량에 든다', () => {
    const project = imageProjectFile()
    const vector = new Uint8Array(16)
    const withVectors = {
      ...project,
      embeddings: new Map([['embeddings/mobilenet-v2/abc.bin', vector]]),
    }
    expect(totalBytes(withVectors)).toBe(totalBytes(project) + vector.length)
  })

  /** `.mlpx` 쪽에는 있는 왕복이 IndexedDB 쪽에는 없었다. 없으면 학습이 매번 다시 뽑는다. */
  it('임베딩이 저장되고 돌아온다', async () => {
    const project = imageProjectFile()
    const path = 'embeddings/mobilenet-v2/abc.bin'
    const vector = new Uint8Array([1, 2, 3, 4])
    await saveProject({ ...project, embeddings: new Map([[path, vector]]) })

    const loaded = await loadProject(project.document.manifest.projectId)
    expect(loaded?.embeddings.get(path)).toEqual(vector)
  })

  it('사진만 있는 프로젝트가 저장되고 돌아온다', async () => {
    const project = imageProjectFile()
    await saveProject(project)

    const loaded = await loadProject(project.document.manifest.projectId)
    expect(loaded).not.toBeNull()
    expect([...(loaded?.images.keys() ?? [])]).toEqual([...project.images.keys()])
    // 표 정본은 없는 것이 정상이다.
    expect(loaded?.dataset).toBeUndefined()
  })

  it('사진을 다 지우면 레코드도 사라진다', async () => {
    const project = imageProjectFile()
    await saveProject(project)
    await saveProject({
      ...project,
      document: {
        ...project.document,
        settings: {
          ...project.document.settings,
          data: { categories: [], backboneId: 'mobilenet-v2' },
        },
      },
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    })

    const loaded = await loadProject(project.document.manifest.projectId)
    expect(loaded?.images.size).toBe(0)
  })
})
