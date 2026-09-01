/**
 * IndexedDB - 브라우저가 저장소다 (CLAUDE.md 1.2).
 *
 * 여기서 가장 중요한 것은 **덮어쓸 때 옛 모델이 남지 않는가**다.
 * 데이터셋을 바꿨는데 옛 모델이 살아남으면 참조형 모델이 엉뚱한 행을 가리켜
 * 조용히 틀린 예측을 한다. 학생은 그게 틀렸다는 것조차 모른다.
 */

import 'fake-indexeddb/auto'

import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { embeddingPath } from '../src/project/embeddings'
import { isClientError } from '../src/errors'
import {
  DB_NAME,
  DB_VERSION,
  closeStorage,
  deleteProject,
  listProjects,
  loadProject,
  markExported,
  readExportedAt,
  readLimitsOff,
  readPreferredLocale,
  roomShortfall,
  saveProject,
  totalBytes,
  writeLimitsOff,
  writePreferredLocale,
} from '../src/project/storage'
import { hashBytes } from '../src/hash'
import { STORAGE_SAFETY_FACTOR } from '../src/limits'
import type { ProjectFile } from '../src/project/format'
import { dataSettings, FORMAT_VERSION } from '../src/project/schema'
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

/**
 * 상한 해제 (`limits-switch.ts`, `open-decisions.md` "상한은 누가 정했느냐" §2).
 *
 * **언어와 같은 store에 산다** — 기기의 설정이라서다. 새 store를 만들면 `DB_VERSION`이
 * 오르고 그건 지시 없이 올릴 값이 아니다 (`tests/versions.spec.ts`).
 */
describe('상한 해제 저장', () => {
  it('저장한 적이 없으면 꺼진 것이다 - 안전한 쪽이 기본이다', async () => {
    await expect(readLimitsOff()).resolves.toBe(false)
  })

  it('켠 것을 다시 읽을 수 있다', async () => {
    await writeLimitsOff(true)
    await expect(readLimitsOff()).resolves.toBe(true)
  })

  it('껐던 것으로 되돌아온다', async () => {
    await writeLimitsOff(true)
    await writeLimitsOff(false)
    await expect(readLimitsOff()).resolves.toBe(false)
  })

  it('연결을 닫았다 열어도 값이 남아 있다', async () => {
    await writeLimitsOff(true)
    closeStorage()
    await expect(readLimitsOff()).resolves.toBe(true)
  })

  /**
   * **`true`가 아니면 꺼진 것이다.** 손으로 넣어 둔 값이나 옛 형식을 참으로 읽으면
   * 학생이 켠 적 없는 상태로 앱이 뜬다 — 상한이 조용히 풀린 채로 시작한다.
   *
   * **같은 열쇠에 직접 넣어야 재는 것이 있다** (2026-09-01 감사 A-2). 처음에는 **언어
   * 열쇠**에 쓰고 상한 열쇠를 읽었는데, 두 열쇠가 다르다는 것은 바로 아래 검사가 스스로
   * 단언한다 — 읽히는 값이 늘 `undefined`라 위 `저장한 적이 없으면 꺼진 것이다`와 **똑같은
   * 것을 재고 있었다.** 그래서 `=== true`를 `Boolean(...)`으로 풀어도 통과했다.
   *
   * **`writeLimitsOff`를 먼저 부르는 이유**는 앱이 store를 만들게 하기 위해서다. 생
   * 연결로 먼저 열면 store 없는 빈 DB가 서서 `NotFoundError`가 난다.
   */
  it('같은 열쇠의 참 아닌 값을 켠 것으로 안 읽는다', async () => {
    await writeLimitsOff(true)
    const raw = await openDB(DB_NAME, DB_VERSION)
    // 옛 형식이 문자열이었다면 이렇게 남아 있다.
    await raw.put('preferences', 'true', 'limitsOff')
    raw.close()
    await expect(readLimitsOff()).resolves.toBe(false)
  })

  it('언어와 서로를 덮어쓰지 않는다 - 열쇠가 다르다', async () => {
    await writePreferredLocale('ko')
    await writeLimitsOff(true)
    await expect(readPreferredLocale()).resolves.toBe('ko')
    await expect(readLimitsOff()).resolves.toBe(true)
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
   * (CLAUDE.md §1.2) 여기서 빠지면 새로고침 한 번에 테스트 데이터가 사라지고, 참조만
   * 남은 프로젝트는 **저장도 내보내기도 안 된다**(writeProject가 거부한다).
   */
  it('테스트 데이터가 왕복한다', async () => {
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

  it('테스트 데이터를 떼면 남아 있던 것도 함께 사라진다', async () => {
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
  /**
   * **안전계수가 실제로 곱해지는가** (R7 감사 B-9). 기존 셋은 여유가 아주 많거나 아주
   * 적은 값만 줘서, `STORAGE_SAFETY_FACTOR`를 통째로 무시해도 전체가 침묵했다.
   *
   * 브라우저가 보고하는 여유는 근사값이고 압축·인덱스가 더 먹는다 — 그래서 계수만큼
   * 더 요구한다. **필요량과 여유를 계수 사이에 놓으면** 그 곱셈이 있을 때만 거부된다.
   */
  it('여유가 실제 크기보다는 크고 안전계수보다는 작으면 거부한다', async () => {
    const project = projectFile()
    const size = totalBytes(project)
    // 계수가 1보다 크다는 전제 자체를 먼저 세운다.
    expect(STORAGE_SAFETY_FACTOR).toBeGreaterThan(1)
    const available = Math.floor(size * ((1 + STORAGE_SAFETY_FACTOR) / 2))
    stubEstimate(available * 4, available * 3)

    try {
      await expect(saveProject(project)).rejects.toSatisfy(isClientError)
    } finally {
      clearEstimate()
    }
  })

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

  /**
   * **반대 방향이다** (open-decisions.md "저장소가 미래에서 온 것도 예측 가능하게
   * 거부한다"). 배포를 되돌리면 디스크의 DB가 앱보다 높고, `idb`는 `VersionError`를
   * 던진다. 어휘가 없으면 `UNEXPECTED_ERROR`와 **영어 원문**이 뜨고 목록이 빈 채로
   * 선다 — `architecture.md` §8.10.2가 막으려던 바로 그 장면이다.
   */
  it('디스크의 저장소가 더 새 것이면 우리 코드로 거절한다', async () => {
    const ahead = await openDB(DB_NAME, DB_VERSION + 1)
    ahead.close()
    closeStorage()

    const thrown: unknown = await listProjects().catch((error: unknown) => error)

    expect(isClientError(thrown) && thrown.code).toBe('STORAGE_VERSION_TOO_NEW')
  })

  /**
   * **실패한 약속을 붙들지 않는다.** `connection ??=`이 거절된 약속을 캐시하면 그 세션의
   * 저장소 접근이 전부 죽어, 되돌린 배포를 다시 올려도 새로고침 전까지 안 산다.
   */
  it('한 번 실패해도 그 세션이 통째로 죽지 않는다', async () => {
    const ahead = await openDB(DB_NAME, DB_VERSION + 1)
    ahead.close()
    closeStorage()
    await expect(listProjects()).rejects.toSatisfy(isClientError)

    // 되돌렸던 배포를 다시 올린 자리다. closeStorage()를 부르지 않는 것이 요점이다.
    await deleteDatabase()

    await expect(listProjects()).resolves.toEqual([])
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

  /**
   * **저장소도 파일과 같은 문을 지나야 한다** (mlpx-spec.md §9).
   *
   * `migrate.spec.ts`가 하는 것은 `migrateProjectDocument`를 **직접 부르는 것**이라,
   * `loadProject`가 그것을 부르는지는 안 본다. 실제로 이 자리에서 마이그레이션을
   * 무력화해도 저장소 전체가 초록이었다 (R13-1 감사 A-1). 파일 쪽 짝은
   * `image-format.spec.ts`에 있다.
   *
   * **여기가 파일 쪽보다 아프다.** 안 올라오면 `loadProject`가 곧장 옛 id의 임베딩을
   * 버리고, 학습을 누르면 `BACKBONE_UNAVAILABLE`로 선다 — 다시 뽑을 길도 없다.
   */
  it('v1 레코드를 열면 백본 id가 올라온다', async () => {
    // v1이 쓰던 백본 id (mlpx-spec.md §9.1). **등록부를 안 읽고 글자를 박는다** -
    // `migrate.ts`와 같은 이유다. 셋째 백본이 등록돼도 이 값은 안 움직인다.
    const base = emptyProjectFile().document
    await plant({
      ...base,
      manifest: { ...base.manifest, formatVersion: 1, dataType: 'image' },
      settings: { ...base.settings, data: { categories: ['개'], backboneId: 'mobilenet-v2' } },
    })

    const loaded = await loadProject('planted')

    expect(loaded?.document.manifest.formatVersion).toBe(FORMAT_VERSION)
    expect(dataSettings('image', loaded!.document.settings).backboneId).toBe('mobilenet-v2-r2')
  })

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

  it('테스트 데이터 참조만 남았으면 던진다', async () => {
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

  /**
   * **폴더 참조는 파일 참조와 판정이 다르다** (R7 감사 A-3). 위 셋은 전부 파일 참조라,
   * `paired`의 폴더 갈래(`그 아래 한 장이라도 있는가`)를 `return true`로 뭉개도 저장소
   * 전체 1,996개가 초록이었다.
   *
   * **사진이 날아간 이미지 프로젝트가 "열리는" 것이 그 결과다.** 그 프로젝트는 저장도
   * 내보내기도 못 하고(`writeProject`가 거부한다), 학생은 왜인지 모른 채 다음 차시에 안다.
   */
  it('사진 폴더 참조만 남았으면 던진다 - 폴더는 그 아래 한 장이라도 있어야 한다', async () => {
    const base = emptyProjectFile().document
    await plantWithoutBody({
      ...base,
      manifest: { ...base.manifest, dataType: 'image' },
      settings: {
        ...base.settings,
        data: {
          dataset: { path: 'dataset/data/', canonicalSize: 224, format: 'webp', quality: 0.65 },
          categories: ['개'],
          backboneId: DEFAULT_BACKBONE_ID,
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
            backboneId: DEFAULT_BACKBONE_ID,
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

  /**
   * **항마다 따로 본다** (R7 감사 B-8). 목록의 용량 검사가 기대값을 **구현의 일부로 다시
   * 만들고 있었고**(`dataset + models`), 픽스처에 테스트·예측 정본도 첨부도 없어서
   * 그 셋을 구현에서 빼도 양쪽이 같이 0이었다.
   *
   * 소스가 실패를 직접 적어 두었다 — *"훈련 정본만 세면 여유 공간 검사가 실제로 쓸 양보다
   * 적게 잡고, 그러면 사전 검사를 통과한 뒤 실제 쓰기에서 터진다."*
   */
  for (const term of ['testDataset', 'predictDataset', 'attachments'] as const) {
    it(`용량이 ${term}을 센다`, () => {
      const bytes = new Uint8Array(24)
      const base = projectFile()
      const withTerm =
        term === 'attachments'
          ? { ...base, attachments: new Map([['portfolio/attachments/1.webp', bytes]]) }
          : { ...base, [term]: { bytes, hash: 'deadbeef' } }

      expect(totalBytes(withTerm)).toBe(totalBytes(base) + bytes.length)
    })
  }

  it('임베딩도 용량에 든다', () => {
    const project = imageProjectFile()
    const vector = new Uint8Array(16)
    const withVectors = {
      ...project,
      embeddings: new Map([[embeddingPath(DEFAULT_BACKBONE_ID, 'abc'), vector]]),
    }
    expect(totalBytes(withVectors)).toBe(totalBytes(project) + vector.length)
  })

  /** `.mlpx` 쪽에는 있는 왕복이 IndexedDB 쪽에는 없었다. 없으면 학습이 매번 다시 뽑는다. */
  it('임베딩이 저장되고 돌아온다', async () => {
    const project = imageProjectFile()
    const path = embeddingPath(DEFAULT_BACKBONE_ID, 'abc')
    const vector = new Uint8Array([1, 2, 3, 4])
    await saveProject({ ...project, embeddings: new Map([[path, vector]]) })

    const loaded = await loadProject(project.document.manifest.projectId)
    expect(loaded?.embeddings.get(path)).toEqual(vector)
  })

  /**
   * **개정 전 좌표계는 여는 자리에서 떨어진다** (mlpx-spec.md §1.3 규칙 2).
   *
   * 파일에서만 떨어뜨리면 IndexedDB에는 새 벡터와 옛 벡터가 나란히 남고, `totalBytes`가
   * 그것까지 세므로 **새로 뽑은 학생이 자기 프로젝트를 저장하지 못하게 된다.**
   */
  it('등록부에 없는 백본의 임베딩은 열 때 떨어진다', async () => {
    const project = imageProjectFile()
    const kept = embeddingPath(DEFAULT_BACKBONE_ID, 'abc')
    const stale = 'embeddings/mobilenet-v2/abc.bin'
    const vector = new Uint8Array([1, 2, 3, 4])
    await saveProject({
      ...project,
      embeddings: new Map([
        [stale, vector],
        [kept, vector],
      ]),
    })

    const loaded = await loadProject(project.document.manifest.projectId)
    expect([...(loaded?.embeddings.keys() ?? [])]).toEqual([kept])
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
          data: { categories: [], backboneId: DEFAULT_BACKBONE_ID },
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

/**
 * **주석이 "이걸 안 하면 이렇게 망가진다"고 적어 둔 자리들이다.** 셋 다 뭉개도 저장소가
 * 조용했다 (R13-4 감사 C-2). 정상 경로로는 안 지나가므로 여기서 따로 태운다.
 */
describe('저장소의 방어 갈래', () => {
  /**
   * 브라우저가 보고하는 `usage`가 `quota`를 넘는 기기가 있다. 걷어내면 화면이
   * **"남은 공간 -1MB"**라고 말한다.
   */
  it('쓴 것이 할당량을 넘어도 남은 공간을 음수로 말하지 않는다', async () => {
    stubEstimate(1_000_000, 3_000_000)

    const shortfall = await roomShortfall(1)

    expect(shortfall?.availableMb).toBe(0)
  })

  /**
   * `roomShortfall`의 머리말이 이 자리를 명시적으로 약속한다 — *"estimate()가 없는
   * 브라우저에서는 `null`이다 … 그때는 실제 쓰기에서 나는 QuotaExceededError가 같은
   * 코드로 바뀐다."* 안 바뀌면 로케일에 없는 원문이 토스트로 간다.
   */
  it('실제 쓰기에서 나는 쿼터 오류도 우리 코드가 된다', async () => {
    const quota = new DOMException('quota', 'QuotaExceededError')
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota
    })

    try {
      const thrown: unknown = await saveProject(projectFile()).catch((error: unknown) => error)
      expect(isClientError(thrown) && thrown.code).toBe('STORAGE_QUOTA_EXCEEDED')
    } finally {
      put.mockRestore()
    }
  })

  /**
   * 주석: *"없는 프로젝트에는 아무것도 하지 않는다 - 지워진 프로젝트를 되살리면 안 된다."*
   * 학생이 지운 프로젝트가 목록에 되살아나면 지우기가 안 먹은 것으로 보인다.
   */
  it('없는 프로젝트를 내보낸 것으로 적어도 되살아나지 않는다', async () => {
    await saveProject(projectFile())
    await deleteProject(manifest.projectId)

    await markExported(manifest.projectId, '2026-08-30T00:00:00.000Z')

    expect(await loadProject(manifest.projectId)).toBeNull()
    expect(await readExportedAt(manifest.projectId)).toBeNull()
    expect(await listProjects()).toEqual([])
  })
})

/**
 * **저장소를 못 쓰는 기기** (2026-09-01 감사 B-5).
 *
 * 사파리의 사생활 보호 모드처럼 IndexedDB 접근 자체가 던지는 환경이 있다. 두 읽기 함수의
 * 주석이 *"저장소를 못 쓰면 … 안전한 쪽으로 떨어진다"*고 단정하는데, **그 단정을 아무도
 * 안 쟀다** — `catch { return false }`를 `true`로 바꿔도 75개가 초록이었다. 그러면
 * **학생이 켠 적 없는데 상한이 풀린 채로 앱이 뜬다.**
 */
describe('저장소가 던져도 안전한 쪽으로 떨어진다', () => {
  /** `openDB`가 던지게 만든다. **모듈을 다시 들여와야 그 모의가 걸린다.** */
  async function withBrokenStorage<T>(
    read: (module: typeof import('../src/project/storage')) => Promise<T>,
  ): Promise<T> {
    vi.resetModules()
    vi.doMock('idb', () => ({
      openDB: () => {
        throw new Error('storage is unavailable')
      },
    }))
    try {
      return await read(await import('../src/project/storage'))
    } finally {
      vi.doUnmock('idb')
      vi.resetModules()
    }
  }

  it('상한 해제는 꺼진 것으로 읽는다', async () => {
    await expect(withBrokenStorage((module) => module.readLimitsOff())).resolves.toBe(false)
  })

  it('언어는 고른 적 없는 것으로 읽는다', async () => {
    await expect(withBrokenStorage((module) => module.readPreferredLocale())).resolves.toBeNull()
  })

  /**
   * **던지는 것과 엉뚱한 값이 든 것은 다른 경로다** (2026-09-01 감사 B-5). 위 둘은
   * `catch`를 재고, 이것은 **타입 가드**를 잰다 — 같은 store에 이제 문자열과 참·거짓이
   * 함께 살므로(`string | boolean`) 두 가드가 처음으로 서로 다른 타입을 만난다.
   */
  it('언어 열쇠에 참·거짓이 들어 있으면 고른 적 없는 것으로 읽는다', async () => {
    await writePreferredLocale('ko')
    const raw = await openDB(DB_NAME, DB_VERSION)
    await raw.put('preferences', true, 'locale')
    raw.close()
    await expect(readPreferredLocale()).resolves.toBeNull()
  })
})
