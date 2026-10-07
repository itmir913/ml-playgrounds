/**
 * **범주 편집이 테스트 자리도 고친다** (open-decisions.md 106 개정 2, R43-1 후속 계획 5차).
 *
 * 전에는 범주 이름을 바꾸거나 지워도 테스트 자리(`dataset/test/<옛 이름>/`)는 그대로였고, 학습 입구의 대조(결정 106)가
 * 막아 학생이 테스트 사진을 다시 올려야 했다. 이제 이름 바꾸기는 테스트 사진도 옮기고, 지우기는 그 범주의 테스트 사진을 지운다.
 * **테스트 자리에만 남은 이름으로 바꾸기는 거절한다** — 두 범주가 합쳐져 옛 테스트 사진이 새 범주의 정답으로 채점된다.
 * 판정은 술어 하나(`renameCollidesWithTest`)를 gate와 `renameCategory`가 함께 부른다.
 */

import { describe, expect, it } from 'vitest'

import { imageEntryPath } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { renameCollidesWithTest, testZipBlockFor } from '../src/data/image/test-set'
import { refusalFor } from '../src/locks'
import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { newProjectDocument } from '../src/project/create'
import { addEmbeddings, readEmbeddings } from '../src/project/embeddings'
import { readProject, writeProject, type ProjectFile } from '../src/project/format'
import {
  addCategory,
  addImages,
  applyTestImages,
  imageCategories,
  readImages,
  removeCategory,
  renameCategory,
  testCountByCategory,
  trainedCategories,
} from '../src/project/images'
import { dataSettings } from '../src/project/schema'

const NOW = '2026-10-07T09:00:00.000Z'
const OPTIONS = { canonicalSize: 224, now: NOW, format: 'webp' } as const

interface Photo {
  readonly hash: string
  readonly category: string
}

function emptyProject(): ProjectFile {
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-10-07T08:00:00.000Z',
      randomState: 42,
    },
  )
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

const baked = (photos: readonly Photo[]) =>
  photos.map((photo) => ({ ...photo, bytes: new Uint8Array([1, 2, 3]) }))

/** 훈련 사진과 테스트 사진. `applyTestImages`는 범주를 대조하지 않으므로 고아 테스트 범주도 세울 수 있다. */
function projectWith(train: readonly Photo[], test: readonly Photo[]): ProjectFile {
  const trained = addImages(emptyProject(), baked(train), OPTIONS).project
  return applyTestImages(trained, baked(test), OPTIONS).project
}

/** 실험 기록 하나를 심는다. 여기서 보는 것은 **남는가**뿐이라 모양은 안 본다. */
function withExperiment(project: ProjectFile): ProjectFile {
  const { document } = project
  const experiment = { id: 'exp-1' } as unknown as (typeof document.runs.experiments)[number]
  return {
    ...project,
    document: { ...document, runs: { ...document.runs, experiments: [experiment] } },
  }
}

const placed = (project: ProjectFile, role: 'data' | 'test'): readonly string[] =>
  readImages(project, role).map((entry) => `${entry.category}/${entry.hash}`)

const testCategoriesOf = (project: ProjectFile): readonly string[] => [
  ...new Set(readImages(project, 'test').map((entry) => entry.category)),
]

/** 학습 입구의 대조(결정 106)와 같은 판정. */
const trainingBlock = (project: ProjectFile) =>
  testZipBlockFor(trainedCategories(project), testCategoriesOf(project))

describe('이름 바꾸기는 테스트 사진도 옮긴다', () => {
  it('훈련과 테스트가 함께 새 이름으로 가고, 학습 입구의 대조가 통과한다', () => {
    const before = projectWith(
      [
        { hash: 'a', category: '고양이' },
        { hash: 'b', category: '개' },
      ],
      [
        { hash: 'ta', category: '고양이' },
        { hash: 'tb', category: '개' },
      ],
    )
    const after = renameCategory(before, '고양이', 'cat', NOW)

    expect(placed(after, 'data')).toEqual(['cat/a', '개/b'])
    expect(placed(after, 'test')).toEqual(['cat/ta', '개/tb'])
    expect(trainingBlock(after)).toBeNull()
  })
})

describe('테스트 자리에만 남은 이름으로는 못 바꾼다 — 만들기는 된다', () => {
  /**
   * 고아 테스트 범주 `C` — 화면의 범주 목록에는 없다(옛 파일·손으로 고친 파일). 테스트 사진을 앉히면 그 범주가 목록에 서므로
   * 목록을 손으로 되돌린다.
   */
  function orphaned(): ProjectFile {
    const project = projectWith(
      [
        { hash: 'a', category: 'A' },
        { hash: 'b', category: 'B' },
      ],
      [
        { hash: 'ta', category: 'A' },
        { hash: 'tb', category: 'B' },
        { hash: 'tc', category: 'C' },
      ],
    )
    const { document } = project
    const data = { ...dataSettings('image', document.settings), categories: ['A', 'B'] }
    return {
      ...project,
      document: {
        ...document,
        settings: { ...document.settings, data: data as typeof document.settings.data },
      },
    }
  }

  const nameInput = (
    project: ProjectFile,
    mode: 'create' | 'rename',
    from: string,
    value: string,
  ) => ({
    mode,
    from,
    value,
    categories: imageCategories(project),
    testCategories: testCategoriesOf(project),
  })

  it('술어 — 지금 범주에 없고 테스트 자리에 있을 때만 참이다', () => {
    const categories = ['A', 'B']
    const testCategories = ['A', 'B', 'C']
    expect(renameCollidesWithTest({ categories, testCategories, to: 'C' })).toBe(true)
    expect(renameCollidesWithTest({ categories, testCategories, to: 'B' })).toBe(false)
    expect(renameCollidesWithTest({ categories, testCategories, to: 'D' })).toBe(false)
  })

  it('이름 창의 gate — 바꾸기는 nameTakenByTest, 만들기는 통과', () => {
    const project = orphaned()
    expect(imageCategories(project)).toEqual(['A', 'B'])
    expect(refusalFor('categoryName', nameInput(project, 'rename', 'A', ' C '))).toEqual([
      'nameTakenByTest',
    ])
    expect(refusalFor('categoryName', nameInput(project, 'create', '', 'C'))).toEqual([])
    // 화면의 범주와 겹치면 지금처럼 nameTaken이 먼저다. 제 이름 그대로는 거절이 아니다.
    expect(refusalFor('categoryName', nameInput(project, 'rename', 'A', 'B'))).toEqual([
      'nameTaken',
    ])
    expect(refusalFor('categoryName', nameInput(project, 'rename', 'A', 'A'))).toEqual([])
  })

  /** 윈도우에서 한 폴더가 된다 (R43-5 B-1). 자기 이름의 대소문자만 바꾸는 것은 받는다. */
  it('대소문자만 다른 이름도 nameTaken이다', () => {
    const project = orphaned()
    expect(refusalFor('categoryName', nameInput(project, 'create', '', 'a'))).toEqual(['nameTaken'])
    expect(refusalFor('categoryName', nameInput(project, 'rename', 'A', 'b'))).toEqual([
      'nameTaken',
    ])
    expect(refusalFor('categoryName', nameInput(project, 'rename', 'A', 'a'))).toEqual([])
  })

  it('함수 — 바꾸기는 영어 Error로 던지고 파일을 안 바꾼다, 만들기는 된다', () => {
    const project = orphaned()
    expect(() => renameCategory(project, 'A', 'C', NOW)).toThrow(/test images/)
    expect(imageCategories(addCategory(project, 'C', NOW))).toEqual(['A', 'B', 'C'])
  })
})

describe('범주를 지우면 그 범주의 테스트 사진도 지운다', () => {
  it('그 범주의 테스트 사진만 지우고, 훈련 사진은 라벨만 떼고, 실험과 분할은 그대로다', () => {
    const before = withExperiment(
      projectWith(
        [
          { hash: 'a', category: 'A' },
          { hash: 'b', category: 'B' },
          { hash: 'c', category: 'C' },
        ],
        [
          { hash: 'ta', category: 'A' },
          { hash: 'tb', category: 'B' },
          { hash: 'tc', category: 'C' },
        ],
      ),
    )
    // 확인 창이 말하는 장수.
    expect(testCountByCategory(before).get('C')).toBe(1)

    const after = removeCategory(before, 'C', NOW)

    expect(placed(after, 'test')).toEqual(['A/ta', 'B/tb'])
    expect(placed(after, 'data')).toEqual(['A/a', 'B/b', '_unlabeled/c'])
    expect(after.document.settings.split.method).toBe('provided')
    expect(after.document.runs.experiments).toHaveLength(1)
    expect(trainingBlock(after)).toBeNull()
  })

  /**
   * **경로로 지운다** (R43-1 후속 2차 지적 4). 해시로 지우면 손으로 고친 파일에서 같은 해시가 다른 테스트 범주에 함께 있을 때
   * 그쪽까지 지운다. 임베딩은 그 해시가 어느 자리에도 안 남을 때만 지운다.
   */
  it('같은 해시가 다른 테스트 범주에 있으면 그쪽과 그 임베딩은 남는다', () => {
    const base = projectWith(
      [
        { hash: 'a', category: 'A' },
        { hash: 'b', category: 'B' },
      ],
      [
        { hash: 'x', category: 'A' },
        { hash: 'y', category: 'A' },
      ],
    )
    const images = new Map(base.images)
    images.set(imageEntryPath('test', 'x', 'B', CANONICAL_FORMATS.webp), new Uint8Array([1, 2, 3]))
    const before = addEmbeddings(
      { ...base, images },
      DEFAULT_BACKBONE_ID,
      new Map([
        ['x', new Float32Array([1, 2])],
        ['y', new Float32Array([3, 4])],
      ]),
    )

    const after = removeCategory(before, 'A', NOW)

    expect(placed(after, 'test')).toEqual(['B/x'])
    expect([...readEmbeddings(after, DEFAULT_BACKBONE_ID, 2).keys()]).toEqual(['x'])
  })

  it('테스트가 0장이 되면 참조를 떼고 holdout으로 — 실험은 남는다', () => {
    const before = withExperiment(
      projectWith(
        [
          { hash: 'a', category: 'A' },
          { hash: 'b', category: 'B' },
        ],
        [{ hash: 'ta', category: 'A' }],
      ),
    )
    const after = removeCategory(before, 'A', NOW)

    expect(readImages(after, 'test')).toEqual([])
    expect(dataSettings('image', after.document.settings).testDataset).toBeUndefined()
    expect(after.document.settings.split.method).toBe('holdout')
    expect(after.document.runs.experiments).toHaveLength(1)
  })

  it('0장이 되어 holdout으로 돌린 파일은 .mlpx로 나가고 다시 열린다', async () => {
    const before = projectWith(
      [
        { hash: 'a', category: 'A' },
        { hash: 'b', category: 'B' },
      ],
      [{ hash: 'ta', category: 'A' }],
    )
    const after = removeCategory(before, 'A', NOW)

    const { blob } = await writeProject(after, '# x\n')
    const reopened = await readProject(new Uint8Array(await blob.arrayBuffer()))

    expect(reopened.project.document.settings.split.method).toBe('holdout')
    expect(placed(reopened.project, 'data')).toEqual(['B/b', '_unlabeled/a'])
    expect(readImages(reopened.project, 'test')).toEqual([])
  })
})
