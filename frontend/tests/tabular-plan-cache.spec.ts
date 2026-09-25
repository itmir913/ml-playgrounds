// @vitest-environment jsdom
/**
 * **학습 화면들이 나눠 쓰는 계획** (`ml/plan-cache.ts`의 `tabularPlanOf`).
 *
 * 두 쪽을 따로 문다.
 * - **계획에 안 들어가는 편집에는 다시 짓지 않는다** — 하이퍼파라미터 · 모델 추가 · 실행 방법 ·
 *   이름. 같은 계획 **객체**가 돌아와야 한다(`fitPreprocessor`가 안 돈다).
 * - **계획에 들어가는 편집에는 다시 짓는다** — 그리고 새 계획은 그 파일로 `planRun`을 직접
 *   부른 것과 같다. 테스트 데이터를 따로 올린 경로(`provided`)도 여기서 문다.
 *
 * 입력은 전처리 판·학습 화면 스펙과 같은 것이다(`fixtures/prep-kind.ts`).
 */

import 'fake-indexeddb/auto'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { importTable, openTable } from '../src/data/table'
import { planRun } from '../src/ml/plan'
import { holdsTabularPlan, tabularPlanOf } from '../src/ml/plan-cache'
import {
  applyTestDataset,
  readDataset,
  readTestDataset,
  removeTestDataset,
} from '../src/project/dataset'
import type { ProjectFile } from '../src/project/format'
import {
  withFeatures,
  withHyperparameter,
  withPreprocessing,
  withRandomState,
  withRuntime,
  withSampling,
  withSelectedAlgorithms,
  withSplit,
  withTarget,
  withTaskType,
} from '../src/project/settings'
import type { ProjectDocument } from '../src/project/schema'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { surveyCsv, surveyProject } from './fixtures/prep-kind'

const NOW = '2026-09-26T00:00:00Z'

function edited(file: ProjectFile, edit: (document: ProjectDocument) => ProjectDocument) {
  return { ...file, document: edit(file.document) }
}

/** 그 파일로 `planRun`을 직접 부른 것 — 캐시를 안 거친 참값. */
function fresh(file: ProjectFile) {
  const dataset = readDataset(file)
  if (!dataset) throw new Error('no table')
  return planRun({
    dataset,
    testDataset: readTestDataset(file),
    settings: file.document.settings,
    taskType: file.document.manifest.taskType,
  })
}

describe('계획에 안 들어가는 편집에는 다시 짓지 않는다', () => {
  const edits: [string, (document: ProjectDocument) => ProjectDocument][] = [
    [
      '하이퍼파라미터',
      (document) =>
        withHyperparameter(
          document,
          { algorithm: 'knn', runtime: 'mljs', name: 'n_neighbors' },
          7,
          NOW,
        ),
    ],
    [
      '모델 추가',
      (document) => withSelectedAlgorithms(document, [{ algorithm: 'knn', runtime: 'mljs' }], NOW),
    ],
    ['실행 방법', (document) => withRuntime(document, 'mljs', NOW)],
    ['이름', (document) => ({ ...document, manifest: { ...document.manifest, name: '새 이름' } })],
  ]

  it.each(edits)('%s', async (_, edit) => {
    const file = await surveyProject(true)
    const first = tabularPlanOf(file)
    expect(first?.ok).toBe(true)
    expect(tabularPlanOf(edited(file, edit))).toBe(first)
  })
})

describe('계획에 들어가는 편집에는 다시 짓는다', () => {
  const edits: [string, (document: ProjectDocument) => ProjectDocument][] = [
    ['결측 처리', (document) => withPreprocessing(document, { missing: 'mean' }, NOW)],
    ['인코딩', (document) => withPreprocessing(document, { categoricalEncoding: 'onehot' }, NOW)],
    ['시험 비율', (document) => withSplit(document, { testSize: 0.3 }, NOW)],
    ['표본 수', (document) => withSampling(document, 20, NOW)],
    ['유형', (document) => withTaskType(document, 'clustering', NOW)],
    ['특성', (document) => withFeatures(document, ['몸무게'], NOW)],
    ['타깃', (document) => withTarget(document, '몸무게', NOW)],
  ]

  it.each(edits)('%s', async (_, edit) => {
    const file = await surveyProject(true)
    const first = tabularPlanOf(file)
    const next = edited(file, edit)
    const second = tabularPlanOf(next)
    expect(second).not.toBe(first)
    expect(second).toEqual(fresh(next))
  })

  /** 되돌리면 되돌린 파일의 계획이다 — 한 칸 캐시가 옛 입력을 우기지 않는다. */
  it('설정을 바꿨다 되돌리면 처음과 같은 계획이다', async () => {
    const file = await surveyProject(true)
    const first = tabularPlanOf(file)
    tabularPlanOf(edited(file, (document) => withPreprocessing(document, { missing: 'mean' }, NOW)))
    expect(tabularPlanOf(file)).toEqual(first)
  })

  /**
   * **테스트 데이터를 따로 올리면 그 표로 계획한다** (`provided`). 계획이 테스트 표를 안 받으면
   * 이 경로에서 `testFromProvided`가 거짓이 되고 시험 행 번호가 정본을 가리킨다.
   */
  it('테스트 데이터를 따로 올리면 그 표로 계획한다', async () => {
    const file = await surveyProject(true)
    tabularPlanOf(file)
    const imported = importTable(await openTable(surveyCsv(true), '시험.csv'))
    const withTest = applyTestDataset(file, imported, {
      fileName: '시험.csv',
      hasHeader: true,
      now: NOW,
    }).project
    const plan = tabularPlanOf(withTest)
    expect(plan).toEqual(fresh(withTest))
    expect(plan?.ok && plan.testFromProvided).toBe(true)
  })
})

/** 씨앗이 정해진 난수 (mulberry32). 걸음이 매번 같아야 빨강을 다시 밟을 수 있다. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Edit = (file: ProjectFile, pick: <T>(items: readonly T[]) => T) => Promise<ProjectFile>

const doc =
  (edit: (document: ProjectDocument) => ProjectDocument): Edit =>
  (file) =>
    Promise.resolve(edited(file, edit))

/**
 * 걸음에 쓰는 편집. **계획에 들어가는 것과 안 들어가는 것을 섞는다** — 안 들어가는 편집은
 * 캐시가 옛 계획을 돌려주는 자리이고, 들어가는 편집은 그 계획이 틀리면 안 되는 자리다.
 */
const EDITS: readonly Edit[] = [
  doc((document) => withRandomState(document, (document.settings.split.randomState + 7) % 97, NOW)),
  doc((document) => withSplit(document, { stratify: !document.settings.split.stratify }, NOW)),
  doc((document) => withSplit(document, { method: 'holdout' }, NOW)),
  doc((document) => withSplit(document, { method: 'provided' }, NOW)),
  (file, pick) =>
    Promise.resolve(edited(file, (d) => withSplit(d, { testSize: pick([0.2, 0.25, 0.3]) }, NOW))),
  (file, pick) =>
    Promise.resolve(edited(file, (d) => withSampling(d, pick([undefined, 20, 30]), NOW))),
  async (file) => {
    const imported = importTable(await openTable(surveyCsv(true), '시험.csv'))
    return applyTestDataset(file, imported, { fileName: '시험.csv', hasHeader: true, now: NOW })
      .project
  },
  (file) => Promise.resolve(removeTestDataset(file, NOW).project),
  (file, pick) =>
    Promise.resolve(
      edited(file, (d) => withPreprocessing(d, { missing: pick(['drop', 'mean']) }, NOW)),
    ),
  (file, pick) =>
    Promise.resolve(
      edited(file, (d) =>
        withPreprocessing(d, { categoricalEncoding: pick(['none', 'onehot']) }, NOW),
      ),
    ),
  (file, pick) =>
    Promise.resolve(
      edited(file, (d) => withFeatures(d, pick([['키', '몸무게'], ['몸무게'], ['키']]), NOW)),
    ),
  (file, pick) =>
    Promise.resolve(edited(file, (d) => withTarget(d, pick(['성별', '몸무게']), NOW))),
  (file, pick) =>
    Promise.resolve(
      edited(file, (d) =>
        withTaskType(d, pick(['classification', 'regression', 'clustering'] as const), NOW),
      ),
    ),
  (file, pick) =>
    Promise.resolve(
      edited(file, (d) =>
        withHyperparameter(
          d,
          { algorithm: 'knn', runtime: 'mljs', name: 'n_neighbors' },
          pick([3, 5, 7]),
          NOW,
        ),
      ),
    ),
  doc((document) => withSelectedAlgorithms(document, [{ algorithm: 'knn', runtime: 'mljs' }], NOW)),
  doc((document) => ({ ...document, manifest: { ...document.manifest, name: '새 이름' } })),
]

/**
 * **무작위 편집 걸음** — 매 걸음 `tabularPlanOf`가 `planRun` 직접 호출과 같다. 파일 둘을 가끔
 * 번갈아 쥔다(정본이 다르다). 열쇠(`PlanInputs`)에서 `data`·`split`·`nSamples`·`taskType` 중
 * 하나가 빠지면 그 칸만 바꾸는 편집 뒤에 옛 계획이 돌아와 여기서 운다. `dataset`·`testDataset`은
 * 예비 칸이라 여기서 안 문다 — 표를 갈아 끼우는 쓰기가 `settings.data`도 늘 새로 짓는다.
 */
describe('무작위 편집 걸음에서 캐시가 참값과 같다', () => {
  it.each([1, 2, 3, 4])('씨앗 %i', async (seed) => {
    const next = random(seed)
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
    const files = [await surveyProject(true), await surveyProject(false)]
    let at = 0
    for (let step = 0; step < 60; step += 1) {
      if (next() < 0.15) at = 1 - at
      const edit = pick(EDITS)
      files[at] = await edit(files[at]!, pick)
      const file = files[at]!
      expect(tabularPlanOf(file), `seed ${seed} step ${step}`).toEqual(fresh(file))
    }
  })
})

/**
 * **프로젝트를 닫거나 바꾸면 캐시가 빈다** (`stores/project.ts`의 `close`·`open` →
 * `forgetTabularPlan`). 라우터는 A → B를 `close()` 없이 `open(B)`로 바꾸므로 둘 다 본다.
 */
describe('프로젝트를 닫거나 바꾸면 캐시가 빈다', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    closeStorage()
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  })

  it('닫은 뒤에는 한 칸이 비어 있다', async () => {
    tabularPlanOf(await surveyProject(true))
    expect(holdsTabularPlan()).toBe(true)
    useProjectStore().close()
    expect(holdsTabularPlan()).toBe(false)
  })

  it('다른 프로젝트를 열면 앞 프로젝트의 계획을 버린다', async () => {
    const first = await surveyProject(true)
    const other = await surveyProject(false)
    const otherId = '77777777-7777-4777-8777-777777777777'
    await saveProject(first)
    await saveProject({
      ...other,
      document: { ...other.document, manifest: { ...other.document.manifest, projectId: otherId } },
    })
    const project = useProjectStore()
    expect(await project.open(first.document.manifest.projectId)).toBe('opened')
    tabularPlanOf(project.file)
    expect(holdsTabularPlan()).toBe(true)

    expect(await project.open(otherId)).toBe('opened')
    expect(holdsTabularPlan()).toBe(false)
    project.close()
  })
})

/** **이 모듈은 Vue와 스토어를 들이지 않는다** — 스토어가 부르는 쪽이고, 거꾸로 부르면 고리가 된다. */
describe('이 모듈은 Vue와 스토어를 들이지 않는다', () => {
  it('plan-cache.ts의 임포트에 vue도 stores도 없다', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ml', 'plan-cache.ts'), 'utf-8')
    const imports = source.split('\n').filter((line) => line.startsWith('import '))
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) {
      expect(line).not.toMatch(/from 'vue'|from 'pinia'|stores\//)
    }
  })
})
