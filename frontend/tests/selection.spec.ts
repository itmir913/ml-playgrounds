/**
 * 타깃·특성·모델 선택의 판정.
 *
 * **화면 없이 테스트한다.** 조건 하나를 확인하려고 화면 전체를 마운트해야 하면 아무도
 * 그 조건을 확인하지 않는다 (architecture.md §8.3과 같은 이유다).
 *
 * 여기서 지키는 선은 하나다 — **학습이 거부하는 것(issue)과 화면만 하는 말(caution)을
 * 섞지 않는다.** 학습이 안 막는 것을 에러처럼 보여주면 도구가 거짓말을 하고, 학습이
 * 막는 것을 주의로 보여주면 학생이 [학습]에서 처음 알게 된다.
 */

import { describe, expect, it } from 'vitest'

import type { ColumnSummary } from '../src/data/columns'
import { ALGORITHMS, algorithmOptions, type AlgorithmOption } from '../src/ml/algorithms'
import { reasonParams, type RuntimeContext, type UnavailableReason } from '../src/ml/backend'
import type { Dataset } from '../src/ml/preprocess'
import {
  algorithmsLosingMeaning,
  columnBlocks,
  columnNote,
  columnPlan,
  featureLocked,
  modelAxes,
  requiredTargetKind,
  rowUsage,
  stratifyBlock,
  stratifyApplies,
  stratifyLocked,
  splitsData,
  trainableRowCount,
  usesTarget,
  type AxisChoice,
} from '../src/ml/selection'
import { scoresWithTestImages } from '../src/data/image/test-set'
import { isClientError } from '../src/errors'
import { MIN_SPLIT_ROWS, MLJS_SVM_ROW_LIMIT } from '../src/limits'
import { TASK_TYPES } from '../src/project/schema'
import { sampleRows } from '../src/ml/sample'
import type { Preprocessing, Split } from '../src/project/schema'
import { SKLEARN_ONLY_ALGORITHM, withSklearnOnly } from './fixtures/algorithms'

const ONEHOT: Preprocessing = { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' }
const NO_ENCODING: Preprocessing = { ...ONEHOT, categoricalEncoding: 'none' }
const KEEP_BLANKS: Preprocessing = { ...ONEHOT, missing: 'none' }

function column(overrides: Partial<ColumnSummary> & { name: string }): ColumnSummary {
  return { kind: 'numeric', missing: 0, unique: 5, samples: [], ...overrides }
}

const SCORE = column({ name: '점수' })
const HEIGHT = column({ name: '키' })
const GRADE = column({ name: '등급', kind: 'categorical', unique: 3 })

function planFor(overrides: Partial<Parameters<typeof columnPlan>[0]> = {}) {
  return columnPlan({
    columns: [SCORE, HEIGHT, GRADE],
    rowCount: 10,
    taskType: 'classification',
    target: '등급',
    features: ['점수', '키'],
    preprocessing: ONEHOT,
    ...overrides,
  })
}

describe('열마다 지금 무엇인가', () => {
  it('타깃과 특성과 안 쓰는 열을 가른다', () => {
    const plan = planFor({ features: ['점수'] })
    expect(plan.columns.map((one) => one.role)).toEqual(['feature', 'unused', 'target'])
  })

  it('고른 특성 수와 실제로 들어가는 수가 같다', () => {
    expect(planFor().usableFeatures).toBe(2)
  })
})

describe('학습이 거부하는 것', () => {
  it('회귀는 숫자가 아닌 열을 타깃으로 못 쓴다', () => {
    const plan = planFor({ taskType: 'regression' })
    const grade = plan.columns.find((one) => one.summary.name === '등급')
    expect(grade?.targetIssue).toBe('TARGET_NOT_NUMERIC')
    expect(plan.columns.find((one) => one.summary.name === '점수')?.targetIssue).toBeUndefined()
  })

  it('분류는 타깃 자료형을 가리지 않는다 - 3과 "3"을 나누지 않는다', () => {
    for (const one of planFor().columns) expect(one.targetIssue, one.summary.name).toBeUndefined()
    expect(requiredTargetKind('classification')).toBeUndefined()
  })

  it('"그대로 두기"에서는 빈 칸이 하나만 있어도 특성이 될 수 없다', () => {
    // 빈 칸을 그대로 모델에 넣을 방법이 없다. 조용히 0으로 채우느니 거부한다
    // (open-decisions.md "전처리도 분할도 끌 수 있다").
    const holed = column({ name: '점수', missing: 2 })
    const plan = columnPlan({
      columns: [holed],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수'],
      preprocessing: KEEP_BLANKS,
    })
    expect(plan.columns[0]?.featureIssue).toBe('FEATURE_HAS_MISSING')
    expect(plan.usableFeatures).toBe(0)
  })

  it('전략을 바꾸면 같은 열이 풀린다 - 열이 아니라 설정의 문제다', () => {
    const holed = column({ name: '점수', missing: 2 })
    const plan = columnPlan({
      columns: [holed],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수'],
      preprocessing: { ...ONEHOT, missing: 'mean' },
    })
    expect(plan.columns[0]?.featureIssue).toBeUndefined()
    expect(plan.usableFeatures).toBe(1)
  })

  it('값이 통째로 빈 열은 특성이 될 수 없고 학습에도 안 들어간다', () => {
    const empty = column({ name: '비고', missing: 10, unique: 0 })
    const plan = columnPlan({
      columns: [SCORE, empty],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수', '비고'],
      preprocessing: ONEHOT,
    })
    expect(plan.columns[1]?.featureIssue).toBe('FEATURE_ALL_MISSING')
    expect(plan.usableFeatures).toBe(1)
  })
})

describe('화면만 하는 말', () => {
  it('인코딩이 꺼져 있으면 문자 열이 학습에서 빠진다', () => {
    const plan = columnPlan({
      columns: [SCORE, GRADE],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수', '등급'],
      preprocessing: NO_ENCODING,
    })
    expect(plan.columns[1]?.featureNote).toBe('notEncodable')
    // 고르는 것 자체는 막지 않는다 - 인코딩을 켜면 그대로 살아난다.
    expect(plan.columns[1]?.featureIssue).toBeUndefined()
    expect(plan.usableFeatures).toBe(1)
  })

  it('인코딩을 켜면 문자 열도 학습에 들어간다', () => {
    const plan = columnPlan({
      columns: [SCORE, GRADE],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수', '등급'],
      preprocessing: ONEHOT,
    })
    expect(plan.columns[1]?.featureNote).toBeUndefined()
    expect(plan.usableFeatures).toBe(2)
  })

  it('값이 한 종류뿐인 열은 주의이지 거부가 아니다', () => {
    const flat = column({ name: '반', unique: 1 })
    const plan = columnPlan({
      columns: [flat],
      rowCount: 10,
      taskType: 'classification',
      target: '반',
      features: [],
      preprocessing: ONEHOT,
    })
    expect(plan.columns[0]?.targetCaution).toBe('singleValue')
    expect(plan.columns[0]?.targetIssue).toBeUndefined()
  })
})

describe('유형을 바꾸면 뜻을 잃는 모델', () => {
  it('분류로 바꾸면 회귀 전용 모델이 빠진다', () => {
    const selected = [{ algorithm: 'decision_tree' }, { algorithm: 'linear_regression' }]
    expect(algorithmsLosingMeaning(selected, 'classification')).toEqual(['linear_regression'])
    expect(algorithmsLosingMeaning(selected, 'regression')).toEqual(['decision_tree'])
  })

  it('실행 위치는 보지 않는다 - 서버가 꺼져 있다고 선택을 지우지 않는다', () => {
    // 이 모델은 서버나 준비된 엔진이 있어야 돈다. 그래도 분류에서는 뜻이 있으므로 남는다.
    expect(
      algorithmsLosingMeaning([{ algorithm: 'sklearn_only' }], 'classification', [
        SKLEARN_ONLY_ALGORITHM,
      ]),
    ).toEqual([])
  })

  it('등록부에 없는 알고리즘은 남긴다 - 남의 파일에서 온 것이다', () => {
    expect(algorithmsLosingMeaning([{ algorithm: 'xgboost' }], 'regression')).toEqual([])
  })
})

describe('세 축이 서로를 좁힌다', () => {
  const OFFLINE: RuntimeContext = { serverStatus: 'unavailable', rowCount: 50, dataType: 'tabular' }
  const ONLINE: RuntimeContext = { serverStatus: 'available', rowCount: 50, dataType: 'tabular' }

  function axes(
    overrides: Partial<Parameters<typeof modelAxes>[0]> = {},
  ): ReturnType<typeof modelAxes> {
    return modelAxes({
      // 등록부에 sklearn 전용을 하나 얹어 둔다. 지금 실제 등록부에는 하나도 없는데,
      // 그 사실이 이 규칙의 테스트를 지우면 안 된다 (fixtures/algorithms.ts).
      options: algorithmOptions(
        { dataType: 'tabular', taskType: 'classification' },
        OFFLINE,
        withSklearnOnly(ALGORITHMS),
      ),
      algorithm: 'decision_tree',
      runtime: 'mljs',
      chosen: [],
      ...overrides,
    })
  }

  function choice(list: readonly AxisChoice[], id: string): AxisChoice | undefined {
    return list.find((one) => one.id === id)
  }

  /**
   * **카드는 사유만이 아니라 그 칸의 상한도 싣는다** (`AxisChoice.maxRows`).
   *
   * 화면이 그 값을 `reasonParams(reason, choice.maxRows)`로 넘겨 문장의 `{limitRows}`를
   * 채우는데, **안 넘기면 기본값 `BROWSER_ROW_LIMIT`(5000)이 들어간다.** 그러면 SVM
   * 카드가 3000에서 꺼지면서 "5000행까지"라고 말한다. 저장소가 이 실패를 `backend.ts`와
   * `ModelAxes.vue` 두 곳에 글자로 적어 두었는데 **전달 줄을 지워도 2,254개가 전부
   * 초록이었다** (2026-08-30 R12 감사 A-1) — 사유는 덮고 숫자는 안 덮고 있었다.
   */
  describe('상한이 따로 있는 알고리즘은 그 숫자를 카드에 싣는다', () => {
    const TIGHT: RuntimeContext = {
      serverStatus: 'unavailable',
      rowCount: MLJS_SVM_ROW_LIMIT + 1,
      dataType: 'tabular',
    }

    function tightAxes(): ReturnType<typeof modelAxes> {
      return axes({
        options: algorithmOptions(
          { dataType: 'tabular', taskType: 'classification' },
          TIGHT,
          ALGORITHMS,
        ),
        algorithm: 'svm',
        runtime: 'mljs',
      })
    }

    it('모델 축이 자기 상한을 싣는다 - 브라우저 상한이 아니다', () => {
      expect(choice(tightAxes().algorithms, 'svm')).toEqual({
        id: 'svm',
        enabled: false,
        reason: 'DATASET_TOO_LARGE_FOR_BROWSER',
        maxRows: MLJS_SVM_ROW_LIMIT,
      })
    })

    it('실행 방법 축도 같은 숫자를 싣는다', () => {
      expect(choice(tightAxes().runtimes, 'mljs')).toMatchObject({
        enabled: false,
        maxRows: MLJS_SVM_ROW_LIMIT,
      })
    })

    it('화면이 그 숫자로 문장을 채운다 - 안 실으면 5000이라 말한다', () => {
      const card = choice(tightAxes().algorithms, 'svm')
      expect(reasonParams(card?.reason as UnavailableReason, card?.maxRows)).toEqual({
        limitRows: MLJS_SVM_ROW_LIMIT,
      })
    })
  })

  it('실행 방법이 모델을 좁힌다 - 순수 JS에 없는 모델은 순수 JS 축에서 꺼진다', () => {
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'classification' },
      ONLINE,
      withSklearnOnly(ALGORITHMS),
    )
    const { algorithms } = axes({ options })
    expect(choice(algorithms, 'decision_tree')?.enabled).toBe(true)
    expect(choice(algorithms, 'sklearn_only')).toEqual({
      id: 'sklearn_only',
      enabled: false,
      reason: 'ALGORITHM_NOT_AVAILABLE_HERE',
    })
  })

  /**
   * **어디서도 못 도는 것이 먼저다** (mlpx-spec.md 0.1). 서버가 없으면 서포트 벡터 머신은
   * 순수 JS에 없어서가 아니라 **엔진이 준비되지 않아서** 못 쓴다 - 그쪽이 학생이 할 수
   * 있는 일을 알려주는 사유다.
   */
  it('축이 좁히기 전에 더 근본적인 사유가 있으면 그것이 이긴다', () => {
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'classification' },
      OFFLINE,
      withSklearnOnly(ALGORITHMS),
    )
    expect(choice(axes({ options }).algorithms, 'sklearn_only')?.reason).toBe('ENGINE_NOT_WIRED')
  })

  it('과제 유형이 먼저다 - 회귀에서는 분류 모델이 유형 사유로 꺼진다', () => {
    const { algorithms } = axes({
      options: algorithmOptions({ dataType: 'tabular', taskType: 'regression' }, OFFLINE),
      algorithm: 'linear_regression',
    })
    expect(choice(algorithms, 'decision_tree')?.reason).toBe('ALGORITHM_NOT_FOR_TASK_TYPE')
    expect(choice(algorithms, 'linear_regression')?.enabled).toBe(true)
  })

  it('모델이 실행 방법을 좁힌다 - 축은 걸린 모델 기준으로 판정된다', () => {
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'classification' },
      OFFLINE,
      withSklearnOnly(ALGORITHMS),
    )
    expect(choice(axes().runtimes, 'mljs')?.enabled).toBe(true)
    expect(choice(axes({ options, algorithm: 'sklearn_only' }).runtimes, 'mljs')?.reason).toBe(
      'ALGORITHM_NOT_AVAILABLE_HERE',
    )
  })

  it('서버가 없는 것은 정상 상태다 - 지우지 않고 사유와 함께 꺼 둔다', () => {
    const { runtimes } = axes()
    expect(runtimes.map((one) => one.id)).toEqual(['mljs', 'pyodide-sklearn', 'server-sklearn'])
    expect(choice(runtimes, 'server-sklearn')?.reason).toBe('SERVER_UNAVAILABLE')
    // 켤 자리가 아직 없어서 `ENGINE_NOT_READY`가 아니다 (`ml/backend.ts`의 `notReadyReason`).
    expect(choice(runtimes, 'pyodide-sklearn')?.reason).toBe('ENGINE_NOT_WIRED')
  })

  it('같은 쌍은 두 번 못 담고, 실행 방법이 다르면 담을 수 있다', () => {
    const options = algorithmOptions({ dataType: 'tabular', taskType: 'classification' }, ONLINE)
    const chosen = [{ algorithm: 'decision_tree', runtime: 'mljs' }]
    expect(axes({ options, chosen }).blocked).toBe('alreadyAdded')
    expect(axes({ options, chosen, runtime: 'server-sklearn' }).blocked).toBeNull()
  })

  /**
   * **불변식이다** (architecture.md 8.12). 이게 깨지면 "카드는 멀쩡한데 [추가]가 꺼져
   * 있다"가 생기고, 학생은 무엇을 고쳐야 하는지 알 수 없다.
   */
  it('담을 수 없으면 그 카드가 꺼져 있다', () => {
    for (const algorithm of ['svm', 'linear_regression', 'decision_tree', 'sklearn_only']) {
      const result = axes({ algorithm })
      const card = result.algorithms.find((one) => one.id === algorithm)
      expect(card?.enabled).toBe(result.blocked === null)
      if (!card?.enabled) expect(result.blocked).toBe(card?.reason)
    }
  })
})

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return isClientError(error) ? error.code : `던진 것이 ClientError가 아니다: ${String(error)}`
  }
  return '아무것도 던지지 않았다'
}

describe('층화를 걸 수 있는가', () => {
  const dataset = (targets: string[]): Dataset => ({
    columns: ['키', '반'],
    rows: targets.map((target, index) => [String(170 + index), target]),
  })

  function blockFor(overrides: Partial<Parameters<typeof stratifyBlock>[0]> = {}) {
    return stratifyBlock({
      dataset: dataset(['A', 'A', 'B', 'B']),
      taskType: 'classification',
      target: '반',
      features: ['키'],
      preprocessing: ONEHOT,
      nSamples: undefined,
      ...overrides,
    })
  }

  it('값마다 두 줄 이상이면 걸 수 있다', () => {
    expect(blockFor()).toBeNull()
  })

  /**
   * **화면이 학습과 같은 규칙으로 라벨을 뽑는다.**
   *
   * CSV는 셀을 안 다듬는다. 예전에는 화면만 `String(cell)`로 원문을 세고 학습은
   * `targetValues`로 다듬어 세서, `" A"`와 `"A"`가 **화면에서는 두 라벨, 학습에서는 한
   * 라벨**이었다. 그러면 화면이 *"' A' 값이 1개뿐이라 비율을 맞춰 나눌 수 없습니다"*라고
   * 말하는데 학습은 멀쩡히 돌고, 그 안내를 따라 층화를 끄면 `stratifyLocked`가 참이 되어
   * **다시 켤 수도 없다.** (V11 R2 감사 B-9)
   */
  it('앞뒤 공백은 학습과 같게 다듬어 센다 - 화면만 거부하면 안 된다', () => {
    // 다듬으면 A가 둘, B가 둘이라 층화가 성립한다. 안 다듬으면 ' A'가 1개라 막힌다.
    expect(blockFor({ dataset: dataset([' A', 'A', 'B ', 'B']) })).toBeNull()
  })

  it('회귀에서는 유형이 먼저 걸린다 - 값을 세기 전에 답이 나온다', () => {
    // **데이터를 보지 않고도 답한다.** 값이 고르게 갈리는 데이터를 넣어도 마찬가지다 -
    // 회귀에는 맞출 "종류"가 없다.
    expect(blockFor({ taskType: 'regression' })?.code).toBe('STRATIFY_NOT_FOR_TASK_TYPE')
  })

  /**
   * **화면이 [학습]보다 관대하면 안 된다** (`selection.ts` 머리말).
   *
   * `sampleRows`는 워커 안에서 돌아 화면이 부를 수 없어서 같은 식을 `selection.ts`에
   * 한 번 더 쓴다. 그래서 **두 경계가 같은 값인지**를 여기서 못 박는다 — 한쪽만 고치면
   * 학생이 [학습]을 눌러야 알게 된다.
   */
  describe('뽑기가 층화를 감당 못 하면 화면이 먼저 말한다', () => {
    /** 라벨 10종 × 각 2줄. 바닥의 합이 20이다. */
    const tenLabels = dataset([...Array(20).keys()].map((index) => `L${index % 10}`))
    const rowsOf = (): number[] => [...Array(20).keys()]
    const labelsOf = (): string[] => [...Array(20).keys()].map((index) => `L${index % 10}`)
    const split: Split = { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 }

    it('바닥의 합보다 적게 뽑으면 화면이 잠근다', () => {
      const block = blockFor({ dataset: tenLabels, nSamples: 19 })
      expect(block?.code).toBe('SAMPLE_STRATIFY_IMPOSSIBLE')
      expect(block?.params).toMatchObject({ nSamples: 19, labels: 10, minRows: MIN_SPLIT_ROWS })
    })

    it('바닥의 합만큼이면 통과한다', () => {
      expect(blockFor({ dataset: tenLabels, nSamples: 20 })).toBeNull()
    })

    it('화면의 경계와 뽑기의 경계가 같다', () => {
      // 한쪽만 고치면 여기가 운다. 두 판정이 다른 파일에 사는 값이다.
      for (const nSamples of [2, 5, 10, 18, 19, 20, 21]) {
        const blocked = blockFor({ dataset: tenLabels, nSamples })?.code
        const threw = codeOf(() =>
          sampleRows({ rows: rowsOf(), labels: labelsOf() }, split, nSamples),
        )
        expect(
          { nSamples, blocked: blocked ?? null },
          `nSamples=${nSamples}에서 화면과 뽑기가 갈렸다`,
        ).toEqual({
          nSamples,
          blocked: threw === 'SAMPLE_STRATIFY_IMPOSSIBLE' ? 'SAMPLE_STRATIFY_IMPOSSIBLE' : null,
        })
      }
    })

    it('안 뽑으면 아무 말도 안 한다', () => {
      expect(blockFor({ dataset: tenLabels, nSamples: undefined })).toBeNull()
    })

    it('쓸 수 있는 행보다 크면 뽑기가 없는 것과 같다', () => {
      expect(blockFor({ dataset: tenLabels, nSamples: 999 })).toBeNull()
    })

    /**
     * **라벨 크기를 고르지 않게 세운 짝.**
     *
     * 위의 `tenLabels`는 라벨마다 **정확히 2줄**이고 `MIN_SPLIT_ROWS`가 2라서
     * `Math.min(size, MIN_SPLIT_ROWS)`가 **항등**이다 — 그 클램프를 통째로 지워도 위
     * 루프가 안 운다 (2026-08-30 R12 감사 A-2). 클램프가 하는 일(`sample.ts`의
     * `floorFor`, *"가진 것보다 많이 요구하지 않는다"*)은 **라벨 하나가 바닥보다 클 때만**
     * 드러난다.
     *
     * A가 10줄, B와 C가 2줄이면 바닥의 합은 `2+2+2 = 6`이다. 클램프를 잃으면 `10+2+2 = 14`가
     * 되어 **nSamples=6에서 화면은 막고 뽑기는 통과한다** — 화면이 [학습하기]보다 엄격해지는,
     * `selection.ts` 머리말이 금지한 그 상태다. 뽑기는 잠긴 카드를 여는 유일한 손잡이라
     * (`open-decisions.md` #22) 학생이 고칠 방법 없이 그것을 잃는다.
     */
    const UNEVEN: string[] = [...(Array(10).fill('A') as string[]), 'B', 'B', 'C', 'C']
    const uneven = dataset(UNEVEN)

    it('라벨이 바닥보다 크면 가진 것만큼이 아니라 바닥만큼만 요구한다', () => {
      // 바닥의 합은 6이다. 클램프를 잃으면 14가 되어 6도 7도 막힌다.
      expect(blockFor({ dataset: uneven, nSamples: 6 })).toBeNull()
      expect(blockFor({ dataset: uneven, nSamples: 5 })?.code).toBe('SAMPLE_STRATIFY_IMPOSSIBLE')
    })

    it('라벨 크기가 고르지 않아도 화면과 뽑기의 경계가 같다', () => {
      for (const nSamples of [4, 5, 6, 7, 8, 13, 14]) {
        const blocked = blockFor({ dataset: uneven, nSamples })?.code
        const threw = codeOf(() =>
          sampleRows(
            { rows: [...Array(UNEVEN.length).keys()], labels: [...UNEVEN] },
            split,
            nSamples,
          ),
        )
        expect(
          { nSamples, blocked: blocked ?? null },
          `nSamples=${nSamples}에서 화면과 뽑기가 갈렸다`,
        ).toEqual({
          nSamples,
          blocked: threw === 'SAMPLE_STRATIFY_IMPOSSIBLE' ? 'SAMPLE_STRATIFY_IMPOSSIBLE' : null,
        })
      }
    })
  })

  /**
   * **`count`는 이제 센 값이다.** 예전에는 부르는 쪽이 `1`을 박아 넣었고, 그러면
   * `MIN_SPLIT_ROWS`가 움직이는 순간 화면이 *"이 범주의 데이터가 1개뿐이라…"*라고
   * **거짓말한다** (2026-08-30, R12 감사 C-2).
   *
   * **이 축은 오늘 못 가른다.** 외톨이의 조건이 `count < MIN_SPLIT_ROWS`이고 그 상수가
   * 2라서 나올 수 있는 값이 1뿐이다 — 센 것과 박은 것이 같은 수가 된다. 상수가 3이
   * 되는 날 이 검사가 저절로 갈린다. **못 가르는 것을 적어 둔다**, 검사가 지킨다고
   * 말하지 않는다.
   */
  it('1개뿐인 값이 하나면 그 값을 알려준다 - 더 모으면 풀린다', () => {
    const only = blockFor({ dataset: dataset(['A', 'A', 'B', 'B', '희귀품종']) })
    expect(only?.code).toBe('SPLIT_STRATIFY_IMPOSSIBLE')
    expect(only?.params).toMatchObject({ label: '희귀품종', count: 1 })
  })

  it('1개뿐인 값이 여럿이면 다른 사유다 - "더 모아라"가 불가능한 조언이 된다', () => {
    // 연속값 타깃이 실제로 이 모양이다. 소수가 두 번 나오는 일은 없다.
    const continuous = blockFor({ dataset: dataset(['1.13', '2.71', '3.14', '4.20']) })
    expect(continuous?.code).toBe('SPLIT_STRATIFY_TARGET_CONTINUOUS')
    expect(continuous?.params).toMatchObject({ kinds: 4, lonely: 4 })
  })

  it('학습이 버릴 행은 세지 않는다 - 화면과 학습이 같은 행을 봐야 한다', () => {
    // 두 번째 'B'의 특성이 비었다. drop 전략이면 그 행이 빠지므로 'B'가 한 줄이 되고,
    // 층화는 실제로 성립하지 않는다. 전체 행을 세면 이걸 못 잡는다.
    const holed: Dataset = {
      columns: ['키', '반'],
      rows: [
        ['170', 'A'],
        ['171', 'A'],
        ['172', 'B'],
        ['', 'B'],
      ],
    }
    expect(blockFor({ dataset: holed })?.code).toBe('SPLIT_STRATIFY_IMPOSSIBLE')
    // 채워 쓰는 전략이면 네 줄이 다 남아 성립한다.
    expect(blockFor({ dataset: holed, preprocessing: { ...ONEHOT, missing: 'mean' } })).toBeNull()
  })

  it('유형을 안 골랐으면 유형으로 좁히지 않는다', () => {
    expect(blockFor({ taskType: undefined })).toBeNull()
  })

  it('데이터나 타깃이 없으면 할 말이 없다', () => {
    expect(blockFor({ dataset: null })).toBeNull()
    expect(blockFor({ target: undefined })).toBeNull()
  })
})

describe('층화 체크박스를 잠그는 조건', () => {
  const block = { code: 'STRATIFY_NOT_FOR_TASK_TYPE' } as const
  /** 끄는 것이 학생이 할 수 있는 유일한 일인 사유. 옛 규칙이 그대로 걸린다. */
  const lonely = { code: 'SPLIT_STRATIFY_IMPOSSIBLE', label: '가', count: 1, minRows: 2 } as const

  it('켜진 채로는 절대 잠기지 않는다 - 영구 차단을 막는 조건이다', () => {
    // **이 한 줄이 이 describe의 이유다.** 파일에 true로 적힌 채 막힌 상태는 기본값이
    // 켜짐이라 실재한다. 여기서 잠그면 학생은 이유를 읽고도 끌 수 없고, 학습은 계속
    // 거부한다 - 화면에서 빠져나갈 문이 없다.
    expect(stratifyLocked(lonely, true)).toBe(false)
  })

  it('꺼져 있고 뜻이 없으면 잠근다 - 켤 수 없는 것을 켜게 두지 않는다', () => {
    expect(stratifyLocked(block, false)).toBe(true)
    expect(stratifyLocked(lonely, false)).toBe(true)
  })

  /**
   * **유형이 사유일 때만 켜져 있어도 잠근다** (`open-decisions.md` "값을 내리지 않는다.
   * 학습이 무시하고 화면이 잠근다"). 거기서는 학습이 무시하므로 끄는 것이 탈출구가
   * 아니고, 끄게 두면 **유형을 되돌렸을 때 켜 두었던 것이 사라진다.**
   */
  it('유형이 사유면 켜져 있어도 잠근다 - 학습이 무시하므로 끌 이유가 없다', () => {
    expect(stratifyLocked(block, true)).toBe(true)
  })

  it('걸리는 것이 없으면 꺼져 있어도 잠기지 않는다', () => {
    expect(stratifyLocked(null, false)).toBe(false)
    expect(stratifyLocked(null, true)).toBe(false)
  })
})

describe('올린 행 중 몇 행을 쓰는지', () => {
  const dataset = (rows: string[][]): Dataset => ({ columns: ['키', '반'], rows })

  it('빠진 행이 없으면 null이다 - 할 말이 없을 때 굳이 하지 않는다', () => {
    const clean = dataset([
      ['170', 'A'],
      ['180', 'B'],
    ])
    expect(rowUsage(clean, ['키'], '반', 'mean')).toBeNull()
  })

  it('타깃이 빈 행은 결측 전략과 무관하게 빠진다', () => {
    const holed = dataset([
      ['170', 'A'],
      ['180', ''],
    ])
    expect(rowUsage(holed, ['키'], '반', 'mean')).toEqual({ total: 2, usable: 1, dropped: 1 })
  })

  it('drop 전략이면 특성이 빈 행도 빠진다', () => {
    const holed = dataset([
      ['170', 'A'],
      ['', 'B'],
    ])
    expect(rowUsage(holed, ['키'], '반', 'drop')).toEqual({ total: 2, usable: 1, dropped: 1 })
    // mean이면 채워서 쓰므로 안 빠진다 - usableRows가 특성 결측을 drop에서만 본다.
    expect(rowUsage(holed, ['키'], '반', 'mean')).toBeNull()
  })

  it('데이터가 없거나 타깃이 안 정해졌으면 null이다', () => {
    const clean = dataset([['170', 'A']])
    expect(rowUsage(null, ['키'], '반', 'mean')).toBeNull()
    expect(rowUsage(clean, ['키'], undefined, 'mean')).toBeNull()
  })
})

describe('행 상한은 전처리 후 행 수로 잰다', () => {
  const table = (rows: string[][]): Dataset => ({ columns: ['키', '반'], rows })

  it('빠질 행을 뺀 수를 준다', () => {
    const holed = table([
      ['170', 'A'],
      ['180', ''],
      ['190', 'B'],
    ])
    expect(trainableRowCount(holed, ['키'], '반', 'mean', undefined)).toBe(2)
  })

  it('drop 전략에서는 특성이 빈 행도 빠진다', () => {
    const holed = table([
      ['170', 'A'],
      ['', 'B'],
    ])
    expect(trainableRowCount(holed, ['키'], '반', 'drop', undefined)).toBe(1)
    // mean이면 채워서 쓰므로 안 빠진다 - rowUsage와 같은 usableRows를 본다.
    expect(trainableRowCount(holed, ['키'], '반', 'mean', undefined)).toBe(2)
  })

  it('타깃을 안 골랐으면 파일의 행 수다 - 무엇이 빠질지 아직 모른다', () => {
    const clean = table([
      ['170', 'A'],
      ['180', 'B'],
    ])
    expect(trainableRowCount(clean, ['키'], undefined, 'mean', undefined)).toBe(2)
    expect(trainableRowCount(null, ['키'], '반', 'mean', undefined)).toBe(0)
  })

  it('nSamples를 뺀다 - 뽑기는 학생이 잠긴 카드를 여는 손잡이다', () => {
    const clean = table(
      Array.from({ length: 100 }, (_, index) => [String(150 + (index % 50)), 'A']),
    )
    expect(trainableRowCount(clean, ['키'], '반', 'mean', 30)).toBe(30)
    // 가진 행보다 크면 아무 일도 안 한다 - ml/sample.ts가 그대로 돌려주기 때문이다.
    expect(trainableRowCount(clean, ['키'], '반', 'mean', 999)).toBe(100)
    // 타깃을 안 골랐어도 뺀다. fit이 nSamples보다 많이 볼 수 없다.
    expect(trainableRowCount(clean, ['키'], undefined, 'mean', 30)).toBe(30)
  })

  /**
   * **화면이 학습보다 엄격하면 안 된다.** 학습은 `usableRows`로 거른 뒤에 시작하므로
   * (ml/experiment.ts) 걸러서 상한 아래로 내려온 데이터는 실제로 학습할 수 있다. 파일의
   * 행 수로 재면 전처리 화면이 "최종 N행을 학습에 사용합니다"라고 말한 바로 다음 화면에서
   * 그보다 큰 수로 모델을 잠근다 - 학생은 고칠 방법이 없는 이유로 모델을 잃는다.
   */
  it('파일은 상한을 넘어도 전처리 후 아래면 그 모델은 열려 있다', () => {
    const dropped = 200
    const rows = Array.from({ length: MLJS_SVM_ROW_LIMIT + 100 }, (_, index) => [
      String(150 + (index % 50)),
      // 앞의 200행은 타깃이 비어 있다. 어떤 결측 전략에서도 빠진다.
      index < dropped ? '' : 'A',
    ])
    const big = table(rows)
    const usable = trainableRowCount(big, ['키'], '반', 'mean', undefined)

    expect(big.rows.length).toBeGreaterThan(MLJS_SVM_ROW_LIMIT)
    expect(usable).toBeLessThan(MLJS_SVM_ROW_LIMIT)

    const svm = (rowCount: number): AlgorithmOption | undefined =>
      algorithmOptions(
        { dataType: 'tabular', taskType: 'classification' },
        { serverStatus: 'unavailable', rowCount, dataType: 'tabular' },
      ).find((one) => one.algorithm.id === 'svm')

    expect(svm(usable)?.enabled).toBe(true)
    // 같은 데이터를 파일의 행 수로 재면 잠긴다. 고친 것이 정확히 이 차이다.
    expect(svm(big.rows.length)?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })
})

/**
 * **나누는 유형인가** — 전처리의 두 판이 같은 함수를 본다.
 *
 * 이 판정이 갈리면 한쪽 화면만 고쳐진다. 실제로 이미지 판이 사진이 올라왔을 때만
 * 손잡이를 감추고 **군집화는 안 보고 있었고**, 표 판은 아예 안 보고 있었다 —
 * 군집화에서 비율 슬라이더가 켜진 채 아무 일도 안 했다 (2026-08-29 화면 실측 A-2·B-1).
 */
describe('타깃을 쓰는 유형인가', () => {
  it('군집화는 안 쓴다', () => {
    expect(usesTarget('clustering')).toBe(false)
  })

  it('나머지 유형은 쓴다', () => {
    expect(usesTarget('classification')).toBe(true)
    expect(usesTarget('regression')).toBe(true)
  })

  /** `splitsData`와 같은 이유다 — 유형은 학습 화면에서 고른다. */
  it('아직 안 골랐으면 쓴다고 본다', () => {
    expect(usesTarget(undefined)).toBe(true)
  })

  /**
   * **잠금이 아니라 역할이 사라져야 한다.** 이름만 비교하던 때에는 군집화에서도
   * `등급`이 타깃으로 남아, `ColumnPicker`가 그 열의 특성 체크박스를 계속 잠갔다 —
   * 학생은 그 열을 특성으로 못 쓰고 이유도 못 들었다 (2026-08-29 전 경로 감사).
   */
  it('군집화에서는 저장된 타깃이 어떤 열도 타깃으로 안 만든다', () => {
    const plan = planFor({ taskType: 'clustering' })

    expect(plan.usesTarget).toBe(false)
    expect(plan.columns.map((one) => one.role)).toEqual(['feature', 'feature', 'unused'])
  })

  /** 그 열을 특성으로 고르는 길이 열려 있어야 한다. */
  it('군집화에서는 그 열도 특성이 된다', () => {
    const plan = planFor({ taskType: 'clustering', features: ['점수', '키', '등급'] })

    expect(plan.columns.map((one) => one.role)).toEqual(['feature', 'feature', 'feature'])
    expect(plan.usableFeatures).toBe(3)
  })

  /** **값은 안 지운다.** 분류로 되돌리면 고르던 타깃이 그대로 돌아온다. */
  it('분류로 되돌리면 타깃이 그대로 돌아온다', () => {
    expect(planFor({ taskType: 'classification' }).columns[2]?.role).toBe('target')
  })
})

describe('데이터를 나누는 유형인가', () => {
  it('군집화는 안 나눈다', () => {
    expect(splitsData('clustering')).toBe(false)
  })

  it('나머지 유형은 나눈다', () => {
    expect(splitsData('classification')).toBe(true)
    expect(splitsData('regression')).toBe(true)
  })

  /**
   * **아직 안 골랐으면 참이다.** 유형은 학습 화면에서 고르므로 전처리에서는 비어 있는
   * 것이 정상이고, 그때 손잡이를 감추면 고르지도 않은 것을 단정하게 된다.
   */
  it('아직 안 골랐으면 나눈다고 본다', () => {
    expect(splitsData(undefined)).toBe(true)
  })

  /**
   * **사실이 하나라는 것을 못으로 박는다.** 이미지 쪽 이름(`scoresWithTestImages`)은
   * "올린 사진이 채점에 쓰이는가"를 묻지만, 그 답은 "나누는가"와 같은 사실에서 나온다.
   * 한쪽만 고치면 표와 이미지가 다른 말을 한다.
   */
  it('테스트용 사진이 쓰이는가와 같은 답이다', () => {
    for (const taskType of [...TASK_TYPES, undefined]) {
      expect(scoresWithTestImages(taskType), taskType ?? '미정').toBe(splitsData(taskType))
    }
  })
})

/**
 * 열 표의 한 줄이 무엇을 말하고 어느 세기로 말하는가 (`ColumnPicker.vue`가 쓴다).
 *
 * **셋 다 화면 안에 있었고 아무도 안 봤다** (R14-4 감사 A-4). `column-picker.spec.ts`가
 * 64줄로 보는 것은 라디오가 잠기지 않는가뿐이고, 사유·색·잠금은 어느 파일에서도
 * 안 태워졌다. 그래서 우선순위를 통째로 뒤집어도, 색을 넓게 잡아도 초록이었다.
 */
describe('열 한 줄이 말하는 것', () => {
  /** 그 한 열만 뽑는다. 이름으로 찾아야 순서가 바뀌어도 안 흔들린다. */
  const columnNamed = (plan: ReturnType<typeof planFor>, name: string) =>
    plan.columns.find((one) => one.summary.name === name)!

  it('학습이 거부하는 것이 주의보다 먼저다 - 순서가 곧 우선순위다', () => {
    // 값이 한 종류(주의)이면서 수치가 아닌(거부) 열을 회귀 타깃으로 골랐다.
    const plan = planFor({
      taskType: 'regression',
      columns: [column({ name: '반', kind: 'categorical', unique: 1 })],
      target: '반',
      features: [],
    })
    expect(columnNote(columnNamed(plan, '반'))).toEqual({
      key: 'errors.TARGET_NOT_NUMERIC',
      param: 'target',
    })
  })

  it('고를 수 없는 특성이 가장 먼저다', () => {
    const plan = planFor({
      columns: [column({ name: '메모', kind: 'categorical', missing: 10, unique: 0 })],
      target: undefined,
      features: ['메모'],
    })
    expect(columnNote(columnNamed(plan, '메모'))?.key).toBe('errors.FEATURE_ALL_MISSING')
  })

  it('걸리는 것이 없으면 아무 말도 안 한다', () => {
    expect(columnNote(columnNamed(planFor(), '점수'))).toBeNull()
  })

  it('빨강은 학습이 거부할 때만이다 - 안 고른 열은 회색이다', () => {
    /**
     * `columnPlan`은 `targetIssue`를 **역할과 무관하게 모든 열에** 채운다. 그래서
     * 역할을 안 거르면 **안 고른 범주 열이 빨개진다** — 학생은 안 고쳐도 되는 것을
     * 고치려 든다. 같은 사실이 타깃 자리에서는 진짜로 빨강이어야 한다.
     */
    const chosen = planFor({
      taskType: 'regression',
      columns: [SCORE, GRADE],
      target: '등급',
      features: [],
    })
    expect(columnBlocks(columnNamed(chosen, '등급')), '타깃으로 골랐으면 빨강이다').toBe(true)

    // 값이 통째로 빈 열은 **고르면** 학습이 거부한다. 안 골랐으면 아무 일도 안 난다.
    const empty = column({ name: '메모', missing: 10, unique: 0 })
    const picked = planFor({ columns: [SCORE, empty], target: undefined, features: ['메모'] })
    expect(columnBlocks(columnNamed(picked, '메모')), '고른 열은 빨강이다').toBe(true)

    const skipped = planFor({ columns: [SCORE, empty], target: undefined, features: ['점수'] })
    expect(columnBlocks(columnNamed(skipped, '메모')), '안 고른 열은 회색이다').toBe(false)
  })

  it('타깃으로 쓰는 열은 특성 칸이 잠긴다', () => {
    const plan = planFor()
    expect(featureLocked(columnNamed(plan, '등급'))).toBe(true)
    expect(featureLocked(columnNamed(plan, '점수'))).toBe(false)
  })
})

/**
 * **유형이 뜻을 지우면 학습이 무시한다. 파일의 값은 안 건드린다**
 * (`open-decisions.md` "값을 내리지 않는다. 학습이 무시하고 화면이 잠근다").
 *
 * 전에는 유형을 바꿀 때 값을 `false`로 내렸고, **분류로 되돌려도 안 돌아왔다.**
 */
describe('층화가 실제로 걸리는가', () => {
  it('회귀에서는 켜져 있어도 안 걸린다', () => {
    expect(stratifyApplies('regression', true)).toBe(false)
  })

  it('분류로 돌아오면 켜 두었던 대로 살아난다', () => {
    expect(stratifyApplies('classification', true)).toBe(true)
    expect(stratifyApplies('classification', false)).toBe(false)
  })

  it('유형을 아직 모르면 값을 그대로 본다', () => {
    expect(stratifyApplies(undefined, true)).toBe(true)
  })
})
