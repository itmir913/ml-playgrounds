/**
 * 단계 진입 조건.
 *
 * **화면을 하나도 띄우지 않고 여기서 전부 확인한다.** 그러라고 컴포넌트 밖의 순수
 * 함수로 뺐다 (architecture.md §8.3). 컴포넌트 안에 있었으면 조건 하나를 보려고
 * 라우터와 스토어와 화면을 다 세워야 한다.
 */

import { describe, expect, it } from 'vitest'

import {
  FIRST_STEP,
  isStepId,
  isStepUnlocked,
  NO_PROGRESS,
  resolveStep,
  STEP_IDS,
  type ProjectProgress,
} from '../src/router/steps'
import { progressOf } from '../src/stores/project'
import { batch, emptyProjectFile, projectFile, run } from './fixtures/project'

function progress(overrides: Partial<ProjectProgress> = {}): ProjectProgress {
  return { ...NO_PROGRESS, ...overrides }
}

const ALL: ProjectProgress = {
  hasDataset: true,
  hasSettings: true,
  hasRuns: true,
  hasModels: true,
}

describe('단계 목록', () => {
  it('첫 단계가 목록의 처음이다', () => {
    expect(STEP_IDS[0]).toBe(FIRST_STEP)
  })

  it('id가 중복되지 않는다', () => {
    expect(new Set(STEP_IDS).size).toBe(STEP_IDS.length)
  })

  it('아는 id만 통과시킨다', () => {
    for (const step of STEP_IDS) {
      expect(isStepId(step), step).toBe(true)
    }
    for (const value of ['', 'Data', 'settings', null, undefined, 3]) {
      expect(isStepId(value), String(value)).toBe(false)
    }
  })
})

describe('잠금 해제', () => {
  it('데이터와 포트폴리오는 아무것도 없어도 열려 있다', () => {
    // 데이터는 시작점이고, 포트폴리오는 하는 도중에 쓰는 것이다.
    expect(isStepUnlocked('data', NO_PROGRESS)).toBe(true)
    expect(isStepUnlocked('portfolio', NO_PROGRESS)).toBe(true)
  })

  it('나머지는 아무것도 없으면 전부 잠겨 있다', () => {
    for (const step of ['preprocess', 'train', 'results', 'predict'] as const) {
      expect(isStepUnlocked(step, NO_PROGRESS), step).toBe(false)
    }
  })

  it('전처리는 데이터만 있으면 열린다', () => {
    expect(isStepUnlocked('preprocess', progress({ hasDataset: true }))).toBe(true)
  })

  it('학습은 설정만으로는 열리지 않는다', () => {
    // 설정이 남아 있는 채로 데이터를 갈아치우는 경우가 있다.
    expect(isStepUnlocked('train', progress({ hasSettings: true }))).toBe(false)
    expect(isStepUnlocked('train', progress({ hasDataset: true, hasSettings: true }))).toBe(true)
  })

  it('결과는 run이 있으면 열린다 - 실패한 학습도 결과다', () => {
    expect(isStepUnlocked('results', progress({ hasRuns: true }))).toBe(true)
  })

  it('예측은 run이 아니라 모델을 본다', () => {
    // 예산에서 밀리면 지표만 남는다. 그때 예측 화면은 열어 봐야 할 일이 없다.
    expect(isStepUnlocked('predict', progress({ hasRuns: true }))).toBe(false)
    expect(isStepUnlocked('predict', progress({ hasModels: true }))).toBe(true)
  })

  it('전부 갖춰지면 전부 열린다', () => {
    for (const step of STEP_IDS) {
      expect(isStepUnlocked(step, ALL), step).toBe(true)
    }
  })
})

describe('잠긴 단계를 요청했을 때', () => {
  it('열려 있으면 그대로 보낸다', () => {
    for (const step of STEP_IDS) {
      expect(resolveStep(step, ALL), step).toBe(step)
    }
  })

  it('앞에서 가장 가까운 열린 단계로 되돌린다', () => {
    // 목록으로 쫓아내지 않는다. 필요한 것은 "여기까지는 됐다"는 자리다.
    expect(resolveStep('predict', progress({ hasRuns: true }))).toBe('results')
    expect(resolveStep('results', progress({ hasDataset: true, hasSettings: true }))).toBe('train')
    expect(resolveStep('train', progress({ hasDataset: true }))).toBe('preprocess')
  })

  it('아무것도 없으면 데이터까지 내려간다', () => {
    for (const step of STEP_IDS) {
      const landed = resolveStep(step, NO_PROGRESS)
      expect(isStepUnlocked(landed, NO_PROGRESS), step).toBe(true)
    }
    expect(resolveStep('predict', NO_PROGRESS)).toBe(FIRST_STEP)
  })

  it('포트폴리오는 언제나 열려 있어 되돌려지지 않는다', () => {
    expect(resolveStep('portfolio', NO_PROGRESS)).toBe('portfolio')
  })

  it('어떤 상태에서도 돌려준 단계는 반드시 열려 있다', () => {
    // 네 불리언의 16가지 조합 전부를 훑는다. 손으로 고른 표본은 빈 자리를 남긴다.
    for (let mask = 0; mask < 16; mask += 1) {
      const state: ProjectProgress = {
        hasDataset: (mask & 1) !== 0,
        hasSettings: (mask & 2) !== 0,
        hasRuns: (mask & 4) !== 0,
        hasModels: (mask & 8) !== 0,
      }
      for (const step of STEP_IDS) {
        expect(isStepUnlocked(resolveStep(step, state), state), `${mask} ${step}`).toBe(true)
      }
    }
  })
})

describe('프로젝트에서 진행 상황을 뽑는다', () => {
  it('프로젝트가 없으면 아무것도 없다', () => {
    expect(progressOf(null)).toEqual(NO_PROGRESS)
  })

  it('표본 프로젝트는 전부 갖춰져 있다', () => {
    expect(progressOf(projectFile())).toEqual(ALL)
  })

  it('표를 아직 안 올린 프로젝트는 데이터 단계만 열려 있다', () => {
    // 정상 상태다. 새 프로젝트가 여기서 시작한다.
    const empty = progressOf(emptyProjectFile())
    expect(empty).toEqual(NO_PROGRESS)
    expect(resolveStep('portfolio', empty)).toBe('portfolio')
    expect(resolveStep('train', empty)).toBe(FIRST_STEP)
  })

  it('특성이나 알고리즘 중 하나만 비어도 설정이 안 됐다', () => {
    const base = projectFile()
    for (const settings of [
      { ...base.document.settings, features: [] },
      { ...base.document.settings, selectedAlgorithms: [] },
    ]) {
      expect(progressOf({ ...base, document: { ...base.document, settings } }).hasSettings).toBe(
        false,
      )
    }
  })

  it('묶음만 있고 run이 없으면 결과가 아니다', () => {
    const base = projectFile()
    const empty = { ...base.document, runs: { batches: [batch('batch-1', [])] } }
    expect(progressOf({ ...base, document: empty })).toMatchObject({
      hasRuns: false,
      hasModels: false,
    })
  })

  it('모델이 빠진 run은 결과이지 예측 대상이 아니다', () => {
    const base = projectFile()
    const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
    const runs = { batches: [batch('batch-1', [omitted])] }
    expect(progressOf({ ...base, document: { ...base.document, runs } })).toMatchObject({
      hasRuns: true,
      hasModels: false,
    })
  })
})
