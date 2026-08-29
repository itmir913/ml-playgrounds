/**
 * 이미지 프로젝트를 표 문제로 바꾸는 어댑터 (`ml/images.ts`).
 *
 * **여기가 틀리면 학습은 멀쩡히 돌고 성적만 이상해진다.** 행과 라벨이 어긋나거나,
 * 안 쓸 사진이 섞여 들어가거나, 파일에 남는 기록이 계산에 쓴 표를 그대로 베끼거나 —
 * 셋 다 예외를 안 던진다.
 */

import { describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import { comparablePair } from '../src/ml/experiment'
import {
  embeddingColumns,
  IMAGE_LABEL_COLUMN,
  imagePredictTable,
  imageTrainingRows,
  imageTrainingSource,
  pendingEmbeddings,
  rowsHashOf,
  type ImageTrainingSource,
} from '../src/ml/images'
import { fitPreprocessor } from '../src/ml/preprocess'
import { newProjectDocument } from '../src/project/create'
import { IMAGE_UNLABELED, type ProjectFile } from '../src/project/format'
import { addCategory, addImages, moveImages, readImages } from '../src/project/images'
import { dataSettings } from '../src/project/schema'

const NOW = '2026-08-12T09:00:00.000Z'
const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
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
    attachments: new Map(),
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
    expect(
      pendingEmbeddings(project, new Set([first!.hash]), 'data').map((one) => one.hash),
    ).toEqual([second!.hash])
  })

  it('다 있으면 비어 있다', () => {
    const have = new Set(readImages(project).map((entry) => entry.hash))
    expect(pendingEmbeddings(project, have, 'data')).toEqual([])
  })

  /**
   * **예측 화면이 이것을 못 물어서 임베딩을 한 장도 안 뽑았다** (V11 R1 감사 A-2).
   * 훈련 자리만 보면 예측 사진과의 교집합이 언제나 비고, 화면은 그 자리를 0 벡터로
   * 메워 **모든 사진에 같은 답**을 냈다.
   */
  it('예측 자리 사진도 아직 안 뽑은 것으로 센다', () => {
    const withPredict = addImages(
      project,
      [{ hash: hashBytes(photo('p')), bytes: photo('p'), category: IMAGE_UNLABELED }],
      { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp', role: 'predict' },
    ).project

    const [predictPhoto] = readImages(withPredict, 'predict')
    expect(predictPhoto).toBeDefined()
    expect(pendingEmbeddings(withPredict, new Set(), 'predict').map((one) => one.hash)).toEqual([
      predictPhoto!.hash,
    ])
    // 자리가 갈려 있다 — 훈련 쪽을 물으면 예측 사진이 안 나온다.
    expect(pendingEmbeddings(withPredict, new Set(), 'data').map((one) => one.hash)).not.toContain(
      predictPhoto!.hash,
    )
  })
})

describe('예측할 사진들의 표', () => {
  const project = imageProject([
    { seed: 'a', category: '개' },
    { seed: 'b', category: '고양이' },
  ])
  const photos = readImages(project)

  it('학습과 같은 열 이름을 쓴다', () => {
    const table = imagePredictTable(photos, vectorsFor(project), BACKBONE)
    expect(table.columns).toEqual(embeddingColumns(DIM))
  })

  it('벡터가 있으면 그 값이 그대로 행이 된다', () => {
    const vectors = vectorsFor(project)
    const table = imagePredictTable(photos, vectors, BACKBONE)
    expect(table.missing.size).toBe(0)
    expect(table.rows[0]).toEqual(Array.from(vectors.get(photos[0]!.hash)!, String))
  })

  /**
   * **0으로 메우면 모든 사진이 같은 답을 받는다** (V11 R1 감사 A-2). 없는 것은 없는
   * 것으로 두고, 부르는 쪽이 그 사진의 답을 안 낸다.
   */
  it('벡터가 없는 사진은 0으로 메우지 않는다', () => {
    const vectors = vectorsFor(project)
    vectors.delete(photos[1]!.hash)

    const table = imagePredictTable(photos, vectors, BACKBONE)
    expect(table.missing).toEqual(new Set([photos[1]!.hash]))
    expect(table.rows[1]).toEqual([])
    // 남은 사진은 멀쩡하다 — 한 장 때문에 전체가 막히지 않는다.
    expect(table.rows[0]).toHaveLength(DIM)
  })

  it('행의 자리가 사진의 자리와 같다', () => {
    const table = imagePredictTable(photos, new Map(), BACKBONE)
    expect(table.rows).toHaveLength(photos.length)
  })
})

describe('열 이름', () => {
  it('0부터 센다 - 파이썬 관행이다', () => {
    expect(embeddingColumns(3)).toEqual(['f0', 'f1', 'f2'])
  })
})

/**
 * **참조형 모델의 훈련 행을 되세우는 자리** (`imageTrainingRows`, mlpx-spec.md §5.0).
 *
 * 이미지에는 `dataset/data.csv`가 없어서 `trainIndices`는 **임베딩 표의 행 번호**이고,
 * 그 표는 예측할 때마다 지금 사진들로 다시 세워진다. **행 번호가 다른 사진을 가리키게
 * 되면 이웃이 바뀐 채로 답만 멀쩡히 나온다.**
 *
 * **이 함수는 검사가 하나도 없었다** (V11 R1 감사 B-1). 방어선 둘을 각각 무력화하는
 * 돌연변이를 심고 저장소 전체 1,817개를 돌렸는데 하나도 안 울었다.
 */
describe('훈련 행을 되세운다', () => {
  const ITEMS = [
    { seed: 'a', category: '개' },
    { seed: 'b', category: '개' },
    { seed: 'c', category: '고양이' },
    { seed: 'd', category: '고양이' },
  ] as const

  /** 진짜 입구로 짓는다 — 스냅샷을 손으로 조립하면 `rowsHash`가 진짜 순서와 무관해진다. */
  function trained(project: ProjectFile) {
    const vectors = vectorsFor(project)
    const source = imageTrainingSource(project, vectors, BACKBONE, 'classification')
    const trainIndices = source.dataset.rows.map((_, index) => index)
    const preprocessor = fitPreprocessor(
      source.dataset,
      trainIndices,
      // 계산용 설정의 `data`는 스냅샷이 아니라 표의 모양이다 - 특성은 임베딩 열이다.
      embeddingColumns(DIM),
      { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' },
    )
    const experiment = {
      id: 'experiment-1',
      startedAt: NOW,
      settings: {
        taskType: 'classification' as const,
        runtime: 'mljs',
        selectedAlgorithms: [{ algorithm: 'knn', runtime: 'mljs' }],
        data: source.snapshot,
        split: { method: 'holdout' as const, testSize: 0.5, stratify: true, randomState: 42 },
        nSamples: source.dataset.rows.length,
        trainIndices,
        testIndices: [],
      },
      runs: [],
    }
    return { experiment, preprocessor, vectors }
  }

  function rowsOf(project: ProjectFile, trainedOn: ProjectFile = project) {
    const { experiment, preprocessor } = trained(trainedOn)
    return imageTrainingRows(
      project,
      experiment,
      preprocessor,
      BACKBONE,
      vectorsFor(project),
      'classification',
    )
  }

  it('그대로면 행을 내준다', () => {
    const project = imageProject(ITEMS)
    expect(rowsOf(project)?.indices).toEqual([0, 1, 2, 3])
  })

  /**
   * **B-1이 지적한 구멍이다.** 두 사진의 범주를 서로 맞바꾸면 **범주별 장수가 하나도 안
   * 변한다.** 그런데 경로가 바뀌므로 행 순서는 바뀌고, `trainIndices`가 가리키는 사진이
   * 통째로 달라진다. 교실에서 흔한 편집이다 — "이거 둘이 서로 바뀌었네".
   */
  it('라벨을 맞바꾸면 장수가 같아도 행을 안 내준다', () => {
    const before = imageProject(ITEMS)
    const swapped = imageProject([
      { seed: 'a', category: '고양이' },
      { seed: 'b', category: '개' },
      { seed: 'c', category: '개' },
      { seed: 'd', category: '고양이' },
    ])

    // 장수는 정말로 같다 - 이 축이 안 갈리는 것이 이 검사의 전제다.
    const countsOf = (project: ProjectFile) =>
      dataSettings('image', project.document.settings).categories.map(
        (category) => readImages(project).filter((entry) => entry.category === category).length,
      )
    expect(countsOf(swapped)).toEqual(countsOf(before))

    expect(rowsOf(swapped, before)).toBeNull()
  })

  it('사진이 늘면 행을 안 내준다 - 장수가 갈린다', () => {
    const before = imageProject(ITEMS)
    const more = imageProject([...ITEMS, { seed: 'e', category: '개' }])
    expect(rowsOf(more, before)).toBeNull()
  })

  /**
   * **옛 파일에는 `rowsHash`가 없다.** 그때는 장수만 보므로 맞바꾸기가 통과한다 —
   * 닫을 방법이 없는 구멍이고, 그 사실을 여기 못 박아 둔다 (mlpx-spec.md §5.1).
   */
  it('지문이 없는 옛 실험은 장수만 본다', () => {
    const before = imageProject(ITEMS)
    const swapped = imageProject([
      { seed: 'a', category: '고양이' },
      { seed: 'b', category: '개' },
      { seed: 'c', category: '개' },
      { seed: 'd', category: '고양이' },
    ])
    const { experiment, preprocessor } = trained(before)

    // 옛 파일은 이 필드가 **아예 없다.** `undefined`를 넣는 것과 구분해서 진짜로 지운다.
    const older = structuredClone(experiment)
    const data = older.settings.data as { rowsHash?: string }
    expect(data.rowsHash, '지문을 실제로 떼어냈는지부터 확인한다').toBeDefined()
    delete data.rowsHash

    expect(
      imageTrainingRows(
        swapped,
        older,
        preprocessor,
        BACKBONE,
        vectorsFor(swapped),
        'classification',
      ),
    ).not.toBeNull()
  })
})

/**
 * **지문은 순서에 민감해야 한다.** 같은 사진들이라도 자리가 바뀌면 다른 값이어야 위
 * 대조가 성립한다.
 */
describe('행 순서의 지문', () => {
  it('순서가 다르면 값이 다르다', () => {
    expect(rowsHashOf(['aa', 'bb'])).not.toBe(rowsHashOf(['bb', 'aa']))
  })

  it('같은 순서면 같은 값이다', () => {
    expect(rowsHashOf(['aa', 'bb'])).toBe(rowsHashOf(['aa', 'bb']))
  })

  /** 구분자가 없으면 `["ab","cd"]`와 `["abc","d"]`가 같은 글자가 된다. */
  it('경계를 지운 조합과 갈린다', () => {
    expect(rowsHashOf(['ab', 'cd'])).not.toBe(rowsHashOf(['abc', 'd']))
  })
})

/**
 * **라벨 맞바꾸기가 변경 이력에 뜨는가** (R6 감사 A-1).
 *
 * 두 방향 이동(A 개→고양이, B 고양이→개)은 `categories`·`categoryCounts`·`unlabeledCount`가
 * **하나도 안 움직인다.** 그래서 `rowsHash`가 비교 목록에서 빠지는 순간 두 실험의 비교
 * 대상이 **바이트 단위로 같아지고**, 결과 화면이 *"설정을 바꾸지 않고 다시 학습했습니다"*
 * 라고 말한다 — 훈련 데이터는 실제로 달라졌는데도.
 *
 * **한 번 그렇게 만들었다가 되돌렸다.** 읽기 어려운 값이라 이력에서 뺐는데, 그것은
 * 표시의 문제였고 뺀 것은 탐지였다.
 */
describe('라벨을 맞바꾸면 이력이 말한다', () => {
  const ITEMS = [
    { seed: 'a', category: '개' },
    { seed: 'b', category: '개' },
    { seed: 'c', category: '고양이' },
    { seed: 'd', category: '고양이' },
  ] as const

  function snapshotOf(project: ProjectFile) {
    return imageTrainingSource(project, vectorsFor(project), BACKBONE, 'classification')
  }

  function settingsOf(data: ImageTrainingSource['snapshot']) {
    return {
      taskType: 'classification' as const,
      runtime: 'mljs',
      selectedAlgorithms: [{ algorithm: 'knn', runtime: 'mljs' }],
      data,
      split: { method: 'holdout' as const, testSize: 0.5, stratify: true, randomState: 42 },
      nSamples: 4,
      trainIndices: [0, 1],
      testIndices: [2, 3],
    }
  }

  it('장수가 그대로여도 견줄 값이 갈린다', () => {
    const before = imageProject(ITEMS)
    /**
     * **같은 프로젝트를 옮겨야 한다.** 두 프로젝트를 따로 지으면 `categories`가
     * 만든 순서로 등록돼 그 칸이 먼저 갈리고, 이 검사가 **다른 이유로 통과한다**
     * (처음에 그렇게 썼고 돌연변이가 안 울어서 잡았다).
     */
    const swapped = moveImages(
      moveImages(before, [hashBytes(photo('a'))], '고양이', NOW),
      [hashBytes(photo('c'))],
      '개',
      NOW,
    )

    const first = snapshotOf(before)
    const second = snapshotOf(swapped)

    // 전제 둘 - 이 축이 실제로 안 갈리는 것이 이 검사의 이유다.
    expect(second.snapshot.categoryCounts).toEqual(first.snapshot.categoryCounts)
    expect(second.snapshot.unlabeledCount).toBe(first.snapshot.unlabeledCount)
    // 그런데 어느 사진이 어느 줄에 앉는가는 바뀌었다.
    expect(second.hashes).not.toEqual(first.hashes)

    const { before: left, after: right } = comparablePair(
      { settings: settingsOf(first.snapshot), runs: [] },
      { settings: settingsOf(second.snapshot), runs: [] },
    )
    expect(
      right,
      '라벨을 맞바꿨는데 견줄 값이 같다 - 결과 화면이 "설정을 바꾸지 않았다"고 말한다',
    ).not.toEqual(left)
  })
})
