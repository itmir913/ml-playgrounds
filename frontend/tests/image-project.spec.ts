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
  applyTestImages,
  clearTestImages,
  imageOverflow,
  countByCategory,
  hashesBetween,
  imageCategories,
  moveImages,
  readImages,
  removeCategory,
  removeImages,
  renameCategory,
} from '../src/project/images'
import type { ImageRole } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { MAX_IMAGE_COUNT } from '../src/limits'
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
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

/** 해시 자리에 알아볼 수 있는 문자열을 넣는다. 여기서 보는 것은 자리이지 해시가 아니다. */
function baked(hash: string, category: string) {
  return { hash, category, bytes: new Uint8Array([1, 2, 3]) }
}

function withPhotos(...items: readonly { hash: string; category: string }[]): ProjectFile {
  return addImages(
    emptyProject(),
    items.map((item) => baked(item.hash, item.category)),
    { canonicalSize: SIZE, now: NOW, format: 'webp' },
  ).project
}

describe('평가용 사진을 붙이고 뗀다', () => {
  /** 실험 하나가 든 프로젝트. 평가셋이 바뀌면 이것이 사라져야 한다. */
  function withExperiment(project: ProjectFile): ProjectFile {
    return {
      ...project,
      document: {
        ...project.document,
        runs: {
          ...project.document.runs,
          experiments: [
            { id: 'experiment-1', startedAt: NOW, settings: {}, runs: [] },
          ] as unknown as ProjectFile['document']['runs']['experiments'],
        },
      },
    }
  }

  function withTestPhotos(project: ProjectFile) {
    return applyTestImages(project, [baked('t1', '개'), baked('t2', '고양이')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    })
  }

  it('평가 자리에 앉고 학습 자리는 안 건드린다', () => {
    const base = withPhotos({ hash: 'a', category: '개' }, { hash: 'b', category: '고양이' })
    const applied = withTestPhotos(base)

    expect(readImages(applied.project, 'test').map((entry) => entry.hash)).toEqual(['t1', 't2'])
    expect(readImages(applied.project).map((entry) => entry.hash)).toEqual(['a', 'b'])
  })

  it('분할이 provided로 넘어간다 - 안 넘기면 올려 두고도 비율로 채점한다', () => {
    const applied = withTestPhotos(withPhotos({ hash: 'a', category: '개' }))
    expect(applied.project.document.settings.split.method).toBe('provided')
  })

  it('지금까지의 실험을 지운다 - 평가셋이 바뀌면 그 위의 점수는 다른 것을 잰 값이다', () => {
    const base = withExperiment(withPhotos({ hash: 'a', category: '개' }))
    const applied = withTestPhotos(base)

    expect(applied.droppedExperiments).toBe(1)
    expect(applied.project.document.runs.experiments).toHaveLength(0)
    // run이 사라지면 그 모델은 아무도 안 가리키는 본체가 된다.
    expect(applied.project.models.size).toBe(0)
  })

  it('떼면 분할로 돌아온다 - 되돌릴 길이 없으면 올리는 것 자체가 덫이다', () => {
    const applied = withTestPhotos(withPhotos({ hash: 'a', category: '개' }))
    const cleared = clearTestImages(applied.project, NOW)

    expect(readImages(cleared, 'test')).toHaveLength(0)
    expect(cleared.document.settings.split.method).toBe('holdout')
    // 참조도 함께 사라져야 저장이 막히지 않는다 (mlpx-spec.md §1.2).
    expect(dataSettings('image', cleared.document.settings).testDataset).toBeUndefined()
    // 학습용 사진은 그대로다.
    expect(readImages(cleared).map((entry) => entry.hash)).toEqual(['a'])
  })
})

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
    // **형식과 품질이 함께 선다** — 품질만 있으면 "무엇으로 구웠나"에 답을 못 한다
    // (open-decisions.md "정본은 WebP로 굽는다").
    expect(dataset?.format).toBe('webp')
    expect(dataset?.quality).toBeGreaterThan(0)
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
      format: 'webp',
    })
    expect(again.added).toBe(1)
    expect(again.duplicates).toBe(1)
    expect(readImages(again.project)).toHaveLength(2)
  })

  /**
   * 다시 올렸다는 이유로 라벨을 덮으면 **학생이 분류해 둔 것이 조용히 풀린다.**
   * 같은 압축 파일을 두 번 올리는 것은 교실에서 흔한 일이다.
   */
  it('이미 있는 사진은 자리를 안 옮긴다', () => {
    const first = withPhotos({ hash: 'a', category: '개' })
    const again = addImages(first, [baked('a', IMAGE_UNLABELED)], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
    expect(readImages(again)[0]?.category).toBe('개')
  })

  it('앉히기 전의 프로젝트는 안 바뀐다', () => {
    const before = emptyProject()
    addImages(before, [baked('a', '개')], { canonicalSize: SIZE, now: NOW, format: 'webp' })
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
      format: 'webp',
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
      format: 'webp',
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
      format: 'webp',
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
      format: 'webp',
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

/**
 * shift+클릭이 세는 범위 (`hashesBetween`).
 *
 * **화면 밖에 있어야 하는 계산이다.** 격자 안에 두면 이 규칙들을 아무도 못 보고,
 * 틀려도 "고른 수가 좀 다르네"로만 보인다 — 그 상태로 [사진 지우기]를 누른다.
 */
describe('사진 범위 고르기', () => {
  const entries = ['a', 'b', 'c', 'd'].map((hash) => ({
    hash,
    category: '개',
    path: `dataset/train/개/${hash}.webp`,
    bytes: new Uint8Array([1]),
    format: CANONICAL_FORMATS.webp,
  }))

  it('양끝을 포함한다', () => {
    expect(hashesBetween(entries, 'b', 'c')).toEqual(['b', 'c'])
  })

  it('거꾸로 눌러도 같다 - 학생은 아래에서 위로도 고른다', () => {
    expect(hashesBetween(entries, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('같은 것을 두 번 가리키면 그 한 장이다', () => {
    expect(hashesBetween(entries, 'c', 'c')).toEqual(['c'])
  })

  /** 쪽은 보는 단위이지 고르는 단위가 아니다 - 넘겨받은 목록에 다 들어 있다. */
  it('목록 전체를 훑는다 - 쪽을 넘는다', () => {
    expect(hashesBetween(entries, 'a', 'd')).toHaveLength(4)
  })

  /**
   * 기준점이 그새 지워졌거나 다른 범주로 옮겨진 자리다. **빈 배열이어야 부르는 쪽이
   * 보통 클릭으로 떨어진다** — 여기서 하나라도 돌려주면 학생이 안 고른 사진이 골라진다.
   */
  it('한쪽이 목록에 없으면 아무것도 안 고른다', () => {
    expect(hashesBetween(entries, '없는것', 'c')).toEqual([])
    expect(hashesBetween(entries, 'b', '없는것')).toEqual([])
    expect(hashesBetween([], 'b', 'c')).toEqual([])
  })

  /** 순서는 넘겨받은 목록이 정한다. 여기서 다시 정렬하면 화면과 다른 범위가 나온다. */
  it('목록의 순서를 그대로 따른다', () => {
    const shuffled = [entries[2], entries[0], entries[3], entries[1]].filter(
      (entry) => entry !== undefined,
    )
    expect(hashesBetween(shuffled, 'c', 'd')).toEqual(['c', 'a', 'd'])
  })
})

/**
 * **한 프로젝트에 두 형식이 섞인다.** 학교 PC에서 webp로 올리고 집 아이폰에서 jpg로
 * 올린 경우다 (open-decisions.md "정본은 WebP로 굽는다").
 */
describe('형식이 섞인 프로젝트', () => {
  /** jpg로 구운 정본 한 장이 이미 들어 있는 프로젝트. */
  function withJpeg(): ProjectFile {
    return addImages(emptyProject(), [baked('a', '개')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'jpeg',
    }).project
  }

  it('두 형식이 함께 읽힌다', () => {
    const mixed = addImages(withJpeg(), [baked('b', '고양이')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
    expect(readImages(mixed).map((entry) => entry.format.id)).toEqual(['jpeg', 'webp'])
  })

  /**
   * **옮기는 것은 폴더뿐이고 바이트는 손대지 않는다.** 지금의 기본 형식으로 경로를 다시
   * 지으면 jpg 정본이 `.webp` 이름을 뒤집어쓴다 — 화면이 그 이름을 믿고 MIME을 붙인다.
   */
  it('범주를 옮겨도 그 사진의 확장자가 그대로다', () => {
    const moved = moveImages(withJpeg(), ['a'], '고양이', NOW)
    const [entry] = readImages(moved)
    expect(entry?.category).toBe('고양이')
    expect(entry?.path.endsWith('.jpg')).toBe(true)
    expect(entry?.format.id).toBe('jpeg')
  })

  it('마지막에 구운 조건이 dataset에 적힌다', () => {
    const mixed = addImages(withJpeg(), [baked('b', '개')], {
      canonicalSize: SIZE,
      now: NOW,
      format: 'webp',
    }).project
    expect(dataSettings('image', mixed.document.settings).dataset?.format).toBe('webp')
  })
})

/**
 * **막는 것은 학습이 아니라 업로드다** (open-decisions.md #13의 "이미지의 상한").
 * 여기서 안 막으면 5,000장을 굽고 임베딩까지 뽑은 뒤에야 카드가 잠긴다.
 */
describe('담을 수 있는 장수', () => {
  /** 상한만큼 이미 들어 있는 프로젝트. **값을 여기 적지 않는다** — limits.ts가 출처다. */
  function full(role: ImageRole = 'data'): ProjectFile {
    return addImages(
      emptyProject(),
      Array.from({ length: MAX_IMAGE_COUNT }, (_, index) => baked(`h${index}`, '개')),
      { canonicalSize: SIZE, now: NOW, role, format: 'webp' },
    ).project
  }

  it('상한까지는 받는다', () => {
    expect(imageOverflow(emptyProject(), MAX_IMAGE_COUNT)).toBeNull()
  })

  it('한 장이라도 넘기면 거절하고, 학생에게 말할 숫자를 들려준다', () => {
    expect(imageOverflow(emptyProject(), MAX_IMAGE_COUNT + 1)).toEqual({
      current: 0,
      incoming: MAX_IMAGE_COUNT + 1,
      limit: MAX_IMAGE_COUNT,
    })
  })

  it('이미 담은 것과 함께 센다 - 한 장씩 나눠 올려도 넘길 수 없다', () => {
    expect(imageOverflow(full(), 1)).toEqual({
      current: MAX_IMAGE_COUNT,
      incoming: 1,
      limit: MAX_IMAGE_COUNT,
    })
  })

  /**
   * **자리마다 따로 센다.** 표에서 훈련 파일과 테스트 파일이 각자 상한에 걸리는 것과
   * 같다 — 예측하러 올린 사진이 훈련용 자리를 깎으면, 학생은 안 건드린 데이터가 줄어든
   * 것으로 읽는다.
   */
  it('훈련용이 가득 차도 예측용은 받는다', () => {
    expect(imageOverflow(full(), 1, 'predict')).toBeNull()
    expect(imageOverflow(full('predict'), 1, 'predict')).not.toBeNull()
  })

  it('프로젝트가 없으면 빈 것으로 센다', () => {
    expect(imageOverflow(null, 1)).toBeNull()
  })
})

/**
 * **행 순서는 좌표계다** (mlpx-spec.md §5.1). 참조형 모델의 `trainIndices`가 가리키는
 * 자리이고, 그것이 브라우저 설정에 딸려 있으면 같은 파일이 기기마다 다른 뜻을 갖는다.
 *
 * **`localeCompare`를 쓰던 자리다** (V11 R1 감사 B-5). 인자 없이 부르면 그 런타임의 기본
 * 로케일을 쓰는데, 체코에서 `ch`는 한 글자이고 스웨덴에서 `Ä`는 `z` 뒤다. 그때는
 * **정렬을 통째로 지워도 검사 1,817개가 전부 초록이었다.**
 */
describe('사진의 순서는 로케일이 아니라 코드 단위로 정한다', () => {
  /**
   * **대문자와 소문자가 이 축을 가른다.** 코드 단위로는 `B`(0x42)가 `a`(0x61)보다
   * 앞이고, 로케일 비교는 알파벳 순서라 `a`를 앞에 둔다 — 학생이 범주를 `a`와 `B`로
   * 지으면 실제로 갈린다.
   */
  it('대문자 범주가 소문자 범주보다 앞이다 - 로케일 비교는 반대로 답한다', () => {
    const project = withPhotos(
      { hash: 'aa'.repeat(32), category: 'a' },
      { hash: 'bb'.repeat(32), category: 'B' },
    )

    // 이 표본이 실제로 두 규칙을 가르는지부터 확인한다. 안 갈리면 아래가 헛돈다.
    expect('B'.localeCompare('a')).toBeGreaterThan(0)
    expect('B' < 'a').toBe(true)

    expect(readImages(project).map((entry) => entry.category)).toEqual(['B', 'a'])
  })

  it('경로의 코드 단위 오름차순과 같다', () => {
    const project = withPhotos(
      { hash: 'cc'.repeat(32), category: '개' },
      { hash: 'aa'.repeat(32), category: 'Zebra' },
      { hash: 'bb'.repeat(32), category: 'apple' },
    )
    const paths = readImages(project).map((entry) => entry.path)
    expect(paths).toEqual([...paths].sort((left, right) => (left < right ? -1 : 1)))
  })
})
