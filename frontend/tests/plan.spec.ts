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

import { asRecordedSplit, planRun } from '../src/ml/plan'
import { runExperiment } from '../src/ml/experiment'
import type { Dataset } from '../src/ml/preprocess'
import type { RuntimeContext } from '../src/ml/backend'
import { dataSnapshot, type Settings, type TabularSettings } from '../src/project/schema'
import { importTable, openTable } from '../src/data/table'
import { hashBytes } from '../src/hash'
import { applyTestDataset, readDataset, readTestDataset } from '../src/project/dataset'
import { readProject, type ProjectFile } from '../src/project/format'
import { withTarget, withTaskType } from '../src/project/settings'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'
import { scoreProject, surveyProject } from './fixtures/prep-kind'
import { writeProjectBytes } from './fixtures/write'

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
   * **값이 거의 다 다른 열을 타깃으로 삼고 층화를 켜면** 하나뿐인 무리가 쏟아진다 — 학생이
   * 화면에서 만들 수 있는 상태다. 전에는 분할이 던져 사유가 됐는데, 이제 계획이 같은 판정으로
   * 층화를 무시한다(`open-decisions.md` 55).
   *
   * **유형이 분류인 것이 중요하다.** 회귀에서는 유형 사유로 무시되므로 이 판정을 안 지나간다.
   */
  it('층화할 수 없는 타깃이면 거부하지 않고 층화를 무시한다 (결정문 55)', () => {
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
    // 전에는 `SPLIT_STRATIFY_TARGET_CONTINUOUS`로 섰다. 이제 화면이 같은 판정으로 체크박스를
    // 잠그고 학습은 층화 없이 나눈다.
    expect(plan.ok).toBe(true)
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

  /**
   * **분류에서도 막히면 무시한다** (`open-decisions.md` 55). 전에는 *"무시하는 것은 유형이
   * 지운 경우뿐"*이라 여기서 학습이 거부했고, 학생이 손으로 층화를 꺼야 했다.
   * **무시한 분할은 층화를 끈 분할과 같아야 한다** — 반쯤 층화한 무언가가 아니다.
   */
  it('분류에서도 막히면 무시하고, 그 분할은 층화를 끈 것과 같다', () => {
    const on = planRun({
      dataset: continuous(),
      testDataset: null,
      settings: settingsFor(data),
      taskType: 'classification',
    })
    const off = planRun({
      dataset: continuous(),
      testDataset: null,
      settings: settingsFor(data, {
        split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
      }),
      taskType: 'classification',
    })
    expect(on.ok && off.ok).toBe(true)
    if (!on.ok || !off.ok) return
    expect(on.split).toEqual(off.split)
  })
})

/**
 * **파일에 적힌 분할을 그대로 쓴다** (`open-decisions.md` "재실행은 학습 경로를 그대로
 * 탄다"의 "분할은 다시 계산하지 않는다").
 *
 * 여기서 지키는 것 셋.
 *
 *   1. 준 인덱스가 **그대로** 나온다 — 다시 나누면 대조가 아니라 새 학습이다
 *   2. **전처리기가 그 훈련 행에서 맞춰진다** — 주입 자리가 `planRun` 밖이면 채움값과
 *      스케일 기준이 다시 계산한 분할에서 나와 정직한 파일이 재현되지 않는다
 *   3. **그 앞의 검사는 그대로 돈다** — 빈 칸을 건너뛰면 `transform`이 조용히 0을 채운다
 */
/**
 * **옵션이 층화를 막아도 학습이 선다** (`open-decisions.md` 55). 시험 비율과 표본 수는
 * 학생이 고르는 옵션이다 — 전에는 그것이 층화를 막으면 학습이 거부했고, 학생이 전처리
 * 화면에서 층화를 손으로 꺼야 했다. **화면이 잠그는 판정과 같은 판정으로 무시한다.**
 */
describe('옵션이 층화를 막으면 무시한다', () => {
  const run = (common: Partial<Omit<Settings, 'data'>>) =>
    planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor({}, common),
      taskType: 'classification',
    })

  it('시험 비율이 몫을 범주 수보다 작게 만들어도 선다', () => {
    // 붓꽃 3품종 · 5%면 시험 몫이 범주 수보다 적다 — 분할이 SPLIT_STRATIFY_SHARE_TOO_SMALL로
    // 던지던 자리다.
    const plan = run({
      split: { method: 'holdout', testSize: 0.05, stratify: true, randomState: 42 },
    })
    expect(plan.ok).toBe(true)
  })

  it('표본 수가 층화를 감당 못 해도 선다', () => {
    // 품종마다 바닥이 있어 5행으로는 층화 뽑기가 안 된다 — SAMPLE_STRATIFY_IMPOSSIBLE 자리다.
    const plan = run({ nSamples: 5 })
    expect(plan.ok).toBe(true)
  })

  /**
   * **나눌 때의 사유는 나누지 않을 때 층화를 끄지 않는다** (R38-D55 A-1). `provided`에서는
   * 층화가 뽑기에만 걸리고, 뽑기는 1개뿐인 범주에도 바닥 1을 남긴다(`ml/sample.ts`). 판정이
   * *"값이 1개뿐이라 나눌 수 없다"*로 층화를 막자 계획이 뽑기에서 층화를 껐고, **드문 범주가
   * 훈련 표본에서 조용히 빠졌다**(씨앗 200개 중 83). 결정문 55 전에는 안 그랬다.
   */
  it('따로 받은 테스트 데이터면 1개뿐인 범주도 층화 뽑기에 남는다', () => {
    const labels = [...Array<string>(10).fill('A'), ...Array<string>(10).fill('B'), 'C']
    const dataset: Dataset = {
      columns: ['x', 'label'],
      rows: labels.map((label, index) => [String(index), label]),
    }
    const testDataset: Dataset = {
      columns: ['x', 'label'],
      rows: [
        ['1', 'A'],
        ['2', 'B'],
        ['3', 'C'],
      ],
    }
    const absent = [...Array(40).keys()].filter((seed) => {
      const plan = planRun({
        dataset,
        testDataset,
        settings: settingsFor(
          { features: ['x'], target: 'label' },
          {
            nSamples: 12,
            split: { method: 'provided', testSize: 0.3, stratify: true, randomState: seed },
          },
        ),
        taskType: 'classification',
      })
      expect(plan.ok).toBe(true)
      return plan.ok && !plan.sampled.some((row) => dataset.rows[row]![1] === 'C')
    })
    expect(absent).toEqual([])
  })
})

describe('기록된 분할', () => {
  /** 파일에서 읽어 온 셈 치는 분할. 조립(`ml/reproduce.ts`)만 만들 수 있는 값이다. */
  const recorded = asRecordedSplit({ trainIndices: [0, 1, 2, 3, 4, 5], testIndices: [6, 7, 8] })

  it('준 인덱스가 그대로 나온다 - 다시 나누지 않는다', () => {
    const plan = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor(),
      taskType: 'classification',
      recordedSplit: recorded,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.split.trainIndices).toEqual([0, 1, 2, 3, 4, 5])
    expect(plan.split.testIndices).toEqual([6, 7, 8])
    // 뽑힌 행은 둘의 합집합이다. `provided`가 아니면 시험 행도 같은 표의 번호다.
    expect(plan.sampled).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('전처리기가 기록된 훈련 행에서 맞춰진다', () => {
    // **다시 계산한 분할로 맞추면 이 숫자가 달라진다.** 같은 설정으로 분할만 준 계획과
    // 안 준 계획을 견주어, 안 준 쪽과 다르다는 것으로 "그 행에서 맞췄다"를 본다.
    const scaled: Partial<TabularSettings> = {
      preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    }
    const withRecorded = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor(scaled),
      taskType: 'classification',
      recordedSplit: recorded,
    })
    const plain = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor(scaled),
      taskType: 'classification',
    })
    expect(withRecorded.ok && plain.ok).toBe(true)
    if (!withRecorded.ok || !plain.ok) return
    const center = (facts: typeof withRecorded): number | undefined =>
      facts.ok ? facts.preprocessor.columns[0]?.scale?.center : undefined
    expect(center(withRecorded)).toBeTypeOf('number')
    expect(center(withRecorded)).not.toBe(center(plain))
  })

  it('앞의 검사는 그대로 돈다 - 빈 칸은 여전히 막힌다', () => {
    // 뽑기와 나누기만 대신한다. 이 검사가 건너뛰어지면 빈 칸이 조용히 0이 된다.
    const plan = planRun({
      dataset: tableWithBlank(),
      testDataset: null,
      settings: settingsFor({
        features: ['a', 'b'],
        target: 'label',
        preprocessing: { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' },
      }),
      taskType: 'classification',
      recordedSplit: asRecordedSplit({ trainIndices: [0, 1], testIndices: [2] }),
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toEqual({
      kind: 'error',
      code: 'FEATURE_HAS_MISSING',
      params: { feature: 'b', count: 1 },
    })
  })

  it('provided인데 테스트 표가 없으면 막는다', () => {
    // **오늘 이 자리를 지키던 것은 `splitRows`이고 기록된 분할이 그것을 건너뛴다.**
    // 안 막으면 시험 표의 행 번호로 훈련 표를 잘라 엉뚱한 행으로 채점한다 - 범위 안이면
    // 아무 예외도 없이 조용히 틀린다.
    const plan = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor(
        {},
        { split: { method: 'provided', testSize: 0.3, stratify: false, randomState: 42 } },
      ),
      taskType: 'classification',
      recordedSplit: recorded,
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toEqual({
      kind: 'error',
      code: 'TEST_DATASET_NO_USABLE_ROWS',
      params: {},
    })
  })

  it('군집은 테스트 표가 없어도 선다 - 애초에 안 나눈다', () => {
    const plan = planRun({
      dataset: irisDataset(),
      testDataset: null,
      settings: settingsFor(
        { target: undefined },
        {
          selectedAlgorithms: [{ algorithm: 'k_means' }],
          split: { method: 'provided', testSize: 0.3, stratify: false, randomState: 42 },
        },
      ),
      taskType: 'clustering',
      recordedSplit: asRecordedSplit({ trainIndices: [0, 1, 2, 3], testIndices: [] }),
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.split.testIndices).toEqual([])
  })
})

/**
 * **따로 올린 테스트 표(provided)의 경계.** 시험 행 번호가 다른 표를 가리킨다는 것과,
 * 훈련 표가 비었을 때 알리는 최소 행 수를 본다.
 */
describe('provided 분할의 경계', () => {
  const providedSplit = {
    method: 'provided',
    testSize: 0.3,
    stratify: false,
    randomState: 42,
  } as const
  const testTable: Dataset = {
    columns: ['x', 'label'],
    rows: [
      ['1', 'a'],
      ['2', 'b'],
    ],
  }
  const tabular = { features: ['x'], target: 'label' }

  /**
   * **시험 행 번호는 훈련 표의 행을 가리키지 않는다.** 훈련 표의 0번 행은 타깃이 비어
   * 학습에 안 쓰이고 `x`에 글자가 있다. 시험 표에도 0번 행이 있으니, 그 번호를 훈련 표의 종류
   * 판정에 섞으면 **안 쓰는 행의 글자**가 `x`를 범주로 만든다.
   */
  it('시험 행 번호를 훈련 표의 열 종류 판정에 섞지 않는다', () => {
    const train: Dataset = {
      columns: ['x', 'label'],
      rows: [
        ['모름', ''],
        ['1', 'a'],
        ['2', 'b'],
        ['3', 'a'],
        ['4', 'b'],
      ],
    }
    const plan = planRun({
      dataset: train,
      testDataset: testTable,
      settings: settingsFor(tabular, { split: providedSplit }),
      taskType: 'classification',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.split.testIndices).toEqual([0, 1])
    expect(plan.preprocessor.featureNames).toEqual(['x'])
  })

  /**
   * **provided는 훈련 행 하나로도 선다.** 시험은 따로 올린 표가 맡으니 훈련 표에서 둘로
   * 나눌 일이 없다 — holdout의 `MIN_SPLIT_ROWS`와 다르다.
   */
  it('훈련 표에 쓸 행이 0개면 최소 행 수 1을 알린다', () => {
    const train: Dataset = {
      columns: ['x', 'label'],
      rows: [
        ['1', ''],
        ['2', ''],
      ],
    }
    const plan = planRun({
      dataset: train,
      testDataset: testTable,
      settings: settingsFor(tabular, { split: providedSplit }),
      taskType: 'classification',
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toEqual({
      kind: 'error',
      code: 'SPLIT_TOO_FEW_ROWS',
      params: { minRows: 1, actualRows: 0 },
    })
  })
})

/**
 * **타깃 이름이 표에 없는 파일** — 손으로 고친 `.mlpx`가 열린다(`readProject`가 받는다). 계획은
 * 던지지 않고 사유로 선다: 화면의 계산이 이 함수를 부르므로 던지면 화면이 죽는다.
 */
describe('타깃 이름이 표에 없는 파일', () => {
  const NOW = '2026-09-26T00:00:00Z'

  /** 파일을 굽고 다시 열어 그 파일로 계획한다 — 손으로 고친 파일이 들어오는 진짜 입구다. */
  async function planThroughFile(file: ProjectFile) {
    const { bytes } = await writeProjectBytes(file, '# p\n')
    const opened = (await readProject(bytes)).project
    const dataset = readDataset(opened)
    if (!dataset) throw new Error('no table')
    return planRun({
      dataset,
      testDataset: readTestDataset(opened),
      settings: opened.document.settings,
      taskType: opened.document.manifest.taskType,
    })
  }

  it('타깃 이름이 표에 없으면 던지지 않고 사유로 선다', async () => {
    const file = await surveyProject(true)
    const plan = await planThroughFile({
      ...file,
      document: withTarget(file.document, '없는열', NOW),
    })
    expect(plan.ok).toBe(false)
    expect(!plan.ok && plan.reason).toEqual({
      kind: 'error',
      code: 'COLUMN_NOT_FOUND',
      params: { column: '없는열' },
    })
  })

  /** **군집은 타깃을 안 본다** — 파일에 남은 낡은 타깃 이름이 군집의 계획을 막지 않는다. */
  it('군집이면 표에 없는 타깃 이름이 계획을 막지 않는다', async () => {
    const file = await surveyProject(true)
    let document = withTarget(file.document, '없는열', NOW)
    document = withTaskType(document, 'clustering', NOW)
    const plan = await planThroughFile({ ...file, document })
    expect(plan.ok).toBe(true)
  })

  /**
   * **따로 올린 테스트 표에 타깃 열이 없는 파일.** 화면의 입구는 열을 정본에 맞춰 받지만 손으로
   * 고친 `test.csv`는 그대로 열린다. 회귀면 테스트 표의 타깃을 읽는 자리가 있다.
   */
  it('테스트 표에 타깃 열이 없으면 던지지 않고 사유로 선다', async () => {
    const file = await scoreProject(true, 'drop')
    const imported = importTable(
      await openTable(new TextEncoder().encode('키,몸무게,점수\n150,45,60\n151,46,61\n'), 't.csv'),
    )
    const withTest = applyTestDataset(file, imported, {
      fileName: 't.csv',
      hasHeader: true,
      now: NOW,
    }).project
    const bytes = new TextEncoder().encode('키,몸무게\n150,45\n151,46\n')
    const plan = await planThroughFile({
      ...withTest,
      testDataset: { bytes, hash: hashBytes(bytes) },
    })
    expect(plan.ok).toBe(false)
    expect(!plan.ok && plan.reason).toEqual({
      kind: 'error',
      code: 'TEST_DATASET_COLUMN_MISSING',
      params: { columns: '점수' },
    })
  })
})
