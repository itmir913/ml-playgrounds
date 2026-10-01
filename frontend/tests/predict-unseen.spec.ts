/**
 * **학습 때 못 본 값** (open-decisions.md 72, 2026-09-28 감사 F B-4).
 *
 * 범주 열에 학습 때 없던 값(`서울 `처럼 끝에 공백이 붙은 것도)이 오면 `transform`은 그 칸을
 * 원-핫 0 벡터나 순서 −1로 넣는다 — 예측은 나오지만 **모델이 그 값을 모르는 채로 낸 답이다.**
 * 경고가 없어서 학생은 그 답을 믿었다.
 *
 * 코드 소유자의 결정은 **표시만**이다. 예측 값·내려받는 CSV·계산은 그대로이고(공백을 떼지
 * 않는다), 그 답에 표시(`predict.tabular.unseenMark`)가 붙는다. 판정은 이 파일이 무는 순수 함수 하나이고,
 * 한 줄 예측과 파일 예측이 같은 것을 쓴다.
 */
import { describe, expect, it } from 'vitest'

import {
  predictDownloadGrid,
  predictPage,
  unseenCategories,
  type PredictableModel,
} from '../src/ml/predict'
import type { ProbaModel } from '../src/ml/models'
import { fitPreprocessor, type Dataset } from '../src/ml/preprocess'
import type { Experiment, Preprocessing, Run } from '../src/project/schema'

const dataset: Dataset = {
  columns: ['키', '지역', '품종'],
  rows: [
    ['150', '서울', 'a'],
    ['160', '부산', 'b'],
    ['170', '서울', 'a'],
    ['180', '부산', 'b'],
  ],
}

const onehot: Preprocessing = { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' }
const ordinal: Preprocessing = { missing: 'mean', scaling: 'none', categoricalEncoding: 'ordinal' }

function experimentWith(preprocessing: Preprocessing): Experiment {
  return {
    id: 'experiment-1',
    startedAt: '2026-09-29T00:00:00.000Z',
    settings: {
      taskType: 'classification',
      runtime: 'mljs',
      selectedAlgorithms: [],
      data: { features: ['키', '지역'], target: '품종', preprocessing },
      split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
      trainIndices: [0, 1, 2, 3],
      testIndices: [],
    },
    runs: [],
  }
}

const run = { id: 'r1', algorithm: 'decision_tree', status: 'succeeded' } as unknown as Run

describe('unseenCategories', () => {
  const preprocessor = fitPreprocessor(dataset, [0, 1, 2, 3], ['키', '지역'], onehot)

  it('본 값이면 아무것도 없다', () => {
    expect(unseenCategories(preprocessor, { 키: '150', 지역: '서울' })).toEqual([])
  })

  it('못 본 값이 든 범주 열의 이름을 낸다', () => {
    expect(unseenCategories(preprocessor, { 키: '150', 지역: '대구' })).toEqual(['지역'])
  })

  /** **공백을 떼지 않는다** — 계산이 떼지 않으므로 표시도 떼지 않고 본다. */
  it('끝에 공백이 붙은 값은 못 본 값이다 (계산이 그렇게 읽는다)', () => {
    expect(unseenCategories(preprocessor, { 키: '150', 지역: '서울 ' })).toEqual(['지역'])
  })

  it('수치 열은 보지 않는다 — 학습 범위 밖의 수는 못 본 값이 아니다', () => {
    expect(unseenCategories(preprocessor, { 키: '9999', 지역: '부산' })).toEqual([])
  })

  /** 빈 칸은 채움값이 들어가거나(`transform`) 앞에서 거절된다(`inputVector`) — 못 본 값이 아니다. */
  it('빈 칸은 못 본 값이 아니다', () => {
    expect(unseenCategories(preprocessor, { 키: '150', 지역: '  ' })).toEqual([])
    expect(unseenCategories(preprocessor, { 키: '150' })).toEqual([])
  })

  it('열 이름이 __proto__여도 제 값을 본다', () => {
    const proto: Dataset = {
      columns: ['__proto__'],
      rows: [['x'], ['y']],
    }
    const fitted = fitPreprocessor(proto, [0, 1], ['__proto__'], onehot)
    const values = Object.fromEntries([['__proto__', 'z']]) as Record<string, string>
    expect(unseenCategories(fitted, values)).toEqual(['__proto__'])
  })

  /**
   * **값 사전에 없는 열 이름이 `Object.prototype`의 이름이면** 색인 읽기가 함수를 주고
   * `.trim()`이 던진다 — `predictPage`의 catch가 그것을 `MODEL_FILE_INVALID`로 바꿔 멀쩡한 답이
   * 실패로 보인다. `own()`이 막는 자리다(`records.ts`). 위 `__proto__` 줄은 `fromEntries`가 자기
   * 속성을 만들어 이것을 못 문다.
   */
  it.each(['constructor', 'toString'])(
    '값 사전에 없는 %s 열은 빈 칸이다 — 던지지 않는다',
    (name) => {
      const table: Dataset = { columns: [name], rows: [['x'], ['y']] }
      const fitted = fitPreprocessor(table, [0, 1], [name], onehot)
      expect(unseenCategories(fitted, {})).toEqual([])
    },
  )
})

describe('파일 예측 — 표시만 붙고 답과 파일은 그대로다', () => {
  const noProba = new Map<string, ProbaModel>()
  /** 원-핫 0 벡터든 −1이든 그대로 답하는 모델. 답이 바뀌지 않는다는 것을 보려고 입력을 그대로 낸다. */
  const echo = (vectors: readonly (readonly number[])[]) =>
    vectors.map((vector) => vector.join('|'))

  for (const [name, preprocessing] of [
    ['원-핫', onehot],
    ['순서', ordinal],
  ] as const) {
    it(`${name} — 못 본 값의 칸에 열 이름이 붙고, 답은 전과 같다`, () => {
      const experiment = experimentWith(preprocessing)
      const preprocessor = fitPreprocessor(dataset, [0, 1, 2, 3], ['키', '지역'], preprocessing)
      const model: PredictableModel = { experiment, run }
      const rows = [
        { 키: '150', 지역: '서울' },
        { 키: '150', 지역: '서울 ' },
      ]
      const page = predictPage(
        [model],
        rows,
        new Map([[experiment.id, preprocessor]]),
        new Map([['r1', echo]]),
        noProba,
        dataset.columns,
      )

      expect(page[0]?.[0]).toEqual({ value: page[0]?.[0]?.value })
      expect(page[1]?.[0]?.unseen).toEqual(['지역'])
      // 계산은 그대로다 — transform이 못 본 값에 주던 0 벡터·−1이 그대로 모델에 들어간다.
      const expected = preprocessing === onehot ? '150|0|0' : '150|-1'
      expect(page[1]?.[0]?.value).toBe(expected)

      // 내려받는 파일에는 표시가 안 실린다 — 답 칸은 답 하나다.
      const grid = predictDownloadGrid(
        [model],
        ['모델'],
        [null],
        '행',
        rows,
        [],
        page,
        false,
        (value) => String(value),
      )
      expect(grid[2]).toEqual(['2', expected])
    })
  }

  it('답을 못 낸 칸에는 붙지 않는다', () => {
    const experiment = experimentWith(onehot)
    const preprocessor = fitPreprocessor(dataset, [0, 1, 2, 3], ['키', '지역'], onehot)
    const page = predictPage(
      [{ experiment, run }],
      [{ 키: '', 지역: '대구' }],
      new Map([[experiment.id, preprocessor]]),
      new Map([['r1', echo]]),
      noProba,
      dataset.columns,
    )
    expect(page[0]?.[0]?.failure?.code).toBe('PREDICTION_INPUT_INCOMPLETE')
    expect(page[0]?.[0]?.unseen).toBeUndefined()
  })
})
