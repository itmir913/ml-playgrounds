// @vitest-environment jsdom
/**
 * **점검의 대조 예상 시간이 사진 실험에도 선다** (open-decisions.md 87).
 *
 * 대조 판은 실험의 표 설정과 정본 표가 없으면 기준표를 보기도 전에 멈춰서, 사진 실험은 늘 `알 수 없음`이었다.
 * 학습 화면은 같은 사진을 사진 기준표로 낸다. 입력은 학습 화면이 넘기는 모양과 같아야 한다 — 데이터 종류는
 * 실험의 것, 행은 훈련 몫, 폭은 표가 아니면 0. 분류의 클래스 수도 학습 화면과 같은 규칙으로 훈련 몫에서 센다
 * (open-decisions.md 88의 개정) — *"표 실험의 클래스 수"*와 *"이음새"* 묶음이 문다.
 *
 * 앞의 검사는 부품 밖 함수(`ml/reproduce-estimate.ts`)를 재고, 마지막 묶음은 진짜 대조 판을 띄워 그 함수가
 * 판의 예상에 닿는지를 잰다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/ml/worker/client', () => ({
  train: () => ({ result: new Promise(() => {}), cancel: () => {} }),
  calibrateDevice: () => Promise.resolve(null),
}))

vi.mock('../src/ml/worker/spawn', () => ({ spawnTrainingWorker: () => ({}) }))

const { MLJS_ENGINE } = await import('../src/ml/engines/mljs')
const { PYODIDE_SKLEARN_ENGINE } = await import('../src/ml/engines/pyodide-sklearn')
const { describe: describeEstimate, estimateMs } = await import('../src/ml/estimate')
const { reproduceEstimate, reproduceEstimateInputs } = await import('../src/ml/reproduce-estimate')
const { DEFAULT_BACKBONE_ID, backboneFor } = await import('../src/ml/backbones')
const { runExperiment } = await import('../src/ml/experiment')
const { imageTrainingSource } = await import('../src/ml/images')
const { tabularPlanOf } = await import('../src/ml/plan-cache')
const { trainingClassesOf, trainingEstimateShape, trainingSourceOf } =
  await import('../src/ml/training-source')
const { hashBytes } = await import('../src/hash')
const { newProjectDocument } = await import('../src/project/create')
const { readDataset } = await import('../src/project/dataset')
const { IMAGE_UNLABELED } = await import('../src/project/format')
const { addCategory, addImages, readImages } = await import('../src/project/images')
const { withSelectedAlgorithms, withSplit } = await import('../src/project/settings')
const { i18n, setLocale } = await import('../src/i18n')
const ReproducePanel = (await import('../src/views/inspect/ReproducePanel.vue')).default
const { experiment, run } = await import('./fixtures/project')
const { tabularProjectFrom } = await import('./fixtures/prep-kind')

import type { ProjectFile } from '../src/project/format'
import type { Experiment, Run } from '../src/project/schema'

const NOW = '2026-09-30T00:00:00Z'

/** 사진 실험 하나. 스냅샷은 사진의 모양이다 — 표의 것을 두면 여는 문이 거절한다. */
function imageExperiment(runs: Run[], trained = 40): Experiment {
  const base = experiment('experiment-image', runs)
  return {
    ...base,
    settings: {
      ...base.settings,
      data: {
        categories: ['고양이', '개'],
        backboneId: DEFAULT_BACKBONE_ID,
        categoryCounts: [25, 25],
        unlabeledCount: 0,
      },
      trainIndices: Array.from({ length: trained }, (_, at) => at),
      testIndices: [],
    },
  }
}

const naiveBayes = run('run-nb', {
  algorithm: 'naive_bayes',
  hyperparameters: {},
  engine: MLJS_ENGINE,
})

describe('사진 실험의 대조 예상', () => {
  it('입력은 학습 화면과 같은 모양이다 - 사진, 훈련 몫, 폭 0', () => {
    const inputs = reproduceEstimateInputs({
      experiment: imageExperiment([naiveBayes]),
      dataType: 'image',
      featureWidth: null,
      dataset: null,
    })
    expect(inputs).toEqual([
      {
        algorithm: 'naive_bayes',
        dataType: 'image',
        rows: 40,
        columns: 0,
        hyperparameters: {},
        runtime: 'mljs',
        classes: 2,
      },
    ])
  })

  /**
   * **클래스 수도 학습 화면처럼 넘긴다** (open-decisions.md 88과 그 개정). 사진은 스냅샷의 범주별 장수에서 한
   * 장이라도 있는 범주의 수다 — 목록(`categories`)은 빈 범주까지 들고, 혼동 행렬은 시험 몫의 라벨이다. 두 run이
   * 같은 훈련 몫이라 같은 수를 받는다.
   */
  it('사진 분류 run은 사진이 있는 범주 수를 넘긴다 - 빈 범주와 혼동 행렬을 안 센다', () => {
    const classified = run('run-nb-cm', {
      algorithm: 'naive_bayes',
      hyperparameters: {},
      engine: MLJS_ENGINE,
      confusionMatrix: { labels: ['개', '고양이', '새', '말'], matrix: [] },
    })
    const base = imageExperiment([classified, naiveBayes])
    const inputs = reproduceEstimateInputs({
      experiment: {
        ...base,
        settings: {
          ...base.settings,
          data: {
            ...base.settings.data,
            categories: ['고양이', '개', '새'],
            categoryCounts: [25, 25, 0],
          },
        },
      },
      dataType: 'image',
      featureWidth: null,
      dataset: null,
    })
    expect(inputs?.map((input) => input.classes)).toEqual([2, 2])
  })

  /** 옛 파일은 목록에 같은 이름이 두 번 들 수 있다(`renameCategory`가 겹침을 걷기 전). 이름으로 센다. */
  it('같은 이름이 두 칸이면 한 범주로 센다', () => {
    const base = imageExperiment([naiveBayes])
    const inputs = reproduceEstimateInputs({
      experiment: {
        ...base,
        settings: {
          ...base.settings,
          data: { ...base.settings.data, categories: ['개', '개'], categoryCounts: [10, 30] },
        },
      },
      dataType: 'image',
      featureWidth: null,
      dataset: null,
    })
    expect(inputs?.map((input) => input.classes)).toEqual([1])
  })

  it('분류가 아닌 사진 실험은 클래스 수를 안 넘긴다', () => {
    const base = imageExperiment([naiveBayes])
    const inputs = reproduceEstimateInputs({
      experiment: { ...base, settings: { ...base.settings, taskType: 'clustering' } },
      dataType: 'image',
      featureWidth: null,
      dataset: null,
    })
    expect(inputs?.map((input) => input.classes)).toEqual([undefined])
  })

  it('사진 기준표로 선다 - 학습 화면이 같은 입력으로 내는 값과 같다', () => {
    const subject = {
      experiment: imageExperiment([naiveBayes]),
      dataType: 'image' as const,
      featureWidth: null,
      dataset: null,
    }
    const expected = estimateMs(
      {
        algorithm: 'naive_bayes',
        dataType: 'image',
        rows: 40,
        columns: 0,
        hyperparameters: {},
        runtime: 'mljs',
        classes: 2,
      },
      2,
    )
    expect(expected, 'the image baseline for naive Bayes must be measured').not.toBeNull()
    expect(reproduceEstimate(subject, 2)).toEqual(describeEstimate(expected))
  })

  it('기준표가 빈 사진 칸은 알 수 없음이다 - sklearn 인공신경망', () => {
    const neural = run('run-nn', {
      algorithm: 'neural_network',
      hyperparameters: {},
      engine: { ...PYODIDE_SKLEARN_ENGINE, version: '1.5.2' },
    })
    const subject = {
      experiment: imageExperiment([naiveBayes, neural]),
      dataType: 'image' as const,
      featureWidth: null,
      dataset: null,
    }
    expect(reproduceEstimate(subject, 1)).toEqual({ kind: 'unknown' })
  })

  it('기준표가 빈 사진 칸은 알 수 없음이다 - 선형 회귀', () => {
    const linear = run('run-linear', {
      algorithm: 'linear_regression',
      hyperparameters: {},
      engine: MLJS_ENGINE,
    })
    const subject = {
      experiment: imageExperiment([linear]),
      dataType: 'image' as const,
      featureWidth: null,
      dataset: null,
    }
    expect(reproduceEstimate(subject, 1)).toEqual({ kind: 'unknown' })
  })

  it('설정이 그 종류로 안 읽히면 모른다 - 사진 프로젝트에 표 스냅샷', () => {
    const tabular = experiment('experiment-mismatch', [naiveBayes])
    expect(
      reproduceEstimateInputs({
        experiment: tabular,
        dataType: 'image',
        featureWidth: 2,
        dataset: null,
      }),
    ).toBeNull()
  })
})

describe('표 실험의 대조 예상은 그대로다', () => {
  const tree = run('run-tree', { engine: MLJS_ENGINE })

  it('폭은 대조 판이 센 특성 폭이고 행은 훈련 몫이다', () => {
    const claim = experiment('experiment-table', [tree])
    expect(
      reproduceEstimateInputs({
        experiment: claim,
        dataType: 'tabular',
        featureWidth: 3,
        dataset: null,
      }),
    ).toEqual([
      {
        algorithm: 'decision_tree',
        dataType: 'tabular',
        rows: claim.settings.trainIndices.length,
        columns: 3,
        hyperparameters: tree.hyperparameters,
        runtime: 'mljs',
      },
    ])
  })

  it('표를 못 열어 폭을 모르면 모른다', () => {
    const claim = experiment('experiment-table', [tree])
    expect(
      reproduceEstimateInputs({
        experiment: claim,
        dataType: 'tabular',
        featureWidth: null,
        dataset: null,
      }),
    ).toBeNull()
  })

  it('끝나지 않은 run은 안 센다', () => {
    const failed = run('run-failed', { engine: MLJS_ENGINE, status: 'failed' })
    const claim = experiment('experiment-table', [tree, failed])
    expect(
      reproduceEstimateInputs({
        experiment: claim,
        dataType: 'tabular',
        featureWidth: 2,
        dataset: null,
      }),
    ).toHaveLength(1)
  })
})

/**
 * **표 실험의 클래스 수는 그 실험의 훈련 몫에서 센다** (open-decisions.md 88의 개정, 감사 슬라이스 1 B-1).
 *
 * 전에는 run에 남은 혼동 행렬의 라벨 수를 썼다. 그것은 시험 몫의 정답과 예측이라, 드문 클래스가 시험 몫에
 * 안 나오면 빠진다 — 감사가 40행 10클래스(큰 클래스 둘, 한 행짜리 여덟)에서 대조 2클래스, 예상 4.7배 짧음을
 * 재현했다. 지금은 대조 판이 연 표의 `trainIndices` 행을 학습 화면과 같은 함수(`targetClassCount`)로 센다.
 */
describe('표 실험의 클래스 수', () => {
  /** 행마다 타깃 하나. 열은 fixture 실험의 특성·타깃 이름이다. */
  function table(targets: readonly string[]) {
    return {
      columns: ['꽃받침 길이', 'petal_length', '품종'],
      rows: targets.map((target, row) => [String(5 + row), String(1 + row), target]),
    }
  }

  /** fixture 실험에 훈련 몫과 run의 혼동 행렬 라벨을 준다. */
  function claimWith(trainIndices: number[], testIndices: number[], labels: string[]) {
    const base = experiment('experiment-classes', [
      run('run-classes', {
        engine: MLJS_ENGINE,
        confusionMatrix: { labels, matrix: [] },
      }),
    ])
    return { ...base, settings: { ...base.settings, trainIndices, testIndices } }
  }

  function classesOf(claim: Experiment, dataset: { columns: string[]; rows: string[][] }) {
    return reproduceEstimateInputs({
      experiment: claim,
      dataType: 'tabular',
      featureWidth: 2,
      dataset,
    })?.map((input) => input.classes)
  }

  /**
   * 훈련 몫은 `개`·`새`·`말` 셋이다. 혼동 행렬(시험 몫)로 세면 둘, 파일 전체로 세면 시험 몫에만 있는 `토끼`까지
   * 다섯이다 — 둘 다 이 실험이 학습한 클래스 수가 아니다.
   */
  it('훈련 몫의 타깃 값 종류를 센다 - 혼동 행렬도 파일 전체도 아니다', () => {
    const dataset = table(['개', '고양이', '새', '말', '토끼'])
    const claim = claimWith([0, 2, 3], [1, 4], ['고양이', '토끼'])
    expect(classesOf(claim, dataset)).toEqual([3])
  })

  /**
   * **학습과 같은 규칙이다** — 앞뒤 공백을 떼고 공백뿐인 칸을 결측으로 본다(`targetValues`·`isMissing`).
   * 따로 세면 `' 개'`가 둘째 클래스가 되고 빈 칸이 셋째가 된다.
   */
  it('앞뒤 공백을 떼고 결측을 안 센다', () => {
    const dataset = table(['개', ' 개', '고양이 ', '', '   ', '고양이'])
    const claim = claimWith([0, 1, 2, 3, 4], [5], ['고양이'])
    expect(classesOf(claim, dataset)).toEqual([2])
  })

  /** **셀 수 없을 때만** 혼동 행렬로 물러선다 — 타깃 열이 표에 없거나 훈련 몫이 표 밖을 가리킬 때다. */
  it('타깃 열이 표에 없으면 혼동 행렬의 라벨 수로 물러선다', () => {
    const dataset = { columns: ['꽃받침 길이', 'petal_length', 'species'], rows: [['1', '2', 'a']] }
    const claim = claimWith([0], [], ['a', 'b', 'c'])
    expect(classesOf(claim, dataset)).toEqual([3])
  })

  it('훈련 몫이 표 밖을 가리키면 혼동 행렬의 라벨 수로 물러선다', () => {
    const dataset = table(['개', '고양이'])
    const claim = claimWith([0, 1, 7], [], ['개', '고양이', '새'])
    expect(classesOf(claim, dataset)).toEqual([3])
  })

  it('분류가 아니면 표가 있어도 클래스 수를 안 넘긴다', () => {
    const dataset = table(['1.5', '2.5', '3.5'])
    const base = claimWith([0, 1], [2], [])
    const claim = { ...base, settings: { ...base.settings, taskType: 'regression' as const } }
    expect(classesOf(claim, dataset)).toEqual([undefined])
  })
})

/**
 * **이음새 — 같은 실험을 학습 화면 입구와 대조 입구에 태운다.** 조각마다 초록이어도 두 화면이 같은 수를 내는지는
 * 잇는 검사만 본다(병 2). 진짜 입구로 짓는다(병 3): CSV → `tabularProjectFrom` → `trainingSourceOf` →
 * `runExperiment`. 학습 화면 쪽은 `trainingEstimateShape`, 대조 쪽은 `reproduceEstimateInputs`다.
 *
 * 모양은 감사 슬라이스 1 B-1의 재현이다 — 40행 10클래스(큰 클래스 둘 × 16행, 한 행짜리 여덟), 층화 끔, 로지스틱.
 * 드문 클래스가 전부 훈련 몫에 드는 씨앗을 고른다 — 그래야 학습 화면(파일 전체)과 대조(훈련 몫)가 같은 수를
 * 낼 자리이고, 시험 몫의 혼동 행렬은 그보다 적다.
 */
describe('이음새 - 학습 화면과 대조가 같은 실험에서 같은 몫을 낸다', () => {
  const RARE = ['다', '라', '마', '바', '사', '아', '자', '차']

  function auditCsv(): Uint8Array {
    const lines = ['x,y']
    for (let i = 0; i < 16; i += 1) lines.push(`${i},가`, `${100 + i},나`)
    RARE.forEach((label, index) => lines.push(`${200 + index},${label}`))
    return new TextEncoder().encode(`${lines.join('\n')}\n`)
  }

  /** 층화를 끄고, 시험 몫에 드문 클래스가 하나도 없는 씨앗을 고른 프로젝트. */
  async function auditProject(): Promise<ProjectFile> {
    const built = await tabularProjectFrom(auditCsv(), '감사.csv', {
      taskType: 'classification',
      target: 'y',
      features: ['x'],
      preprocessing: {},
    })
    let document = withSplit(built.document, { stratify: false }, NOW)
    document = withSelectedAlgorithms(
      document,
      [{ algorithm: 'logistic_regression', runtime: 'mljs' }],
      NOW,
    )
    const dataset = readDataset(built)
    if (!dataset) throw new Error('the audit table must stand')
    for (let seed = 0; seed < 200; seed += 1) {
      const settings = {
        ...document.settings,
        split: { ...document.settings.split, randomState: seed },
      }
      const project = { ...built, document: { ...document, settings } }
      const plan = tabularPlanOf(project)
      if (!plan?.ok) throw new Error('the audit plan must stand')
      const tested = new Set(plan.split.testIndices.map((row) => dataset.rows[row]?.[1]))
      if (RARE.every((label) => !tested.has(label))) return project
    }
    throw new Error('no seed keeps every rare class in the training share')
  }

  it('클래스 수와 행 수가 학습 화면과 같다 - 혼동 행렬보다 많다', async () => {
    const project = await auditProject()
    const shape = trainingEstimateShape(project)
    expect(shape.classes, 'the training screen counts every class').toBe(10)

    const source = await trainingSourceOf({ project, taskType: 'classification' })
    const { experiment: claim } = await runExperiment({
      dataset: source.dataset,
      testDataset: source.testDataset,
      taskType: 'classification',
      dataType: 'tabular',
      settings: source.settings,
      context: {
        serverStatus: 'unavailable',
        limitsOff: false,
        rowCount: source.dataset.rows.length,
        dataType: 'tabular',
      },
      snapshot: source.snapshot,
    })
    const labels = claim.runs[0]?.confusionMatrix?.labels.length ?? 0
    expect(labels, 'the test share must miss the rare classes').toBeLessThan(10)

    const inputs = reproduceEstimateInputs({
      experiment: claim,
      dataType: 'tabular',
      featureWidth: shape.columns,
      dataset: readDataset(project),
    })
    expect(inputs?.map((input) => ({ classes: input.classes, rows: input.rows }))).toEqual([
      { classes: shape.classes, rows: shape.rows },
    ])
  })

  /**
   * **사진도 학습 화면이 그때 센 수와 같다.** 스냅샷은 학습 화면과 같은 판에서 `imageTrainingSource`가 짓는다.
   * 목록에는 사진이 없는 범주가 하나 들고 미분류 사진이 하나 있다 — 둘 다 세면 안 된다.
   */
  it('사진 실험의 클래스 수가 학습 화면과 같다 - 빈 범주와 미분류를 안 센다', () => {
    const backbone = backboneFor(DEFAULT_BACKBONE_ID)
    if (!backbone) throw new Error('the default backbone must be registered')
    const document = newProjectDocument(
      { name: '동물', locale: 'ko', dataType: 'image' },
      { projectId: '550e8400-e29b-41d4-a716-446655440000', createdAt: NOW, randomState: 42 },
    )
    const photos = (
      [
        ['하나', '개'],
        ['둘', '개'],
        ['셋', '고양이'],
        ['넷', IMAGE_UNLABELED],
      ] as const
    ).map(([seed, category]) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${seed}`)
      return { hash: hashBytes(bytes), bytes, category }
    })
    const empty: ProjectFile = {
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    const added = addImages(empty, photos, {
      canonicalSize: backbone.canonicalSize,
      now: NOW,
      format: 'webp',
    }).project
    const project = addCategory(added, '새', NOW)
    const vectors = new Map(
      readImages(project).map((entry) => [entry.hash, new Float32Array(backbone.embeddingDim)]),
    )
    const { snapshot } = imageTrainingSource(project, vectors, backbone, 'classification')

    const base = imageExperiment([naiveBayes])
    const claim = { ...base, settings: { ...base.settings, data: snapshot } }
    const inputs = reproduceEstimateInputs({
      experiment: claim,
      dataType: 'image',
      featureWidth: null,
      dataset: null,
    })
    expect(trainingClassesOf(project, 'classification')).toBe(2)
    expect(inputs?.map((input) => input.classes)).toEqual([
      trainingClassesOf(project, 'classification'),
    ])
  })
})

describe('모르는 것은 지어내지 않는다', () => {
  it('엔진이 적히지 않은 run이 있으면 모른다', () => {
    const unknown = run('run-no-engine')
    expect(
      reproduceEstimateInputs({
        experiment: imageExperiment([naiveBayes, unknown]),
        dataType: 'image',
        featureWidth: null,
        dataset: null,
      }),
    ).toBeNull()
  })

  it('서버에서 돈 run이 있으면 모른다 - 우리가 모르는 기기다', () => {
    const server = run('run-server', {
      algorithm: 'naive_bayes',
      hyperparameters: {},
      engine: { kind: 'sklearn', version: '1.5.2' },
    })
    const subject = {
      experiment: imageExperiment([naiveBayes, server]),
      dataType: 'image' as const,
      featureWidth: null,
      dataset: null,
    }
    expect(reproduceEstimate(subject, 1)).toEqual({ kind: 'unknown' })
  })

  it('기기 배수를 아직 못 쟀으면 모른다', () => {
    const subject = {
      experiment: imageExperiment([naiveBayes]),
      dataType: 'image' as const,
      featureWidth: null,
      dataset: null,
    }
    expect(reproduceEstimate(subject, null)).toEqual({ kind: 'unknown' })
  })
})

/**
 * **진짜 대조 판이 그 함수로 낸다.** 사진 실험은 아직 대조가 안 열려(`IMAGE_NOT_OPEN`) 예상 줄이 화면에
 * 안 서므로 판이 쥔 값(`estimate`)을 읽는다 — `inspect-reproduce-width.spec.ts`가 `featureWidth`를 읽는 것과 같다.
 */
describe('대조 판', () => {
  const FACTOR_KEY = 'ml-playgrounds:device-factor'

  beforeEach(async () => {
    setActivePinia(createPinia())
    await setLocale('ko')
    window.localStorage.setItem(FACTOR_KEY, '2')
  })

  afterEach(() => {
    window.localStorage.removeItem(FACTOR_KEY)
  })

  function estimateOf(props: {
    experiment: Experiment
    dataType: 'tabular' | 'image'
    dataset: { columns: string[]; rows: string[][] } | null
  }): unknown {
    const panel = mount(ReproducePanel, {
      props: { ...props, order: 1, testDataset: null, preprocessor: null, appVersion: '0.0.0' },
      global: { plugins: [i18n] },
    })
    const value = (panel.vm as unknown as { estimate: unknown }).estimate
    panel.unmount()
    return value
  }

  it('사진 실험에도 사진 기준표로 예상을 낸다', () => {
    const claim = imageExperiment([naiveBayes])
    const value = estimateOf({ experiment: claim, dataType: 'image', dataset: null })
    expect(value).toEqual(
      reproduceEstimate(
        { experiment: claim, dataType: 'image', featureWidth: null, dataset: null },
        2,
      ),
    )
    expect(value).not.toEqual({ kind: 'unknown' })
  })

  it('표 실험은 표를 열었을 때만 낸다', () => {
    const claim = experiment('experiment-table', [run('run-tree', { engine: MLJS_ENGINE })])
    const table = {
      columns: ['꽃받침 길이', 'petal_length', '품종'],
      rows: [
        ['5.1', '1.4', 'setosa'],
        ['7.0', '4.7', 'versicolor'],
        ['6.3', '6.0', 'virginica'],
        ['4.9', '1.5', 'setosa'],
      ],
    }
    expect(estimateOf({ experiment: claim, dataType: 'tabular', dataset: table })).not.toEqual({
      kind: 'unknown',
    })
    expect(estimateOf({ experiment: claim, dataType: 'tabular', dataset: null })).toEqual({
      kind: 'unknown',
    })
  })

  /**
   * **판이 연 표를 넘긴다** (open-decisions.md 88의 개정). 훈련 몫은 열 클래스이고 혼동 행렬은 한 라벨이다 —
   * 판이 표를 안 넘기면 혼동 행렬로 물러서 예상이 짧아진다. 로지스틱은 클래스에 거의 비례해 둘이 갈린다.
   */
  it('표 실험의 클래스 수를 판이 연 표의 훈련 몫에서 센다', () => {
    const size = 3000
    const table = {
      columns: ['꽃받침 길이', 'petal_length', '품종'],
      rows: Array.from({ length: size }, (_, row) => [
        String(row),
        String(row % 7),
        `클래스${String(row % 10)}`,
      ]),
    }
    const base = experiment('experiment-panel-classes', [
      run('run-logistic', {
        algorithm: 'logistic_regression',
        hyperparameters: {},
        engine: MLJS_ENGINE,
        confusionMatrix: { labels: ['클래스9'], matrix: [] },
      }),
    ])
    const claim = {
      ...base,
      settings: {
        ...base.settings,
        trainIndices: Array.from({ length: size - 1 }, (_, row) => row),
        testIndices: [size - 1],
      },
    }
    const panel = mount(ReproducePanel, {
      props: {
        experiment: claim,
        order: 1,
        dataType: 'tabular',
        dataset: table,
        testDataset: null,
        preprocessor: null,
        appVersion: '0.0.0',
      },
      global: { plugins: [i18n] },
    })
    const vm = panel.vm as unknown as { estimate: unknown; featureWidth: number }
    const { estimate, featureWidth } = vm
    panel.unmount()

    const counted = reproduceEstimate(
      { experiment: claim, dataType: 'tabular', featureWidth, dataset: table },
      2,
    )
    const fallback = reproduceEstimate(
      { experiment: claim, dataType: 'tabular', featureWidth, dataset: null },
      2,
    )
    expect(counted, 'counting the training share must change the estimate').not.toEqual(fallback)
    expect(estimate).toEqual(counted)
  })
})
