/**
 * 이미지 프로젝트가 `.mlpx`를 왕복하는가.
 *
 * **표와 뼈대가 다른 유일한 자리다** — 표는 참조 하나에 파일 하나이고 이미지는 참조
 * 하나에 파일 수백 개다 (open-decisions.md "파일 계층은 '파일 참조인가'를 묻는다").
 * 여기서 새면 학생이 사진을 넣은 프로젝트가 **저장은 되는데 다시 안 열린다.**
 */

import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { isValidCategoryName, imageEntryPath } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { hashBytes } from '../src/hash'
import { isClientError } from '../src/errors'
import {
  IMAGE_DATA_DIR,
  IMAGE_TEST_DIR,
  readProject,
  type ProjectFile,
} from '../src/project/format'
import { writeProjectBytes } from './fixtures/write'
import { embeddingPath } from '../src/project/embeddings'
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
          backboneId: DEFAULT_BACKBONE_ID,
        },
        split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: { experiments: [] },
      portfolio: {
        template: { sections: [] },
        answerFormat: 'plain-v1',
        answers: {},
        attachments: {},
      },
    },
    models: new Map(),
    images,
    attachments: new Map(),
    embeddings: new Map(),
    ...overrides,
  }
}

describe('이미지 프로젝트의 왕복', () => {
  it('사진이 그대로 돌아온다', async () => {
    const before = imageProject()
    const { bytes } = await writeProjectBytes(before, markdown)
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
    const { bytes } = await writeProjectBytes(imageProject(), markdown)
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
    const { bytes } = await writeProjectBytes(project, markdown)
    const hashes = parseHashes(
      JSON.parse(new TextDecoder().decode(unzipSync(bytes)['hashes.json'])),
    )

    expect(hashes).not.toBeNull()
    for (const [path, content] of project.images) {
      // 이름이 곧 내용이라는 규칙이 파일 안에서도 성립한다 (mlpx-spec.md §1.2).
      expect(hashes?.entries[path]).toBe(hashBytes(content))
    }
  })

  it('임베딩까지 대조 대상이다 - 읽는 쪽 allowlist가 쓰는 쪽을 따라잡는가', async () => {
    // **쓰는 쪽과 읽는 쪽의 비대칭을 막는 트립와이어다** (integrity.spec.ts의 같은 자리).
    // writeProject는 담을 엔트리를 통째로 해싱하지만 대조 대상은 allowlist로 고른다 -
    // 임베딩을 거기 넣는 것을 잊으면 갓 저장한 파일이 학생 눈앞에서 MODIFIED가 된다.
    const project = imageProject({
      embeddings: new Map(
        ['a', 'b'].map((seed) => [
          embeddingPath(DEFAULT_BACKBONE_ID, hashBytes(photo(seed))),
          new Uint8Array([1, 2, 3, 4]),
        ]),
      ),
    })
    const { bytes } = await writeProjectBytes(project, markdown)
    const { integrity } = await readProject(bytes)

    expect(integrity.status).toBe('UNCHANGED')
    expect(integrity.entries.map((entry) => entry.path).sort()).toEqual(
      Object.keys(unzipSync(bytes))
        .filter((path) => path !== 'hashes.json')
        .sort(),
    )
  })

  it('사진 한 장만 바뀌어도 잡힌다', async () => {
    const { bytes } = await writeProjectBytes(imageProject(), markdown)
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

  it('테스트 폴더도 같은 규칙이다', async () => {
    const project = imageProject()
    project.images.set(...entryFor('개', 'c', 'test'))
    project.document.settings.data.testDataset = {
      path: IMAGE_TEST_DIR,
      canonicalSize: 224,
      format: 'webp',
      quality: 0.65,
    }
    const { bytes } = await writeProjectBytes(project, markdown)
    const { project: after } = await readProject(bytes)

    expect([...after.images.keys()].filter((path) => path.startsWith(IMAGE_TEST_DIR))).toHaveLength(
      1,
    )
  })
})

describe('참조와 본체는 함께 있고 함께 없다', () => {
  it('참조는 있는데 사진이 하나도 없으면 저장이 거부된다', async () => {
    const project = imageProject({
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    })
    await expect(writeProjectBytes(project, markdown)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_INVALID',
    )
  })

  it('사진은 있는데 참조가 없으면 저장이 거부된다', async () => {
    const project = imageProject()
    delete project.document.settings.data.dataset
    await expect(writeProjectBytes(project, markdown)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_INVALID',
    )
  })

  it('참조만 남은 파일은 열 때 거부된다', async () => {
    const project = imageProject()
    const { bytes } = await writeProjectBytes(project, markdown)
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

    const { bytes } = await writeProjectBytes(emptied, markdown)
    const { project: opened } = await readProject(bytes)
    expect(opened.images.size).toBe(0)
    expect(opened.document.settings.data.dataset).toBeUndefined()
  })
})

/**
 * **압축을 풀어 보고 다시 압축한 `.mlpx`도 열린다.**
 *
 * `mlpx-spec.md` §7.2가 "도구 없이 여는 길"을 약속했으므로 이것은 교사가 실제로 하는
 * 일이다. 그런데 윈도 탐색기는 압축할 때 UTF-8 플래그를 안 세우고 이름을 ANSI 코드
 * 페이지로 적는다 — 그러면 `fflate`가 Latin-1로 읽어 **범주 폴더 이름이 깨진다**
 * (`open-decisions.md` "압축 파일의 폴더 이름은 UTF-8이 아닐 수 있다").
 *
 * 고치기 전에는 사진이 선언된 범주 아래 없는 것이 되고, **무결성이 사진 수만큼
 * `REMOVED`+`ADDED`를 뱉어 멀쩡한 파일이 변조로 보였다.**
 */
describe('탐색기로 다시 압축한 .mlpx', () => {
  /**
   * 그 범주 이름의 CP949 바이트. 2026-08-29에 윈도 11(ANSI 949)에서 쟀다.
   * `fflate`는 플래그가 없으면 Latin-1로 읽으므로 **바이트 하나가 글자 하나**가 된다 —
   * 검사도 같은 방식으로 그 문자열을 만든다.
   */
  const CP949: Record<string, readonly number[]> = {
    개: [0xb0, 0xb3],
    고양이: [0xb0, 0xed, 0xbe, 0xe7, 0xc0, 0xcc],
  }

  /** 우리가 쓴 `.mlpx`를 **인코딩만 잃은** 것으로 바꾼다. 내용은 한 바이트도 안 건드린다. */
  function asRezippedByExplorer(bytes: Uint8Array): Uint8Array {
    const mangled: Record<string, Uint8Array> = {}
    for (const [path, content] of Object.entries(unzipSync(bytes))) {
      const broken = path.replace(/[^/]+/g, (segment) =>
        CP949[segment] ? String.fromCharCode(...CP949[segment]) : segment,
      )
      mangled[broken] = content
    }
    return zipSync(mangled)
  }

  it('이름이 깨진 채로 와도 범주가 돌아온다', async () => {
    const before = imageProject()
    const { bytes } = await writeProjectBytes(before, markdown)
    const rezipped = asRezippedByExplorer(bytes)

    // 정말로 깨뜨렸는지 먼저 확인한다 — 안 그러면 아래가 조용히 통과한다.
    const brokenPaths = Object.keys(unzipSync(rezipped))
    expect(brokenPaths.some((path) => path.includes('°³'))).toBe(true)
    expect(brokenPaths.some((path) => path.includes('개'))).toBe(false)

    const { project: after, integrity } = await readProject(rezipped)
    expect([...after.images.keys()].sort()).toEqual([...before.images.keys()].sort())
    expect(integrity.status).toBe('UNCHANGED')
  })

  /**
   * **정답표가 없으면 되살리지 않는다.** `hashes.json`이 그 표이고, 그것이 이 자리에서
   * 추측을 0으로 만든다 — 없으면 맞댈 것이 없으므로 받은 그대로 둔다.
   */
  it('hashes.json이 없으면 깨진 이름 그대로 열린다', async () => {
    const { bytes } = await writeProjectBytes(imageProject(), markdown)
    const entries = unzipSync(asRezippedByExplorer(bytes))
    delete entries['hashes.json']

    const { project: after, integrity } = await readProject(zipSync(entries))
    expect([...after.images.keys()].some((path) => path.includes('개'))).toBe(false)
    expect(integrity.status).toBe('UNKNOWN')
  })
})
