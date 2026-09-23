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

import { openTable, importTable } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import { applyDataset } from '../src/project/dataset'
import type { ProjectFile } from '../src/project/format'
import { withFeatures, withPreprocessing, withTarget, withTaskType } from '../src/project/settings'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

const NOW = '2026-09-23T00:00:00Z'

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
 * 40행 설문. `키`는 수치인데 **한 칸만** `모름`이다. `blankTarget`이면 그 행의 타깃(`성별`)이
 * 빈 칸이라 **그 행은 실행에서 빠진다** — 파일 전체로는 `키`가 범주, 실행으로는 수치다.
 */
function surveyCsv(blankTarget: boolean): Uint8Array {
  const lines = ['키,몸무게,성별']
  for (let i = 0; i < 40; i += 1) {
    const height = i === 7 ? '모름' : String(150 + i)
    const sex = i === 7 && blankTarget ? '' : i % 2 === 0 ? '남' : '여'
    lines.push(`${height},${45 + i},${sex}`)
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

async function projectFrom(csv: Uint8Array): Promise<ProjectFile> {
  const imported = importTable(await openTable(csv, '설문.csv'))
  const { project } = applyDataset(projectFile(), imported, {
    fileName: '설문.csv',
    hasHeader: true,
    now: NOW,
  })
  let document = withTaskType(project.document, 'classification', [], NOW)
  document = withTarget(document, '성별', NOW)
  document = withFeatures(document, ['키', '몸무게'], NOW)
  // **인코딩을 끈다** — 그래야 범주로 읽힌 열이 학습에서 "빠진다"고 화면이 말한다.
  document = withPreprocessing(document, { categoricalEncoding: 'none' }, NOW)
  return { ...project, document }
}

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
    const panel = await mountWith(await projectFrom(surveyCsv(true)))

    // 전제: 학습은 `키`를 수치로 쓴다.
    expect(panel.fittedColumns?.get('키')?.kind).toBe('numeric')
    // 표가 같은 말을 한다.
    expect(heightRow(panel)?.summary.kind).toBe('numeric')
    expect(heightRow(panel)?.featureNote).toBeUndefined()
    expect(panel.plan?.usableFeatures).toBe(2)
  })

  /** 글자가 실행에 **들어가면** 두 쪽 다 범주이고 빠진다 — 덮어쓰기가 옳은 경고를 안 지운다. */
  it('글자가 실행에 들어가면 두 쪽 다 범주이고 빠진다고 말한다', async () => {
    const panel = await mountWith(await projectFrom(surveyCsv(false)))

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
      const panel = await mountWith(await projectFrom(surveyCsv(blank)))
      for (const [name, fitted] of panel.fittedColumns ?? []) {
        const row = panel.plan?.columns.find((one) => one.summary.name === name)
        expect(row?.summary.kind, `${name} (blank target: ${String(blank)})`).toBe(fitted.kind)
      }
    }
  })
})
