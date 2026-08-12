// @vitest-environment jsdom
/**
 * 학습 화면이 무엇을 넘길지 준비하는 자리 (`ml/training-source.ts`).
 *
 * **jsdom이 필요한 이유는 `document`가 없으면 `location`을 보기 때문이다**
 * (`ml/embed/client.ts`의 `documentUrl` — 워커 안을 위한 분기다). node 환경에서는 둘
 * 다 없어서 모델 주소를 푸는 자리에서 죽는다.
 *
 * **제일 위험한 줄이 벡터를 자르는 자리다.** 워커는 사진 순서대로 이어 붙은 배열 하나를
 * 주고, 여기서 잘라 해시에 다시 붙인다 — 한 칸이라도 밀리면 **엉뚱한 사진의 임베딩으로
 * 학습하면서 아무 오류도 안 난다.**
 */

import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { backboneFor } from '../src/ml/backbones'
import type { EmbedMessage, EmbedRequest } from '../src/ml/embed/protocol'
import type { EmbedWorker } from '../src/ml/embed/client'
import { trainingSourceOf } from '../src/ml/training-source'
import { newProjectDocument } from '../src/project/create'
import { addEmbeddings, readEmbeddings } from '../src/project/embeddings'
import { type ProjectFile } from '../src/project/format'
import { addImages, readImages } from '../src/project/images'

const NOW = '2026-08-12T09:00:00.000Z'
const BACKBONE = backboneFor('mobilenet-v2')!
const DIM = BACKBONE.embeddingDim

function photo(seed: string): Uint8Array {
  return new TextEncoder().encode(`가짜jpg:${seed}`)
}

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
    embeddings: new Map(),
  }
  return addImages(
    empty,
    seeds.map((seed) => {
      const bytes = photo(seed)
      return { hash: hashBytes(bytes), bytes, category: '개' }
    }),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW },
  ).project
}

/**
 * 가짜 임베딩 워커. **받은 사진의 첫 바이트를 벡터 전체에 채워 돌려준다** — 어느 사진의
 * 벡터인지 값만 보고 알 수 있어야 자르는 순서를 검사할 수 있다.
 */
function fakeWorker(seen: { requests: EmbedRequest[] }): EmbedWorker {
  const worker: EmbedWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(request) {
      seen.requests.push(request)
      const vectors = new Float32Array(request.images.length * DIM)
      request.images.forEach((image, index) => {
        vectors.fill(image[0] ?? 0, index * DIM, (index + 1) * DIM)
      })
      const message: EmbedMessage = { type: 'done', vectors, dim: DIM }
      queueMicrotask(() => worker.onmessage?.({ data: message } as MessageEvent<EmbedMessage>))
    },
    terminate() {},
  }
  return worker
}

describe('표는 정본을 그대로 넘긴다', () => {
  it('정본이 없으면 거부한다 - 조용히 빈 표로 학습하면 지표가 NaN인 채로 끝난다', async () => {
    const document = newProjectDocument(
      { name: '붓꽃', locale: 'ko', dataType: 'tabular' },
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
      embeddings: new Map(),
    }
    // **던지는 것이 아니라 거부한다.** 둘이 섞이면 부르는 쪽이 한쪽을 빠뜨린다.
    await expect(trainingSourceOf({ project: empty, taskType: 'classification' })).rejects.toThrow()
  })
})

describe('이미지는 없는 것만 뽑는다', () => {
  it('다 있으면 워커를 안 띄운다', async () => {
    const project = imageProject(['a', 'b'])
    const vectors = new Map(
      readImages(project).map((entry, index) => [
        entry.hash,
        new Float32Array(DIM).fill(index + 1),
      ]),
    )
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: addEmbeddings(project, BACKBONE.id, vectors),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(seen.requests).toEqual([])
    expect(source.dataset.rows).toHaveLength(2)
  })

  it('없는 것만 워커에 넘긴다', async () => {
    const project = imageProject(['a', 'b', 'c'])
    const [first] = readImages(project)
    const seen = { requests: [] as EmbedRequest[] }
    await trainingSourceOf({
      project: addEmbeddings(
        project,
        BACKBONE.id,
        new Map([[first!.hash, new Float32Array(DIM).fill(9)]]),
      ),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(seen.requests[0]?.images).toHaveLength(2)
  })

  /**
   * **여기가 조용히 틀리는 자리다.** 워커는 벡터를 이어 붙여 하나로 주고, 그것을 잘라
   * 해시에 다시 붙인다. 한 칸 밀리면 개 사진이 고양이의 벡터를 갖는다.
   */
  it('이어 붙은 벡터를 사진마다 제 몫으로 자른다', async () => {
    const project = imageProject(['a', 'b', 'c'])
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project,
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })

    const stored = readEmbeddings(source.project, BACKBONE.id, DIM)
    for (const entry of readImages(project)) {
      // 가짜 워커가 채워 준 값은 그 사진의 첫 바이트다.
      expect(stored.get(entry.hash)?.[0], entry.hash).toBe(entry.bytes[0])
    }
  })

  /** 뽑은 것이 프로젝트에 남아야 다음 학습에서 다시 안 뽑는다 (mlpx-spec.md §1.3). */
  it('뽑은 임베딩이 프로젝트에 붙어서 나온다', async () => {
    const project = imageProject(['a', 'b'])
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project,
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(project.embeddings.size).toBe(0)
    expect(readEmbeddings(source.project, BACKBONE.id, DIM).size).toBe(2)
  })

  /** 사진 꾸러미로 평가 데이터를 받는 길은 아직 없다. */
  it('평가 데이터는 아직 없다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: imageProject(['a']),
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(source.testDataset).toBeNull()
  })

  /** 결과 화면이 사진을 되찾는 길이다. */
  it('행 번호가 사진 해시로 되돌아간다', async () => {
    const project = imageProject(['a', 'b'])
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project,
      taskType: 'clustering',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(source.rowKeys).toEqual(readImages(project).map((entry) => entry.hash))
  })
})
