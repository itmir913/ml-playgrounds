/**
 * **`.mlpx` 한 파일의 엔트리 수에는 못 끄는 한계가 있다** (open-decisions.md ".mlpx 한 파일의
 * 엔트리 수는 ZIP64 없이 쓸 수 있는 만큼이다", `limits.ts`의 `MAX_ARCHIVE_ENTRIES`).
 *
 * fflate는 ZIP64를 쓰지 않고 끝 레코드의 엔트리 수 칸(16비트)에 **아래 16비트만** 적는다. 상한을
 * 끄고 사진을 많이 넣으면 그 칸이 한 바퀴 돌아, **다시 열 때 사진이 말없이 사라진다**(감사 A/B-2).
 * 여기가 보는 것은 셋이다 — ① 세는 함수가 실제로 쓰이는 수와 같다 ② 받기 전에 막는다
 * ③ 그래도 넘은 것이 오면 조용히 쓰지 않고 던진다.
 */

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { imageEntryPath } from '../src/data/image/canonical'
import { isClientError } from '../src/errors'
import { hashBytes } from '../src/hash'
import { MAX_ARCHIVE_ENTRIES } from '../src/limits'
import { BACKBONES, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { embeddingPath } from '../src/project/embeddings'
import {
  archiveEntryCount,
  archiveGrowthRefused,
  IMAGE_DATA_DIR,
  IMAGE_PREDICT_DIR,
  IMAGE_TEST_DIR,
  readProject,
  type ProjectFile,
} from '../src/project/format'
import { requireRoomForPhotos } from '../src/project/images'
import { writeProjectBytes } from './fixtures/write'
import { emptyProjectFile, projectFile, projectFileWithTestDataset } from './fixtures/project'

const markdown = '# 포트폴리오'

const folder = (path: string) => ({
  path,
  canonicalSize: 224,
  format: 'webp' as const,
  quality: 0.65,
})

/** 사진 `count`장이 든 이미지 프로젝트. 임베딩은 `embedded`장까지 붙는다. */
function imageProject(count: number, embedded = 0): ProjectFile {
  const base = emptyProjectFile()
  const images = new Map<string, Uint8Array>()
  const embeddings = new Map<string, Uint8Array>()
  for (let index = 0; index < count; index += 1) {
    const bytes = new TextEncoder().encode(`p${index}`)
    const hash = hashBytes(bytes)
    images.set(imageEntryPath('data', hash, '개', CANONICAL_FORMATS.webp), bytes)
    if (index < embedded) {
      embeddings.set(embeddingPath(DEFAULT_BACKBONE_ID, hash), new Uint8Array(4))
    }
  }
  return {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, dataType: 'image' },
      settings: {
        ...base.document.settings,
        data: {
          dataset: folder(IMAGE_DATA_DIR),
          categories: ['개'],
          backboneId: DEFAULT_BACKBONE_ID,
        },
      },
    },
    images,
    embeddings,
  }
}

async function writtenEntries(project: ProjectFile): Promise<number> {
  return Object.keys(unzipSync((await writeProjectBytes(project, markdown)).bytes)).length
}

describe('세는 함수가 쓰는 쪽과 같은 수를 센다', () => {
  it('표 프로젝트 — 문서·표·모델·해시', async () => {
    const project = projectFileWithTestDataset()
    expect(archiveEntryCount(project)).toBe(await writtenEntries(project))
  })

  it('빈 프로젝트', async () => {
    const project = emptyProjectFile()
    expect(archiveEntryCount(project)).toBe(await writtenEntries(project))
  })

  /**
   * **쓰는 쪽이 버리는 것은 세지 않는다** — 짝 없는 임베딩, 아무도 안 가리키는 첨부,
   * 새는 이름, 문서가 안 가리키는 모델. 세면 될 것을 막는다.
   */
  it('이미지 프로젝트 — 세 자리 사진, 임베딩, 첨부, 버려지는 것들', async () => {
    const project = imageProject(5, 3)
    const test = new TextEncoder().encode('t')
    const predict = new TextEncoder().encode('q')
    project.images.set(imageEntryPath('test', hashBytes(test), '개', CANONICAL_FORMATS.webp), test)
    project.images.set(
      imageEntryPath('predict', hashBytes(predict), '', CANONICAL_FORMATS.webp),
      predict,
    )
    project.images.set(`${IMAGE_DATA_DIR}../${hashBytes(test)}.webp`, test)
    const data = project.document.settings.data as Record<string, unknown>
    data.testDataset = folder(IMAGE_TEST_DIR)
    data.predictDataset = folder(IMAGE_PREDICT_DIR)
    // 사진이 없는 임베딩 — 쓸 때 버려진다.
    project.embeddings.set(
      embeddingPath(DEFAULT_BACKBONE_ID, hashBytes(new Uint8Array([9]))),
      new Uint8Array(4),
    )
    // 가리키는 첨부 하나, 아무도 안 가리키는 첨부 하나.
    project.attachments.set('portfolio/attachments/1.webp', new Uint8Array([1]))
    project.attachments.set('portfolio/attachments/2.webp', new Uint8Array([2]))
    project.document.portfolio.attachments = { s1: ['portfolio/attachments/1.webp'] }
    // 문서가 안 가리키는 모델.
    project.models.set('model/stray.json', new Uint8Array([1]))

    expect(archiveEntryCount(project)).toBe(await writtenEntries(project))
  })

  it('실험과 모델이 있는 표 프로젝트', async () => {
    const project = projectFile()
    expect(archiveEntryCount(project)).toBe(await writtenEntries(project))
  })
})

describe('사진은 받기 전에 막는다', () => {
  /** 한 장이 늘리는 엔트리 — 정본 하나와 백본마다 임베딩 하나다. */
  const perPhoto = 1 + BACKBONES.length

  /** 임베딩이 다 붙은 프로젝트 — 지금 수가 곧 다 붙은 뒤의 수다. 경계를 한 칸까지 잰다. */
  it('한계까지는 받는다', () => {
    const project = imageProject(2, 2)
    const room = Math.floor((MAX_ARCHIVE_ENTRIES - archiveEntryCount(project)) / perPhoto)
    expect(() => requireRoomForPhotos(project, room)).not.toThrow()
  })

  it('한계를 넘기는 한 장부터 거절한다', () => {
    const project = imageProject(2, 2)
    const room = Math.floor((MAX_ARCHIVE_ENTRIES - archiveEntryCount(project)) / perPhoto)
    expect(() => requireRoomForPhotos(project, room + 1)).toThrow(
      expect.objectContaining({ code: 'PROJECT_FILE_TOO_MANY_ENTRIES' }),
    )
  })

  it('프로젝트가 없어도 센다', () => {
    expect(() => requireRoomForPhotos(null, MAX_ARCHIVE_ENTRIES)).toThrow(
      expect.objectContaining({ code: 'PROJECT_FILE_TOO_MANY_ENTRIES' }),
    )
  })

  /**
   * **임베딩이 아직 없는 사진도 임베딩 몫까지 센다** (검토 B-1). 임베딩은 학습·예측 때 붙고 그 자리에는
   * 입구가 없다. 지금 붙은 것만 세면 4만 + 1만 장이 통과하고(40,006 + 20,000), 학습이 임베딩을 다 붙이면
   * 100,006이 된다.
   */
  it('임베딩이 아직 없는 사진도 임베딩 몫까지 센다', () => {
    expect(() => requireRoomForPhotos(imageProject(40_000), 10_000)).toThrow(
      expect.objectContaining({ code: 'PROJECT_FILE_TOO_MANY_ENTRIES' }),
    )
  })

  /**
   * **상한을 켠 채로는 닿지 않는다** — 자리마다 `MAX_IMAGE_COUNT`장, 세 자리를 다 채워도 넉넉하다.
   * 임베딩이 없는 사진으로 채워 다 붙은 뒤의 몫까지 센다.
   */
  it('정상 범위의 프로젝트는 막지 않는다 - 세 자리 5,000장씩, 임베딩 없이', () => {
    const project = imageProject(5000)
    for (const role of ['test', 'predict'] as const) {
      for (let index = 0; index < 5000; index += 1) {
        const bytes = new TextEncoder().encode(`${role}${index}`)
        const category = role === 'test' ? '개' : ''
        project.images.set(
          imageEntryPath(role, hashBytes(bytes), category, CANONICAL_FORMATS.webp),
          bytes,
        )
      }
    }
    expect(() => requireRoomForPhotos(project, 1)).not.toThrow()
    expect(() => requireRoomForPhotos(imageProject(5000, 5000), 10_000)).not.toThrow()
  })
})

describe('첨부는 늘리는 편집만 거절한다', () => {
  it('한계를 넘으면서 늘리면 거절한다', () => {
    const before = imageProject(0)
    const after: ProjectFile = { ...before, attachments: new Map(before.attachments) }
    const paths: string[] = []
    for (let index = 0; index <= MAX_ARCHIVE_ENTRIES; index += 1) {
      const path = `portfolio/attachments/${index}.webp`
      after.attachments.set(path, new Uint8Array([1]))
      paths.push(path)
    }
    after.document = {
      ...before.document,
      portfolio: { ...before.document.portfolio, attachments: { s1: paths } },
    }
    expect(archiveGrowthRefused(before, after)).toBe(true)

    // **넘은 상태에서 줄이는 것은 받는다** — 줄인 뒤에도 여전히 넘어 있어도 그렇다.
    const shrunk: ProjectFile = {
      ...after,
      document: {
        ...after.document,
        portfolio: { ...after.document.portfolio, attachments: { s1: paths.slice(1) } },
      },
    }
    expect(archiveEntryCount(shrunk)).toBeGreaterThan(MAX_ARCHIVE_ENTRIES)
    expect(archiveGrowthRefused(after, shrunk)).toBe(false)
  })

  it('한계 안이면 받는다', () => {
    const before = projectFile()
    const after: ProjectFile = {
      ...before,
      attachments: new Map([['portfolio/attachments/1.webp', new Uint8Array([1])]]),
      document: {
        ...before.document,
        portfolio: {
          ...before.document.portfolio,
          attachments: { motivation: ['portfolio/attachments/1.webp'] },
        },
      },
    }
    expect(archiveGrowthRefused(before, after)).toBe(false)
  })
})

describe('마지막 그물', () => {
  /**
   * **재현** — 고치기 전에는 한계를 넘는 프로젝트가 **그대로 쓰였고**, 다시 열면 엔트리 수 칸이
   * 한 바퀴 돌아 사진이 사라졌다. 이제 쓰기 전에 던진다.
   */
  it('한계를 넘는 프로젝트는 조용히 쓰지 않고 던진다', async () => {
    const project = imageProject(MAX_ARCHIVE_ENTRIES)
    await expect(writeProjectBytes(project, markdown)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_TOO_MANY_ENTRIES',
    )
  }, 60_000)

  /** **경계는 한 칸도 안 어긋난다** — 한계와 같은 수는 쓰이고, 다시 열면 한 장도 안 빠진다. */
  it('한계와 같은 수는 쓰이고 다시 열면 다 돌아온다', async () => {
    const photos = MAX_ARCHIVE_ENTRIES - archiveEntryCount(imageProject(0))
    const project = imageProject(photos)
    expect(archiveEntryCount(project)).toBe(MAX_ARCHIVE_ENTRIES)

    const { bytes } = await writeProjectBytes(project, markdown)
    expect(Object.keys(unzipSync(bytes))).toHaveLength(MAX_ARCHIVE_ENTRIES)
    expect((await readProject(bytes)).project.images.size).toBe(photos)
  }, 120_000)
})
