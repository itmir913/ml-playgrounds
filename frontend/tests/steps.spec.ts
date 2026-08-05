/**
 * 단계 진입 조건과 체크리스트.
 *
 * **화면을 하나도 띄우지 않고 여기서 전부 확인한다.** 그러라고 컴포넌트 밖의 순수
 * 함수로 뺐다 (architecture.md §8.3).
 *
 * 그리고 **둘이 같은 사실에서 나오는지**를 본다 (§8.7). 체크리스트와 잠금이 갈라지면
 * "체크는 다 됐는데 다음 단계가 잠겨 있다"가 생기고, 학생이 고칠 방법이 없다.
 */

import { describe, expect, it } from 'vitest'

import {
  currentTask,
  DERIVED_FACTS,
  FIRST_STEP,
  isStepId,
  isStepUnlocked,
  NO_FACTS,
  resolveStep,
  stepRequires,
  stepTasks,
  STEP_IDS,
  type FactKey,
  type ProjectFacts,
} from '../src/router/steps'
import { factsOf } from '../src/stores/project'
import { batch, emptyProjectFile, projectFile, run } from './fixtures/project'

const FLAGS: readonly FactKey[] = [
  'datasetReady',
  'targetChosen',
  'featuresChosen',
  'algorithmsChosen',
  'trainingDone',
  'modelReady',
  'portfolioWritten',
]

/** 어느 단계에서든 학생이 직접 체크할 수 있는 사실들. */
function asTaskKeys(): FactKey[] {
  return STEP_IDS.flatMap((step) => stepTasks(step, NO_FACTS)).map((task) => task.key)
}

function facts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
  return { ...NO_FACTS, ...overrides }
}

const ALL: ProjectFacts = Object.fromEntries(
  FLAGS.map((flag) => [flag, true]),
) as unknown as ProjectFacts

/** 불리언 일곱 개의 128가지 조합 전부. 손으로 고른 표본은 빈 자리를 남긴다. */
function everyCombination(): ProjectFacts[] {
  const all: ProjectFacts[] = []
  for (let mask = 0; mask < 1 << FLAGS.length; mask += 1) {
    const state: Record<string, boolean> = {}
    FLAGS.forEach((flag, bit) => {
      state[flag] = (mask & (1 << bit)) !== 0
    })
    all.push(state as unknown as ProjectFacts)
  }
  return all
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
    expect(isStepUnlocked('data', NO_FACTS)).toBe(true)
    expect(isStepUnlocked('portfolio', NO_FACTS)).toBe(true)
  })

  it('나머지는 아무것도 없으면 전부 잠겨 있다', () => {
    for (const step of ['preprocess', 'train', 'results', 'predict'] as const) {
      expect(isStepUnlocked(step, NO_FACTS), step).toBe(false)
    }
  })

  it('전처리는 데이터만 있으면 열린다', () => {
    expect(isStepUnlocked('preprocess', facts({ datasetReady: true }))).toBe(true)
  })

  it('학습에 대상 열은 필요 없다 - 군집화에는 대상이 없다', () => {
    const ready = facts({ datasetReady: true, featuresChosen: true, algorithmsChosen: true })
    expect(isStepUnlocked('train', ready)).toBe(true)
    expect(ready.targetChosen).toBe(false)
  })

  it('학습은 설정만으로는 열리지 않는다', () => {
    // 설정이 남아 있는 채로 데이터를 갈아치우는 경우가 있다.
    expect(isStepUnlocked('train', facts({ featuresChosen: true, algorithmsChosen: true }))).toBe(
      false,
    )
  })

  it('결과는 run이 있으면 열린다 - 실패한 학습도 결과다', () => {
    expect(isStepUnlocked('results', facts({ trainingDone: true }))).toBe(true)
  })

  it('예측은 run이 아니라 모델을 본다', () => {
    // 예산에서 밀리면 지표만 남는다. 그때 예측 화면은 열어 봐야 할 일이 없다.
    expect(isStepUnlocked('predict', facts({ trainingDone: true }))).toBe(false)
    expect(isStepUnlocked('predict', facts({ modelReady: true }))).toBe(true)
  })

  it('전부 갖춰지면 전부 열린다', () => {
    for (const step of STEP_IDS) {
      expect(isStepUnlocked(step, ALL), step).toBe(true)
    }
  })
})

describe('체크리스트', () => {
  it('모든 잠금 조건은 할 일이거나 결과다 - 그 사이는 없다', () => {
    // **이게 이 설계의 요점이다.** 잠금 조건이 어느 단계의 할 일도 아니고 결과로
    // 선언되지도 않았다면, 학생은 열리지 않는 단계를 보면서 무엇을 해야 할지 알 수 없다.
    // 새 조건을 넣는 사람이 둘 중 하나를 고르게 강제한다.
    const asTask = new Set(STEP_IDS.flatMap((step) => stepTasks(step, NO_FACTS)).map((t) => t.key))
    for (const step of STEP_IDS) {
      for (const fact of stepRequires(step)) {
        expect(asTask.has(fact) || DERIVED_FACTS.includes(fact), `${step} <- ${fact}`).toBe(true)
      }
    }
  })

  it('할 일을 다 하면 결과로만 잠긴 단계만 남는다', () => {
    // 할 일을 전부 끝낸 학생이 갇히지 않는지 본다. 남아도 되는 것은 예측 하나뿐이고,
    // 그건 모델이 예산에서 밀렸을 때다 - 학생이 할 수 있는 일이 없는 것이 맞다.
    const done = facts(Object.fromEntries(asTaskKeys().map((key) => [key, true])))
    const locked = STEP_IDS.filter((step) => !isStepUnlocked(step, done))
    expect(locked).toEqual(['predict'])
  })

  it('데이터 단계의 할 일은 표를 올리는 것 하나다', () => {
    expect(stepTasks('data', NO_FACTS)).toEqual([{ key: 'datasetReady', done: false }])
    expect(stepTasks('data', ALL)).toEqual([{ key: 'datasetReady', done: true }])
  })

  it('보는 화면에는 할 일이 없다 - 빈 목록은 그리지 않는다', () => {
    expect(stepTasks('results', ALL)).toEqual([])
    expect(stepTasks('predict', ALL)).toEqual([])
  })

  it('할 일에 쓰는 사실은 전부 ProjectFacts 안에 있다', () => {
    for (const step of STEP_IDS) {
      for (const task of stepTasks(step, NO_FACTS)) {
        expect(FLAGS, `${step}.${task.key}`).toContain(task.key)
      }
    }
  })
})

describe('지금 할 일', () => {
  it('아무것도 없으면 표를 올리는 것부터다', () => {
    expect(currentTask(NO_FACTS)).toEqual({ step: 'data', key: 'datasetReady' })
  })

  it('앞 단계가 끝나면 다음 열린 단계로 넘어간다', () => {
    const uploaded = facts({ datasetReady: true })
    expect(currentTask(uploaded)).toEqual({ step: 'preprocess', key: 'targetChosen' })
  })

  it('잠긴 단계의 할 일은 고르지 않는다', () => {
    // 아직 못 가는 곳을 하라고 하면 학생은 그 화면을 찾다가 멈춘다.
    const found = currentTask(facts({ datasetReady: true }))
    expect(found).not.toBeNull()
    if (found) expect(isStepUnlocked(found.step, facts({ datasetReady: true }))).toBe(true)
  })

  it('다 하면 null이다', () => {
    expect(currentTask(ALL)).toBeNull()
  })

  it('어떤 상태에서도 돌려준 것은 열린 단계의 안 끝난 일이다', () => {
    for (const state of everyCombination()) {
      const found = currentTask(state)
      if (found === null) continue
      expect(isStepUnlocked(found.step, state)).toBe(true)
      expect(state[found.key]).toBe(false)
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
    expect(resolveStep('predict', facts({ trainingDone: true }))).toBe('results')
    expect(
      resolveStep(
        'results',
        facts({ datasetReady: true, featuresChosen: true, algorithmsChosen: true }),
      ),
    ).toBe('train')
    expect(resolveStep('train', facts({ datasetReady: true }))).toBe('preprocess')
  })

  it('아무것도 없으면 데이터까지 내려간다', () => {
    expect(resolveStep('predict', NO_FACTS)).toBe(FIRST_STEP)
  })

  it('포트폴리오는 언제나 열려 있어 되돌려지지 않는다', () => {
    expect(resolveStep('portfolio', NO_FACTS)).toBe('portfolio')
  })

  it('어떤 상태에서도 돌려준 단계는 반드시 열려 있다', () => {
    for (const state of everyCombination()) {
      for (const step of STEP_IDS) {
        expect(isStepUnlocked(resolveStep(step, state), state), step).toBe(true)
      }
    }
  })
})

describe('프로젝트에서 사실을 뽑는다', () => {
  it('프로젝트가 없으면 아무것도 없다', () => {
    expect(factsOf(null)).toEqual(NO_FACTS)
  })

  it('표본 프로젝트는 포트폴리오까지 갖춰져 있다', () => {
    expect(factsOf(projectFile())).toEqual(ALL)
  })

  it('표를 아직 안 올린 프로젝트는 데이터 단계만 열려 있다', () => {
    // 정상 상태다. 새 프로젝트가 여기서 시작한다.
    const empty = factsOf(emptyProjectFile())
    expect(empty).toEqual(NO_FACTS)
    expect(resolveStep('portfolio', empty)).toBe('portfolio')
    expect(resolveStep('train', empty)).toBe(FIRST_STEP)
  })

  it('데이터는 참조가 아니라 실제 바이트로 판정한다', () => {
    const base = projectFile()
    expect(factsOf({ ...base, dataset: undefined }).datasetReady).toBe(false)
  })

  it('특성과 알고리즘은 따로 본다', () => {
    const base = projectFile()
    const settings = { ...base.document.settings, features: [] }
    const changed = factsOf({ ...base, document: { ...base.document, settings } })
    expect(changed.featuresChosen).toBe(false)
    expect(changed.algorithmsChosen).toBe(true)
  })

  it('묶음만 있고 run이 없으면 결과가 아니다', () => {
    const base = projectFile()
    const runs = { batches: [batch('batch-1', [])] }
    expect(factsOf({ ...base, document: { ...base.document, runs } })).toMatchObject({
      trainingDone: false,
      modelReady: false,
    })
  })

  it('모델이 빠진 run은 결과이지 예측 대상이 아니다', () => {
    const base = projectFile()
    const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
    const runs = { batches: [batch('batch-1', [omitted])] }
    expect(factsOf({ ...base, document: { ...base.document, runs } })).toMatchObject({
      trainingDone: true,
      modelReady: false,
    })
  })

  it('공백만 쓴 포트폴리오는 쓴 것이 아니다', () => {
    const base = projectFile()
    const portfolio = { ...base.document.portfolio, answers: { motivation: '   ' } }
    expect(factsOf({ ...base, document: { ...base.document, portfolio } }).portfolioWritten).toBe(
      false,
    )
  })
})
