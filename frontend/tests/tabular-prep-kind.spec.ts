// @vitest-environment jsdom
/**
 * **전처리 판의 열 표가 학습과 같은 열 종류를 말하는가** (2026-09-23, R38 A-2).
 *
 * 열 표는 `summarizeColumns`로 **파일 전체의 행**을 세고, 학습은 **그 실행이 쓰는 행**을
 * 센다(결정문 53). 둘이 갈리는 흔한 입력 — **타깃이 빈 행에만** 특성의 `모름`이 있다 — 에서
 * 표는 *"문자 값이 든 열이라 학습에서 빠집니다 · 2개 중 1개"*라고 말했는데 **학습은 그 열을
 * 수치로 썼다.** 학생은 그 문장을 믿고 포트폴리오에 *"키는 제외했다"*고 쓴다.
 * `architecture.md` §9.1.3이 막으려던 모양 그대로다 — *"화면이 말하는 숫자와 모델이 쓰는
 * 숫자가 같은 객체에서 나온다."*
 *
 * **진짜 입구로 세운다** — CSV 바이트 → `openTable` → `importTable` → `applyDataset` → 설정
 * 문. 픽스처로 조립하면 이 판에서 계획이 선 적이 **한 번도 없었다**(R38 C-4).
 *
 * **`nSamples`로 갈리는 경우는 따로 안 세운다.** 감사자가 전·후·처음부터를 재서 셋이
 * 같았고(갱신 누락이 아니다), 틀린 쪽은 처음부터 틀린 파일 전체의 종류였다 — 아래 불변식
 * 판이 입력과 무관하게 그 모양을 문다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { scoreProject, surveyProject } from './fixtures/prep-kind'

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 판의 안쪽. 열 표와 요약 카드가 같은 사실을 말하는지 본다. */
interface PrepInternals {
  plan: {
    usableFeatures: number
    columns: readonly {
      summary: { name: string; kind: 'numeric' | 'categorical' }
      featureIssue?: string
      featureNote?: string
    }[]
  } | null
  fittedColumns: ReadonlyMap<string, { kind: 'numeric' | 'categorical' }> | undefined
  featureSummary: { text: string }
}

/**
 * 입력 둘(`surveyCsv`·`scoreCsv`)은 `fixtures/prep-kind.ts`에 있다 — 학습 화면
 * (`train-prep-kind.spec.ts`)이 **같은 입력**을 태워 두 화면이 같은 말을 하는지 견준다.
 */
async function mountWith(file: ProjectFile): Promise<PrepInternals> {
  const project = useProjectStore()
  await project.save(file)
  const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
  await settle()
  return wrapper.vm as unknown as PrepInternals
}

function heightRow(panel: PrepInternals) {
  return panel.plan?.columns.find((one) => one.summary.name === '키')
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

describe('열 표가 학습과 같은 종류를 말한다', () => {
  /**
   * **고친 자리.** `모름`이 있는 행의 타깃이 비어 실행에서 빠지면, 학습은 `키`를 수치로
   * 쓴다. 표도 수치라고 말해야 하고, 특성 둘이 다 들어간다고 말해야 한다.
   */
  it('타깃이 빈 행에만 글자가 있으면 표도 수치라고 말한다', async () => {
    const panel = await mountWith(await surveyProject(true))

    // 전제: 학습은 `키`를 수치로 쓴다.
    expect(panel.fittedColumns?.get('키')?.kind).toBe('numeric')
    // 표가 같은 말을 한다.
    expect(heightRow(panel)?.summary.kind).toBe('numeric')
    expect(heightRow(panel)?.featureNote).toBeUndefined()
    expect(panel.plan?.usableFeatures).toBe(2)
  })

  /** 글자가 실행에 **들어가면** 두 쪽 다 범주이고 빠진다 — 덮어쓰기가 옳은 경고를 안 지운다. */
  it('글자가 실행에 들어가면 두 쪽 다 범주이고 빠진다고 말한다', async () => {
    const panel = await mountWith(await surveyProject(false))

    expect(panel.fittedColumns?.has('키')).toBe(false)
    expect(heightRow(panel)?.summary.kind).toBe('categorical')
    expect(heightRow(panel)?.featureNote).toBe('notEncodable')
    expect(panel.plan?.usableFeatures).toBe(1)
  })

  /**
   * **불변식 — 학습이 쓰는 열마다 표의 종류가 학습의 종류와 같다** (§9.1.3). 위 두 입력에서
   * 다 성립해야 한다.
   */
  it('학습이 쓰는 열마다 표와 학습의 종류가 같다', async () => {
    for (const blank of [true, false]) {
      const panel = await mountWith(await surveyProject(blank))
      for (const [name, fitted] of panel.fittedColumns ?? []) {
        const row = panel.plan?.columns.find((one) => one.summary.name === name)
        expect(row?.summary.kind, `${name} (blank target: ${String(blank)})`).toBe(fitted.kind)
      }
    }
  })
})

/**
 * **타깃 열도 학습이 본 종류를 말한다** (2026-09-23 R38-V V-A1).
 *
 * 위 판의 고침은 **특성 열**만 덮었다 — 타깃은 `fittedColumns`에 없어 파일 전체의 종류로
 * 남았다. 학습은 타깃을 **쓸 수 있는 행**(`usableRows`)의 라벨로 판정하므로, 회귀 타깃의
 * 글자가 **특성이 빈 행에만** 있고 결측 처리가 `drop`이면 학습은 통과하는데 표의 타깃 줄은
 * *"학습이 거부한다"*는 빨강이었다. **`drop`은 새 프로젝트의 기본값이다** — 학생이 아무것도
 * 안 바꿔도 이 길이다.
 *
 * 대조 둘(`mean`으로 그 행을 살린다 · 글자 행의 특성을 채운다)은 두 쪽 다 거부해야 한다.
 */
describe('타깃 줄이 학습의 판정을 말한다', () => {
  const NOT_NUMERIC = '타깃 열에는 숫자가 아닌 값이 있습니다'

  async function regressionPanel(heightBlank: boolean, missing: 'drop' | 'mean', csv?: Uint8Array) {
    const project = useProjectStore()
    await project.save(await scoreProject(heightBlank, missing, csv))
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await settle()
    const vm = wrapper.vm as unknown as {
      runPlan: {
        ok: boolean
        reason?: { code?: string; params?: Record<string, unknown> }
        targetKind?: string
      } | null
      plan: {
        columns: readonly { summary: { name: string; kind: string }; targetIssue?: string }[]
      } | null
    }
    const target = vm.plan?.columns.find((one) => one.summary.name === '점수')
    const reds = wrapper.text().split(NOT_NUMERIC).length - 1
    return { vm, target, reds }
  }

  it('글자가 drop으로 빠지는 행에만 있으면 학습은 받고 타깃 줄도 조용하다', async () => {
    const { vm, target, reds } = await regressionPanel(true, 'drop')

    // 전제: 학습은 받는다.
    expect(vm.runPlan?.ok).toBe(true)
    // 표가 같은 말을 한다 — 빨강이 없고, 종류는 수치다.
    expect(target?.targetIssue).toBeUndefined()
    expect(target?.summary.kind).toBe('numeric')
    expect(reds).toBe(0)
  })

  it('그 행을 mean으로 살리면 두 쪽 다 거부한다', async () => {
    const { vm, target, reds } = await regressionPanel(true, 'mean')

    expect(vm.runPlan?.ok).toBe(false)
    expect(vm.runPlan?.reason?.code).toBe('TARGET_NOT_NUMERIC')
    expect(target?.targetIssue).toBe('TARGET_NOT_NUMERIC')
    // 타깃 줄과 요약 카드 둘이 같은 말을 한다.
    expect(reds).toBe(2)
  })

  /**
   * **쓸 수 있는 행이 하나도 없으면 타깃의 종류를 말하지 않는다** (R38-V2 B-1, `open-decisions.md`
   * 53). `키`가 모든 행에서 비면 `drop`이 전부 걸러 행이 0개다. 전에는 계획이 빈 라벨을 범주로
   * 불러 **숫자뿐인** `점수` 줄에 "숫자가 아닌 값"이 빨갛게 섰다(빨강 2). 참말은 옆 `키` 줄의
   * "전부 비었다"이고, 요약은 행 수를 말한다.
   */
  it('쓸 수 있는 행이 0개면 숫자뿐인 타깃 줄이 조용하고 계획은 행 수로 선다', async () => {
    const lines = ['키,몸무게,점수']
    for (let i = 0; i < 40; i += 1) lines.push(`,${45 + i},${60 + i}`)
    const csv = new TextEncoder().encode(`${lines.join('\n')}\n`)
    const { vm, target, reds } = await regressionPanel(true, 'drop', csv)

    expect(vm.runPlan?.reason?.code).toBe('SPLIT_TOO_FEW_ROWS')
    expect(vm.runPlan?.reason?.params).toMatchObject({ actualRows: 0 })
    expect(vm.runPlan?.targetKind).toBeUndefined()
    expect(target?.targetIssue).toBeUndefined()
    expect(target?.summary.kind).toBe('numeric')
    expect(reds).toBe(0)
  })

  it('글자 행의 특성이 있으면 drop이어도 두 쪽 다 거부한다', async () => {
    const { vm, target, reds } = await regressionPanel(false, 'drop')

    expect(vm.runPlan?.reason?.code).toBe('TARGET_NOT_NUMERIC')
    expect(target?.targetIssue).toBe('TARGET_NOT_NUMERIC')
    expect(reds).toBe(2)
  })
})
