/**
 * 자동 저장과 `.mlpx` 내보내기.
 *
 * **컴퓨터실 PC는 전원을 끄면 디스크가 되돌아간다.** 그래서 이 둘이 이 도구에서
 * 특별히 중요하다 — 브라우저 저장은 새로고침과 크래시까지 지켜 주고, 차시를 넘기는
 * 것은 내보낸 파일뿐이다 (architecture.md §8.8).
 *
 * 여기서 보는 것 셋.
 *
 * 1. 미뤄 둔 저장이 **실제로 도착하는가**, 그리고 그 사이 상태가 정직한가
 * 2. 내보내기 전에 **미뤄 둔 것을 먼저 쓰는가** - 방금 쓴 글이 빠진 파일이 나가면 안 된다
 * 3. 내보낸 시각을 저장이 **덮어쓰지 않는가** - 저장은 자주, 내보내기는 가끔이다
 */

import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTOSAVE_DELAY_MS } from '../src/limits'
import { exportStateOf } from '../src/project/export-state'
import { closeStorage, DB_NAME, loadProject, readExportedAt } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { emptyProjectFile, manifest, projectFile } from './fixtures/project'
import { hashBytes } from '../src/hash'
import type { ProjectFile } from '../src/project/format'

const downloads: { fileName: string; bytes: Uint8Array }[] = []

vi.mock('../src/project/download', () => ({
  downloadBytes: (bytes: Uint8Array, fileName: string) => {
    downloads.push({ bytes, fileName })
  },
  readFileBytes: async (file: File) => new Uint8Array(await file.arrayBuffer()),
}))

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 새 이름을 붙인 사본. 값이 바뀐 것을 흉내낸다. */
function renamed(name: string) {
  const base = projectFile()
  return {
    ...base,
    document: { ...base.document, manifest: { ...base.document.manifest, name } },
  }
}

beforeEach(async () => {
  downloads.length = 0
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  // setTimeout만 가짜로 바꾼다. 전부 바꾸면 fake-indexeddb가 자기 이벤트 루프를
  // 돌리지 못해 모든 요청이 영원히 안 끝난다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
  vi.useRealTimers()
  closeStorage()
  await deleteDatabase()
})

describe('자동 저장', () => {
  it('바꾸면 화면은 즉시, 저장은 나중에', async () => {
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))

    // 화면은 벌써 새 값을 본다. 기다리게 하면 입력이 끊긴다.
    expect(project.name).toBe('바뀐 이름')
    expect(project.dirty).toBe(true)
    expect(await loadProject(manifest.projectId)).toBeNull()
  })

  it('시간이 지나면 도착한다', async () => {
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    // 값을 먼저 확인한다. 타이머는 깨웠지만 IndexedDB 왕복은 실제 비동기라
    // advanceTimersByTimeAsync가 그것까지 기다려 주지는 않는다.
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('바뀐 이름')
    expect(project.dirty).toBe(false)
  })

  it('연달아 바꾸면 마지막 것만 쓴다', async () => {
    // 슬라이더를 끄는 동안 한 픽셀마다 수십 MB를 쓰면 교실 PC가 멈춘다.
    const project = useProjectStore()
    project.update(renamed('하나'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2)
    project.update(renamed('둘'))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS / 2)

    // 아직 첫 타이머만 지났다. 두 번째가 앞의 것을 밀어냈으므로 안 써 있어야 한다.
    expect(await loadProject(manifest.projectId)).toBeNull()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('둘')
  })

  it('flush는 기다리지 않고 지금 쓴다', async () => {
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))
    await project.flush()

    expect(project.dirty).toBe(false)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('바뀐 이름')
  })

  it('바꾼 것이 없으면 flush가 아무것도 안 한다', async () => {
    const project = useProjectStore()
    await project.flush()
    expect(project.savedAt).toBeNull()
  })

  it('닫으면 미뤄 둔 저장이 취소된다', async () => {
    // 프로젝트를 놓아준 뒤에 옛 값이 뒤늦게 도착하면 안 된다.
    const project = useProjectStore()
    project.update(renamed('바뀐 이름'))
    project.close()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    expect(await loadProject(manifest.projectId)).toBeNull()
  })

  it('save는 미뤄 둔 것을 밀어내고 즉시 쓴다', async () => {
    const project = useProjectStore()
    project.update(renamed('미뤄진 것'))
    await project.save(renamed('즉시'))

    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('즉시')

    // 취소되지 않았다면 여기서 옛 값이 덮어쓴다.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe('즉시')
  })
})

describe('내보내기', () => {
  const markdown = '# 나의 AI 모델 정리\n'

  it('파일 하나를 내려보낸다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    await project.exportFile(markdown)

    expect(downloads).toHaveLength(1)
    expect(downloads[0]?.fileName.endsWith('.mlpx')).toBe(true)
    expect((downloads[0]?.bytes.length ?? 0) > 0).toBe(true)
  })

  it('미뤄 둔 저장을 먼저 끝낸다 - 방금 쓴 글이 빠진 파일이 나가면 안 된다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    project.update(renamed('마지막 순간에 고친 이름'))

    await project.exportFile(markdown)

    expect(project.dirty).toBe(false)
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      '마지막 순간에 고친 이름',
    )
  })

  it('내보낸 시각을 남긴다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    expect(project.exportedAt).toBeNull()

    await project.exportFile(markdown)

    expect(project.exportedAt).not.toBeNull()
    expect(await readExportedAt(manifest.projectId)).toBe(project.exportedAt)
  })

  it('그 뒤의 저장이 내보낸 시각을 지우지 않는다', async () => {
    // 자동 저장은 자주 돌고 내보내기는 학생이 일부러 하는 일이다. 덮어쓰면
    // "아직 안 내보냈습니다"가 계속 다시 뜬다.
    const project = useProjectStore()
    await project.save(projectFile())
    await project.exportFile(markdown)
    const at = project.exportedAt

    await project.save(renamed('그 뒤에 고친 이름'))

    expect(await readExportedAt(manifest.projectId)).toBe(at)
  })

  it('프로젝트가 없으면 아무것도 내려보내지 않는다', async () => {
    const project = useProjectStore()
    await expect(project.exportFile(markdown)).resolves.toEqual([])
    expect(downloads).toHaveLength(0)
  })
})

/**
 * 저장소를 지우지 말아 달라는 요청 (`open-decisions.md` #7).
 *
 * **안 부르면 IndexedDB는 "지워도 되는 데이터"다.** iOS Safari는 일정 기간 방문이 없으면
 * 통째로 지운다 — 수행평가 제출물이 조용히 사라지는 모양이다.
 *
 * 여기서 보는 것 셋. **셋 다 "언제 부르는가"이지 "허락받았는가"가 아니다** — 허락은
 * 브라우저가 정하고 우리가 할 수 있는 일이 없다.
 */
/**
 * 사진이 든 이미지 프로젝트. **표의 정본 칸(`dataset`)은 비어 있는 것이 정상이다** —
 * 사진은 `images` 맵에 산다 (`tests/image-format.spec.ts`가 그것을 못 박아 두었다).
 */
function imageProjectFile(): ProjectFile {
  const base = emptyProjectFile()
  const bytes = new TextEncoder().encode('가짜webp')
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
    images: new Map([[`dataset/data/개/${hashBytes(bytes)}.webp`, bytes]]),
  }
}

describe('저장소를 지우지 말아 달라고 청한다', () => {
  let asked = 0

  beforeEach(() => {
    asked = 0
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        persist: async () => {
          asked += 1
          return true
        },
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('표가 들어간 저장에서 청한다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    expect(asked).toBe(1)
  })

  it('빈 프로젝트에서는 안 청한다 - 아직 지킬 것이 없다', async () => {
    // 프로젝트를 만들면 빈 문서가 곧장 쓰인다. 거기서 청하면 학생이 아무것도 안 한
    // 시점에 브라우저 팝업을 보게 되고(파이어폭스), 정작 지킬 것은 없다.
    const project = useProjectStore()
    await project.save(emptyProjectFile())
    expect(asked).toBe(0)
  })

  it('표가 들어온 뒤에는 청한다 - 빈 채로 시작했어도', async () => {
    const project = useProjectStore()
    await project.save(emptyProjectFile())
    expect(asked).toBe(0)

    await project.save(projectFile())
    expect(asked).toBe(1)
  })

  it('여러 번 저장해도 한 번만 청한다', async () => {
    // 자동저장은 슬라이더를 끌 때마다 돈다. 그때마다 물으면 브라우저에 계속 묻는 꼴이다.
    const project = useProjectStore()
    await project.save(projectFile())
    await project.save(renamed('둘'))
    await project.save(renamed('셋'))
    expect(asked).toBe(1)
  })

  it('브라우저가 이 API를 몰라도 저장은 그대로 된다', async () => {
    // 이건 저장의 전제 조건이 아니라 저장된 것을 오래 살게 하는 요청이다.
    vi.stubGlobal('navigator', {})
    const project = useProjectStore()
    await expect(project.save(projectFile())).resolves.toBeUndefined()
    expect((await loadProject(manifest.projectId))?.document.manifest.name).toBe(
      projectFile().document.manifest.name,
    )
  })

  it('거절당해도 저장은 그대로 된다', async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist: async () => false },
    })
    const project = useProjectStore()
    await expect(project.save(projectFile())).resolves.toBeUndefined()
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })

  it('던져도 저장은 그대로 된다', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => false,
        persist: async () => {
          throw new Error('사용자가 거부했다')
        },
      },
    })
    const project = useProjectStore()
    await expect(project.save(projectFile())).resolves.toBeUndefined()
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })

  /**
   * **"올린 것이 있는가"는 종류가 답한다.** 예전에는 `saved.dataset !== undefined`로 물었는데
   * 그 칸은 표의 정본 한 자리라 **이미지 프로젝트에서는 언제나 비어 있었고, 그래서 한 번도
   * 안 청했다** (V11 R1 감사 B-11). 이미지가 이 앱에서 제일 큰 프로젝트다 — 사진 5,000장이면
   * 80~100MB이고 그것이 계속 "지워도 되는 데이터"로 남았다.
   */
  it('사진이 들어간 저장에서도 청한다 - 표만 보지 않는다', async () => {
    const project = useProjectStore()
    await project.save(imageProjectFile())
    expect(asked).toBe(1)
  })

  it('사진도 표도 없으면 안 청한다 - 종류와 무관하다', async () => {
    const project = useProjectStore()
    await project.save({ ...imageProjectFile(), images: new Map() })
    expect(asked).toBe(0)
  })

  it('이미 허락받았으면 다시 묻지 않는다', async () => {
    // 파이어폭스는 이 호출에 권한 팝업을 띄운다. 물어보는 횟수 자체를 줄인다.
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => true,
        persist: async () => {
          asked += 1
          return true
        },
      },
    })
    const project = useProjectStore()
    await project.save(projectFile())
    expect(asked).toBe(0)
  })
})

/**
 * 상태 표시줄이 읽는 판정 (`AppStatusBar`). **가운데("저장했지만 파일은 옛것")가
 * 이 함수가 화면에서 빠져나온 이유다** — 그것만 검사가 못 닿는 자리에 있었다.
 */
describe('내보낸 파일이 지금 작업과 얼마나 어긋나 있는가', () => {
  it('한 번도 안 내보냈으면 notExported다', () => {
    expect(exportStateOf('2026-08-18T10:00:00.000Z', null)).toBe('notExported')
    expect(exportStateOf(null, null)).toBe('notExported')
  })

  it('내보낸 뒤로 저장한 적이 없으면 exported다', () => {
    expect(exportStateOf('2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z')).toBe('exported')
    expect(exportStateOf(null, '2026-08-18T10:00:00.000Z')).toBe('exported')
  })

  it('내보낸 뒤에 또 작업했으면 stale이다 - 여기서 안 알리면 학생이 안심하고 끈다', () => {
    expect(exportStateOf('2026-08-18T11:00:00.000Z', '2026-08-18T10:00:00.000Z')).toBe('stale')
  })

  /**
   * `savedAt`은 파일을 열었을 때 `manifest.updatedAt`에서 온다. 스키마가 받는 것은
   * `z.iso.datetime({ offset: true })`라 우리가 안 쓴 표기가 들어올 수 있고, 사전순으로
   * 재면 실제 시각과 순서가 어긋난다.
   */
  it('오프셋이 든 시각도 실제 시각으로 잰다', () => {
    // 05:00-09:00 = 14:00Z 저장 > 10:00Z 내보냄. 사전순이면 '05' < '10'이라 뒤집힌다.
    expect(exportStateOf('2026-08-18T05:00:00-09:00', '2026-08-18T10:00:00.000Z')).toBe('stale')
    // 다음 날 05:00+09:00 = 20:00Z 저장 < 21:00Z 내보냄. 사전순이면 날짜가 커서 뒤집힌다.
    expect(exportStateOf('2026-08-19T05:00:00+09:00', '2026-08-18T21:00:00.000Z')).toBe('exported')
  })
})
