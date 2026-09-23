/**
 * **채점하는 시험 행렬에 수로 못 읽는 값이 있으면 학습 전에 선다** (2026-09-21 R36 A-1).
 *
 * **왜 이 검사가 있는가.** 열이 수치인지 범주인지는 `detectKind`가 **훈련 몫만** 보고
 * 정하는데 `transform`은 **시험 몫도** 같은 규칙으로 돌린다. 그 비대칭 때문에 시험 몫에만
 * 있는 `1,650`·`없음`·`N/A`가 아무 그물에도 안 걸리고 `preprocess.ts`의 `?? 0`에서
 * **조용히 `0`이 됐다** — 실패도 경고도 없이 그 `0`으로 정확도와 R²가 나왔고, 학생은 그
 * 숫자를 포트폴리오에 적었다.
 *
 * **여기서 재는 것은 둘이다** — 막는가, 그리고 **막아야 할 것만 막는가.** 둘째가 없으면
 * 멀쩡한 파일이 거절당하는 쪽으로 넘어간다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { MAX_ERROR_VALUE_LENGTH } from '../src/limits'
import { planRun } from '../src/ml/plan'
import { transform, type Dataset } from '../src/ml/preprocess'
import type { Settings } from '../src/project/schema'

/** 훈련 표 — `점수`가 전부 수로 읽힌다. 열 판정이 `numeric`으로 서는 최소 크기다. */
function trainTable(): Dataset {
  const rows: string[][] = []
  for (let i = 0; i < 12; i += 1) rows.push([String(100 + i * 10), i % 2 === 0 ? '가' : '나'])
  return { columns: ['점수', '등급'], rows }
}

function testTable(scores: readonly string[]): Dataset {
  return {
    columns: ['점수', '등급'],
    rows: scores.map((score, index) => [score, index % 2 === 0 ? '가' : '나']),
  }
}

function settingsFor(
  method: 'holdout' | 'provided',
  features: readonly string[] = ['점수'],
): Settings {
  return {
    kind: 'tabular',
    data: {
      features: [...features],
      target: '등급',
      preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
    },
    split: { method, testSize: 0.25 },
    randomState: 42,
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'decision_tree' }],
  } as unknown as Settings
}

/** `지역`을 **0번 열**로 앞에 붙인다. 수치 열이 첫 열이 아니게 만드는 것이 목적이다. */
function withRegion(table: Dataset, override?: string): Dataset {
  return {
    columns: ['지역', ...table.columns],
    rows: table.rows.map((row, i) => [override ?? (i % 2 === 0 ? '북부' : '남부'), ...row]),
  }
}

function planWith(test: Dataset | null, method: 'holdout' | 'provided' = 'provided') {
  return planRun({
    dataset: trainTable(),
    testDataset: test,
    settings: settingsFor(method),
    taskType: 'classification',
  })
}

describe('시험 몫의 수로 못 읽는 값 — 따로 올린 표는 서고, 같은 파일은 범주가 된다', () => {
  /** 교실에서 실제로 나오는 셋. 한국 학교 자료의 수는 `1,650`으로 적힌다. */
  for (const bad of ['1,650', '없음', 'N/A']) {
    it(`따로 올린 테스트 표의 \`${bad}\`를 거절한다`, () => {
      const plan = planWith(testTable(['150', bad, '170', '180']))
      expect(plan.ok).toBe(false)
      if (plan.ok || plan.reason.kind !== 'error') return
      expect(plan.reason.code).toBe('FEATURE_NOT_NUMBER')
      // **어느 열의 어느 값인지 말한다** — 안 말하면 학생이 고칠 자리를 못 찾는다.
      expect(plan.reason.params).toEqual({ feature: '점수', value: bad })
    })
  }

  /**
   * **한 파일 홀드아웃에서는 거절하지 않고 열이 범주가 된다** (open-decisions.md 53,
   * 2026-09-23).
   *
   * **전에는 반대를 못 박았다** — 시험 몫에만 있는 글자가 거절됐다(R36 A-1). 그런데 같은
   * 글자가 훈련 몫에 가면 열이 조용히 범주가 돼서 **무작위 분할이 해석을 정했다.** 이제
   * 열 종류를 그 실행이 쓰는 행 전체로 정하므로, `N/A`가 어디 가든 결과가 같다.
   *
   * **R36 A-1의 피해는 여전히 안 난다** — 그 피해는 *수치 열의 시험 행이 조용히 `0`이
   * 되는 것*이었는데, 열이 수치가 아니게 되니 그 자리가 없다. 아래 두 판이 그것을 잰다.
   */
  it('한 파일 홀드아웃에서는 시험 몫의 글자가 열을 범주로 만든다 — 분할이 해석을 안 정한다', () => {
    const clean = planWith(null, 'holdout')
    expect(clean.ok).toBe(true)
    if (!clean.ok) return

    // 같은 글자를 한 번은 시험 몫에, 한 번은 훈련 몫에 둔다. 나머지는 같다.
    function planWithLetterAt(row: number) {
      const dirty = trainTable()
      ;(dirty.rows[row] as string[])[0] = 'N/A'
      return planRun({
        dataset: dirty,
        testDataset: null,
        settings: settingsFor('holdout'),
        taskType: 'classification',
      })
    }
    const inTest = planWithLetterAt(clean.split.testIndices[0] as number)
    const inTrain = planWithLetterAt(clean.split.trainIndices[0] as number)

    expect(inTest.ok).toBe(true)
    expect(inTrain.ok).toBe(true)
    if (!inTest.ok || !inTrain.ok) return
    const kindOf = (plan: typeof inTest) =>
      plan.ok ? plan.preprocessor.columns.find((column) => column.name === '점수')?.kind : null
    // **어디 있든 같은 종류다.** 전에는 시험 몫이면 거절, 훈련 몫이면 범주였다.
    expect(kindOf(inTest)).toBe('categorical')
    expect(kindOf(inTrain)).toBe('categorical')
  })

  it('학습 경로에서는 그 사유로 던진다', async () => {
    const { planRunOrThrow } = await import('../src/ml/plan')
    try {
      planRunOrThrow({
        dataset: trainTable(),
        testDataset: testTable(['150', '1,650', '170', '180']),
        settings: settingsFor('provided'),
        taskType: 'classification',
      })
      expect.unreachable('planRunOrThrow should have thrown')
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('FEATURE_NOT_NUMBER')
    }
  })
})

describe('막아야 할 것만 막는다', () => {
  it('시험 몫이 전부 수면 통과하고, 그때 행렬이 0으로 안 뭉개진다', () => {
    const plan = planWith(testTable(['150', '160', '170', '180']))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const matrix = transform(
      plan.preprocessor,
      testTable(['150', '160', '170', '180']),
      plan.split.testIndices,
      'onehot',
    )
    // **이 단언이 이 파일의 절반이다** — 고치기 전에는 여기가 [[150],[0],[0],[0]]이었다.
    expect(matrix).toEqual([[150], [160], [170], [180]])
  })

  it('빈 칸은 이 문이 안 막는다 — 채움값이 있고 사유가 다르다', () => {
    const plan = planWith(testTable(['150', '', '170', '180']))
    expect(plan.ok, 'blank cells are filled by the mean strategy').toBe(true)
  })

  /**
   * **글자를 특성 열에 넣어야 이 갈래를 지난다** (2026-09-21 델타 감사 B-3). 전에는
   * 타깃 열에 넣었는데 **타깃은 전처리기의 `columns`에 애초에 없어서**, 수치 열만 보는
   * 가드를 지워도 초록이었다. 그래서 `지역`을 특성으로 하나 더 둔다.
   */
  it('범주 특성의 글자는 안 막는다 — 수치 열만 본다', () => {
    const plan = planRun({
      dataset: withRegion(trainTable()),
      testDataset: withRegion(testTable(['150', '160', '170', '180']), '처음 보는 지역'),
      settings: settingsFor('provided', ['지역', '점수']),
      taskType: 'classification',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.preprocessor.columns.find((one) => one.name === '지역')?.kind).toBe('categorical')
  })

  /**
   * **수치 특성이 0번 열이 아니어야 열 조회를 잰다** (2026-09-21 델타 감사 B-3).
   * 전에는 `점수`가 늘 첫 열이라 `columns.indexOf(...)`를 `0`으로 바꿔도 초록이었다.
   */
  it('수치 열이 첫 열이 아니어도 그 열을 본다', () => {
    const plan = planRun({
      dataset: withRegion(trainTable()),
      testDataset: withRegion(testTable(['150', '1,650', '170', '180'])),
      settings: settingsFor('provided', ['지역', '점수']),
      taskType: 'classification',
    })
    expect(plan.ok).toBe(false)
    if (plan.ok || plan.reason.kind !== 'error') return
    expect(plan.reason.params).toEqual({ feature: '점수', value: '1,650' })
  })

  it('훈련 몫의 글자는 이 문이 아니라 열 판정이 받는다 — 그 열은 범주가 된다', () => {
    const dirty = trainTable()
    ;(dirty.rows[0] as string[])[0] = '없음'
    const plan = planRun({
      dataset: dirty,
      testDataset: testTable(['150', '160', '170', '180']),
      settings: settingsFor('provided'),
      taskType: 'classification',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // 훈련 몫에 글자가 하나라도 있으면 `detectKind`가 범주로 돌린다 — 그러면 수로 읽을
    // 일이 없으므로 이 문이 볼 것도 없다.
    expect(plan.preprocessor.columns.find((one) => one.name === '점수')?.kind).toBe('categorical')
  })
})

/**
 * **따로 올린 테스트 표의 타깃도 같은 잣대로 본다** (2026-09-21 R36-V V-1).
 *
 * 정본의 타깃은 `requiredTargetKind`가 이미 보는데, `provided`면 **채점에 쓰는 정답이
 * 다른 표에서 온다.** 거기 글자가 있으면 `evaluateRegression`의 `Number()`가 `NaN`을
 * 만들고 지표 가드가 `JOB_FAILED`로 던진다 — **시끄럽게 죽긴 하는데 열 이름도 값도
 * 없다.** 같은 데이터가 특성 열에 있었으면 `FEATURE_NOT_NUMBER`가 짚어 준다.
 */
describe('회귀 · 따로 올린 테스트 표의 타깃 열', () => {
  function regressionTables(testTargets: readonly string[]) {
    const train: string[][] = []
    for (let i = 0; i < 12; i += 1) train.push([String(100 + i * 10), String(i * 2)])
    return {
      dataset: { columns: ['점수', '보상'], rows: train },
      testDataset: {
        columns: ['점수', '보상'],
        rows: testTargets.map((one, i) => [String(150 + i * 10), one]),
      },
    }
  }

  function planFor(testTargets: readonly string[]) {
    const { dataset, testDataset } = regressionTables(testTargets)
    return planRun({
      dataset,
      testDataset,
      settings: {
        kind: 'tabular',
        data: {
          features: ['점수'],
          target: '보상',
          preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
        },
        split: { method: 'provided', testSize: 0.25 },
        randomState: 42,
        runtime: 'mljs',
        selectedAlgorithms: [{ algorithm: 'linear_regression' }],
      } as unknown as Settings,
      taskType: 'regression',
    })
  }

  it('테스트 표의 타깃이 전부 수면 통과한다', () => {
    expect(planFor(['10', '20', '30', '40']).ok).toBe(true)
  })

  /**
   * **빈 것은 "숫자가 아니다"가 아니다** (2026-09-21 델타 감사 B-1). `detectKind([])`는
   * `categorical`을 내므로, 길이를 안 보면 **쓸 행이 하나도 없는 테스트 표**에
   * *"회귀는 숫자를 예측하는데…"*라고 답한다. `0.22.0`은 여기서
   * `TEST_DATASET_NO_USABLE_ROWS`를 냈다 — 이 델타가 낸 회귀였다.
   */
  it('테스트 표의 타깃이 전부 비면 "숫자가 아니다"가 아니라 "쓸 행이 없다"다', () => {
    const plan = planFor(['', '', '', ''])
    expect(plan.ok).toBe(false)
    if (plan.ok || plan.reason.kind !== 'error') return
    expect(plan.reason.code).toBe('TEST_DATASET_NO_USABLE_ROWS')
  })

  /**
   * **테스트 표의 이름으로 말한다** (2026-09-23, R38-V2 C-1, `open-decisions.md` 53). 처음에는
   * *"새 어휘 없이"* `TARGET_NOT_NUMERIC`이었는데, 그 문장을 읽은 학생은 **정본**의 타깃 열을
   * 뒤졌다 — 정본의 타깃 줄은 조용한데(`targetKind`는 정본의 것이라 `numeric`이다).
   */
  it('테스트 표의 타깃이 글자면 테스트 표의 이름으로 말한다', () => {
    const plan = planFor(['10', '없음', '30', '40'])
    expect(plan.ok).toBe(false)
    if (plan.ok || plan.reason.kind !== 'error') return
    expect(plan.reason.code).toBe('TEST_DATASET_TARGET_NOT_NUMERIC')
    expect(plan.reason.params).toEqual({ target: '보상' })
    // 정본의 타깃은 숫자뿐이다 — 전처리 화면의 타깃 줄이 빨개질 이유가 없다.
    expect(plan.targetKind).toBe('numeric')
  })
})

/** **오류 문구에 실리는 셀 값은 잘린다** (2026-09-21 R36-V V-2). */
describe('오류 문구에 실리는 값의 길이', () => {
  it('긴 셀은 상한까지만 실린다', () => {
    const long = '가'.repeat(500)
    const plan = planWith(testTable(['150', long, '170', '180']))
    expect(plan.ok).toBe(false)
    if (plan.ok || plan.reason.kind !== 'error') return
    expect(plan.reason.code).toBe('FEATURE_NOT_NUMBER')
    expect(String(plan.reason.params.value)).toHaveLength(MAX_ERROR_VALUE_LENGTH)
  })
})
