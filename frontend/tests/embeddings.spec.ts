/**
 * 임베딩이 프로젝트에 앉고 파일을 왕복하는 것 (`project/embeddings.ts`, mlpx-spec.md §1.3).
 *
 * **여기가 조용히 틀리는 방식이 둘이다.** 벡터가 뒤집히거나(엔디언), 짝 없는 벡터가
 * 남는 것. 둘 다 예외를 안 던지고 성적만 이상해진다.
 */

import { describe, expect, it } from 'vitest'

import { imageEntryPath } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { hashBytes } from '../src/hash'
import {
  addEmbeddings,
  decodeVector,
  embeddingPath,
  encodeVector,
  readEmbeddings,
  removeEmbeddings,
} from '../src/project/embeddings'
import { newProjectDocument } from '../src/project/create'
import { readProject, writeProject, type ProjectFile } from '../src/project/format'
import { addImages, readImages, removeImages } from '../src/project/images'

const NOW = '2026-08-12T09:00:00.000Z'
const BACKBONE = 'mobilenet-v2'
const DIM = 4

function photo(seed: string): Uint8Array {
  return new TextEncoder().encode(`가짜jpg:${seed}`)
}

/** 사진이 실제로 든 프로젝트. **해시는 진짜로 계산한다** — 경로 규칙이 검사 대상이다. */
function imageProject(seeds: readonly string[]): ProjectFile {
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-12T08:00:00.000Z',
      randomState: 42,
    },
  )
  const empty: ProjectFile = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    seeds.map((seed) => {
      const bytes = photo(seed)
      return { hash: hashBytes(bytes), bytes, category: '개' }
    }),
    { canonicalSize: 224, now: NOW, format: 'webp' },
  ).project
}

describe('벡터를 바이트로 담고 되돌린다', () => {
  /**
   * **`Float32Array`의 바이트를 그대로 쓰면 그 기기의 엔디언이 파일에 새겨진다.**
   * 지금 쓰는 기기가 전부 리틀엔디언이라 어긋나도 아무 데서도 안 터지고, 빅엔디언
   * 기기에서 열었을 때 숫자가 조용히 뒤집힌 채로 학습된다.
   */
  it('리틀엔디언 float32로 담는다', () => {
    const bytes = encodeVector(new Float32Array([1]))
    // 1.0f = 0x3f800000. 리틀엔디언이면 낮은 바이트가 먼저다.
    expect([...bytes]).toEqual([0x00, 0x00, 0x80, 0x3f])
  })

  it('담았다 되돌리면 같은 값이다', () => {
    const vector = new Float32Array([0.5, -1.25, 0, 3.75])
    const back = decodeVector(encodeVector(vector), DIM)
    expect(back && [...back]).toEqual([...vector])
  })

  /**
   * 길이가 안 맞는 것은 깨진 파일이거나 다른 백본의 것이다. **던지지 않는다** —
   * 던지면 파일 하나가 통째로 안 열리고, 할 일은 그 사진만 다시 뽑는 것뿐이다.
   */
  it('길이가 안 맞으면 없는 것으로 본다', () => {
    expect(decodeVector(encodeVector(new Float32Array([1, 2])), DIM)).toBeNull()
  })
})

describe('프로젝트에 앉는다', () => {
  it('해시로 찾아 읽는다', () => {
    const project = imageProject(['a', 'b'])
    const [first] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      BACKBONE,
      new Map([[first!.hash, new Float32Array([1, 2, 3, 4])]]),
    )
    const found = readEmbeddings(withVectors, BACKBONE, DIM)
    expect([...found.keys()]).toEqual([first!.hash])
  })

  /**
   * **경로가 "어느 백본에서 나왔나"를 답한다** (mlpx-spec.md §1.3). 백본이 바뀌면 맞는
   * 디렉터리가 없고, 없으면 다시 뽑는다 — 무효 판정에 규칙이 따로 없다.
   */
  it('다른 백본의 것은 안 보인다', () => {
    const project = imageProject(['a'])
    const [only] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      'other-backbone',
      new Map([[only!.hash, new Float32Array([1, 2, 3, 4])]]),
    )
    expect(readEmbeddings(withVectors, BACKBONE, DIM).size).toBe(0)
  })

  /**
   * **개정한 백본의 것도 안 보여야 한다.** 우리가 백본을 고치는 방법은 id에 접미사를
   * 붙이는 것이고(`mobilenet-v2` -> `mobilenet-v2-r2`), 그러면 옛 id가 새 id의
   * **접두사**가 된다. 거르는 접두사가 `.../`로 끝나는 것이 그 둘을 가르는 유일한
   * 장치다 - 떼면 옛 백본이 새 좌표계의 벡터를 자기 것으로 읽고 조용히 틀린다
   * (open-decisions.md "백본 입력 범위가 그래프의 계약과 어긋났다").
   *
   * 위 검사는 글자가 아예 다른 이름을 쓰므로 이 축을 안 가른다.
   */
  it('개정한 백본의 것도 안 보인다 - 접두사가 아니라 폴더로 가른다', () => {
    const project = imageProject(['a'])
    const [only] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      `${BACKBONE}-r2`,
      new Map([[only!.hash, new Float32Array([1, 2, 3, 4])]]),
    )

    expect(readEmbeddings(withVectors, BACKBONE, DIM).size).toBe(0)
    expect(readEmbeddings(withVectors, `${BACKBONE}-r2`, DIM).size).toBe(1)
  })

  /**
   * 학생이 무엇을 바꾼 것이 아니라 우리가 계산을 캐시한 것이다. 여기서 시각이 움직이면
   * 파일을 받은 교사가 학생이 뭔가 한 줄로 읽는다.
   */
  it('앉혀도 마지막 수정 시각이 안 움직인다', () => {
    const project = imageProject(['a'])
    const [only] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      BACKBONE,
      new Map([[only!.hash, new Float32Array([1, 2, 3, 4])]]),
    )
    expect(withVectors.document.manifest.updatedAt).toBe(project.document.manifest.updatedAt)
  })

  /** 안 지우면 아무 사진의 것도 아닌 벡터가 계속 쌓인다. */
  it('사진을 지우면 임베딩도 함께 나간다', () => {
    const project = imageProject(['a', 'b'])
    const [first, second] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      BACKBONE,
      new Map([
        [first!.hash, new Float32Array([1, 2, 3, 4])],
        [second!.hash, new Float32Array([5, 6, 7, 8])],
      ]),
    )
    const left = removeImages(withVectors, [first!.hash], NOW)
    expect([...readEmbeddings(left, BACKBONE, DIM).keys()]).toEqual([second!.hash])
  })

  it('직접 뺄 수도 있다', () => {
    const project = imageProject(['a'])
    const [only] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      BACKBONE,
      new Map([[only!.hash, new Float32Array([1, 2, 3, 4])]]),
    )
    expect(removeEmbeddings(withVectors, [only!.hash]).embeddings.size).toBe(0)
  })
})

describe('.mlpx를 왕복한다', () => {
  async function roundTrip(project: ProjectFile): Promise<ProjectFile> {
    const { bytes } = await writeProject(project, '# 포트폴리오')
    const { project: opened } = await readProject(bytes)
    return opened
  }

  it('담았다 열면 그대로 있다', async () => {
    const project = imageProject(['a'])
    const [only] = readImages(project)
    const vector = new Float32Array([0.5, -1.25, 0, 3.75])
    const withVectors = addEmbeddings(project, BACKBONE, new Map([[only!.hash, vector]]))

    const opened = await roundTrip(withVectors)
    const found = readEmbeddings(opened, BACKBONE, DIM)
    expect(found.get(only!.hash) && [...found.get(only!.hash)!]).toEqual([...vector])
  })

  it('경로가 명세 그대로다', async () => {
    const project = imageProject(['a'])
    const [only] = readImages(project)
    const withVectors = addEmbeddings(
      project,
      BACKBONE,
      new Map([[only!.hash, new Float32Array([1, 2, 3, 4])]]),
    )
    const opened = await roundTrip(withVectors)
    expect([...opened.embeddings.keys()]).toEqual([embeddingPath(BACKBONE, only!.hash)])
    // 정본 사진과 이름이 같다 - 확장자만 다르다.
    expect(
      opened.images.has(imageEntryPath('data', only!.hash, '개', CANONICAL_FORMATS.webp)),
    ).toBe(true)
  })

  /**
   * **마지막 그물이다.** 사진 없이 남은 벡터를 들고 다니면 파일이 지운 사진 수만큼
   * 계속 자란다.
   */
  it('짝 없는 임베딩은 저장할 때 버린다', async () => {
    const project = imageProject(['a'])
    const orphan: ProjectFile = {
      ...project,
      embeddings: new Map([
        [embeddingPath(BACKBONE, 'deadbeef'), encodeVector(new Float32Array([1, 2, 3, 4]))],
      ]),
    }
    expect((await roundTrip(orphan)).embeddings.size).toBe(0)
  })

  /** 파생물이라 통째로 없는 파일이 정상이다. */
  it('임베딩이 없어도 열린다', async () => {
    const opened = await roundTrip(imageProject(['a']))
    expect(opened.embeddings.size).toBe(0)
    expect(opened.images.size).toBe(1)
  })
})
