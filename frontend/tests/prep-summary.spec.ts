// @vitest-environment jsdom
/**
 * 전처리 요약 카드 (`views/preprocess/TabularPrepSummary.vue`).
 *
 * **카드가 말하는 숫자는 `planRun`에서 온다** — 그 계획이 학습이 쓰는 것과 같은지는
 * `plan.spec.ts`가 본다. 여기서 보는 것은 **화면이 그 값을 제대로 꺼내 놓는지**와
 * **세 상태를 다 갖는지**다: 유형을 안 골랐다 / 학습이 거부한다 / 계획이 섰다.
 *
 * 대시보드 검사와 같은 방식으로 **띄워서 본다** — 없는 로케일 키를 만나면 `i18n`이
 * 검사 환경에서 던지므로, 그리는 것만으로 그물에 걸린다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import TabularPrepSummary from '../src/views/preprocess/TabularPrepSummary.vue'
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import { applyDataset } from '../src/project/dataset'
import type { ProjectFile } from '../src/project/format'
import {
  withFeatures,
  withPreprocessing,
  withSplit,
  withTarget,
  withTaskType,
} from '../src/project/settings'
import type { Preprocessing } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'

const NOW = '2026-08-13T00:00:00.000Z'

const CSV = ['키,반,점수', '150,A,80', '160,B,90', '170,A,70', '180,B,60'].join('\n')

/** 정본이 앉은 프로젝트. **진짜 입구로 만든다** — 손으로 조립하면 방어선을 건너뛴다. */
function projectWith(csv = CSV): ProjectFile {
  const document = newProjectDocument(
    { name: '테스트', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: NOW,
      randomState: 42,
    },
  )
  const bytes = new TextEncoder().encode(csv)
  const grid = csv.split('\n').map((line) => line.split(','))
  const empty: ProjectFile = {
    document,
    models: new Map(),
    images: new Map(),
    embeddings: new Map(),
  }
  return applyDataset(
    empty,
    { bytes, hash: hashBytes(bytes), grid, source: 'csv', sourceEncoding: 'utf-8' },
    { fileName: '점수.csv', hasHeader: true, now: NOW },
  ).project
}

function mountSummary(file: ProjectFile) {
  useProjectStore().file = file
  return mount(TabularPrepSummary, { global: { plugins: [i18n] } })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

/** 타깃·특성·유형까지 고른 프로젝트. 여기까지 와야 계획이 선다. */
function chosen(preprocessing?: Partial<Preprocessing>): ProjectFile {
  const file = projectWith()
  let document = withTarget(file.document, '점수', NOW)
  document = withFeatures(document, ['키', '반'], NOW)
  document = withTaskType(document, 'regression', [], NOW)
  // 층화는 회귀 타깃에서 막힌다(값이 거의 다 다르다). 여기서 보려는 것은 그 뒤다.
  document = withSplit(document, { stratify: false }, NOW)
  if (preprocessing) document = withPreprocessing(document, preprocessing, NOW)
  return { ...file, document }
}

describe('전처리 요약', () => {
  it('유형을 안 골랐으면 정해지지 않았다고 말한다', () => {
    const summary = mountSummary(projectWith())
    const text = summary.text()

    // 전체 행 수는 계획이 못 서도 안다 - 정본을 읽은 것이 곧 그 숫자다.
    expect(text).toContain('4행')
    expect(text).toContain('기계학습 유형을 고르면 정해집니다.')
    // 로케일 키가 그대로 뜨는 것까지 막는다 (대시보드 검사와 같은 그물이다).
    expect(text).not.toMatch(/preprocess[.]\w+/)
  })

  it('계획이 서면 훈련과 테스트 행 수를 말한다', () => {
    const summary = mountSummary(chosen())
    const text = summary.text()

    // 4행 중 30%가 테스트다 - 반올림은 ml/split.ts가 하고 화면은 받아 적기만 한다.
    expect(text).toContain('훈련 데이터')
    expect(text).toContain('3행')
    expect(text).toContain('1행')
    expect(text).toContain('채움값과 스케일 기준은 훈련 데이터에서만 구합니다.')
  })

  /**
   * **거부 사유도 결과다.** 지금까지는 [학습]을 눌러야 알 수 있었다. `반`은 문자
   * 열이라 인코딩을 끄면 학습에서 빠지고, 남는 특성이 `키` 하나다 — 여기서는 그보다
   * 앞서 "빈 칸을 그대로 두기"가 걸리도록 값을 비운 표를 쓴다.
   */
  it('학습이 거부하면 그 사유가 뜬다', () => {
    const withBlank = ['키,반,점수', '150,A,80', ',B,90', '170,A,70', '180,B,60'].join('\n')
    const file = projectWith(withBlank)
    let document = withTarget(file.document, '점수', NOW)
    document = withFeatures(document, ['키'], NOW)
    document = withTaskType(document, 'regression', [], NOW)
    document = withPreprocessing(document, { missing: 'none' }, NOW)

    const text = mountSummary({ ...file, document }).text()
    expect(text).toContain('빈 칸')
    expect(text).not.toMatch(/errors[.]\w+/)
  })
})
