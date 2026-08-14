/**
 * 이미지 프로젝트가 `.mlpx`를 왕복하는가.
 *
 * **표와 뼈대가 다른 유일한 자리다** — 표는 참조 하나에 파일 하나이고 이미지는 참조
 * 하나에 파일 수백 개다 (open-decisions.md "파일 계층은 '파일 참조인가'를 묻는다").
 * 여기서 새면 학생이 사진을 넣은 프로젝트가 **저장은 되는데 다시 안 열린다.**
 */

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { isValidCategoryName, imageEntryPath } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { hashBytes } from '../src/hash'
import { isClientError } from '../src/errors'
import {
  IMAGE_DATA_DIR,
  IMAGE_TEST_DIR,
  readProject,
  writeProject,
  type ProjectFile,
} from '../src/project/format'
import { readImages, removeImages } from '../src/project/images'
import { parseHashes } from '../src/project/integrity'
import { FORMAT_VERSION, PROJECT_KIND_ML } from '../src/project/schema'

const markdown = '# 포트폴리오'

const photo = (seed: string) => new TextEncoder().encode(`가짜jpg:${seed}`)

/** 정본 한 장. **이름은 바이트의 해시다** — 실제 경로 규칙을 그대로 쓴다. */
function entryFor(category: string, seed: string, role: 'data' | 'test' = 'data') {
  const bytes = photo(seed)
  return [imageEntryPath(role, hashBytes(bytes), category, CANONICAL_FORMATS.webp), bytes] as const
}

function imageProject(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const images = new Map([entryFor('개', 'a'), entryFor('고양이', 'b')])
  return {
    document: {
      manifest: {
        formatVersion: FORMAT_VERSION,
        appVersion: '0.0.0',
        projectId: '3f9a1b2c-4d5e-4f60-8a1b-2c3d4e5f6071',
        name: '개와 고양이',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        kind: PROJECT_KIND_ML,
        dataType: 'image',
        locale: 'ko',
      },
      settings: {
        data: {
          // **폴더 참조다.** `/`로 끝나는 것이 파일과 폴더를 가르는 표시다.
          dataset: { path: IMAGE_DATA_DIR, canonicalSize: 224, format: 'webp', quality: 0.65 },
          categories: ['개', '고양이'],
          backboneId: 'mobilenet-v2',
        },
        split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: { experiments: [] },
      portfolio: { template: { id: 'default-v1' }, answers: {} },
    },
    models: new Map(),
    images,
    embeddings: new Map(),
    ...overrides,
  }
}

describe('이미지 프로젝트의 왕복', () => {
  it('사진이 그대로 돌아온다', async () => {
    const before = imageProject()
    const { bytes } = await writeProject(before, markdown)
    const { project: after, integrity } = await readProject(bytes)

    expect([...after.images.keys()].sort()).toEqual([...before.images.keys()].sort())
    for (const [path, content] of before.images) {
      expect([...(after.images.get(path) ?? [])]).toEqual([...content])
    }
    // 표 자리는 비어 있다 - 이미지 프로젝트에는 정본 파일 하나가 없다.
    expect(after.dataset).toBeUndefined()
    // 사진까지 대조 대상이다 - 한 장만 바뀌어도 MODIFIED가 된다 (mlpx-spec.md §7.2.1).
    expect(integrity.status).toBe('UNCHANGED')
  })

  it('라벨은 폴더가 갖는다 - zip 경로가 그대로 범주다', async () => {
    const { bytes } = await writeProject(imageProject(), markdown)
    const paths = Object.keys(unzipSync(bytes)).filter((path) => path.startsWith(IMAGE_DATA_DIR))

    expect(paths).toHaveLength(2)
    for (const path of paths) {
      const category = path.slice(IMAGE_DATA_DIR.length).split('/')[0] ?? ''
      expect(isValidCategoryName(category)).toBe(true)
      expect(['개', '고양이']).toContain(category)
    }
  })

  it('사진 한 장마다 해시 항목이 있다', async () => {
    const project = imageProject()
    const { bytes } = await writeProject(project, markdown)
    const hashes = parseHashes(
      JSON.parse(new TextDecoder().decode(unzipSync(bytes)['hashes.json'])),
    )

    expect(hashes).not.toBeNull()
    for (const [path, content] of project.images) {
      // 이름이 곧 내용이라는 규칙이 파일 안에서도 성립한다 (mlpx-spec.md §1.2).
      expect(hashes?.entries[path]).toBe(hashBytes(content))
    }
  })

  it('사진 한 장만 바뀌어도 잡힌다', async () => {
    const { bytes } = await writeProject(imageProject(), markdown)
    const entries = unzipSync(bytes)
    const target = Object.keys(entries).find((path) => path.startsWith(IMAGE_DATA_DIR))
    // 파일 이름은 그대로 두고 바이트만 바꾼다. **이름이 해시라 원래는 있을 수 없는 상태**이고,
    // 그래서 남이 손댄 흔적이다.
    entries[target ?? ''] = photo('손댐')
    const { zipSync } = await import('fflate')

    const { integrity } = await readProject(zipSync(entries))
    expect(integrity.status).toBe('MODIFIED')
    expect(integrity.entries.find((entry) => entry.path === target)?.state).toBe('MODIFIED')
  })

  it('평가 폴더도 같은 규칙이다', async () => {
    const project = imageProject()
    project.images.set(...entryFor('개', 'c', 'test'))
    project.document.settings.data.testDataset = {
      path: IMAGE_TEST_DIR,
      canonicalSize: 224,
      format: 'webp',
      quality: 0.65,
    }
    const { bytes } = await writeProject(project, markdown)
    const { project: after } = await readProject(bytes)

    expect([...after.images.keys()].filter((path) => path.startsWith(IMAGE_TEST_DIR))).toHaveLength(
      1,
    )
  })
})

describe('참조와 본체는 함께 있고 함께 없다', () => {
  it('참조는 있는데 사진이 하나도 없으면 저장이 거부된다', async () => {
    const project = imageProject({ images: new Map(), embeddings: new Map() })
    await expect(writeProject(project, markdown)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_INVALID',
    )
  })

  it('사진은 있는데 참조가 없으면 저장이 거부된다', async () => {
    const project = imageProject()
    delete project.document.settings.data.dataset
    await expect(writeProject(project, markdown)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_INVALID',
    )
  })

  it('참조만 남은 파일은 열 때 거부된다', async () => {
    const project = imageProject()
    const { bytes } = await writeProject(project, markdown)
    // 누군가 zip에서 사진만 빼냈다. 열어 주면 저장도 내보내기도 못 하는 상태가 된다.
    const entries = unzipSync(bytes)
    for (const path of Object.keys(entries)) {
      if (path.startsWith(IMAGE_DATA_DIR)) delete entries[path]
    }
    const { zipSync } = await import('fflate')
    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_ENTRY_MISSING',
    )
  })
})

describe('사진을 다 지운 프로젝트도 저장된다', () => {
  /**
   * **학생이 실제로 하는 일이다** — 사진을 잘못 올려 전부 지우고 다시 시작한다. 그때
   * 참조만 남으면 저장이 거부되고 다음 차시에는 아예 안 열린다. `removeImages`가
   * 마지막 한 장에서 참조를 함께 걷어 가는 것이 그 자리를 막는다.
   */
  it('마지막 사진까지 지우고 저장했다 열 수 있다', async () => {
    const project = imageProject()
    const emptied = removeImages(
      project,
      readImages(project).map((entry) => entry.hash),
      '2026-08-12T10:00:00.000Z',
    )

    const { bytes } = await writeProject(emptied, markdown)
    const { project: opened } = await readProject(bytes)
    expect(opened.images.size).toBe(0)
    expect(opened.document.settings.data.dataset).toBeUndefined()
  })
})
