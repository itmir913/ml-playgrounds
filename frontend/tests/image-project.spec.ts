/**
 * 정본 사진이 프로젝트에 앉고 범주 사이를 옮겨 다니는 것 (`project/images.ts`).
 *
 * **여기서 틀리면 학생이 분류해 둔 것이 조용히 풀린다.** 라벨이 경로에만 있으므로
 * 열쇠를 하나 잘못 만들면 사진이 사라진 것처럼 보이고, 되돌릴 방법은 다시 올리는 것뿐이다.
 */

import { describe, expect, it } from 'vitest'

import {
  addCategory,
  addImages,
  countByCategory,
  imageCategories,
  moveImages,
  readImages,
  removeCategory,
  removeImages,
  renameCategory,
} from '../src/project/images'
import { newProjectDocument } from '../src/project/create'
import { IMAGE_UNLABELED, type ProjectFile } from '../src/project/format'
import { dataSettings, parseProjectDocument } from '../src/project/schema'

const NOW = '2026-08-12T09:00:00.000Z'
/** 백본이 주는 값이다. 여기서는 참조에 그대로 적히는지만 본다. */
const SIZE = 224

function emptyProject(): ProjectFile {
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-12T08:00:00.000Z',
      randomState: 42,
    },
  )
  return { document, models: new Map(), images: new Map(), embeddings: new Map() }
}

/** 해시 자리에 알아볼 수 있는 문자열을 넣는다. 여기서 보는 것은 자리이지 해시가 아니다. */
function baked(hash: string, category: string) {
  return { hash, category, bytes: new Uint8Array([1, 2, 3]) }
}

function withPhotos(...items: readonly { hash: string; category: string }[]): ProjectFile {
  return addImages(
    emptyProject(),
    items.map((item) => baked(item.hash, item.category)),
    { canonicalSize: SIZE, now: NOW },
  ).project
}

describe('사진을 프로젝트에 앉힌다', () => {
  it('폴더가 라벨이 된다', () => {
    const project = withPhotos({ hash: 'a', category: '개' }, { hash: 'b', category: '고양이' })
    expect(readImages(project).map((entry) => [entry.hash, entry.category])).toEqual([
      ['a', '개'],
      ['b', '고양이'],
    ])
  })

  it('올린 범주가 목록에 선다', () => {
    const project = withPhotos({ hash: 'a', category: '개' }, { hash: 'b', category: '고양이' })
    expect(imageCategories(project)).toEqual(['개', '고양이'])
  })

  /** 범주가 아니라 상태다. 목록에 들어가면 화면이 그것도 범주 하나로 그린다. */
  it('라벨 없음은 범주 목록에 안 들어간다', () => {
    const project = withPhotos({ hash: 'a', category: IMAGE_UNLABELED })
    expect(imageCategories(project)).toEqual([])
    expect(countByCategory(project).get(IMAGE_UNLABELED)).toBe(1)
  })

  /**
   * **정본을 구운 조건이 그때의 사실로 남는다.** `limits.ts`의 품질을 나중에 올려도
   * 옛 파일은 안 흔들리고, "왜 이 프로젝트만 흐린가"에 답할 수 있다.
   */
  it('정본 참조가 굽는 조건과 함께 선다', () => {
    const project = withPhotos({ hash: 'a', category: '개' })
    const { dataset } = dataSettings('image', project.document.settings)
    expect(dataset?.canonicalSize).toBe(SIZE)
    expect(dataset?.jpegQuality).toBeGreaterThan(0)
    // 폴더 참조는 슬래시로 끝나야 한다 - 안 그러면 파일 참조로 읽혀 저장이 어긋난다.
    expect(dataset?.path.endsWith('/')).toBe(true)
  })

  it('앉힌 프로젝트가 스키마를 통과한다', () => {
    const project = withPhotos({ hash: 'a', category: '개' })
    expect(() => parseProjectDocument(project.document)).not.toThrow()
  })

  /** 이름이 곧 내용이라 저절로 걸러진다. 그래도 세어서 말한다. */
  it('같은 사진을 다시 올리면 장수가 안 는다', () => {
    const first = withPhotos({ hash: 'a', category: '개' })
    const again = addImages(first, [baked('a', '개'), baked('b', '개')], {
      canonicalSize: SIZE,
      now: NOW,
    })
    expect(again.added).toBe(1)
    expect(again.duplicates).toBe(1)
    expect(readImages(again.project)).toHaveLength(2)
  })

  /**
   * 다시 올렸다는 이유로 라벨을 덮으면 **학생이 분류해 둔 것이 조용히 풀린다.**
   * 같은 꾸러미를 두 번 올리는 것은 교실에서 흔한 일이다.
   */
  it('이미 있는 사진은 자리를 안 옮긴다', () => {
    const first = withPhotos({ hash: 'a', category: '개' })
    const again = addImages(first, [baked('a', IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
    }).project
    expect(readImages(again)[0]?.category).toBe('개')
  })

  it('앉히기 전의 프로젝트는 안 바뀐다', () => {
    const before = emptyProject()
    addImages(before, [baked('a', '개')], { canonicalSize: SIZE, now: NOW })
    expect(before.images.size).toBe(0)
  })
})

describe('범주를 옮기고 고친다', () => {
  it('라벨 없음에서 범주로 옮긴다', () => {
    const project = withPhotos(
      { hash: 'a', category: IMAGE_UNLABELED },
      { hash: 'b', category: IMAGE_UNLABELED },
    )
    const moved = moveImages(project, ['a'], '개', NOW)
    expect(countByCategory(moved).get('개')).toBe(1)
    expect(countByCategory(moved).get(IMAGE_UNLABELED)).toBe(1)
    // 없던 범주는 옮기면서 목록에 선다.
    expect(imageCategories(moved)).toEqual(['개'])
  })

  /** 바이트가 움직이면 해시 이름을 쓰는 뜻이 없다. */
  it('옮겨도 바이트는 그대로다', () => {
    const project = withPhotos({ hash: 'a', category: '개' })
    const original = readImages(project)[0]?.bytes
    const moved = moveImages(project, ['a'], '고양이', NOW)
    expect(readImages(moved)[0]?.bytes).toBe(original)
  })

  it('이름을 바꾸면 그 안의 사진이 따라간다', () => {
    const project = withPhotos({ hash: 'a', category: '개' }, { hash: 'b', category: '고양이' })
    const renamed = renameCategory(project, '개', '강아지', NOW)
    expect(imageCategories(renamed)).toEqual(['강아지', '고양이'])
    expect(readImages(renamed).find((entry) => entry.hash === 'a')?.category).toBe('강아지')
  })

  /**
   * 지우는 것으로 만들면 잘못 누른 한 번에 40장이 사라지고, 되돌릴 방법이 다시
   * 올리는 것뿐이다.
   */
  it('범주를 없애도 사진은 남는다 - 라벨만 떨어진다', () => {
    const project = withPhotos({ hash: 'a', category: '개' })
    const removed = removeCategory(project, '개', NOW)
    expect(imageCategories(removed)).toEqual([])
    expect(readImages(removed)[0]?.category).toBe(IMAGE_UNLABELED)
  })

  /** 범주를 없애는 것과 다르다 — 이쪽은 사진 자체가 빠진다. */
  it('사진을 지우면 프로젝트에서 빠진다', () => {
    const project = withPhotos({ hash: 'a', category: '개' }, { hash: 'b', category: '개' })
    const left = removeImages(project, ['a'], NOW)
    expect(readImages(left).map((entry) => entry.hash)).toEqual(['b'])
  })

  /**
   * 마지막 한 장을 지웠다고 범주가 사라지면, 사진을 바꿔 넣으려던 학생이 만들어 둔
   * 칸까지 잃는다.
   */
  it('마지막 사진을 지워도 범주는 남는다', () => {
    const project = withPhotos({ hash: 'a', category: '개' })
    expect(imageCategories(removeImages(project, ['a'], NOW))).toEqual(['개'])
  })

  /**
   * **참조와 본체는 함께 있고 함께 없다** (mlpx-spec.md §1). 참조만 남으면
   * `writeProject`가 저장을 거부하고 `loadProject`는 그 프로젝트를 **아예 안 열어
   * 준다** — 사진을 다 지운 학생이 다음 차시에 빈 목록을 만난다.
   */
  it('마지막 사진을 지우면 참조도 함께 나간다', () => {
    const project = withPhotos({ hash: 'a', category: '개' }, { hash: 'b', category: '개' })
    const one = removeImages(project, ['a'], NOW)
    // 한 장이라도 남아 있으면 참조는 그대로다.
    expect(dataSettings('image', one.document.settings).dataset).toBeDefined()

    const none = removeImages(one, ['b'], NOW)
    expect(dataSettings('image', none.document.settings).dataset).toBeUndefined()
  })

  it('예측 자리도 같은 규칙이다', () => {
    const project = addImages(emptyProject(), [baked('a', IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
      role: 'predict',
    }).project
    const emptied = removeImages(project, ['a'], NOW, 'predict')
    expect(readImages(emptied, 'predict')).toEqual([])
    expect(dataSettings('image', emptied.document.settings).predictDataset).toBeUndefined()
  })

  /** 자리가 갈려 있어야 예측 사진을 지워도 훈련 사진이 안 사라진다. */
  it('예측 사진을 지워도 훈련 사진은 그대로다', () => {
    const trained = withPhotos({ hash: 'a', category: '개' })
    const both = addImages(trained, [baked('b', IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
      role: 'predict',
    }).project
    const left = removeImages(both, ['b'], NOW, 'predict')
    expect(readImages(left).map((entry) => entry.hash)).toEqual(['a'])
    expect(dataSettings('image', left.document.settings).dataset).toBeDefined()
  })

  /**
   * **zip은 빈 폴더를 표현하지 못한다.** 목록이 갖지 않으면 수업 중에 만든 범주가
   * 저장하고 열었을 때 사라진다.
   */
  it('사진 없는 범주도 목록에 남는다', () => {
    const project = addCategory(emptyProject(), '토끼', NOW)
    expect(imageCategories(project)).toEqual(['토끼'])
    expect(countByCategory(project).get('토끼')).toBe(0)
  })

  /**
   * **예측 사진은 답을 모르는 사진이라 범주에 못 넣는다** (mlpx-spec.md §1.2).
   * 범주 폴더가 한 겹 없고 범주 목록도 안 건드린다.
   */
  it('예측 자리에 앉힌 사진은 범주를 안 만든다', () => {
    const project = addImages(emptyProject(), [baked('a', '개')], {
      canonicalSize: SIZE,
      now: NOW,
      role: 'predict',
    }).project
    expect(imageCategories(project)).toEqual([])
    expect(readImages(project, 'predict')).toHaveLength(1)
    // 훈련 자리는 그대로 비어 있다.
    expect(readImages(project)).toEqual([])
    expect(dataSettings('image', project.document.settings).predictDataset).toBeDefined()
  })

  /**
   * 훈련에 쓴 사진을 예측으로 올리는 것은 학생이 일부러 하는 일이다 — "이 사진은 뭐라고
   * 답하지?". 없는 것으로 다루면 아무 일도 안 일어난 것처럼 보인다.
   */
  it('같은 사진이 훈련과 예측 양쪽에 설 수 있다', () => {
    const first = withPhotos({ hash: 'a', category: '개' })
    const both = addImages(first, [baked('a', '개')], {
      canonicalSize: SIZE,
      now: NOW,
      role: 'predict',
    })
    expect(both.duplicates).toBe(0)
    expect(readImages(both.project, 'predict')).toHaveLength(1)
    expect(readImages(both.project)).toHaveLength(1)
  })

  /**
   * 학생이 zip을 직접 열어 폴더를 넣는 일은 실제로 일어난다. 그때 **사진이 있는데
   * 화면에 안 보이는 쪽이 더 나쁘다.**
   */
  it('목록에 없는데 폴더에 있으면 목록 끝에 붙는다', () => {
    const project = withPhotos({ hash: 'a', category: '개' })
    const smuggled: ProjectFile = {
      ...project,
      images: new Map([
        ...project.images,
        [
          `${dataSettings('image', project.document.settings).dataset?.path ?? ''}토끼/c.jpg`,
          new Uint8Array([9]),
        ],
      ]),
    }
    expect(imageCategories(smuggled)).toEqual(['개', '토끼'])
  })
})
