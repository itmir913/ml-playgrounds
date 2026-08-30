/**
 * 학습 화면이 무엇을 넘길지 준비하는 자리 (`ml/training-source.ts`).
 *
 * **jsdom 선언을 뗐다** (2026-08-19, R7 감사 B-13). 근거로 `ml/embed/client.ts`의
 * `documentUrl`을 들고 있었는데 **그 이름은 저장소 어디에도 없다** — 이 주석 한 줄에만
 * 있었다. 떼고 돌려도 일곱 개가 전부 통과한다.
 *
 * **제일 위험한 줄이 벡터를 자르는 자리다.** 워커는 사진 순서대로 이어 붙은 배열 하나를
 * 주고, 여기서 잘라 해시에 다시 붙인다 — 한 칸이라도 밀리면 **엉뚱한 사진의 임베딩으로
 * 학습하면서 아무 오류도 안 난다.**
 */

import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import type { EmbedMessage, EmbedRequest } from '../src/ml/embed/protocol'
import type { EmbedWorker } from '../src/ml/embed/client'
import { runtimeContextFor, trainableRowsOf, trainingSourceOf } from '../src/ml/training-source'
import { newProjectDocument } from '../src/project/create'
import { addEmbeddings, readEmbeddings } from '../src/project/embeddings'
import { type ProjectFile } from '../src/project/format'
import { addImages, applyTestImages, readImages } from '../src/project/images'
import { withSplit } from '../src/project/settings'
import { IMAGE_UNLABELED } from '../src/project/format'

const NOW = '2026-08-12T09:00:00.000Z'
const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
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
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    seeds.map((seed) => {
      const bytes = photo(seed)
      return { hash: hashBytes(bytes), bytes, category: '개' }
    }),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
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
      attachments: new Map(),
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

  /** 테스트 사진을 안 올렸으면 나눌 것도 채점할 것도 파일에서 안 온다. */
  it('테스트 사진이 없으면 테스트 표도 없다', async () => {
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

/**
 * **테스트용 사진이 학습까지 닿는가** (R11 감사 A-1·A-2).
 *
 * **임베딩을 미리 채우지 않는다.** 그것이 이 블록의 전부다 — 미리 채운 픽스처는 뽑는
 * 경로를 한 번도 안 지나가므로, **테스트 사진의 임베딩을 안 뽑는 돌연변이가 초록으로
 * 살아남았다.** 그 돌연변이가 만드는 동작이 정확히 R10 A-1(배포되어 나갔던 결함)이다.
 *
 * 사진마다 첫 바이트를 달리 준다 — 가짜 워커가 그 값을 벡터에 채우므로 **어느 사진의
 * 벡터가 어느 줄에 앉았는지**를 값만 보고 가를 수 있다.
 */
describe('테스트용 사진이 학습까지 닿는다', () => {
  const SIZE = BACKBONE.canonicalSize

  function baked(mark: number, category: string) {
    const bytes = new Uint8Array([mark, 2, 3])
    return { hash: hashBytes(bytes), bytes, category }
  }

  /** 훈련 둘·테스트 둘. **임베딩은 하나도 없다** — 실물에서 막 올린 상태다. */
  function project(): ProjectFile {
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
    const base = addImages(empty, [baked(1, '개'), baked(2, '고양이')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
    return applyTestImages(base, [baked(3, '개'), baked(4, '고양이')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
  }

  it('테스트 사진의 임베딩도 함께 뽑는다 - 안 뽑으면 채점할 것이 없다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: project(),
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })

    // 넷 다 뽑혀야 한다. 훈련 둘만 뽑으면 아래 표가 비고 학습이 곱게 선다.
    expect(seen.requests[0]?.images).toHaveLength(4)
    expect(source.testDataset, '테스트 사진을 올렸는데 표가 없다').not.toBeNull()
    expect(source.testDataset?.rows).toHaveLength(2)
  })

  /**
   * **채점할 자리가 없으면 안 뽑는다** (2026-08-30, R12 감사 C-5).
   *
   * `scored`의 `split.method === 'provided'` 조건을 떼도 저장소 전체가 초록이었다.
   * 떼면 holdout 분류에서도 테스트 자리를 훑어 **백본을 그만큼 더 돌린다** — 사진이
   * 많은 프로젝트에서 그것이 곧 학생이 기다리는 시간이다. 점수가 틀려지지는 않는다
   * (`experiment.ts`의 `testSource`가 같은 조건을 한 번 더 본다).
   */
  it('holdout이면 테스트 사진의 임베딩을 안 뽑는다', async () => {
    const base = project()
    const holdout: ProjectFile = {
      ...base,
      document: withSplit(base.document, { method: 'holdout' }, NOW),
    }
    const seen = { requests: [] as EmbedRequest[] }

    await trainingSourceOf({
      project: holdout,
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })

    // 훈련 둘만이다. 넷이면 테스트 자리까지 훑은 것이다.
    expect(seen.requests[0]?.images).toHaveLength(2)
  })

  /**
   * **라벨 없는 사진은 분류의 훈련 행이 아니다** (2026-08-30, R12 감사 C-5).
   *
   * 이 수가 `ml/backend.ts`의 실행 위치·상한 판정으로 간다 — R12-4 A-1이 잡은 것과
   * 같은 계통이라 **틀려도 예외가 안 나고 카드의 숫자만 조용히 어긋난다.**
   * 군집화에는 라벨이 없으므로 그때는 전부 센다.
   */
  it('라벨 없는 사진을 분류는 안 세고 군집은 센다', () => {
    const base = project()
    const withUnlabeled = addImages(base, [baked(9, IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project

    expect(trainableRowsOf(withUnlabeled, 'classification')).toBe(2)
    expect(trainableRowsOf(withUnlabeled, 'clustering')).toBe(3)
  })

  /**
   * **값이 옳은 자리에 앉는가.** 열 이름과 줄 수만 보면 라벨을 앞에 붙여도 통과한다 —
   * 그 상태에서 학습은 예외 없이 끝까지 돌고 **정확도만 바닥으로 나온다.**
   */
  it('테스트 표는 벡터 뒤에 라벨이다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: project(),
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })

    const rows = source.testDataset?.rows ?? []
    for (const row of rows) {
      // 마지막 칸이 라벨, 나머지가 벡터다.
      expect(row).toHaveLength(DIM + 1)
      expect(row[DIM], '마지막 칸이 라벨이 아니다').toMatch(/개|고양이/)
      expect(Number(row[0]), '첫 칸이 벡터가 아니다').toBeGreaterThan(0)
    }
    // 3번 사진이 개, 4번이 고양이 - 벡터 값과 라벨이 짝을 지켜야 한다.
    expect(rows.map((row) => [row[0], row[DIM]])).toEqual([
      ['3', '개'],
      ['4', '고양이'],
    ])
  })

  /** 훈련 표에는 테스트 사진이 섞이지 않는다. 섞이면 점수가 자기 답을 다시 맞힌 값이 된다. */
  it('훈련 표에는 테스트 사진이 없다', async () => {
    const seen = { requests: [] as EmbedRequest[] }
    const source = await trainingSourceOf({
      project: project(),
      taskType: 'classification',
      createEmbedWorker: () => fakeWorker(seen),
    })
    expect(source.dataset.rows.map((row) => row[0])).toEqual(['1', '2'])
  })
})

/**
 * **화면이 등록부에 넘기는 것.**
 *
 * 학습 화면 안의 computed로 있던 동안 `dataType`을 기본 종류로 고정해도 저장소 전체가
 * 초록이었고 타입도 조용했다 (R13-3 감사 A-2). 타입이 필수로 만들어 두어 빠뜨릴 수는
 * 없지만 **틀린 값을 넣는 것은 아무도 안 봤다** — 그러면 사진 프로젝트가 표의 상한
 * 칸으로 재어지고, 사유 코드가 갈려 사진을 지워야 할 학생이 "행을 줄이라"를 읽는다.
 */
describe('실행 방법 판정에 넘기는 것', () => {
  it('이미지 프로젝트는 이미지 종류로 넘어간다', () => {
    const context = runtimeContextFor(imageProject(['a', 'b']), 'classification', 'tabular')

    expect(context.dataType).toBe('image')
  })

  it('사진 수를 센다 - 파일의 행 수가 아니다', () => {
    const project = imageProject(['a', 'b', 'c'])

    expect(runtimeContextFor(project, 'classification', 'tabular').rowCount).toBe(
      trainableRowsOf(project, 'classification'),
    )
    expect(runtimeContextFor(project, 'classification', 'tabular').rowCount).toBe(3)
  })

  it('프로젝트가 없으면 0행이고 서버 상태는 모른다', () => {
    const context = runtimeContextFor(null, undefined, 'tabular')

    expect(context.rowCount).toBe(0)
    expect(context.serverStatus).toBe('unknown')
  })
})
