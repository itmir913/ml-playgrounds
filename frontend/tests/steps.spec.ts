// @vitest-environment jsdom
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
  stepBlockers,
  stepRequires,
  stepTasks,
  STEP_IDS,
  type FactKey,
  type ProjectFacts,
} from '../src/router/steps'
import { TASK_TYPES, type Portfolio } from '../src/project/schema'
import { PREFERRED_CANONICAL_FORMAT } from '../src/data/image/formats'
import { imageEntryPath } from '../src/data/image/canonical'
import { factsOf } from '../src/stores/project'
import { experiment, emptyProjectFile, projectFile, run } from './fixtures/project'

const FLAGS: readonly FactKey[] = [
  'datasetReady',
  'targetChosen',
  'featuresChosen',
  'taskTypeChosen',
  'algorithmsChosen',
  'trainingDone',
  'modelReady',
  'portfolioAnswered',
]

/**
 * 검사의 기본 과제 유형. **분류는 모든 사실이 해당하는 유일한 유형이라** 여기서
 * 고른다 - 이 파일의 표들이 "빠지는 것 없는 상태"를 못 박는 것이 목적이기 때문이다.
 * 빠지는 쪽은 아래 "과제 유형마다 할 일이 다르다"가 따로 본다.
 */
const TASK = 'classification' as const

/** 어느 단계에서든 학생이 직접 체크할 수 있는 사실들. */
function asTaskKeys(): FactKey[] {
  return STEP_IDS.flatMap((step) => stepTasks(step, NO_FACTS, TASK)).map((task) => task.key)
}

function facts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
  return { ...NO_FACTS, ...overrides }
}

const ALL: ProjectFacts = Object.fromEntries(
  FLAGS.map((flag) => [flag, true]),
) as unknown as ProjectFacts

/** 불리언 여덟 개의 256가지 조합 전부. 손으로 고른 표본은 빈 자리를 남긴다. */
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

  it('학습은 타깃과 특성이 정해지면 열린다', () => {
    // 모델을 고르는 것은 학습 화면 안의 할 일이다. 그것까지 요구하면 학생이 들어갈 수 없다.
    const ready = facts({ datasetReady: true, targetChosen: true, featuresChosen: true })
    expect(isStepUnlocked('train', ready)).toBe(true)
    expect(ready.algorithmsChosen).toBe(false)
  })

  /**
   * **유형을 고르는 화면은 그 선택으로 안 잠긴다** (architecture.md §10.5,
   * 2026-09-02 교실 보고). 전에는 분류에서 `false`였고, 그래서 분류를 누른 학생이
   * **유형을 바꿀 손잡이가 있는 화면에서 쫓겨났다.**
   *
   * 잠금이 사라진 것이 아니라 **카드로 옮겼다** — 못 하는 유형은 `ModelAxes`의 축에서
   * 이유와 함께 꺼진다(§9.4).
   */
  it('학습 화면은 어떤 유형을 골랐든 그 선택으로 안 잠긴다', () => {
    const ready = facts({ datasetReady: true, featuresChosen: true })
    expect(isStepUnlocked('train', ready, 'clustering')).toBe(true)
    expect(isStepUnlocked('train', ready, 'classification')).toBe(true)
  })

  /**
   * **한때 순환이었다** (2026-08-15). 유형은 학습 화면에서 고르는데 그 화면이 유형별
   * 사실을 요구했다 - 타깃을 면제받는 군집화는 영원히 고를 수 없었다. 잠금이 묻는 것은
   * "지금 유형에서 필요한가"가 아니라 **"어떤 유형으로도 못 하는가"**다.
   */
  it('유형을 고르기 전에는 한 유형이라도 면제하는 사실이 안 막는다', () => {
    const ready = facts({ datasetReady: true, featuresChosen: true })
    expect(isStepUnlocked('train', ready)).toBe(true)
  })

  /**
   * **고른 뒤에도 안 막힌다** (§10.5). 여기가 갇힘이 나던 자리다 — `manifest.taskType`이
   * 파일에 남으므로 분류를 한 번 누르면 다시 열 수 없었다.
   *
   * **다른 단계는 그대로 유형을 본다.** 완화는 그 축을 **고르는 단계**에만 걸린다.
   */
  it('유형을 고른 뒤에도 학습 화면은 열려 있다', () => {
    const ready = facts({ datasetReady: true, featuresChosen: true })
    expect(isStepUnlocked('train', ready, 'classification')).toBe(true)
    expect(isStepUnlocked('train', ready, 'regression')).toBe(true)
  })

  it('완화는 유형을 고르는 단계에만 걸린다 - 전처리는 그대로 유형을 본다', () => {
    const ready = facts({ datasetReady: true })
    expect(stepBlockers('preprocess', ready, 'classification')).toEqual([])
    // 전처리의 잠금 조건은 데이터뿐이라 유형과 무관하다. 완화가 새 문을 열지 않았다.
    expect(stepBlockers('preprocess', facts({}), 'clustering')).toEqual(['datasetReady'])
  })

  /** 어느 유형도 면제하지 않는 사실은 유형이 없어도 그대로 막는다. */
  it('모든 유형이 요구하는 사실은 유형 미정에도 막는다', () => {
    expect(isStepUnlocked('train', facts({ targetChosen: true, featuresChosen: true }))).toBe(false)
  })

  it('학습은 설정만으로는 열리지 않는다', () => {
    // 설정이 남아 있는 채로 데이터를 갈아치우는 경우가 있다.
    expect(isStepUnlocked('train', facts({ targetChosen: true, featuresChosen: true }))).toBe(false)
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
    const asTask = new Set(
      STEP_IDS.flatMap((step) => stepTasks(step, NO_FACTS, TASK)).map((t) => t.key),
    )
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

  it('데이터 단계의 할 일은 정본을 올리는 것 하나다', () => {
    expect(stepTasks('data', NO_FACTS, TASK)).toEqual([
      { key: 'datasetReady', done: false, labelKey: 'tasks.datasetReady' },
    ])
    expect(stepTasks('data', ALL, TASK)).toEqual([
      { key: 'datasetReady', done: true, labelKey: 'tasks.datasetReady' },
    ])
  })

  /**
   * **데이터 종류마다 해당하지 않는 사실이 있다** (open-decisions.md "이미지에서
   * 체크리스트 세 항목은 무엇인가"). 이미지에서 특성 고르기는 항목이 아니다 —
   * 백본이 만든다. `false`로 두면 학습 단계에 영원히 못 들어간다.
   */
  it('이미지에서는 특성 고르기가 항목도 잠금 조건도 아니다', () => {
    const keys = stepTasks('preprocess', NO_FACTS, 'classification', 'image').map(
      (task) => task.key,
    )
    expect(keys).not.toContain('featuresChosen')

    const ready = facts({ datasetReady: true, targetChosen: true })
    expect(isStepUnlocked('train', ready, 'classification', 'image')).toBe(true)
    // 표에서는 여전히 필요하다. 축을 더한 것이지 규칙을 무르게 한 것이 아니다.
    expect(isStepUnlocked('train', ready, 'classification', 'tabular')).toBe(false)
  })

  /** 사실의 이름은 안 가르고 문구만 가른다 — 갈리면 잠금표가 종류마다 갈린다. */
  it('같은 사실을 종류마다 다른 문구로 부른다', () => {
    const [task] = stepTasks('data', NO_FACTS, TASK, 'image')
    expect(task?.key).toBe('datasetReady')
    expect(task?.labelKey).toBe('tasks.image.datasetReady')
  })

  it('보는 화면에는 할 일이 없다 - 빈 목록은 그리지 않는다', () => {
    expect(stepTasks('results', ALL, TASK)).toEqual([])
    expect(stepTasks('predict', ALL, TASK)).toEqual([])
  })

  it('할 일에 쓰는 사실은 전부 ProjectFacts 안에 있다', () => {
    for (const step of STEP_IDS) {
      for (const task of stepTasks(step, NO_FACTS, TASK)) {
        expect(FLAGS, `${step}.${task.key}`).toContain(task.key)
      }
    }
  })
})

describe('기계학습 유형마다 할 일이 다르다', () => {
  // architecture.md §8.10. 문구를 바꾸는 것이 아니라 **항목 자체가 없다.**

  it('군집화에는 타깃 정하기가 없다', () => {
    const keys = stepTasks('preprocess', NO_FACTS, 'clustering').map((task) => task.key)
    expect(keys).not.toContain('targetChosen')
    // 나머지는 그대로다. 군집화도 무엇으로 묶을지는 골라야 한다.
    expect(keys).toContain('featuresChosen')
  })

  it('분류와 회귀에는 타깃 정하기가 있다', () => {
    for (const taskType of ['classification', 'regression'] as const) {
      const keys = stepTasks('preprocess', NO_FACTS, taskType).map((task) => task.key)
      expect(keys, taskType).toContain('targetChosen')
    }
  })

  it('빠진 항목은 지금 할 일로도 안 나온다', () => {
    // 목록에서만 빼고 여기서 안 빼면, 화면에 없는 일을 하라고 시키게 된다.
    const uploaded = facts({ datasetReady: true })
    expect(currentTask(uploaded, 'clustering')?.key).not.toBe('targetChosen')
  })

  it('빠진 항목은 잠금 조건이 아니다 - 뺐는데 잠기면 학생이 갇힌다', () => {
    // **이게 이 설계가 무너지는 유일한 경로다.** 항목에서 뺀 사실이 어딘가의 잠금
    // 조건으로 남아 있으면, 학생은 할 일을 다 했는데 못 가는 단계를 보게 되고
    // 화면에는 무엇을 더 해야 하는지가 없다.
    for (const taskType of TASK_TYPES) {
      const shown = new Set(
        STEP_IDS.flatMap((step) => stepTasks(step, NO_FACTS, taskType)).map((task) => task.key),
      )
      const done = facts(Object.fromEntries([...shown].map((key) => [key, true])))
      const locked = STEP_IDS.filter((step) => !isStepUnlocked(step, done, taskType))
      // 예측만 남아야 한다. 모델이 예산에서 밀렸을 때이고 학생이 할 수 있는 일이 없다.
      expect(locked, taskType).toEqual(['predict'])
    }
  })
})

describe('지금 할 일', () => {
  it('아무것도 없으면 표를 올리는 것부터다', () => {
    expect(currentTask(NO_FACTS, TASK)).toEqual({
      step: 'data',
      key: 'datasetReady',
      labelKey: 'tasks.datasetReady',
    })
  })

  it('앞 단계가 끝나면 다음 열린 단계로 넘어간다', () => {
    const uploaded = facts({ datasetReady: true })
    expect(currentTask(uploaded, TASK)).toEqual({
      step: 'preprocess',
      key: 'targetChosen',
      labelKey: 'tasks.targetChosen',
    })
  })

  it('전처리를 마치면 학습의 첫 일은 유형 고르기다', () => {
    // 모델 목록이 유형에서 나오므로 유형이 먼저다 (TrainView).
    const ready = facts({ datasetReady: true, targetChosen: true, featuresChosen: true })
    expect(currentTask(ready, TASK)).toEqual({
      step: 'train',
      key: 'taskTypeChosen',
      labelKey: 'tasks.taskTypeChosen',
    })
  })

  it('잠긴 단계의 할 일은 고르지 않는다', () => {
    // 아직 못 가는 곳을 하라고 하면 학생은 그 화면을 찾다가 멈춘다.
    const found = currentTask(facts({ datasetReady: true }), TASK)
    expect(found).not.toBeNull()
    if (found) expect(isStepUnlocked(found.step, facts({ datasetReady: true }))).toBe(true)
  })

  it('문구 키가 데이터 종류를 따라간다 - 대시보드의 [바로가기]가 이걸 쓴다', () => {
    // 부르는 쪽이 `tasks.{key}`를 조립하면 이미지 프로젝트에 표의 말이 뜬다. 실제로 그랬다.
    expect(currentTask(NO_FACTS, TASK, 'image')?.labelKey).toBe('tasks.image.datasetReady')
    expect(currentTask(NO_FACTS, TASK, 'tabular')?.labelKey).toBe('tasks.datasetReady')
  })

  it('다 하면 null이다', () => {
    expect(currentTask(ALL, TASK)).toBeNull()
  })

  it('어떤 상태에서도 돌려준 것은 열린 단계의 안 끝난 일이다', () => {
    for (const state of everyCombination()) {
      const found = currentTask(state, TASK)
      if (found === null) continue
      expect(isStepUnlocked(found.step, state)).toBe(true)
      expect(state[found.key]).toBe(false)
    }
  })

  /**
   * **바닥에 난 구멍을 막는다.** 위 검사는 전수를 돌지만 단언이 한 방향뿐이라 —
   * "돌려준 것이 옳은가"만 보고 "돌려줘야 하는데 안 돌려준 것이 없는가"는 안 본다.
   * `null`이 늘어나는 회귀는 256조합 전부에서 `continue`로 빠져나간다. 실제로
   * `currentTask`의 `continue`를 `break`로 바꿔도 저장소 전체가 초록이었다
   * (R13-5 감사 A-5).
   *
   * **지어낸 상태가 아니다.** 모델이 예산에서 밀려 `modelReady`가 거짓인 프로젝트가
   * 정확히 그 모양이고(`mlpx-spec.md` §4.2), 그때 예측 단계는 영구히 잠긴다. 그래도
   * 포트폴리오는 열려 있으므로 대시보드가 할 일을 내놓아야 한다 — 안 내놓으면 학생은
   * 쓸 수 있는 것이 있는데 화면이 아무 말도 안 한다.
   */
  it('열린 단계에 남은 일이 있으면 반드시 돌려준다', () => {
    for (const state of everyCombination()) {
      const remaining = STEP_IDS.filter(
        (step) =>
          isStepUnlocked(step, state) && stepTasks(step, state, TASK).some((task) => !task.done),
      )
      const found = currentTask(state, TASK)

      if (remaining.length === 0) {
        expect(found, JSON.stringify(state)).toBeNull()
        continue
      }
      expect(found, JSON.stringify(state)).not.toBeNull()
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
        facts({ datasetReady: true, targetChosen: true, featuresChosen: true }),
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

  /**
   * **사진 갈래를 아무도 안 재고 있었다** (2026-09-02 R19 감사 — 검사가 없던 자리).
   *
   * 위 검사들은 전부 **표 픽스처**다. `DATA_FACTS.image`의 범주 경계를 옮겨도 2,738개가
   * 전부 초록이었다.
   *
   * **틀리면 양쪽으로 다친다.** 느슨해지면 갈릴 것이 없는 사진 프로젝트에 학습 단계가
   * 열려 학생이 엔진 실패를 만나고, 조여지면 **정상 프로젝트가 영구히 잠긴다.**
   *
   * **경로를 손으로 안 짓는다** — `imageEntryPath`가 짜야 `readImages`의 판정
   * (`categoryOfEntry` · `canonicalFormatOfPath`)을 실제로 지나간다.
   */
  describe('사진 프로젝트의 사실', () => {
    function withPhotos(categories: readonly (string | undefined)[]) {
      const file = emptyProjectFile()
      file.document.manifest.dataType = 'image'
      categories.forEach((category, index) => {
        const path = imageEntryPath('data', `hash${index}`, category, PREFERRED_CANONICAL_FORMAT)
        file.images.set(path, new Uint8Array([1, 2, 3]))
      })
      return file
    }

    it('사진이 없으면 데이터가 없는 것이다', () => {
      expect(factsOf(withPhotos([])).datasetReady).toBe(false)
    })

    it('사진이 있으면 데이터는 준비된 것이다', () => {
      expect(factsOf(withPhotos(['개'])).datasetReady).toBe(true)
    })

    /** **갈릴 것이 없다.** 범주가 하나면 분류가 성립하지 않는다. */
    it('범주가 하나면 타깃이 안 정해진 것이다', () => {
      expect(factsOf(withPhotos(['개', '개'])).targetChosen).toBe(false)
    })

    it('범주가 둘이면 타깃이 정해진 것이다', () => {
      expect(factsOf(withPhotos(['개', '고양이'])).targetChosen).toBe(true)
    })

    /**
     * **`_unlabeled`는 범주가 아니라 상태다.** 그 사진들은 분류 학습에 안 들어가므로
     * 세면 안 된다 — 세면 `개` 하나짜리 프로젝트가 둘로 보여 학습이 열린다.
     */
    it('아직 범주가 없는 사진은 안 센다', () => {
      const facts = factsOf(withPhotos(['개', undefined, undefined]))
      expect(facts.datasetReady).toBe(true)
      expect(facts.targetChosen).toBe(false)
    })

    it('범주 없는 사진만 있으면 타깃이 안 정해진 것이다', () => {
      expect(factsOf(withPhotos([undefined, undefined])).targetChosen).toBe(false)
    })

    /**
     * **학생이 특성을 안 고른다. 백본이 만든다.** 여기서 `false`를 주면 사진 프로젝트가
     * 학습 단계에 **영원히 못 들어간다** — 체크리스트에서 빼는 일은 종류 축이 한다.
     */
    it('특성은 언제나 갖춰진 것으로 본다 - 백본이 만든다', () => {
      expect(factsOf(withPhotos([])).featuresChosen).toBe(true)
      expect(factsOf(withPhotos(['개', '고양이'])).featuresChosen).toBe(true)
    })
  })

  it('특성과 알고리즘은 따로 본다', () => {
    const base = projectFile()
    const settings = {
      ...base.document.settings,
      data: { ...base.document.settings.data, features: [] },
    }
    const changed = factsOf({ ...base, document: { ...base.document, settings } })
    expect(changed.featuresChosen).toBe(false)
    expect(changed.algorithmsChosen).toBe(true)
  })

  it('실험만 있고 run이 없으면 결과가 아니다', () => {
    const base = projectFile()
    const runs = { experiments: [experiment('experiment-1', [])] }
    expect(factsOf({ ...base, document: { ...base.document, runs } })).toMatchObject({
      trainingDone: false,
      modelReady: false,
    })
  })

  it('모델이 빠진 run은 결과이지 예측 대상이 아니다', () => {
    const base = projectFile()
    const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
    const runs = { experiments: [experiment('experiment-1', [omitted])] }
    expect(factsOf({ ...base, document: { ...base.document, runs } })).toMatchObject({
      trainingDone: true,
      modelReady: false,
    })
  })

  it('공백만 쓴 포트폴리오는 쓴 것이 아니다', () => {
    const base = projectFile()
    const portfolio = { ...base.document.portfolio, answers: { motivation: '   ' } }
    expect(factsOf({ ...base, document: { ...base.document, portfolio } }).portfolioAnswered).toBe(
      false,
    )
  })

  it('문항이 하나라도 비어 있으면 완료가 아니다 - 한 글자라도가 아니다', () => {
    const base = projectFile()
    const portfolio = {
      template: {
        sections: [
          { id: 'motivation', title: '이 주제를 선택한 이유' },
          { id: 'reflection', title: '느낀 점' },
        ],
      },
      answerFormat: 'plain-v1',
      answers: { motivation: '꽃이 좋아서' },
      attachments: {},
    } satisfies Portfolio
    expect(factsOf({ ...base, document: { ...base.document, portfolio } }).portfolioAnswered).toBe(
      false,
    )
  })

  it('양식을 아직 고르지 않았으면 완료가 아니다', () => {
    const base = projectFile()
    const portfolio = {
      template: { sections: [] },
      answerFormat: 'plain-v1',
      answers: {},
      attachments: {},
    } satisfies Portfolio
    expect(factsOf({ ...base, document: { ...base.document, portfolio } }).portfolioAnswered).toBe(
      false,
    )
  })
})

describe('할 일의 자리는 데이터 종류가 정한다', () => {
  const photosOnly = facts({ datasetReady: true, featuresChosen: true })

  /**
   * **사진만 올린 학생이 갇혔다** (2026-08-15). 범주를 하나도 안 나눈 학생 - 즉 군집만
   * 하고 싶은 학생 - 이 학습 단계에 영원히 못 들어갔다.
   */
  it('사진만 올려도 학습 단계에 들어간다', () => {
    expect(isStepUnlocked('train', photosOnly, undefined, 'image')).toBe(true)
  })

  /**
   * **용어가 아니라 자리가 틀렸다.** 범주 나누기는 데이터 화면에서 하는 일인데 전처리
   * 화면이 그것을 할 일로 들고 서 있었다.
   */
  it('이미지에서 범주 나누기는 데이터 단계의 할 일이다', () => {
    const dataTasks = stepTasks('data', photosOnly, undefined, 'image').map((one) => one.key)
    expect(dataTasks).toEqual(['datasetReady', 'targetChosen'])
  })

  /**
   * **비어 있는 것이 맞다.** 거기서 정하는 테스트 데이터는 언제나 선택이라 할 일이 아니다
   * (`open-decisions.md` - 테스트용 zip이 와도 부활시키지 마라).
   */
  it('이미지 전처리에는 할 일이 없다', () => {
    expect(stepTasks('preprocess', photosOnly, undefined, 'image')).toEqual([])
  })

  /** 표는 안 바뀐다 - 거기서는 타깃과 특성을 정말 전처리에서 고른다. */
  it('표는 그대로 전처리에서 고른다', () => {
    const tabular = stepTasks('preprocess', photosOnly, undefined, 'tabular').map((one) => one.key)
    expect(tabular).toEqual(['targetChosen', 'featuresChosen'])
    expect(stepTasks('data', photosOnly, undefined, 'tabular').map((one) => one.key)).toEqual([
      'datasetReady',
    ])
  })

  /** 옮겨도 사라지지 않는다 - 잠금 조건은 전부 어딘가의 할 일이어야 한다. */
  it('옮긴 사실도 여전히 어느 단계의 할 일이다', () => {
    const everywhere = STEP_IDS.flatMap((step) =>
      stepTasks(step, photosOnly, undefined, 'image').map((one) => one.key),
    )
    expect(everywhere).toContain('targetChosen')
  })
})

/**
 * **잠금은 boolean이 아니라 이유 목록이다** (`CLAUDE.md` §2).
 *
 * 화면이 "잠겼다"만 알면 할 말이 단계마다 하나뿐이고, 그 하나가 틀릴 수 있다 — 실제로
 * 그랬다: 새 표 프로젝트에서 학습 단계가 *"전처리 단계에서 할 일을 먼저 마쳐 주세요"*라고
 * 말하는데 **전처리도 잠겨 있었고**, 막고 있던 것은 데이터였다 (V11 R5 B-10).
 */
describe('무엇이 이 단계를 막는가', () => {
  it('새 표 프로젝트에서 학습을 막는 것은 데이터다 - 전처리가 아니다', () => {
    const blockers = stepBlockers('train', NO_FACTS, undefined, 'tabular')

    expect(blockers[0]).toBe('datasetReady')
    // 전처리도 잠겨 있으므로 "전처리에서 마쳐라"는 갈 수 없는 곳을 가리킨다.
    expect(isStepUnlocked('preprocess', NO_FACTS, undefined, 'tabular')).toBe(false)
  })

  /**
   * **목록이 전부여야 한다.** 위의 검사들은 첫 칸과 개수만 봐서 `.slice(0, 1)`을 붙여도
   * 전부 통과했다 (R8 감사 C-3). 지금은 `lockedTextFor`가 `blockers[0]`만 쓰니 무해하지만,
   * `CLAUDE.md` §2가 요구한 것은 **boolean이 아니라 이유 목록**이다 — 화면이 이유를
   * 둘 이상 말하기로 하는 날 조용히 하나만 나온다.
   *
   * **순서도 함께 못 박는다.** `requires`의 순서이고, 앞엣것이 지금 할 수 있는 일이다.
   */
  it('막는 사실을 전부, 순서대로 준다', () => {
    // **`targetChosen`이 빠진 것이 맞다.** 학습 단계는 유형을 고르는 자리라 유형으로
    // 자기를 안 잠그고(§10.5), 유형 미정의 규칙("한 유형이라도 면제하면 안 막는다")이
    // 그대로 걸린다 — 군집이 타깃을 면제한다. 그 유형은 카드가 잠근다.
    expect(stepBlockers('train', NO_FACTS, 'classification', 'tabular')).toEqual([
      'datasetReady',
      'featuresChosen',
    ])
  })

  it('데이터가 들어오면 다음 사실로 넘어간다', () => {
    const blockers = stepBlockers(
      'train',
      { ...NO_FACTS, datasetReady: true },
      'classification',
      'tabular',
    )
    expect(blockers).not.toContain('datasetReady')
    expect(blockers.length).toBeGreaterThan(0)
  })

  it('안 막히면 빈 배열이다 - 그리고 그때만 열린다', () => {
    const done = { ...NO_FACTS }
    for (const key of Object.keys(done) as FactKey[]) done[key] = true
    for (const step of STEP_IDS) {
      expect(stepBlockers(step, done, 'classification', 'tabular'), step).toEqual([])
      expect(isStepUnlocked(step, done, 'classification', 'tabular'), step).toBe(true)
    }
  })

  it('잠긴 단계에는 반드시 막는 사실이 있다 - 이유 없는 회색은 고장으로 보인다', () => {
    for (const step of STEP_IDS) {
      if (isStepUnlocked(step, NO_FACTS, undefined, 'tabular')) continue
      expect(stepBlockers(step, NO_FACTS, undefined, 'tabular').length, step).toBeGreaterThan(0)
    }
  })
})
