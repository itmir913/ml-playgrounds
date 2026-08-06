/**
 * 예측의 이음매 둘 (architecture.md 8.13.1).
 *
 * **여기는 틀려도 에러가 안 나는 자리다.** 행이 한 줄 밀려도, 원-핫 열 순서가 어긋나도,
 * 다른 실험의 전처리기를 써도 예측은 그럴듯한 답을 낸다. 그래서 이 파일이 확인하는 것은
 * "던지는가"가 아니라 **같은 좌표계에 있는가**다.
 *
 * 그걸 확인하는 방법이 하나뿐이다 - **② 로 만든 벡터가 ① 의 같은 행과 완전히 같은가.**
 * 두 이음매가 같은 전처리기를 통과했다면 반드시 같아야 하고, 어느 한쪽만 틀려도
 * 그 순간 깨진다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { loadModel, REFERENCE_FORMAT } from '../src/ml/models'
import { inputVector, trainingRowsFor } from '../src/ml/predict'
import {
  fitPreprocessor,
  parsePreprocessor,
  PREPROCESSOR_FORMAT,
  type Dataset,
} from '../src/ml/preprocess'
import type { Experiment, Preprocessing } from '../src/project/schema'

/** 수치 둘·범주 하나. 범주가 있어야 원-핫으로 열이 늘어난다. */
const dataset: Dataset = {
  columns: ['키', '몸무게', '지역', '품종'],
  rows: [
    ['150', '40', '서울', 'a'],
    ['160', '50', '부산', 'b'],
    ['170', '60', '서울', 'a'],
    ['180', '70', '대구', 'b'],
    ['190', '80', '부산', 'a'],
  ],
}

const features = ['키', '몸무게', '지역']

function experiment(
  trainIndices: number[],
  preprocessing: Preprocessing,
  overrides: Partial<Experiment['settings']> = {},
): Experiment {
  return {
    id: 'experiment-1',
    startedAt: '2026-08-06T00:00:00.000Z',
    settings: {
      taskType: 'classification',
      runtime: 'mljs',
      selectedAlgorithms: [],
      features,
      target: '품종',
      preprocessing,
      split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
      trainIndices,
      testIndices: [],
      ...overrides,
    },
    runs: [],
  }
}

const onehot: Preprocessing = { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' }
const ordinal: Preprocessing = { missing: 'mean', scaling: 'none', categoricalEncoding: 'ordinal' }
const scaled: Preprocessing = {
  missing: 'mean',
  scaling: 'standard',
  categoricalEncoding: 'onehot',
}

/** 그 실험의 전처리기. 학습이 만드는 것과 같은 인자로 만든다. */
function fitFor(subject: Experiment) {
  return fitPreprocessor(
    dataset,
    subject.settings.trainIndices,
    subject.settings.features,
    subject.settings.preprocessing,
  )
}

/** 원본 행을 그대로 칸에 넣은 것. 학생이 [데이터에서 한 줄 가져오기]를 누른 상태다. */
function cellsOf(row: number): Record<string, string> {
  const values: Record<string, string> = {}
  dataset.columns.forEach((name, column) => {
    values[name] = dataset.rows[row]?.[column] ?? ''
  })
  return values
}

function codeOf(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    if (isClientError(error)) return error.code
    throw error
  }
  throw new Error('던지지 않았다')
}

describe('① 학습 행 만들기', () => {
  it('행 번호를 그대로 넘긴다 - 다시 매기면 참조형이 다른 행을 가리킨다', () => {
    const subject = experiment([0, 2, 4], onehot)
    const rows = trainingRowsFor(subject, fitFor(subject), dataset)

    expect(rows.indices).toEqual([0, 2, 4])
    expect(rows.features).toHaveLength(3)
    expect(rows.target).toEqual(['a', 'a', 'a'])
  })

  it('그 실험의 전처리기로 변환한다 - 학습셋에서만 파라미터가 나온다', () => {
    const subject = experiment([0, 1], scaled)
    const rows = trainingRowsFor(subject, fitFor(subject), dataset)

    // 학습셋이 키 150·160이므로 평균 155, 표준편차 5. 전체(150~190)로 맞췄다면 값이 다르다.
    expect(rows.features[0]?.[0]).toBeCloseTo(-1, 10)
    expect(rows.features[1]?.[0]).toBeCloseTo(1, 10)
  })

  it('벡터의 폭이 featureNames와 같다 - 원-핫으로 늘어난 만큼', () => {
    const subject = experiment([0, 1, 3], onehot)
    const preprocessor = fitFor(subject)
    const rows = trainingRowsFor(subject, preprocessor, dataset)

    // 키·몸무게 + 학습셋에서 본 지역 셋(서울·부산·대구)
    expect(preprocessor.featureNames).toEqual([
      '키',
      '몸무게',
      '지역=서울',
      '지역=부산',
      '지역=대구',
    ])
    expect(rows.features[0]).toHaveLength(5)
  })

  it('데이터에 없는 행 번호는 시끄럽게 실패한다 - 빈 행을 만들면 가짜 행이 된다', () => {
    const subject = experiment([0, 1], onehot)
    const preprocessor = fitFor(subject)
    const broken = experiment([0, 99], onehot)

    expect(codeOf(() => trainingRowsFor(broken, preprocessor, dataset))).toBe(
      'SPLIT_INDEX_OUT_OF_RANGE',
    )
  })

  it('타깃이 없으면 거부한다 - 정답 없이 이웃의 답을 셀 수 없다', () => {
    const subject = experiment([0, 1], onehot, { target: undefined })
    expect(codeOf(() => trainingRowsFor(subject, fitFor(subject), dataset))).toBe(
      'TARGET_NOT_SELECTED',
    )
  })

  it('인코딩이 어긋난 전처리기는 폭에서 잡힌다', () => {
    const fitted = experiment([0, 1, 3], onehot)
    // 같은 데이터·같은 열인데 인코딩만 다른 실험. 전처리기를 바꿔 끼우면 열 수가 갈린다.
    const other = experiment([0, 1, 3], ordinal)

    expect(codeOf(() => trainingRowsFor(other, fitFor(fitted), dataset))).toBe('MODEL_FILE_INVALID')
  })
})

describe('② 입력 한 줄을 특성 벡터로', () => {
  it('학습 때의 그 행과 완전히 같은 벡터가 나온다 - 두 이음매가 같은 좌표계다', () => {
    for (const preprocessing of [onehot, ordinal, scaled]) {
      const subject = experiment([0, 1, 3], preprocessing)
      const preprocessor = fitFor(subject)
      const rows = trainingRowsFor(subject, preprocessor, dataset)

      subject.settings.trainIndices.forEach((row, position) => {
        expect(inputVector(subject, preprocessor, cellsOf(row))).toEqual(rows.features[position])
      })
    }
  })

  it('원-핫 열의 순서가 featureNames의 순서다', () => {
    const subject = experiment([0, 1, 3], onehot)
    const preprocessor = fitFor(subject)
    // 학습셋에서 본 순서가 서울·부산·대구다. 부산이면 두 번째 자리만 1이다.
    const vector = inputVector(subject, preprocessor, {
      키: '160',
      몸무게: '50',
      지역: '부산',
    })

    expect(vector).toEqual([160, 50, 0, 1, 0])
  })

  it('빈 칸은 시끄럽게 거부한다 - 대체값으로 채우면 학생이 안 넣은 값으로 예측된다', () => {
    const subject = experiment([0, 1, 3], onehot)
    const preprocessor = fitFor(subject)

    expect(codeOf(() => inputVector(subject, preprocessor, { 키: '160', 지역: '부산' }))).toBe(
      'PREDICTION_INPUT_INCOMPLETE',
    )
    expect(
      codeOf(() => inputVector(subject, preprocessor, { 키: '160', 몸무게: '  ', 지역: '부산' })),
    ).toBe('PREDICTION_INPUT_INCOMPLETE')
  })

  it('학습에 안 쓰인 열은 칸도 없고, 있어도 무시된다', () => {
    // 범주형 인코딩을 끄면 '지역'이 excludedColumns로 빠진다.
    const subject = experiment([0, 1, 3], { ...onehot, categoricalEncoding: 'none' })
    const preprocessor = fitFor(subject)

    expect(preprocessor.excludedColumns).toEqual([{ name: '지역', reason: 'notEncodable' }])
    expect(inputVector(subject, preprocessor, { 키: '160', 몸무게: '50' })).toEqual([160, 50])
  })

  it('다른 실험의 전처리기를 쓰면 답이 갈린다 - 그래서 실험과 함께 골라야 한다', () => {
    const mine = experiment([0, 1], scaled)
    const other = experiment([3, 4], scaled)
    const cells = cellsOf(0)

    expect(inputVector(mine, fitFor(mine), cells)).not.toEqual(
      inputVector(mine, fitFor(other), cells),
    )
  })
})

describe('전처리기 파서', () => {
  it('저장했다 읽은 전처리기가 같은 벡터를 만든다', () => {
    const subject = experiment([0, 1, 3], scaled)
    const preprocessor = fitFor(subject)
    const revived = parsePreprocessor(JSON.parse(JSON.stringify(preprocessor)))

    expect(revived.format).toBe(PREPROCESSOR_FORMAT)
    expect(inputVector(subject, revived, cellsOf(0))).toEqual(
      inputVector(subject, preprocessor, cellsOf(0)),
    )
  })

  it('형식이 아닌 것은 거부한다 - 캐스팅으로 넘기면 한 칸 밀린 원-핫이 조용히 나온다', () => {
    expect(codeOf(() => parsePreprocessor({}))).toBe('MODEL_FILE_INVALID')
    expect(codeOf(() => parsePreprocessor({ format: 'mlpx-preprocess-v9' }))).toBe(
      'MODEL_FILE_INVALID',
    )
    expect(
      codeOf(() =>
        parsePreprocessor({
          format: PREPROCESSOR_FORMAT,
          columns: [{ name: '키', kind: 'numeric' }],
          featureNames: [42],
        }),
      ),
    ).toBe('MODEL_FILE_INVALID')
  })

  it('excludedColumns가 없는 파일도 읽는다 - 잃는 것은 화면의 한 줄뿐이다', () => {
    const revived = parsePreprocessor({
      format: PREPROCESSOR_FORMAT,
      columns: [{ name: '키', kind: 'numeric' }],
      featureNames: ['키'],
    })
    expect(revived.excludedColumns).toEqual([])
  })
})

describe('참조형 모델과 이어 붙이기', () => {
  it('① 이 만든 행으로 KNN이 학습 행을 그대로 맞힌다', () => {
    const subject = experiment([0, 1, 2, 3, 4], onehot)
    const preprocessor = fitFor(subject)
    const trainingRows = trainingRowsFor(subject, preprocessor, dataset)

    const predict = loadModel(
      {
        format: REFERENCE_FORMAT,
        k: 1,
        classes: ['a', 'b'],
        featureCount: preprocessor.featureNames.length,
        trainIndices: [0, 1, 2, 3, 4],
      },
      { trainingRows },
    )

    // 이웃이 하나면 자기 자신이므로 학습 행의 답은 그 행의 라벨이다. ② 로 만든 벡터를
    // 넣어도 같아야 한다 - 두 이음매가 어긋나면 여기서 답이 갈린다.
    const vectors = dataset.rows.map((_, row) => inputVector(subject, preprocessor, cellsOf(row)))
    expect(predict(vectors)).toEqual(['a', 'b', 'a', 'b', 'a'])
  })

  it('학습 행이 없으면 참조형만 못 쓴다 - 파일이 깨진 것이 아니다', () => {
    expect(
      codeOf(() =>
        loadModel({
          format: REFERENCE_FORMAT,
          k: 1,
          classes: ['a'],
          featureCount: 2,
          trainIndices: [0],
        }),
      ),
    ).toBe('MODEL_NEEDS_DATASET')
  })
})
