/**
 * 이미지 프로젝트를 표 문제로 바꾸는 어댑터 (`ml/images.ts`).
 *
 * **여기가 틀리면 학습은 멀쩡히 돌고 성적만 이상해진다.** 행과 라벨이 어긋나거나,
 * 안 쓸 사진이 섞여 들어가거나, 파일에 남는 기록이 계산에 쓴 표를 그대로 베끼거나 —
 * 셋 다 예외를 안 던진다.
 */

import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { backboneFor } from '../src/ml/backbones'
import {
  embeddingColumns,
  IMAGE_LABEL_COLUMN,
  imageTrainingSource,
  pendingEmbeddings,
} from '../src/ml/images'
import { newProjectDocument } from '../src/project/create'
import { IMAGE_UNLABELED, type ProjectFile } from '../src/project/format'
import { addCategory, addImages, readImages } from '../src/project/images'
import { dataSettings } from '../src/project/schema'

const NOW = '2026-08-12T09:00:00.000Z'
const BACKBONE = backboneFor('mobilenet-v2')!
const DIM = BACKBONE.embeddingDim

function photo(seed: string): Uint8Array {
  return new TextEncoder().encode(`가짜jpg:${seed}`)
}

/** 범주를 정해 사진을 넣은 프로젝트. 해시는 실제로 계산한다. */
function imageProject(items: readonly { seed: string; category: string }[]): ProjectFile {
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
    items.map((item) => {
      const bytes = photo(item.seed)
      return { hash: hashBytes(bytes), bytes, category: item.category }
    }),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
  ).project
}

/** 사진마다 알아볼 수 있는 벡터 하나. 값 자체는 어댑터가 안 본다. */
function vectorsFor(project: ProjectFile): Map<string, Float32Array> {
  const vectors = new Map<string, Float32Array>()
  for (const [index, entry] of readImages(project).entries()) {
    vectors.set(entry.hash, new Float32Array(DIM).fill(index + 1))
  }
  return vectors
}

describe('임베딩을 표로 바꾼다', () => {
  const project = imageProject([
    { seed: 'a', category: '개' },
    { seed: 'b', category: '고양이' },
    { seed: 'c', category: IMAGE_UNLABELED },
  ])

  it('열 이름이 f0부터 시작하고 끝에 타깃이 붙는다', () => {
    const source = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'classification')
    expect(source.dataset.columns).toHaveLength(DIM + 1)
    expect(source.dataset.columns[0]).toBe('f0')
    expect(source.dataset.columns[DIM - 1]).toBe(`f${DIM - 1}`)
    expect(source.dataset.columns[DIM]).toBe(IMAGE_LABEL_COLUMN)
  })

  /**
   * 라벨 없는 사진은 학습에 안 들어간다. **표에서 타깃이 빈 행이 빠지는 것과 같다**
   * (open-decisions.md "이미지 프로젝트의 데이터 화면").
   */
  it('분류는 라벨 붙은 사진만 쓴다', () => {
    const source = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'classification')
    expect(source.dataset.rows).toHaveLength(2)
    expect(source.dataset.rows.map((row) => row[DIM])).toEqual(['개', '고양이'])
  })

  /** 군집은 범주에 상관없이 올린 사진 전부를 쓴다. 타깃 열 자체가 없다. */
  it('군집은 라벨 없는 것까지 전부 쓴다', () => {
    const source = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'clustering')
    expect(source.dataset.rows).toHaveLength(3)
    expect(source.dataset.columns).toHaveLength(DIM)
    expect(dataSettings('tabular', source.settings).target).toBeUndefined()
  })

  /** `Dataset`의 칸이 문자열이라 한 번 왕복한다. float32 값은 그대로 되돌아온다. */
  it('숫자를 문자열로 왕복해도 값이 안 바뀐다', () => {
    const [only] = readImages(project)
    const vector = new Float32Array(DIM).fill(0)
    vector[0] = 0.30000001192092896
    vector[1] = -1.25
    const source = imageTrainingSource(
      project,
      new Map([[only!.hash, vector]]),
      BACKBONE,
      'clustering',
    )
    const row = source.dataset.rows[0]
    expect(Number(row?.[0])).toBe(vector[0])
    expect(Number(row?.[1])).toBe(vector[1])
  })

  /**
   * **정상 경로에서는 하나도 없다** — 부르는 쪽이 먼저 채운다. 그래도 조용히 빼는
   * 이유는 한 장 때문에 학습 전체가 막히는 것이 더 나쁘기 때문이다.
   */
  it('임베딩이 없는 사진은 빠진다', () => {
    const [first] = readImages(project)
    const vectors = vectorsFor(project)
    vectors.delete(first!.hash)
    const source = imageTrainingSource(project, vectors, BACKBONE, 'clustering')
    expect(source.dataset.rows).toHaveLength(2)
    expect(source.hashes).not.toContain(first!.hash)
  })

  /** 결과 화면이 사진을 되찾는 길이다. 어긋나면 엉뚱한 사진이 그 군집에 뜬다. */
  it('행 번호가 사진으로 되돌아간다', () => {
    const source = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'clustering')
    expect(source.hashes).toEqual(readImages(project).map((entry) => entry.hash))
  })

  /**
   * 스케일링이 이미지에서 무슨 뜻인지 아직 안 정했다. 정해지기 전에 뭔가를 켜 두면
   * 그게 기본값으로 굳는다.
   */
  it('전처리는 셋 다 꺼진 채로 간다', () => {
    const source = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'classification')
    // **표의 스키마로 읽힌다.** 어댑터가 만든 것이 표의 모양이라는 것 자체가 검사다.
    const data = dataSettings('tabular', source.settings)
    expect(data.preprocessing.missing).toBe('none')
    expect(data.preprocessing.scaling).toBe('none')
  })

  /** 분할·실행 방법·모델은 프로젝트의 것을 그대로 쓴다. 갈리는 것은 `data`뿐이다. */
  it('나머지 설정은 프로젝트 것을 그대로 쓴다', () => {
    const source = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'classification')
    expect(source.settings.split).toEqual(project.document.settings.split)
    expect(source.settings.runtime).toBe(project.document.settings.runtime)
  })
})

describe('파일에 남는 기록은 표가 아니다', () => {
  const project = addCategory(
    imageProject([
      { seed: 'a', category: '개' },
      { seed: 'b', category: '개' },
      { seed: 'c', category: '고양이' },
      { seed: 'd', category: IMAGE_UNLABELED },
    ]),
    '토끼',
    NOW,
  )

  it('범주와 백본이 남는다', () => {
    const { snapshot } = imageTrainingSource(
      project,
      vectorsFor(project),
      BACKBONE,
      'classification',
    )
    expect(snapshot.categories).toEqual(['개', '고양이', '토끼'])
    expect(snapshot.backboneId).toBe(BACKBONE.id)
  })

  /** 순서가 다르면 이력이 엉뚱한 범주의 장수가 바뀌었다고 말한다. */
  it('장수가 범주 목록과 같은 순서다', () => {
    const { snapshot } = imageTrainingSource(
      project,
      vectorsFor(project),
      BACKBONE,
      'classification',
    )
    expect(snapshot.categoryCounts).toEqual([2, 1, 0])
    expect(snapshot.unlabeledCount).toBe(1)
  })

  /**
   * **분류에서 안 쓴 사진도 센다.** 세는 것은 "학습에 들어간 행"이 아니라 "프로젝트에
   * 든 사진"이다 — 군집은 그 사진들까지 쓰고, 이력은 두 유형에서 같은 것을 세야 한다.
   */
  it('라벨 없는 사진도 센다', () => {
    const { snapshot } = imageTrainingSource(project, vectorsFor(project), BACKBONE, 'clustering')
    expect(snapshot.unlabeledCount).toBe(1)
  })
})

describe('아직 안 뽑은 사진', () => {
  const project = imageProject([
    { seed: 'a', category: '개' },
    { seed: 'b', category: '고양이' },
  ])

  it('없는 것만 준다', () => {
    const [first, second] = readImages(project)
    expect(pendingEmbeddings(project, new Set([first!.hash])).map((one) => one.hash)).toEqual([
      second!.hash,
    ])
  })

  it('다 있으면 비어 있다', () => {
    const have = new Set(readImages(project).map((entry) => entry.hash))
    expect(pendingEmbeddings(project, have)).toEqual([])
  })
})

describe('열 이름', () => {
  it('0부터 센다 - 파이썬 관행이다', () => {
    expect(embeddingColumns(3)).toEqual(['f0', 'f1', 'f2'])
  })
})
