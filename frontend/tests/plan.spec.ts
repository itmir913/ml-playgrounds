/**
 * 학습 직전까지의 계획 (`ml/plan.ts`).
 *
 * **여기가 지키는 것은 하나다 — 화면이 말하는 숫자와 학습이 쓰는 숫자가 같다.**
 * 전처리 요약 카드가 "훈련 21행 / 테스트 9행"이라고 말하면, 그 설정으로 [학습]을
 * 눌렀을 때 파일에 남는 `trainIndices`·`testIndices`가 정확히 그것이어야 한다
 * (architecture.md §9.1.3).
 *
 * 그래서 마지막 검사가 **계획과 실제 실험을 맞대 본다.** 나머지는 그 계획이 사유를
 * 값으로 돌려주는지(던지지 않는지) 본다 — 카드는 아직 아무것도 안 고른 상태에서도
 * 그려져야 한다.
 */

import { describe, expect, it } from 'vitest'

import { planRun } from '../src/ml/plan'
import { runExperiment } from '../src/ml/experiment'
import type { Dataset } from '../src/ml/preprocess'
import type { RuntimeContext } from '../src/ml/backend'
import { dataSnapshot, type Settings, type TabularSettings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

const BROWSER_ONLY: RuntimeContext = {
  serverStatus: 'unavailable',
  limitsOff: false,
  rowCount: 30,
  dataType: 'tabular',
}

const baseData: TabularSettings = {
  dataset: {
    path: 'dataset/data.csv',
    originalFileName: 'iris.csv',
    hasHeader: true,
    encoding: 'utf-8',
  },
  features: [...IRIS_FEATURE_COLUMNS],
  target: IRIS_TARGET_COLUMN,
  preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
}

function settingsFor(
  data: Partial<TabularSettings> = {},
  common: Partial<Omit<Settings, 'data'>> = {},
): Settings {
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'decision_tree' }],
    hyperparameters: {},
    ...common,
    data: { ...baseData, ...data },
  }
}

/** 빈 칸이 있는 작은 표. 결측 전략을 시험하려면 정말로 빈 칸이 있어야 한다. */
function tableWithBlank(): Dataset {
  return {
    columns: ['a', 'b', 'label'],
    rows: [
      ['1', '2', 'x'],
      ['3', '', 'y'],
      ['5', '6', 'x'],
      ['7', '8', 'y'],
    ],
  }
}

describe('아직 정할 수 없는 상태', () => {
  it('유형을 안 골랐으면 pending이다 - 실패가 아니다', () => {
    // 유형은 학습 화면에서 고른다. 전처리 화면에서는 비어 있는 것이 정상이고,
    // 그때는 분할이 어떻게 될지 말할 수 없다 - 군집은 분할하지 않는다.
    const plan = planRun({ dataset: irisDataset(), testDataset: null, settings: settingsFor() })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toEqual({ kind: 'pending', missing: 'taskType' })
  })
})

describe('거부 사유를 던지지 않고 돌려준다', () => {
  const reasonOf = (plan: ReturnType<typeof planRun>): string =>
    plan.ok ? 'ok' : plan.reason.kind === 'error' ? plan.reason.code : plan.reason.missing

  it('타깃을 안 골랐다', () => {
    const plan = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor({ target: undefined }),
      taskType: 'classification',
    })
    expect(reasonOf(plan)).toBe('TARGET_NOT_SELECTED')
  })

  it('회귀인데 타깃이 숫자가 아니다', () => {
    const plan = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor(),
      taskType: 'regression',
    })
    expect(reasonOf(plan)).toBe('TARGET_NOT_NUMERIC')
  })

  it('빈 칸을 그대로 두기인데 빈 칸이 있다', () => {
    const plan = planRun({
      dataset: tableWithBlank(),
      testDataset: null,
      settings: settingsFor({
        features: ['a', 'b'],
        target: 'label',
        preprocessing: { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' },
      }),
      taskType: 'classification',
    })
    expect(reasonOf(plan)).toBe('FEATURE_HAS_MISSING')
  })

  /**
   * **전처리기가 던지는 것도 같은 모양으로 나온다.** 문자 열만 골라 놓고 인코딩을 끄면
   * 남는 특성이 하나도 없다. 삼키는 자리가 `planRun` 하나여야 화면과 학습이 같은
   * 목록을 본다.
   */
  it('고른 특성이 하나도 안 남는다', () => {
    const plan = planRun({
      dataset: tableWithBlank(),
      testDataset: null,
      settings: settingsFor(
        {
          features: ['label'],
          target: 'a',
          preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'none' },
        },
        // 층화를 켜 두면 회귀 타깃에서 분할이 먼저 운다. 여기서 보려는 것은 그 뒤다.
        { split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 } },
      ),
      taskType: 'regression',
    })
    expect(reasonOf(plan)).toBe('FEATURE_NOT_SELECTED')
  })

  /**
   * **분할이 던지는 것도 사유가 된다.** 값이 거의 다 다른 열을 타깃으로 삼고 층화를 켜면
   * 하나뿐인 무리가 쏟아진다 - 학생이 화면에서 만들 수 있는 상태이고, 그때 카드가
   * 예외로 죽으면 안 된다.
   *
   * **유형이 분류인 것이 중요하다.** 회귀에서는 이제 학습이 층화를 무시하므로(아래
   * describe) 이 경로를 안 지나간다 — 유형을 회귀로 두면 이 검사가 **아무것도 안 지킨
   * 채로 초록**이 된다.
   */
  it('층화할 수 없는 타깃이다', () => {
    const plan = planRun({
      dataset: tableWithBlank(),
      testDataset: null,
      settings: settingsFor({
        features: ['a'],
        target: 'b',
        preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
      }),
      taskType: 'classification',
    })
    expect(reasonOf(plan)).toBe('SPLIT_STRATIFY_TARGET_CONTINUOUS')
  })
})

describe('세는 것이 실제 학습과 같다', () => {
  const input = {
    dataset: irisDataset(),
    testDataset: null,
    settings: settingsFor(),
    taskType: 'classification',
  } as const

  it('군집은 분할하지 않는다', () => {
    const plan = planRun({
      ...input,
      settings: settingsFor({ target: undefined }),
      taskType: 'clustering',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.split.testIndices).toEqual([])
    expect(plan.split.trainIndices).toEqual([...plan.sampled])
  })

  it('뽑기를 켜면 분할의 분모가 뽑힌 행이다', () => {
    // **뽑고 나서 나눈다** (open-decisions.md #22). 20%는 전체의 20%가 아니다.
    const plan = planRun({ ...input, settings: settingsFor({}, { nSamples: 15 }) })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.usable).toHaveLength(30)
    expect(plan.sampled).toHaveLength(15)
    expect(plan.split.trainIndices.length + plan.split.testIndices.length).toBe(15)
  })

  /**
   * **이 검사가 이 파일의 이유다.** 카드가 읽는 계획과 학습이 남긴 기록이 같은 행을
   * 가리키는지 본다. 화면이 따로 세기 시작하면 여기가 먼저 깨진다.
   */
  it('계획의 분할이 곧 실험에 남는 분할이다', async () => {
    for (const nSamples of [undefined, 21]) {
      const settings = settingsFor({}, nSamples === undefined ? {} : { nSamples })
      const plan = planRun({ ...input, settings })
      const { experiment } = await runExperiment({
        ...input,
        settings,
        dataType: 'tabular',
        context: BROWSER_ONLY,
        snapshot: dataSnapshot('tabular', settings),
      })

      expect(plan.ok, `nSamples=${nSamples}`).toBe(true)
      if (!plan.ok) return
      expect(experiment.settings.trainIndices, `nSamples=${nSamples}`).toEqual([
        ...plan.split.trainIndices,
      ])
      expect(experiment.settings.testIndices, `nSamples=${nSamples}`).toEqual([
        ...plan.split.testIndices,
      ])
      // 전처리기도 같은 것이어야 한다 - 채움값과 스케일 기준이 훈련 데이터에서 나온다.
      expect(experiment.settings.trainIndices.length).toBe(plan.split.trainIndices.length)
    }
  })
})

/**
 * **유형이 뜻을 지우면 학습이 층화를 무시한다** (`open-decisions.md` "값을 내리지 않는다.
 * 학습이 무시하고 화면이 잠근다").
 *
 * **진짜 입구로 확인한다.** `stratifyApplies`를 따로 부르는 것은 이 결함을 안 잡는다 —
 * 고쳐야 했던 것은 `planRun`이 `sampleRows`와 `splitRows`에 **무엇을 넘기는가**이고,
 * 넘기는 자리를 하나라도 빠뜨리면 거기서 다시 거부한다.
 */
describe('뜻이 없는 유형에서는 층화를 무시한다', () => {
  /** 타깃이 연속이라 층화하면 `SPLIT_STRATIFY_TARGET_CONTINUOUS`로 막히던 표. */
  function continuous(): Dataset {
    return {
      columns: ['a', 'value'],
      rows: Array.from({ length: 12 }, (_, index) => [String(index), String(index * 1.5 + 0.25)]),
    }
  }

  const data: Partial<TabularSettings> = {
    features: ['a'],
    target: 'value',
    preprocessing: { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' },
  }

  it('회귀는 stratify가 켜져 있어도 학습이 선다', () => {
    const plan = planRun({
      dataset: continuous(),
      testDataset: null,
      settings: settingsFor(data),
      taskType: 'regression',
    })
    expect(plan.ok).toBe(true)
  })

  it('파일의 값은 그대로 있다 - 분류로 돌아오면 살아난다', () => {
    // 계획은 값을 고쳐 쓰지 않는다. 고쳐 쓰면 자동 저장이 그것을 파일에 적고,
    // 유형을 되돌려도 안 돌아오던 옛 동작이 이름만 바꿔 되살아난다.
    const settings = settingsFor(data)
    planRun({
      dataset: continuous(),
      testDataset: null,
      settings,
      taskType: 'regression',
    })
    expect(settings.split.stratify).toBe(true)
  })

  it('분류에서는 여전히 막는다 - 무시하는 것은 유형이 지운 경우뿐이다', () => {
    const plan = planRun({
      dataset: continuous(),
      testDataset: null,
      settings: settingsFor(data),
      taskType: 'classification',
    })
    expect(plan.ok).toBe(false)
  })
})
