/**
 * **흐름도가 열 때 구하는 수** (`ml/flow-counts.ts`, `architecture.md` §8.22).
 *
 * 표는 계획 캐시의 수를 그대로 읽고, 이미지는 계획 없이 사진 수에서 센다. 아래 검사는 두 가지를 문다.
 * ① 수가 **손으로 센 값과** 같은가(계획이 내는 값을 그대로 베끼면 같이 틀린다) ② 이미지는 **학습이 실제로 세우는
 * 계획의 인덱스 길이와** 같은가. 그리고 점검의 가벼운 입구가 계획 캐시를 채우지 않는 것.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hashBytes } from '../src/hash'
import { importTable, openTable } from '../src/data/table'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import { barValuesOf, flowCountsLite, flowCountsOf } from '../src/ml/flow-counts'
import { imageTrainingSource } from '../src/ml/images'
import { holdsTabularPlan } from '../src/ml/plan-cache'
import { forgetTabularPlan } from '../src/ml/plan-cache-reset'
import { newProjectDocument } from '../src/project/create'
import { applyTestDataset } from '../src/project/dataset'
import { IMAGE_UNLABELED, type ProjectFile } from '../src/project/format'
import { addImages, applyTestImages, readImages } from '../src/project/images'
import {
  withFeatures,
  withPreprocessing,
  withSampling,
  withSplit,
  withTarget,
  withTaskType,
} from '../src/project/settings'
import { tabularDataOf, type ProjectDocument } from '../src/project/schema'
import { planRun } from '../src/ml/plan'
import { surveyCsv, surveyProject, tabularProjectFrom } from './fixtures/prep-kind'

/** `planRun`이 몇 번 불렸는가. 계획 캐시가 다시 안 짓는지를 센다. */
const calls = vi.hoisted(() => ({ planRun: 0 }))
vi.mock('../src/ml/plan', async (original) => {
  const actual = await original<typeof import('../src/ml/plan')>()
  return {
    ...actual,
    planRun: (...args: Parameters<typeof actual.planRun>) => {
      calls.planRun += 1
      return actual.planRun(...args)
    },
  }
})

const NOW = '2026-11-17T00:00:00Z'

beforeEach(() => {
  forgetTabularPlan()
  calls.planRun = 0
})

function edited(file: ProjectFile, edit: (document: ProjectDocument) => ProjectDocument) {
  return { ...file, document: edit(file.document) }
}

// ------------------------------------------------------------------------------------ 표

describe('표 · 계획이 선 경우', () => {
  it('손으로 센 수와 같다 — 40행 가운데 타깃이 빈 한 행이 빠지고 테스트 비율 20%다', async () => {
    const file = await surveyProject(true)
    const counts = await flowCountsOf(file)
    expect(counts).toMatchObject({
      total: 40,
      usable: 39,
      sampled: 39,
      unusable: 1,
      notDrawn: 0,
      // 39행의 20%를 올림하면 8행이다(sklearn과 같다).
      test: 8,
      train: 31,
      featureCount: 2,
      testFile: null,
    })
  })

  it('표본 수를 켜면 추출한 만큼만 나뉘고 남은 몫이 추출하지 않은 행이다', async () => {
    const file = edited(await surveyProject(true), (document) => withSampling(document, 20, NOW))
    expect(await flowCountsOf(file)).toMatchObject({
      usable: 39,
      sampled: 20,
      notDrawn: 19,
      test: 4,
      train: 16,
    })
  })

  it('군집화는 테스트가 0이고 타깃이 빈 행도 버리지 않는다', async () => {
    const file = edited(await surveyProject(true), (document) =>
      withTaskType(document, 'clustering', NOW),
    )
    expect(await flowCountsOf(file)).toMatchObject({
      total: 40,
      usable: 40,
      unusable: 0,
      train: 40,
      test: 0,
    })
  })

  it('별도 테스트 파일이면 파일의 수가 나오고 훈련은 추출한 행 전부다', async () => {
    const file = await surveyProject(true)
    const imported = importTable(await openTable(surveyCsv(true), '시험.csv', { locale: 'ko' }))
    const withTest = applyTestDataset(file, imported, {
      fileName: '시험.csv',
      hasHeader: true,
      now: NOW,
    }).project
    const counts = await flowCountsOf(withTest)
    expect(counts?.train).toBe(39)
    expect(counts?.test).toBe(39)
    expect(counts?.testFile).toEqual({ total: 40, usable: 39 })
  })

  it('별도 테스트 파일의 회색 몫은 파일 전체에서 학습에 드는 수를 뺀 것이다', async () => {
    // 무는 대상: `barValuesOf`의 `testFile` 칸. 이 칸을 `null`로 두거나 회색을 0으로 두면 별도 테스트 파일 막대가 늘 한 색이다.
    const file = await surveyProject(true)
    const imported = importTable(await openTable(surveyCsv(true), '시험.csv', { locale: 'ko' }))
    const withTest = applyTestDataset(file, imported, {
      fileName: '시험.csv',
      hasHeader: true,
      now: NOW,
    }).project
    // 시험 파일 40행 가운데 타깃이 빈 한 행이 빠진다.
    expect(barValuesOf(await flowCountsOf(withTest))).toEqual({
      train: 39,
      test: 39,
      gray: 1,
      testFile: { usable: 39, gray: 1 },
    })
    // 점검은 행 수를 모르므로 막대가 없다.
    expect(barValuesOf(flowCountsLite(withTest))).toBeNull()
  })

  it('막대가 받는 모양으로 옮긴다 — 회색은 사용할 수 없는 몫과 추출하지 않은 몫의 합이다', async () => {
    const file = edited(await surveyProject(true), (document) => withSampling(document, 20, NOW))
    expect(barValuesOf(await flowCountsOf(file))).toEqual({
      train: 16,
      test: 4,
      gray: 1 + 19,
      testFile: null,
    })
    expect(barValuesOf(null)).toBeNull()
  })
})

describe('표 · 계획이 안 선 경우', () => {
  // 계획이 없으면 열 종류는 파일 전체로 본다 — `키`에 `모름`이 한 칸 있어 범주이고 인코딩이 꺼져 있어 빠진다(계획이 선 경우는 그 행이 빠져 수치다).
  it('유형을 안 골랐으면 행 수는 비고 특성 수와 전처리 모양은 채운다', async () => {
    const base = await surveyProject(true)
    const file = {
      ...base,
      document: {
        ...base.document,
        manifest: { ...base.document.manifest, taskType: undefined },
      },
    }
    const counts = await flowCountsOf(file)
    expect(counts).toMatchObject({
      total: 40,
      usable: null,
      sampled: null,
      train: null,
      test: null,
      unusable: null,
      notDrawn: null,
      featureCount: 1,
      prep: 'preprocess',
    })
    expect(barValuesOf(counts)).toBeNull()
  })

  it('타깃이 없으면 계획이 거부해도 특성 수는 센다', async () => {
    const file = edited(await surveyProject(true), (document) =>
      withTarget(document, undefined, NOW),
    )
    const counts = await flowCountsOf(file)
    expect(counts?.train).toBeNull()
    expect(counts?.featureCount).toBe(1)
  })

  it('데이터가 없으면 null이다', async () => {
    expect(await flowCountsOf(null)).toBeNull()
    expect(flowCountsLite(null)).toBeNull()
  })
})

describe('표 · 전처리 모양', () => {
  it('스케일링이 켜져 있으면 preprocess이고 구할 값이 없으면 preprocessOff다', async () => {
    const base = await surveyProject(true)
    expect((await flowCountsOf(base))?.prep).toBe('preprocess')
    const off = edited(base, (document) =>
      withPreprocessing(document, { scaling: 'none', missing: 'drop' }, NOW),
    )
    expect((await flowCountsOf(off))?.prep).toBe('preprocessOff')
  })

  it('범주 열이 인코딩되면 preprocess이다', async () => {
    const file = await tabularProjectFrom(surveyCsv(false), '설문.csv', {
      taskType: 'classification',
      target: '키',
      features: ['성별'],
      preprocessing: { scaling: 'none', missing: 'drop', categoricalEncoding: 'onehot' },
    })
    // 타깃을 `키`로 두면 계획이 회귀 요구로 막힐 수 있으나 전처리 모양은 계획과 무관하게 선다.
    expect((await flowCountsOf(file))?.prep).toBe('preprocess')
    const none = edited(file, (document) =>
      withPreprocessing(document, { categoricalEncoding: 'none' }, NOW),
    )
    expect((await flowCountsOf(none))?.prep).toBe('preprocessOff')
  })

  it('기준 화살표는 학습에 드는 특성만으로 판정한다 — 결측을 그대로 두면 빠지는 수치 열은 안 센다', async () => {
    // 결측이 있는 수치 열 하나만 특성이고 결측 처리가 "그대로 두기"이면 학습이 그 열을 뺀다(`FEATURE_HAS_MISSING`).
    // 걸러 내지 않으면 스케일링이 켜져 있다는 이유로 구할 값이 없는데도 기준 화살표가 선다. 무는 검사는 이것이다
    // (`ml/flow-counts.ts`의 `tabularShape`에서 `featureIssue` 거르기를 뭉개면 운다).
    const lines = ['키,성별']
    for (let i = 0; i < 40; i += 1)
      lines.push(`${i === 7 ? '' : 150 + i},${i % 2 === 0 ? '남' : '여'}`)
    const csv = new TextEncoder().encode(`${lines.join('\n')}\n`)
    const file = await tabularProjectFrom(csv, '키.csv', {
      taskType: 'classification',
      target: '성별',
      features: ['키'],
      preprocessing: { missing: 'none', scaling: 'standard' },
    })
    expect(tabularDataOf(file.document)?.preprocessing).toMatchObject({
      missing: 'none',
      scaling: 'standard',
    })
    expect((await flowCountsOf(file))?.prep).toBe('preprocessOff')
    expect(flowCountsLite(file)?.prep).toBe('preprocessOff')
    // 짝: 결측을 채우면 같은 열이 학습에 들고 기준 화살표가 선다 — 위 검사가 늘 꺼진 채로 초록이 아니다.
    const filled = edited(file, (document) => withPreprocessing(document, { missing: 'mean' }, NOW))
    expect((await flowCountsOf(filled))?.prep).toBe('preprocess')
  })

  it('특성 수는 학습에 들어가는 수다 — 인코딩이 꺼진 범주 열은 안 센다', async () => {
    const file = await tabularProjectFrom(surveyCsv(false), '설문.csv', {
      taskType: 'classification',
      target: '성별',
      features: ['키', '몸무게'],
      preprocessing: { categoricalEncoding: 'none' },
    })
    const withBoth = edited(file, (document) =>
      withFeatures(document, ['키', '몸무게', '성별'], NOW),
    )
    // 타깃과 같은 이름은 특성에서 빠지고, `키`는 파일 전체로 범주라 인코딩이 꺼져 빠진다.
    expect((await flowCountsOf(withBoth))?.featureCount).toBe(1)
  })
})

describe('계획 캐시', () => {
  it('같은 파일로 두 번 부르면 planRun은 한 번만 돈다', async () => {
    const file = await surveyProject(true)
    await flowCountsOf(file)
    await flowCountsOf(file)
    expect(calls.planRun).toBe(1)
    expect(holdsTabularPlan()).toBe(true)
  })

  it('계획에 안 들어가는 편집에는 다시 안 짓는다', async () => {
    const file = await surveyProject(true)
    await flowCountsOf(file)
    const renamed = { ...file, document: { ...file.document } }
    await flowCountsOf(renamed)
    expect(calls.planRun).toBe(1)
  })

  it('분할을 바꾸면 다시 짓고 수가 따라간다', async () => {
    const file = await surveyProject(true)
    await flowCountsOf(file)
    const bigger = edited(file, (document) => withSplit(document, { testSize: 0.5 }, NOW))
    const counts = await flowCountsOf(bigger)
    expect(calls.planRun).toBe(2)
    expect(counts?.test).toBe(20)
    expect(counts?.train).toBe(19)
  })
})

describe('점검의 가벼운 입구', () => {
  it('계획 캐시를 채우지 않고 planRun을 안 부른다', async () => {
    const file = await surveyProject(true)
    forgetTabularPlan()
    calls.planRun = 0
    const counts = flowCountsLite(file)
    expect(holdsTabularPlan()).toBe(false)
    expect(calls.planRun).toBe(0)
    expect(counts).toMatchObject({
      total: 40,
      usable: null,
      sampled: null,
      train: null,
      test: null,
      unusable: null,
      notDrawn: null,
      featureCount: 1,
      prep: 'preprocess',
    })
    expect(barValuesOf(counts)).toBeNull()
  })

  it('열 종류는 파일 전체로 본다 — 전처리 모양이 큰 입구와 다르지 않은 입력에서 같다', async () => {
    const file = await surveyProject(false)
    expect(flowCountsLite(file)?.prep).toBe((await flowCountsOf(file))?.prep)
    expect(flowCountsLite(file)?.featureCount).toBe((await flowCountsOf(file))?.featureCount)
  })

  it('별도 테스트 파일이 올라와 있으면 전체 행 수만 알려 준다', async () => {
    const file = await surveyProject(true)
    const imported = importTable(await openTable(surveyCsv(true), '시험.csv', { locale: 'ko' }))
    const withTest = applyTestDataset(file, imported, {
      fileName: '시험.csv',
      hasHeader: true,
      now: NOW,
    }).project
    expect(flowCountsLite(withTest)?.testFile).toEqual({ total: 40, usable: null })
  })
})

// ------------------------------------------------------------------------------------ 이미지

const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
const DIM = BACKBONE.embeddingDim

function photo(seed: string): Uint8Array {
  return new TextEncoder().encode(`가짜jpg:${seed}`)
}

/** 사진 프로젝트. `{개: 12, 고양이: 12, _unlabeled: 4}`처럼 범주별 장수를 준다. */
function photos(shape: Readonly<Record<string, number>>): ProjectFile {
  const document = newProjectDocument(
    { name: '동물', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-11-17T00:00:00.000Z',
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
  const items = Object.entries(shape).flatMap(([category, count]) =>
    Array.from({ length: count }, (_, at) => ({ seed: `${category}-${at}`, category })),
  )
  return addImages(
    empty,
    items.map((item) => {
      const bytes = photo(item.seed)
      return { hash: hashBytes(bytes), bytes, category: item.category }
    }),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
  ).project
}

function typed(file: ProjectFile, taskType: 'classification' | 'clustering'): ProjectFile {
  return edited(file, (document) => withTaskType(document, taskType, NOW))
}

/** 학습이 실제로 세우는 계획의 인덱스 길이. 임베딩은 가짜 벡터로 채운다. */
function trainedLengths(file: ProjectFile, taskType: 'classification' | 'clustering') {
  const vectors = new Map<string, Float32Array>()
  for (const [index, entry] of readImages(file).entries()) {
    vectors.set(entry.hash, new Float32Array(DIM).fill(index + 1))
  }
  const source = imageTrainingSource(file, vectors, BACKBONE, taskType)
  const plan = planRun({
    dataset: source.dataset,
    testDataset: null,
    settings: source.settings,
    taskType,
  })
  if (!plan.ok) throw new Error('plan refused')
  return {
    usable: plan.usable.length,
    sampled: plan.sampled.length,
    train: plan.split.trainIndices.length,
    test: plan.split.testIndices.length,
  }
}

describe('이미지', () => {
  const SHAPE = { 개: 12, 고양이: 12, [IMAGE_UNLABELED]: 4 } as const

  it('분류: 범주 없는 사진은 회색이고 수는 학습이 세우는 인덱스와 같다', async () => {
    const file = typed(photos(SHAPE), 'classification')
    const counts = await flowCountsOf(file)
    expect(counts).toMatchObject({
      total: 28,
      usable: 24,
      unusable: 4,
      sampled: 24,
      notDrawn: 0,
      featureCount: null,
      prep: 'backbone',
      testFile: null,
    })
    expect(counts).toMatchObject(trainedLengths(file, 'classification'))
    // 24장의 20%를 올림하면 5장이다.
    expect(counts?.test).toBe(5)
    expect(counts?.train).toBe(19)
  })

  it('분류 + 표본 수: 추출한 만큼만 나눈다', async () => {
    const file = edited(typed(photos(SHAPE), 'classification'), (document) =>
      withSampling(document, 10, NOW),
    )
    const counts = await flowCountsOf(file)
    expect(counts).toMatchObject({ sampled: 10, notDrawn: 14, test: 2, train: 8 })
    expect(counts).toMatchObject(trainedLengths(file, 'classification'))
  })

  it('군집화: 범주 없는 사진도 전부 사용하므로 범주 때문에 회색이 생기지 않는다', async () => {
    const file = typed(photos(SHAPE), 'clustering')
    const counts = await flowCountsOf(file)
    expect(counts).toMatchObject({ total: 28, usable: 28, unusable: 0, notDrawn: 0, test: 0 })
    expect(counts).toMatchObject(trainedLengths(file, 'clustering'))
  })

  it('군집화 + 표본 수: 추출하지 않은 몫만 회색이다', async () => {
    const file = edited(typed(photos(SHAPE), 'clustering'), (document) =>
      withSampling(document, 20, NOW),
    )
    const counts = await flowCountsOf(file)
    expect(counts).toMatchObject({ unusable: 0, sampled: 20, notDrawn: 8, train: 20, test: 0 })
    expect(counts).toMatchObject(trainedLengths(file, 'clustering'))
  })

  it('별도 테스트 사진: 훈련은 추출한 사진 전부이고 테스트 파일 수가 나온다', async () => {
    const base = typed(photos({ 개: 6, 고양이: 6 }), 'classification')
    const applied = applyTestImages(
      base,
      [
        { hash: hashBytes(photo('t1')), bytes: photo('t1'), category: '개' },
        { hash: hashBytes(photo('t2')), bytes: photo('t2'), category: '고양이' },
        { hash: hashBytes(photo('t3')), bytes: photo('t3'), category: '개' },
      ],
      { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
    ).project
    const counts = await flowCountsOf(applied)
    expect(counts).toMatchObject({ train: 12, test: 3, testFile: { total: 3, usable: 3 } })
    expect(barValuesOf(counts)?.testFile).toEqual({ usable: 3, gray: 0 })
    // 점검의 가벼운 입구도 별도 테스트 사진 수는 안다. 학습에 드는 수는 모른다.
    // 무는 대상: `imageLite`의 `testFile` — `null`로 두면 점검에서 별도 테스트 카드가 사라진다.
    expect(flowCountsLite(applied)?.testFile).toEqual({ total: 3, usable: null })
    expect(flowCountsLite(base)?.testFile).toBeNull()
  })

  it('범주가 하나뿐이면 학습이 거절하는 모양이라 행 수는 비어 있다', async () => {
    const counts = await flowCountsOf(typed(photos({ 개: 8 }), 'classification'))
    expect(counts).toMatchObject({ total: 8, usable: null, train: null, test: null })
    expect(counts?.prep).toBe('backbone')
  })

  it('유형을 안 골랐으면 행 수는 비어 있다', async () => {
    const counts = await flowCountsOf(photos(SHAPE))
    expect(counts).toMatchObject({ total: 28, usable: null, train: null })
  })

  it('사진이 없으면 null이다', async () => {
    expect(await flowCountsOf(photos({}))).toBeNull()
  })

  it('점검의 가벼운 입구는 계획 캐시를 안 채우고 사진도 행 수 없이 윤곽으로 둔다', async () => {
    const file = typed(photos(SHAPE), 'classification')
    const lite = flowCountsLite(file)
    expect(holdsTabularPlan()).toBe(false)
    const full = await flowCountsOf(file)
    // 사진 수와 전처리 모양은 같고, 행 수 칸은 비어 있다.
    expect(lite).toMatchObject({ total: full?.total, prep: 'backbone', featureCount: null })
    for (const key of ['usable', 'sampled', 'train', 'test', 'unusable', 'notDrawn'] as const) {
      expect(lite?.[key], key).toBeNull()
    }
    expect(holdsTabularPlan()).toBe(false)
  })
})
