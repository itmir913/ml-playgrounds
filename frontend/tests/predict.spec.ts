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
import { loadModel, REFERENCE_FORMAT, type ProbaModel } from '../src/ml/models'
import {
  answerRank,
  answersInClusters,
  rankAnswersAcross,
  clusterNumberOf,
  showsClusterNames,
  applyPredictFilter,
  assignAnswerColors,
  cellColorIndex,
  chosenProbability,
  defaultFilter,
  inputFields,
  isAllSelected,
  answerState,
  mergeFields,
  inputVector,
  numericRanges,
  predictDownloadGrid,
  predictPage,
  predictPageSignature,
  shuffled,
  toggleAllFilter,
  toggleFilter,
  rankAnswers,
  sampleRow,
  predictableModels,
  algorithmFilterOptions,
  experimentFilterOptions,
  filterAxisSignature,
  readPreprocessors,
  withPreprocessorReason,
  tallyClassificationAnswers,
  trainingRowsFor,
  type Answer,
  type PredictableModel,
} from '../src/ml/predict'
import type { Prediction } from '../src/ml/metrics'
import { experimentNames, experimentOrder } from '../src/ml/results'
import {
  fitPreprocessor,
  parsePreprocessor,
  PREPROCESSOR_FORMAT,
  type Dataset,
} from '../src/ml/preprocess'
import {
  dataSnapshot,
  type Experiment,
  type Preprocessing,
  type ProjectDocument,
  type Run,
} from '../src/project/schema'

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
      data: { features, target: '품종', preprocessing },
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
    dataSnapshot('tabular', subject.settings).features,
    dataSnapshot('tabular', subject.settings).preprocessing,
  )
}

/** 원본 행을 그대로 칸에 넣은 것. 학생이 [무작위로 하나 가져오기]를 누른 상태다. */
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
  throw new Error('it did not throw')
}

describe('① 훈련 행 만들기', () => {
  it('행 번호를 그대로 넘긴다 - 다시 매기면 참조형이 다른 행을 가리킨다', () => {
    const subject = experiment([0, 2, 4], onehot)
    const rows = trainingRowsFor(subject, fitFor(subject), dataset)

    expect(rows.indices).toEqual([0, 2, 4])
    expect(rows.features).toHaveLength(3)
    expect(rows.target).toEqual(['a', 'a', 'a'])
  })

  it('그 실험의 전처리기로 변환한다 - 훈련 데이터에서만 파라미터가 나온다', () => {
    const subject = experiment([0, 1], scaled)
    const rows = trainingRowsFor(subject, fitFor(subject), dataset)

    // 훈련 데이터가 키 150·160이므로 평균 155, 표준편차 5. 전체(150~190)로 맞췄다면 값이 다르다.
    expect(rows.features[0]?.[0]).toBeCloseTo(-1, 10)
    expect(rows.features[1]?.[0]).toBeCloseTo(1, 10)
  })

  it('벡터의 폭이 featureNames와 같다 - 원-핫으로 늘어난 만큼', () => {
    const subject = experiment([0, 1, 3], onehot)
    const preprocessor = fitFor(subject)
    const rows = trainingRowsFor(subject, preprocessor, dataset)

    // 키·몸무게 + 훈련 데이터에서 본 지역 셋(서울·부산·대구)
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
    const subject = experiment([0, 1], onehot, { data: { features, preprocessing: onehot } })
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
    // 훈련 데이터에서 본 순서가 서울·부산·대구다. 부산이면 두 번째 자리만 1이다.
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
  it('① 이 만든 행으로 KNN이 훈련 행을 그대로 맞힌다', () => {
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

    // 이웃이 하나면 자기 자신이므로 훈련 행의 답은 그 행의 라벨이다. ② 로 만든 벡터를
    // 넣어도 같아야 한다 - 두 이음매가 어긋나면 여기서 답이 갈린다.
    const vectors = dataset.rows.map((_, row) => inputVector(subject, preprocessor, cellsOf(row)))
    expect(predict(vectors)).toEqual(['a', 'b', 'a', 'b', 'a'])
  })

  it('훈련 행이 없으면 참조형만 못 쓴다 - 파일이 깨진 것이 아니다', () => {
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

describe('칸 서술', () => {
  it('수치는 숫자 칸, 범주는 학습 때 본 값 중에서 고르는 칸이다', () => {
    const subject = experiment([0, 1, 3], onehot)
    expect(inputFields(fitFor(subject))).toEqual([
      { name: '키', kind: 'numeric' },
      { name: '몸무게', kind: 'numeric' },
      // 순서가 원-핫 열의 순서와 같다. 자유 입력이면 오타가 미지의 범주가 된다.
      { name: '지역', kind: 'categorical', options: ['서울', '부산', '대구'] },
    ])
  })

  it('학습에 안 쓰인 열은 칸도 없다 - 넣어도 안 보는 값을 묻지 않는다', () => {
    const subject = experiment([0, 1, 3], { ...onehot, categoricalEncoding: 'none' })
    expect(inputFields(fitFor(subject)).map((field) => field.name)).toEqual(['키', '몸무게'])
  })

  it('순서형에도 고를 값이 있다 - 인코딩은 저장 방식이지 입력 방식이 아니다', () => {
    const subject = experiment([0, 1, 3], ordinal)
    const 지역 = inputFields(fitFor(subject)).find((field) => field.name === '지역')
    expect(지역?.options).toEqual(['서울', '부산', '대구'])
  })
})

describe('표에서 한 줄 가져오기', () => {
  /** 뽑을 후보 중 `position`번째를 고르는 난수원. 어느 줄을 뽑는지 확인할 수 있다. */
  const picks = (position: number) => () => position / 100

  it('테스트에 쓴 행에서 뽑는다 - 학습한 행을 다시 맞히는 장면은 아무것도 안 가르친다', () => {
    const subject = experiment([0, 1, 3], onehot, { testIndices: [2, 4] })
    const fields = inputFields(fitFor(subject))

    // 난수를 어느 쪽으로 돌려도 테스트 행 밖으로는 안 나간다.
    expect(sampleRow(subject, fields, { dataset }, undefined, () => 0)?.index).toBe(2)
    expect(sampleRow(subject, fields, { dataset }, undefined, () => 0.99)?.index).toBe(4)
  })

  it('가져온 줄의 값이 그 행 그대로다', () => {
    const subject = experiment([0, 1, 3], onehot, { testIndices: [2, 4] })
    const sample = sampleRow(subject, inputFields(fitFor(subject)), { dataset }, undefined, () => 0)

    expect(sample?.values).toEqual({ 키: '170', 몸무게: '60', 지역: '서울' })
  })

  it('직전에 준 줄은 빼고 뽑는다 - 눌렀는데 그대로면 고장으로 읽힌다', () => {
    const subject = experiment([0], onehot, { testIndices: [2, 4] })
    const fields = inputFields(fitFor(subject))

    // 후보가 둘인데 하나를 빼면 남는 것은 하나다. 난수를 어떻게 돌려도 그것이 나온다.
    expect(sampleRow(subject, fields, { dataset }, 2, () => 0)?.index).toBe(4)
    expect(sampleRow(subject, fields, { dataset }, 2, () => 0.99)?.index).toBe(4)
    expect(sampleRow(subject, fields, { dataset }, 4, () => 0)?.index).toBe(2)
  })

  it('뽑을 것이 하나뿐이면 그것을 다시 준다 - 없는 것을 지어내지 않는다', () => {
    const subject = experiment([0, 1, 3], onehot, { testIndices: [2] })
    const fields = inputFields(fitFor(subject))

    expect(sampleRow(subject, fields, { dataset }, 2, () => 0)?.index).toBe(2)
  })

  it('난수가 1을 줘도 범위를 안 벗어난다', () => {
    const subject = experiment([0, 1], onehot, { testIndices: [2, 4] })
    const fields = inputFields(fitFor(subject))

    expect(sampleRow(subject, fields, { dataset }, undefined, () => 1)?.index).toBe(4)
  })

  it('테스트 행이 없으면 훈련 행뿐이다 - 없는 것을 지어내지 않는다', () => {
    const subject = experiment([0, 1], onehot, { testIndices: [] })
    const fields = inputFields(fitFor(subject))

    expect(sampleRow(subject, fields, { dataset }, undefined, picks(0))?.index).toBe(0)
    expect(sampleRow(subject, fields, { dataset }, undefined, picks(60))?.index).toBe(1)
  })

  it('가져올 줄이 아예 없으면 null이다', () => {
    const subject = experiment([], onehot, { testIndices: [] })
    expect(sampleRow(subject, [], { dataset })).toBeNull()
  })

  /**
   * **`provided`에서는 testIndices가 다른 표의 행 번호다** (mlpx-spec.md §1.1).
   *
   * 열 이름과 순서는 양쪽이 같으므로(정본 순서로 재배열해 저장한다) 잘못된 표에서 뽑아도
   * 값이 그럴듯하게 채워지고 **화면에는 틀린 티가 전혀 안 난다.** 그래서 여기서 못 박는다.
   */
  describe('테스트 데이터가 파일로 온 실험', () => {
    const testDataset: Dataset = {
      columns: ['키', '몸무게', '지역', '품종'],
      rows: [
        ['101', '11', '서울', 'a'],
        ['102', '12', '부산', 'b'],
        ['103', '13', '대구', 'a'],
      ],
    }

    const providedExperiment = () =>
      experiment([0, 1, 2, 3, 4], onehot, {
        split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
        testIndices: [0, 1, 2],
      })

    it('테스트 표에서 뽑는다 - 훈련 표에서 뽑으면 모델이 외운 행을 준다', () => {
      const subject = providedExperiment()
      const fields = inputFields(fitFor(subject))
      const sample = sampleRow(subject, fields, { dataset, testDataset }, undefined, picks(0))

      // 훈련 표의 0번은 키 150이다. 테스트 표의 0번이 나와야 한다.
      expect(sample?.values).toEqual({ 키: '101', 몸무게: '11', 지역: '서울' })
    })

    it('테스트 표가 훈련 표보다 길어도 뽑는다 - 훈련 표를 보면 여기서 조용히 null이 된다', () => {
      const longer: Dataset = {
        columns: testDataset.columns,
        rows: [...testDataset.rows, ['104', '14', '서울', 'b'], ['105', '15', '부산', 'a']],
      }
      const subject = experiment([0, 1], onehot, {
        split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
        // 훈련 표는 5행뿐이라 이 번호들은 그쪽에서 못 찾는다.
        testIndices: [3, 4],
      })
      const fields = inputFields(fitFor(subject))

      expect(
        sampleRow(subject, fields, { dataset, testDataset: longer }, undefined, picks(0))?.index,
      ).toBe(3)
    })

    it('테스트 표가 없으면 null이다 - 훈련 표로 조용히 떨어지지 않는다', () => {
      const subject = providedExperiment()
      const fields = inputFields(fitFor(subject))

      expect(sampleRow(subject, fields, { dataset }, undefined, picks(0))).toBeNull()
    })

    it('훈련 행으로 떨어질 때는 훈련 표를 본다 - trainIndices는 언제나 data.csv다', () => {
      const subject = experiment([0, 1], onehot, {
        split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
        testIndices: [],
      })
      const fields = inputFields(fitFor(subject))
      const sample = sampleRow(subject, fields, { dataset, testDataset }, undefined, picks(0))

      expect(sample?.values).toEqual({ 키: '150', 몸무게: '40', 지역: '서울' })
    })
  })

  it('가져온 줄이 그대로 벡터가 된다 - 한두 칸만 바꿔 보는 길이 여기서 열린다', () => {
    const subject = experiment([0, 1, 3], scaled, { testIndices: [2] })
    const preprocessor = fitFor(subject)
    const sample = sampleRow(subject, inputFields(preprocessor), { dataset })

    expect(() => inputVector(subject, preprocessor, sample?.values ?? {})).not.toThrow()
  })
})

describe('예측에 쓸 수 있는 모델', () => {
  const modelRef = (format: string) => ({
    format,
    path: 'model/run-1.json',
    includesPreprocessing: false,
    sizeBytes: 10,
  })

  function documentWith(runs: Run[], preprocessor = true): ProjectDocument {
    const subject = experiment([0, 1], onehot)
    return {
      manifest: {
        formatVersion: 1,
        appVersion: '0.0.0',
        projectId: '11111111-1111-4111-8111-111111111111',
        name: '테스트',
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        kind: 'machineLearning',
        dataType: 'tabular',
        locale: 'ko',
      },
      settings: {
        data: { features, target: '품종', preprocessing: onehot },
        split: subject.settings.split,
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: {
        experiments: [
          {
            ...subject,
            runs,
            ...(preprocessor
              ? { preprocessor: { format: 'mlpx-preprocess-v1', path: 'model/p.json' } }
              : {}),
          },
        ],
      },
      portfolio: {
        template: { sections: [] },
        answerFormat: 'plain-v1',
        answers: {},
        attachments: {},
      },
    }
  }

  const base: Run = {
    id: 'run-1',
    algorithm: 'decision_tree',
    hyperparameters: {},
    computedBy: 'browser',
    trainedAt: '2026-08-06T00:00:00.000Z',
    status: 'done',
    metrics: { accuracy: 1 },
  }

  it('담긴 모델은 쓸 수 있다', () => {
    const list = predictableModels(
      documentWith([{ ...base, model: modelRef('mlpx-tree-v1') }]),
      true,
    )
    expect(list).toHaveLength(1)
    expect(list[0]?.reason).toBeUndefined()
  })

  /**
   * **최신 실험이 위다.** `.reverse()` 한 줄에 화면 셋이 매여 있다 — 예측 목록의 순서,
   * 필터 칩의 순서(`experimentFilterOptions`가 "모델 목록에 나오는 순서"를 지킨다고
   * 적는다), 그리고 입력 칸의 순서(`mergeFields`가 "최신 실험이 앞에 오도록 넘기면
   * 화면의 칸 순서가 지금 설정과 같아진다"고 적는다).
   *
   * 그 줄을 지워도 `lifecycle.spec.ts`를 포함해 저장소 전체가 초록이었다
   * (R13-5 감사 C-2).
   */
  it('최신 실험이 위다 - 화면 셋의 순서가 이 줄에 매여 있다', () => {
    const document = documentWith([base])
    const older = document.runs.experiments[0]!
    document.runs.experiments = [
      { ...older, id: 'experiment-old', runs: [{ ...base, id: 'run-old' }] },
      { ...older, id: 'experiment-new', runs: [{ ...base, id: 'run-new' }] },
    ]

    const list = predictableModels(document, true)

    expect(list.map((one) => one.experiment.id)).toEqual(['experiment-new', 'experiment-old'])
  })

  it('실패한 run은 목록에 없다 - 지표조차 없는 줄이다', () => {
    const failed: Run = {
      ...base,
      status: 'failed',
      metrics: undefined,
      failure: { code: 'JOB_FAILED' },
    }
    expect(predictableModels(documentWith([failed]), true)).toEqual([])
  })

  it('사유 셋이 서로 다른 말이다 - 학생이 할 수 있는 일이 다르다', () => {
    // 이 빌드가 모르는 형식. 앱을 최신으로 바꾸면 된다.
    expect(
      predictableModels(documentWith([{ ...base, model: modelRef('onnx-v1') }]), true)[0]?.reason,
    ).toBe('MODEL_FORMAT_UNSUPPORTED')

    // 참조형인데 원본 데이터가 없다. 데이터를 가진 파일로 다시 열면 된다.
    expect(
      predictableModels(documentWith([{ ...base, model: modelRef(REFERENCE_FORMAT) }]), false)[0]
        ?.reason,
    ).toBe('MODEL_NEEDS_DATASET')

    // 모델이 아예 안 담겼다. 예산에서 밀린 것이고 지표만 남았다.
    expect(
      predictableModels(documentWith([{ ...base, modelOmitted: 'overBudget' }]), true)[0]?.reason,
    ).toBe('MODEL_FILE_INVALID')
  })

  it('참조형은 데이터가 있으면 쓸 수 있다 - 형식 이름으로 가르지 않는다', () => {
    const list = predictableModels(
      documentWith([{ ...base, model: modelRef(REFERENCE_FORMAT) }]),
      true,
    )
    expect(list[0]?.reason).toBeUndefined()
  })

  it('전처리기가 없으면 자체 JSON 모델은 좌표계를 못 세운다', () => {
    const list = predictableModels(
      documentWith([{ ...base, model: modelRef('mlpx-tree-v1') }], false),
      true,
    )
    expect(list[0]?.reason).toBe('MODEL_FILE_INVALID')
  })
})

describe('여러 실험의 칸을 합친다', () => {
  it('합집합이다 - 교집합으로 하면 열을 더 쓴 실험의 모델이 통째로 빠진다', () => {
    const wide = inputFields(fitFor(experiment([0, 1, 3], onehot)))
    const narrow = inputFields(fitFor(experiment([0, 1, 3], onehot, { features: ['키'] })))

    expect(mergeFields([narrow, wide]).map((field) => field.name)).toEqual(['키', '몸무게', '지역'])
  })

  it('범주 목록도 합친다 - 훈련 데이터가 달라 못 본 값이 있다', () => {
    const seoulBusan = inputFields(fitFor(experiment([0, 1], onehot)))
    const daegu = inputFields(fitFor(experiment([3], onehot)))
    const merged = mergeFields([seoulBusan, daegu])

    expect(merged.find((field) => field.name === '지역')?.options).toEqual(['서울', '부산', '대구'])
  })

  /**
   * **겹치는 값이 있어야 중복 제거가 일을 한다.** 위 검사의 두 목록은 겹치는 값이 하나도
   * 없어 `includes` 가드가 항등이었고, 지워도 저장소 전체가 초록이었다 (R13-5 감사 C-1).
   *
   * **실물은 겹치는 것이 정상이다** — 같은 데이터로 여러 번 학습한 실험들이라 범주가
   * 거의 같다. 그때 예측 화면의 드롭다운이 `서울 · 부산 · 서울 · 부산 · 대구`가 된다.
   */
  it('겹치는 범주를 두 번 담지 않는다', () => {
    const seoulBusan = inputFields(fitFor(experiment([0, 1], onehot)))
    const all = inputFields(fitFor(experiment([0, 1, 3], onehot)))

    const merged = mergeFields([seoulBusan, all])

    expect(merged.find((field) => field.name === '지역')?.options).toEqual(['서울', '부산', '대구'])
  })

  it('먼저 나온 순서를 지킨다 - 최신 실험을 앞에 주면 화면이 지금 설정을 따른다', () => {
    const full = inputFields(fitFor(experiment([0, 1, 3], onehot)))
    const reordered = [...full].reverse()
    expect(mergeFields([reordered, full]).map((field) => field.name)).toEqual([
      '지역',
      '몸무게',
      '키',
    ])
  })
})

describe('수치 칸의 값 범위', () => {
  it('표 전체에서 구한다 - 학생이 표에서 본 범위와 같아야 한다', () => {
    const subject = experiment([0, 1], onehot)
    const ranges = numericRanges([dataset], inputFields(fitFor(subject)))

    // 훈련 데이터는 150~160뿐이지만 표에는 150~190이 있다.
    expect(ranges.get('키')).toEqual({ min: 150, max: 190 })
    expect(ranges.get('몸무게')).toEqual({ min: 40, max: 80 })
  })

  it('테스트 파일까지 함께 본다 - 가져온 값이 힌트 범위 밖에 있으면 안 된다', () => {
    const subject = experiment([0, 1], onehot)
    const provided: Dataset = {
      columns: ['키', '몸무게', '지역'],
      rows: [['200', '30', '서울']],
    }

    const ranges = numericRanges([dataset, provided], inputFields(fitFor(subject)))

    expect(ranges.get('키')).toEqual({ min: 150, max: 200 })
    expect(ranges.get('몸무게')).toEqual({ min: 30, max: 80 })
  })

  it('열 순서가 달라도 이름으로 찾는다', () => {
    const subject = experiment([0, 1], onehot)
    const swapped: Dataset = { columns: ['몸무게', '키'], rows: [['30', '200']] }

    const ranges = numericRanges([dataset, swapped], inputFields(fitFor(subject)))

    expect(ranges.get('키')).toEqual({ min: 150, max: 200 })
  })

  it('범주 칸에는 범위가 없다 - 고를 것이 이미 목록에 있다', () => {
    const subject = experiment([0, 1, 3], onehot)
    expect(numericRanges([dataset], inputFields(fitFor(subject))).has('지역')).toBe(false)
  })

  it('숫자가 하나도 없는 열은 아무 말도 안 한다', () => {
    const empty: Dataset = { columns: ['키'], rows: [[''], ['  ']] }
    expect(numericRanges([empty], [{ name: '키', kind: 'numeric' }]).size).toBe(0)
  })
})

/** run 하나. 필터·집계 테스트는 알고리즘과 id만 있으면 된다. */
function runOf(id: string, algorithm = 'decision_tree'): Run {
  return {
    id,
    algorithm,
    hyperparameters: {},
    computedBy: 'browser',
    trainedAt: '2026-08-06T00:00:00.000Z',
    status: 'done',
    metrics: {},
  }
}

describe('필터 (architecture.md 8.13.1 "답을 거르고 세어 본다")', () => {
  it('기본값은 지금 있는 모델이 전부 보이는 상태다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [
      { experiment: subject, run: runOf('r1', 'decision_tree') },
      { experiment: subject, run: runOf('r2', 'knn') },
    ]

    expect(applyPredictFilter(models, defaultFilter(models))).toEqual(models)
  })

  it('실험과 알고리즘 둘 다 걸려야 보인다', () => {
    const exp1 = { ...experiment([0], onehot), id: 'exp-1' }
    const exp2 = { ...experiment([0], onehot), id: 'exp-2' }
    const models: PredictableModel[] = [
      { experiment: exp1, run: runOf('r1', 'decision_tree') },
      { experiment: exp1, run: runOf('r2', 'knn') },
      { experiment: exp2, run: runOf('r3', 'decision_tree') },
    ]

    const filter = { experimentIds: new Set(['exp-1']), algorithms: new Set(['decision_tree']) }
    expect(applyPredictFilter(models, filter).map((model) => model.run.id)).toEqual(['r1'])
  })

  it('둘 다 꺼지면 아무것도 안 보인다 - 지어낸 승자를 강조하지 않는다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [{ experiment: subject, run: runOf('r1') }]
    const filter = { experimentIds: new Set<string>(), algorithms: new Set<string>() }

    expect(applyPredictFilter(models, filter)).toEqual([])
  })
})

describe('축을 켜고 끈다 (architecture.md 8.13.1 "답을 거르고 세어 본다")', () => {
  const base = { experimentIds: new Set(['exp-1', 'exp-2']), algorithms: new Set(['knn']) }

  it('칩 하나를 끄면 그 축에서만 빠진다', () => {
    const next = toggleFilter(base, 'experiment', 'exp-1')

    expect([...next.experimentIds]).toEqual(['exp-2'])
    expect([...next.algorithms]).toEqual(['knn'])
  })

  it('꺼진 칩을 누르면 다시 켜진다', () => {
    const off = toggleFilter(base, 'algorithm', 'knn')

    expect([...toggleFilter(off, 'algorithm', 'knn').algorithms]).toEqual(['knn'])
  })

  it('전부 켜져 있으면 전체 버튼이 끈다', () => {
    const next = toggleAllFilter(base, 'experiment', ['exp-1', 'exp-2'])

    expect([...next.experimentIds]).toEqual([])
  })

  it('하나라도 꺼져 있으면 전체 버튼이 전부 켠다', () => {
    const some = toggleFilter(base, 'experiment', 'exp-1')
    const next = toggleAllFilter(some, 'experiment', ['exp-1', 'exp-2'])

    expect([...next.experimentIds].sort()).toEqual(['exp-1', 'exp-2'])
  })

  it('버튼 이름과 동작이 같은 판정을 본다', () => {
    expect(isAllSelected(base, 'experiment', ['exp-1', 'exp-2'])).toBe(true)
    expect(isAllSelected(base, 'experiment', ['exp-1', 'exp-2', 'exp-3'])).toBe(false)
  })

  it('켤 것이 없으면 전부 켜진 것도 아니다 - 빈 축에 [전체 해제]가 뜨면 안 된다', () => {
    expect(isAllSelected(base, 'experiment', [])).toBe(false)
  })
})

describe('분류 답의 집계 (architecture.md 8.13.1)', () => {
  it('분류 답만 센다 - 회귀는 값이 거의 안 겹쳐서 집계가 장식이 된다', () => {
    const classification = experiment([0], onehot)
    const regression = experiment([0], onehot, { taskType: 'regression' })
    const models: PredictableModel[] = [
      { experiment: classification, run: runOf('r1') },
      { experiment: classification, run: runOf('r2') },
      { experiment: regression, run: runOf('r3') },
    ]
    const answers = new Map<string, Answer>([
      ['r1', { value: 'a' }],
      ['r2', { value: 'a' }],
      ['r3', { value: 3.14 }],
    ])

    expect(tallyClassificationAnswers(models, answers)).toEqual([{ value: 'a', count: 2 }])
  })

  it('답을 낸 모델만 센다 - 실패했거나 아직 안 돈 모델은 표에 안 든다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [
      { experiment: subject, run: runOf('r1') },
      { experiment: subject, run: runOf('r2') },
    ]
    const answers = new Map<string, Answer>([['r1', { value: 'a' }]])

    expect(tallyClassificationAnswers(models, answers)).toEqual([{ value: 'a', count: 1 }])
  })
})

describe('답 값별 등수 - 갈림표 칩과 카드가 같은 색을 쓰기 위한 것 (architecture.md 8.13.1)', () => {
  it('개수가 많은 값이 0등이다', () => {
    const ranks = rankAnswers([
      { value: 'a', count: 3 },
      { value: 'b', count: 1 },
    ])
    expect(ranks?.get('a')).toBe(0)
    expect(ranks?.get('b')).toBe(1)
  })

  it('동점이어도 등수를 매긴다 - 1등이 누군지는 몰라도 서로 다른 색이면 된다', () => {
    const ranks = rankAnswers([
      { value: 'a', count: 2 },
      { value: 'b', count: 2 },
    ])
    expect(ranks?.size).toBe(2)
    expect(ranks?.get('a')).not.toBe(ranks?.get('b'))
  })

  it('값이 하나뿐이면 없다 - 갈리지 않은 것에 색을 매기지 않는다', () => {
    expect(rankAnswers([{ value: 'a', count: 5 }])).toBeNull()
  })

  it('답이 하나도 없으면 없다', () => {
    expect(rankAnswers([])).toBeNull()
  })

  /**
   * **두 모델이 `taskType`에서만 갈려야 한다** (R7 감사 B-11). 회귀 쪽 답을 `3.14`로
   * 두었더니 **답 값이 `ranks`에 있는지도 함께 갈려서**, `taskType` 검사를 통째로 지워도
   * `ranks.get(3.14) ?? null`이 `null`을 주어 초록이었다.
   *
   * 답을 분류와 같은 `'b'`로 두면 남는 축이 하나다.
   */
  it('모델의 답 등수는 분류에만, 등수가 있을 때만 있다', () => {
    const classification = experiment([0], onehot)
    const regression = experiment([0], onehot, { taskType: 'regression' })
    const models: PredictableModel[] = [
      { experiment: classification, run: runOf('r1') },
      { experiment: regression, run: runOf('r2') },
    ]
    const answers = new Map<string, Answer>([
      ['r1', { value: 'b' }],
      ['r2', { value: 'b' }],
    ])
    const ranks = rankAnswers([
      { value: 'a', count: 3 },
      { value: 'b', count: 1 },
    ])

    expect(answerRank(models[0]!, answers, ranks)).toBe(1)
    expect(answerRank(models[1]!, answers, ranks)).toBeNull()
  })

  it('답이 없는 모델은 등수도 없다', () => {
    const subject = experiment([0], onehot)
    const model: PredictableModel = { experiment: subject, run: runOf('r1') }
    const ranks = rankAnswers([
      { value: 'a', count: 3 },
      { value: 'b', count: 1 },
    ])

    expect(answerRank(model, new Map(), ranks)).toBeNull()
  })

  /** 셀 것이 없으면 등수도 없다. `rankAnswers`가 `null`을 주는 자리와 짝이다. */
  it('등수표가 없으면 등수도 없다', () => {
    const subject = experiment([0], onehot)
    const model: PredictableModel = { experiment: subject, run: runOf('r1') }
    const answers = new Map([['r1', { value: 'a', kind: 'label' } as Answer]])

    expect(answerRank(model, answers, null)).toBeNull()
  })
})

describe('일괄 예측 표의 값별 색 배정 - 등수가 아니라 처음 본 순서다 (architecture.md 8.13.1)', () => {
  it('처음 보는 값에 순서대로 색을 준다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [{ experiment: subject, run: runOf('r1') }]
    const rows: Answer[][] = [[{ value: 'b' }], [{ value: 'a' }]]

    const assigned = assignAnswerColors(models, rows, new Map(), 7)

    expect(assigned.get('b')).toBe(0)
    expect(assigned.get('a')).toBe(1)
  })

  it('이미 배정된 값은 다시 안 바꾼다 - 페이지를 오가도 색이 그대로다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [{ experiment: subject, run: runOf('r1') }]
    const existing = new Map([['a', 0]])
    const rows: Answer[][] = [[{ value: 'b' }], [{ value: 'a' }]]

    const assigned = assignAnswerColors(models, rows, existing, 7)

    expect(assigned.get('a')).toBe(0)
    expect(assigned.get('b')).toBe(1)
  })

  it('최대치를 넘으면 더 안 준다 - 그 값은 색 없이 남는다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [{ experiment: subject, run: runOf('r1') }]
    const rows: Answer[][] = [[{ value: 'a' }], [{ value: 'b' }], [{ value: 'c' }]]

    const assigned = assignAnswerColors(models, rows, new Map(), 2)

    expect(assigned.get('a')).toBe(0)
    expect(assigned.get('b')).toBe(1)
    expect(assigned.has('c')).toBe(false)
  })

  it('회귀 모델의 값은 건너뛴다', () => {
    const subject = experiment([0], onehot, { taskType: 'regression' })
    const models: PredictableModel[] = [{ experiment: subject, run: runOf('r1') }]
    const rows: Answer[][] = [[{ value: 3.14 }]]

    const assigned = assignAnswerColors(models, rows, new Map(), 7)

    expect(assigned.size).toBe(0)
  })

  it('여러 모델이 섞인 행에서 열마다 값을 본다', () => {
    const classification = experiment([0], onehot)
    const models: PredictableModel[] = [
      { experiment: classification, run: runOf('r1') },
      { experiment: classification, run: runOf('r2') },
    ]
    const rows: Answer[][] = [[{ value: 'a' }, { value: 'b' }]]

    const assigned = assignAnswerColors(models, rows, new Map(), 7)

    expect(assigned.get('a')).toBe(0)
    expect(assigned.get('b')).toBe(1)
  })

  it('바뀐 게 없으면 같은 맵을 그대로 돌려준다', () => {
    const subject = experiment([0], onehot)
    const models: PredictableModel[] = [{ experiment: subject, run: runOf('r1') }]
    const existing = new Map([['a', 0]])
    const rows: Answer[][] = [[{ value: 'a' }]]

    expect(assignAnswerColors(models, rows, existing, 7)).toBe(existing)
  })

  /**
   * **칠하는 쪽에도 같은 주장이 있어야 한다.** 배정은 회귀를 건너뛰는데 칠하기가 안
   * 건너뛰면, 배정된 색과 우연히 같은 수치를 낸 회귀 열에 분류 색이 칠해진다 - 일괄
   * 예측 표는 여러 실험의 모델이 열로 섞여 서므로(architecture.md §8.13.1) 유형은
   * 모델(열)마다 봐야 한다.
   */
  it('회귀 열에는 색을 안 칠한다', () => {
    const classification = experiment([0], onehot)
    const regression = experiment([0], onehot, { taskType: 'regression' })
    const colors = new Map<Prediction, number>([
      ['a', 0],
      [3.14, 1],
    ])

    expect(cellColorIndex({ experiment: classification, run: runOf('r1') }, 'a', colors)).toBe(0)
    expect(cellColorIndex({ experiment: regression, run: runOf('r2') }, 3.14, colors)).toBeNull()
  })

  it('값이 없는 칸에도 색이 없다', () => {
    const classification = experiment([0], onehot)
    const colors = new Map<Prediction, number>([['a', 0]])

    expect(
      cellColorIndex({ experiment: classification, run: runOf('r1') }, undefined, colors),
    ).toBeNull()
  })
})

describe('일괄 예측 (open-decisions.md "일괄 예측은 행 × 모델 매트릭스다")', () => {
  const subject = experiment([0, 1, 2, 3, 4], onehot)
  const preprocessor = fitFor(subject)
  const preprocessors = new Map([[subject.id, preprocessor]])

  /** 붙여 둔 predict.csv의 열. **올린 열을 전부 담으므로 안 쓰는 열도 함께 있다.** */
  const fileColumns = dataset.columns

  const model: PredictableModel = { experiment: subject, run: runOf('r1') }
  // '키' 하나만 보는 결정트리 흉내 - 몸무게·지역이 비어도 이 모델은 예측할 수 있다.
  const predictor = (vectors: readonly (readonly number[])[]) =>
    vectors.map((vector) => ((vector[0] ?? 0) > 165 ? 'b' : 'a'))
  const predictors = new Map([['r1', predictor]])
  /** 확률을 내는 모델이 없는 경우. 아래 검사는 대부분 확률과 무관하다. */
  const noProba = new Map<string, ProbaModel>()

  it('행마다 모델의 답을 낸다', () => {
    const rows = [cellsOf(0), cellsOf(3)]
    const page = predictPage([model], rows, preprocessors, predictors, noProba, fileColumns)

    expect(page).toHaveLength(2)
    expect(page[0]?.[0]).toEqual({ value: 'a' }) // 키 150
    expect(page[1]?.[0]).toEqual({ value: 'b' }) // 키 180
  })

  it('빈 칸이 있는 행은 그 행·그 모델 칸만 예측할 수 없다 - 나머지 행은 계속 간다', () => {
    const rows = [cellsOf(0), { 키: '160' }, cellsOf(2)]
    const page = predictPage([model], rows, preprocessors, predictors, noProba, fileColumns)

    expect(page[0]?.[0]?.value).toBe('a')
    expect(page[1]?.[0]?.failure?.code).toBe('PREDICTION_INPUT_INCOMPLETE')
    expect(page[2]?.[0]?.value).toBe('b')
  })

  it('모델이 보는 열이 파일에 없으면 빈 칸이 아니라 열이 없다고 말한다', () => {
    // 파일을 붙인 뒤 학생이 특성을 바꿔 재학습한 상태. 붙일 때는 통과했던 파일이다.
    const without = ['몸무게', '지역', '품종']
    const rows = [cellsOf(0)].map((values) => {
      const kept: Record<string, string> = { ...values }
      delete kept['키']
      return kept
    })

    const page = predictPage([model], rows, preprocessors, predictors, noProba, without)

    const failure = page[0]?.[0]?.failure
    expect(failure?.code).toBe('PREDICT_DATASET_COLUMN_MISSING')
    expect(failure?.params).toEqual({ columns: ['키'] })
  })

  it('열이 있는데 값만 비었으면 여전히 빈 칸이다 - 학생이 할 일이 다르다', () => {
    // 위와 나란히 둔다. 이 둘이 같은 코드로 떨어지면 화면이 틀린 사유를 말한다.
    const blank = [{ ...cellsOf(0), 키: '' }]
    const page = predictPage([model], blank, preprocessors, predictors, noProba, fileColumns)

    expect(page[0]?.[0]?.failure?.code).toBe('PREDICTION_INPUT_INCOMPLETE')
  })

  it('파일에 여분의 열이 있어도 예측은 그대로 된다 - 전처리기가 보는 열만 쓴다', () => {
    const page = predictPage(
      [model],
      [{ ...cellsOf(3), 메모: '결석' }],
      preprocessors,
      predictors,
      noProba,
      [...fileColumns, '메모'],
    )

    expect(page[0]?.[0]).toEqual({ value: 'b' })
  })

  it('사유로 꺼진 모델은 실패가 아니라 빈 칸이다 - 애초에 안 도는 것이다', () => {
    const disabled: PredictableModel = { ...model, reason: 'MODEL_FORMAT_UNSUPPORTED' }
    const page = predictPage(
      [disabled],
      [cellsOf(0)],
      preprocessors,
      predictors,
      noProba,
      fileColumns,
    )

    expect(page[0]?.[0]).toEqual({})
  })

  it('전처리기나 predictor가 없으면 화면 쪽 버그로 취급해 실패 칸을 준다', () => {
    const page = predictPage([model], [cellsOf(0)], new Map(), new Map(), noProba, fileColumns)
    expect(page[0]?.[0]?.failure?.code).toBe('MODEL_FILE_INVALID')
  })

  /**
   * **모델 순서가 바뀌었다고 다시 계산하지 않는다.** 서명이 순서에 흔들리면 목록을 다시
   * 세울 때마다 캐시가 통째로 버려지고, 저사양 교실 PC가 이미 한 예측을 또 한다.
   * `.sort()`를 지워도 저장소가 조용했다 (R13-5 감사 C-5).
   */
  it('서명은 모델 순서에 안 흔들린다', () => {
    const second: PredictableModel = { ...model, run: runOf('r2') }

    expect(predictPageSignature('hash-1', [second, model], 100)).toBe(
      predictPageSignature('hash-1', [model, second], 100),
    )
  })

  it('서명은 파일 해시·모델·전처리 설정이 바뀌면 달라진다', () => {
    const base = predictPageSignature('hash-1', [model], 100)

    expect(predictPageSignature('hash-2', [model], 100)).not.toBe(base)
    expect(predictPageSignature('hash-1', [], 100)).not.toBe(base)

    const changed: PredictableModel = {
      ...model,
      experiment: {
        ...subject,
        settings: {
          ...subject.settings,
          data: { ...subject.settings.data, preprocessing: scaled },
        },
      },
    }
    expect(predictPageSignature('hash-1', [changed], 100)).not.toBe(base)
  })

  /**
   * **판 크기가 바뀌면 캐시를 버려야 한다** (2026-09-01, 상한 해제).
   *
   * 캐시의 열쇠가 **쪽 번호**라 판 크기가 바뀌면 같은 번호가 다른 행을 가리킨다.
   * 학생이 마지막 쪽에서 상한을 풀면 쪽 수가 1로 줄어드는데 쪽 번호는 2에 남고,
   * **표가 통째로 빈다** — 아무 오류도 안 난다. 화면이 이 서명을 보고 첫 쪽으로
   * 되돌아간다.
   */
  it('서명은 판 크기가 바뀌면 달라진다', () => {
    const base = predictPageSignature('hash-1', [model], 100)

    expect(predictPageSignature('hash-1', [model], 250)).not.toBe(base)
    // **`Infinity`는 안 잰다** (2026-09-01 감사 C-7). 부르는 쪽이 언제나 `pageSizeOf`를
    // 거쳐 유한한 수를 넘기므로 그 입력은 만들어질 수 없다 — 그것을 막는 것은
    // `limits-rules.spec.ts`의 `판 크기를 pageSizeOf로 감싼다`다.
  })

  it('서명은 같은 입력에서 같다', () => {
    expect(predictPageSignature('hash-1', [model], 100)).toBe(
      predictPageSignature('hash-1', [model], 100),
    )
  })

  describe('내려받을 CSV 격자', () => {
    const featureNames = inputFields(preprocessor).map((field) => field.name)
    const rows = [cellsOf(0), cellsOf(1)]
    const answers = predictPage([model], rows, preprocessors, predictors, noProba, fileColumns)
    const format = (value: unknown) => String(value)

    it('첫 줄은 행 번호·모델 이름이다 - 특성은 기본으로 숨긴다', () => {
      const grid = predictDownloadGrid(
        [model],
        ['결정 트리 · 내 컴퓨터'],
        [null],
        '번호',
        rows,
        featureNames,
        answers,
        false,
        format,
      )
      expect(grid[0]).toEqual(['번호', '결정 트리 · 내 컴퓨터'])
    })

    /**
     * **파일에서도 실패와 없음이 갈려야 한다** (R6 감사 B-3). 화면은 `—`를 두고 문장을
     * 아래에 세우는데 여기까지 안 오면, 학생이 **제출하는 파일에서는** 둘이 다시 같은
     * 빈 칸이 된다.
     *
     * **문장이 아니라 코드다.** 여기는 눈이 아니라 데이터다 (`CLAUDE.md` §1.4).
     */
    it('실패한 칸에는 사유 코드가 들어간다', () => {
      const failed = [[{ failure: { code: 'PREDICTION_INPUT_INCOMPLETE' as const, params: {} } }]]
      const grid = predictDownloadGrid(
        [model],
        ['결정 트리'],
        [null],
        '번호',
        [cellsOf(0)],
        featureNames,
        failed,
        false,
        format,
      )
      expect(grid[1]).toEqual(['1', 'PREDICTION_INPUT_INCOMPLETE'])
    })

    it('아무 일도 안 일어난 칸은 비어 있다 - 실패와 갈린다', () => {
      const grid = predictDownloadGrid(
        [model],
        ['결정 트리'],
        [null],
        '번호',
        [cellsOf(0)],
        featureNames,
        [[{}]],
        false,
        format,
      )
      expect(grid[1]).toEqual(['1', ''])
    })

    it('토글을 켜면 특성 열이 행 번호와 모델 사이에 낀다', () => {
      const grid = predictDownloadGrid(
        [model],
        ['결정 트리'],
        [null],
        '번호',
        rows,
        featureNames,
        answers,
        true,
        format,
      )
      expect(grid[0]).toEqual(['번호', '키', '몸무게', '지역', '결정 트리'])
      expect(grid[1]).toEqual(['1', '150', '40', '서울', 'a'])
    })

    /**
     * **못을 옮겼다** (2026-08-19, R6 감사 B-3). 전에는 이 자리가 `['1', '']`을 고정하고
     * 제목이 *"사람이 읽는 문장을 데이터에 넣지 않는다"*였다. **그 원칙은 그대로다** —
     * 지금 들어가는 것은 문장이 아니라 **에러 코드**이고, 실험 기록이 실패를
     * `failure.code`로 담는 것과 같은 규약이다.
     *
     * 옮긴 이유는 화면만 고치면 **제출물에서 약속이 깨지기** 때문이다. 화면은 실패한
     * 칸에 `—`를 두고 사유를 아래에 세우는데, 파일에서는 실패한 칸과 계산 안 한 칸이
     * 다시 같은 빈 칸이었다. 500행 중 세 줄이 왜 비었는지 교사가 받는 것은 파일이다.
     */
    it('진짜 입구로 태워도 실패한 칸에 사유 코드가 들어간다', () => {
      const incomplete = [{ 키: '160' }]
      const page = predictPage([model], incomplete, preprocessors, predictors, noProba, fileColumns)
      const grid = predictDownloadGrid(
        [model],
        ['결정 트리'],
        [null],
        '번호',
        incomplete,
        featureNames,
        page,
        false,
        format,
      )
      expect(grid[1]).toEqual(['1', 'PREDICTION_INPUT_INCOMPLETE'])
    })
  })

  /**
   * 확률 (mlpx-spec.md §5.4).
   *
   * **여기서 지키는 것은 답 옆의 숫자가 그 답의 확신인가 하나다.** 최댓값을 쓰면 포화
   * 구간에서 "FALSE라고 답해 놓고 TRUE의 확률"이 표에 뜨고, 그건 에러가 안 난다.
   */
  describe('확률', () => {
    const featureNames = inputFields(preprocessor).map((field) => field.name)
    const format = (value: unknown) => String(value)

    /** 언제나 'a'라고 답하면서 확률은 'b'가 높다고 하는 모델. 정상 경로에는 없다. */
    const contrary: ProbaModel = {
      classes: ['a', 'b'],
      predict: (vectors) => vectors.map(() => Float64Array.from([0.25, 0.75])),
    }
    const withProba = new Map([['r1', contrary]])

    it('답 옆의 숫자는 최댓값이 아니라 그 답의 확률이다', () => {
      const page = predictPage(
        [model],
        [cellsOf(0)],
        preprocessors,
        predictors,
        withProba,
        fileColumns,
      )
      const answer = page[0]?.[0]

      // 모델이 낸 답은 'a'다. 확률에서 라벨을 다시 구하면 'b'가 됐을 것이다.
      expect(answer?.value).toBe('a')
      expect(chosenProbability(answer)).toBeCloseTo(0.25, 10)
    })

    it('확률을 내는 모델만 확률이 붙는다', () => {
      const page = predictPage(
        [model],
        [cellsOf(0)],
        preprocessors,
        predictors,
        noProba,
        fileColumns,
      )
      expect(page[0]?.[0]?.probabilities).toBeUndefined()
      expect(chosenProbability(page[0]?.[0])).toBeNull()
    })

    it('포화해서 못 낸 행은 확률이 없다 - 답은 그대로 나온다', () => {
      const saturated = new Map([
        ['r1', { classes: ['a', 'b'], predict: () => [null] } satisfies ProbaModel],
      ])
      const page = predictPage(
        [model],
        [cellsOf(0)],
        preprocessors,
        predictors,
        saturated,
        fileColumns,
      )

      expect(page[0]?.[0]?.value).toBe('a')
      expect(page[0]?.[0]?.probabilities).toBeUndefined()
    })

    /**
     * **화면은 한 칸, 파일은 두 열이다.** 화면의 `FALSE (100%)`는 사람이 읽는 모양이라
     * 파일에 그대로 넣으면 엑셀에서 정렬도 계산도 안 되는 문자열이 된다.
     */
    it('CSV는 확률 열을 그 모델 바로 뒤에 따로 세운다', () => {
      const rows = [cellsOf(0), cellsOf(1)]
      const answers = predictPage([model], rows, preprocessors, predictors, withProba, fileColumns)
      const grid = predictDownloadGrid(
        [model],
        ['로지스틱 회귀'],
        ['로지스틱 회귀 확률'],
        '번호',
        rows,
        featureNames,
        answers,
        false,
        format,
      )

      expect(grid[0]).toEqual(['번호', '로지스틱 회귀', '로지스틱 회귀 확률'])
      // **비율 그대로다.** 퍼센트로 바꾸거나 반올림하는 것은 화면의 일이다.
      expect(grid[1]).toEqual(['1', 'a', '0.25'])
    })

    it('확률을 안 내는 모델은 확률 열 자체가 없다', () => {
      const rows = [cellsOf(0)]
      const answers = predictPage([model], rows, preprocessors, predictors, noProba, fileColumns)
      const grid = predictDownloadGrid(
        [model],
        ['결정 트리'],
        [null],
        '번호',
        rows,
        featureNames,
        answers,
        false,
        format,
      )

      expect(grid[0]).toEqual(['번호', '결정 트리'])
      expect(grid[1]).toEqual(['1', 'a'])
    })

    it('열은 있는데 그 행만 확률이 없으면 그 칸만 빈다', () => {
      const rows = [cellsOf(0)]
      const saturated = new Map([
        ['r1', { classes: ['a', 'b'], predict: () => [null] } satisfies ProbaModel],
      ])
      const answers = predictPage([model], rows, preprocessors, predictors, saturated, fileColumns)
      const grid = predictDownloadGrid(
        [model],
        ['로지스틱 회귀'],
        ['로지스틱 회귀 확률'],
        '번호',
        rows,
        featureNames,
        answers,
        false,
        format,
      )

      expect(grid[1]).toEqual(['1', 'a', ''])
    })
  })
})

describe('색은 화면 전체에서 한 번 정한다', () => {
  const models: PredictableModel[] = [
    { experiment: experiment([0], onehot), run: runOf('r1') },
    { experiment: experiment([0], onehot), run: runOf('r2') },
  ]

  const answersOf = (a: string, b: string) =>
    new Map([
      ['r1', { value: a } as Answer],
      ['r2', { value: b } as Answer],
    ])

  /**
   * **사진마다 매기면 동점에서 정렬이 뒤집힌다.** `몰루 1개 · 0 1개`가 두 사진에서
   * 각각 나오면 벌마다 1등이 달라지고, 같은 답이 사진마다 다른 색을 받는다.
   * 화면에서 실제로 그렇게 났다.
   */
  it('사진이 여럿이어도 같은 답은 같은 등수다', () => {
    const ranks = rankAnswersAcross(models, [answersOf('몰루', '0'), answersOf('0', '몰루')])
    expect(ranks).not.toBeNull()
    // 두 벌을 합치면 둘 다 2개씩이고, 어느 쪽이 1등이든 **하나의 답이 하나의 등수**다.
    expect(new Set(ranks?.values()).size).toBe(2)
  })

  /**
   * **누적이 순서를 바꾸는 입력** (R7 감사 B-12). 위 검사는 등수가 **둘로 갈리는지**만
   * 보므로, 벌마다 덮어쓰기로 바꿔도 서로 다른 등수 둘은 그대로 나와 초록이었다 —
   * 소스가 고쳤다고 적은 결함이 정작 무검사였다.
   *
   * 여기서는 **누가 1등인지**를 본다. 합치면 `몰루 3 : 0 1`이라 `몰루`가 1등이고,
   * 덮어쓰면 마지막 벌만 남아 `1 : 1` 동점이 된다.
   */
  it('벌마다 덮어쓰지 않고 합친다 - 합쳐야 1등이 정해진다', () => {
    /**
     * **덮어쓰기와 갈리는 입력이라야 한다.** 합치면 `몰루 5 : 0 3`이라 몰루가 1등이고,
     * 벌마다 덮어쓰면 몰루의 마지막 벌은 셋째(1개)·0의 마지막 벌은 넷째(2개)라
     * **0이 1등이 된다.** 동점으로 끝나는 입력은 삽입 순서가 답을 정해서 이 축을 못 가른다.
     */
    const ranks = rankAnswersAcross(models, [
      answersOf('몰루', '몰루'),
      answersOf('몰루', '몰루'),
      answersOf('몰루', '0'),
      answersOf('0', '0'),
    ])
    expect(ranks?.get('몰루')).toBe(0)
  })

  /**
   * 한 사진 안에서만 보면 갈릴 것이 없어 색이 없었다. 화면 전체로 보면 그 값은
   * **정체성을 가진 값**이고, "이 사진은 전부 몰루"가 같은 색 넉 장으로 보인다.
   */
  it('한 벌이 전부 같은 답이어도 다른 벌에서 갈렸으면 등수가 있다', () => {
    const ranks = rankAnswersAcross(models, [answersOf('몰루', '몰루'), answersOf('0', '0')])
    expect(ranks?.get('몰루')).not.toBeUndefined()
    expect(ranks?.get('0')).not.toBeUndefined()
  })

  it('답이 한 가지뿐이면 갈릴 것이 없다', () => {
    expect(rankAnswersAcross(models, [answersOf('몰루', '몰루')])).toBeNull()
  })

  /** 표 예측은 벌이 하나다. 그 자리에서 결과가 예전과 같아야 한다. */
  it('벌이 하나면 그 벌만 센 것과 같다', () => {
    const answers = answersOf('몰루', '0')
    expect(rankAnswersAcross(models, [answers])).toEqual(
      rankAnswers(tallyClassificationAnswers(models, answers)),
    )
  })
})

describe('군집의 답은 번호가 아니라 이름으로 쓴다', () => {
  it('군집 모델만 참이다', () => {
    // **화면이 과제 유형을 보지 않게 하는 판정이다** (§9.1). 이것이 없으면 답 카드에
    // `0`만 떠서 분류의 라벨 0이나 회귀의 값 0과 글자가 같아진다.
    const clustering: PredictableModel = {
      experiment: experiment([0], onehot, { taskType: 'clustering', target: undefined }),
      run: runOf('r1', 'kmeans'),
    }
    const classification: PredictableModel = {
      experiment: experiment([0], onehot),
      run: runOf('r2'),
    }

    expect(answersInClusters(clustering)).toBe(true)
    expect(answersInClusters(classification)).toBe(false)
  })

  /**
   * **답을 보지 않는다.** 전에는 답이 실제로 나온 뒤에만 안내가 떴는데, 서로 다른
   * 학습의 `2번 군집`이 같은 것이 아니라는 사실은 **답을 읽기 전에** 알아야 오독을
   * 막는다 (open-decisions.md "머리글은 목록 밖에 선다").
   */
  it('번호의 뜻은 답이 나오기 전에 말한다', () => {
    const clustering: PredictableModel = {
      experiment: experiment([0], onehot, { taskType: 'clustering', target: undefined }),
      run: runOf('r1', 'kmeans'),
    }
    const classification: PredictableModel = {
      experiment: experiment([0], onehot),
      run: runOf('r2'),
    }

    expect(showsClusterNames([classification, clustering], true)).toBe(true)
    // 군집 모델을 걸러 낸 학생에게는 할 말이 없다.
    expect(showsClusterNames([classification], true)).toBe(false)
    expect(showsClusterNames([], true)).toBe(false)
  })

  /**
   * **군집 답은 문자열로 온다** (`ml/models/kmeans.ts`가 `"0"`을 돌려준다). 화면이 그걸
   * 잊고 숫자만 받으면 **아무 일도 안 일어나면서 아무 데도 안 우는 결함**이 된다 —
   * 실제로 답 카드의 팝오버가 그렇게 안 붙었다 (2026-08-14).
   */
  it('군집 번호는 문자열로 와도 읽는다', () => {
    const clustering: PredictableModel = {
      experiment: experiment([0], onehot, { taskType: 'clustering', target: undefined }),
      run: runOf('r1', 'kmeans'),
    }
    const classification: PredictableModel = {
      experiment: experiment([0], onehot),
      run: runOf('r2'),
    }

    expect(clusterNumberOf(clustering, '2')).toBe(2)
    expect(clusterNumberOf(clustering, 2)).toBe(2)
    expect(clusterNumberOf(clustering, undefined)).toBeNull()
    // 분류 라벨이 "3"인 데이터가 실제로 있다. 그건 군집 번호가 아니다.
    expect(clusterNumberOf(classification, '3')).toBeNull()
    // 범주 이름이 답인 군집은 없다 - 숫자로 안 읽히면 그릴 것이 없다.
    expect(clusterNumberOf(clustering, '개')).toBeNull()
    // **`Number()`가 아니라 정수인지까지 본다.** 소스가 그렇게 적어 두었는데 검사의
    // 입력에 소수가 하나도 없었다 (R13-5 감사 C-5). 군집 번호는 정수다.
    expect(clusterNumberOf(clustering, '1.5')).toBeNull()
  })

  /**
   * **답이 설 자리가 없으면 말하지 않는다.** 사진을 하나도 안 올린 이미지 예측 화면이
   * 그렇다 — 빈 상태 아래에 주의색 한 줄만 떠 있으면 학생은 자기가 뭘 잘못한 줄 안다
   * (2026-08-14, 사용자가 화면에서 봤다).
   */
  it('읽을 답이 설 자리가 없으면 말하지 않는다', () => {
    const clustering: PredictableModel = {
      experiment: experiment([0], onehot, { taskType: 'clustering', target: undefined }),
      run: runOf('r1', 'kmeans'),
    }

    expect(showsClusterNames([clustering], false)).toBe(false)
  })
})

/**
 * **두 예측 판이 이 계산을 각자 들고 있었고 이미 어긋나 있었다** (V11 R4 B-7).
 * 표 판만 사유 층을 갖고 이미지 판은 안 가져서, 못 읽는 전처리기를 가진 모델이
 * 이미지 화면에서 조용히 건너뛰어지고 카드가 "계산 중"에 영원히 머물렀다(B-3).
 * 올려 두면 두 판이 같은 함수를 부르고 여기 검사가 둘 다 덮는다.
 */
describe('예측 판이 함께 쓰는 계산', () => {
  const subject = experiment([0, 1, 2], onehot)
  const models: PredictableModel[] = [
    { experiment: subject, run: runOf('r1') },
    { experiment: subject, run: runOf('r2', 'knn') },
  ]

  /** 전처리기 JSON을 담은 파일 맵. 실제 저장 모양과 같다. */
  function filesWith(json: unknown): Map<string, Uint8Array> {
    return new Map([
      ['model/preprocessor-experiment-1.json', new TextEncoder().encode(JSON.stringify(json))],
    ])
  }

  function documentWith(): ProjectDocument {
    return {
      manifest: {
        formatVersion: 1,
        appVersion: '0.0.0',
        projectId: '11111111-1111-4111-8111-111111111111',
        name: '테스트',
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        kind: 'machineLearning',
        dataType: 'tabular',
        locale: 'ko',
      },
      settings: {
        data: { features, target: '품종', preprocessing: onehot },
        split: subject.settings.split,
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: {
        experiments: [
          {
            ...subject,
            preprocessor: {
              path: 'model/preprocessor-experiment-1.json',
              format: PREPROCESSOR_FORMAT,
            },
          },
        ],
      },
      portfolio: {
        template: { sections: [] },
        answerFormat: 'plain-v1',
        answers: {},
        attachments: {},
      },
    }
  }

  it('읽을 수 있는 전처리기를 실험 id로 준다', () => {
    const fitted = fitFor(subject)
    const found = readPreprocessors(documentWith(), filesWith(fitted))
    expect(found.has('experiment-1')).toBe(true)
  })

  it('못 읽는 전처리기는 빠진다 - 남이 손으로 고친 파일에서 온다', () => {
    const found = readPreprocessors(documentWith(), filesWith({ 이건: '전처리기가 아니다' }))
    expect(found.size).toBe(0)
  })

  it('파일에 아예 없어도 던지지 않는다', () => {
    expect(readPreprocessors(documentWith(), new Map()).size).toBe(0)
  })

  it('전처리기가 없는 모델에 사유를 붙인다 - 조용히 건너뛰면 안 된다', () => {
    const found = withPreprocessorReason(models, new Map())
    expect(found.map((entry) => entry.reason)).toEqual(['MODEL_FILE_INVALID', 'MODEL_FILE_INVALID'])
  })

  it('전처리기가 있으면 사유를 안 붙인다', () => {
    const found = withPreprocessorReason(models, new Map([['experiment-1', fitFor(subject)]]))
    expect(found.map((entry) => entry.reason)).toEqual([undefined, undefined])
  })

  it('이미 사유가 있는 카드는 안 덮는다 - 먼저 든 사유가 더 정확하다', () => {
    const already: PredictableModel[] = [
      { experiment: subject, run: runOf('r1'), reason: 'MODEL_FORMAT_UNSUPPORTED' },
    ]
    expect(withPreprocessorReason(already, new Map())[0]?.reason).toBe('MODEL_FORMAT_UNSUPPORTED')
  })

  it('지문은 실험·알고리즘 집합이 같으면 같다 - 순서가 달라도 그렇다', () => {
    const flipped = [...models].reverse()
    expect(filterAxisSignature(flipped)).toBe(filterAxisSignature(models))
  })

  it('지문은 알고리즘이 하나 늘면 달라진다', () => {
    const more = [...models, { experiment: subject, run: runOf('r3', 'svm') }]
    expect(filterAxisSignature(more)).not.toBe(filterAxisSignature(models))
  })

  it('실험 축은 중복 없이 목록 순서를 지킨다', () => {
    const options = experimentFilterOptions(models, new Map([['experiment-1', '1번째 실험']]))
    expect(options).toEqual([{ id: 'experiment-1', label: '1번째 실험' }])
  })

  it('이름이 없으면 id를 그대로 쓴다 - 빈 칸을 그리지 않는다', () => {
    expect(experimentFilterOptions(models, new Map())[0]?.label).toBe('experiment-1')
  })

  it('알고리즘 축은 중복 없이 등록부 문구를 쓴다', () => {
    const options = algorithmFilterOptions(models, (algorithm) => `[${algorithm}]`)
    expect(options).toEqual([
      { id: 'decision_tree', label: '[decision_tree]' },
      { id: 'knn', label: '[knn]' },
    ])
  })
})

/**
 * **사유는 학생이 할 일이 다르면 갈라야 한다** (`errors.ts`가 여러 번 적어 둔 규칙).
 *
 * `MODEL_FILE_INVALID`의 문구는 "다시 학습하면 쓸 수 있습니다"로 끝나는데, 모델이 커서
 * 안 담긴 run에는 **정반대의 조언**이다 — 앱 자신이 `modelOmission.tooLarge`에서 "다시
 * 학습해도 같다"고 적었다 (V11 R5 B-7). 그리고 `MODEL_FORMAT_UNSUPPORTED`의 문구는
 * `({format})`으로 끝나는데 값이 안 오면 **빈 괄호**가 뜬다 (B-6).
 */
describe('못 쓰는 사유는 화면이 맞는 말을 고를 수 있게 온다', () => {
  const base = experiment([0, 1, 2], onehot)

  function documentOf(run: Run): ProjectDocument {
    const withRun = { ...base, runs: [run] }
    return {
      manifest: {
        formatVersion: 1,
        appVersion: '0.0.0',
        projectId: '11111111-1111-4111-8111-111111111111',
        name: '테스트',
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        kind: 'machineLearning',
        dataType: 'tabular',
        locale: 'ko',
      },
      settings: {
        data: { features, target: '품종', preprocessing: onehot },
        split: base.settings.split,
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: { experiments: [withRun] },
      portfolio: {
        template: { sections: [] },
        answerFormat: 'plain-v1',
        answers: {},
        attachments: {},
      },
    }
  }

  it('모르는 형식에는 그 형식 이름이 함께 온다 - 빈 괄호가 뜨면 안 된다', () => {
    const run = { ...runOf('r1'), model: { path: 'model/r1.json', format: '없는형식-v9' } }
    const [entry] = predictableModels(documentOf(run as Run), true)

    expect(entry?.reason).toBe('MODEL_FORMAT_UNSUPPORTED')
    expect(entry?.reasonParams).toEqual({ format: '없는형식-v9' })
  })

  it('안 담긴 모델에는 왜 안 담겼는지가 함께 온다', () => {
    const run = { ...runOf('r1'), modelOmitted: 'tooLarge' }
    const [entry] = predictableModels(documentOf(run as Run), true)

    expect(entry?.reason).toBe('MODEL_FILE_INVALID')
    expect(entry?.omitted).toBe('tooLarge')
  })

  it('왜 안 담겼는지 모르면 그 칸은 없다 - 추측해서 채우지 않는다', () => {
    const [entry] = predictableModels(documentOf(runOf('r1')), true)

    expect(entry?.reason).toBe('MODEL_FILE_INVALID')
    expect(entry?.omitted).toBeUndefined()
  })
})

/**
 * 네 곳이 같은 번호를 써야 한다 — 결과 목록, 실험 상세, 예측 판 둘. 학생이 결과
 * 화면에서 본 "실험 2"와 예측 화면의 "실험 2"가 다른 것을 가리키면 그 화면들은
 * 서로 다른 도구가 된다 (V11 R4 B-8).
 */
describe('실험 번호', () => {
  const three = [
    { ...experiment([0], onehot), id: 'a' },
    { ...experiment([0], onehot), id: 'b' },
    { ...experiment([0], onehot), id: 'c' },
  ]

  it('파일 순서 + 1이다', () => {
    expect([...experimentOrder(three)]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('목록을 뒤집어도 번호는 안 따라간다', () => {
    const reversed = [...three].reverse()
    expect(experimentOrder(reversed).get('a')).toBe(3)
    // 뒤집힌 배열을 넘기면 번호도 뒤집힌다 - 그래서 **부르는 쪽이 뒤집기 전에 부른다.**
    expect(experimentOrder(three).get('a')).toBe(1)
  })

  it('이름은 부르는 쪽의 t()로 만든다', () => {
    const names = experimentNames(three, (index) => `${index}번째 실험`)
    expect(names.get('b')).toBe('2번째 실험')
  })
})

/**
 * **실패한 칸과 빈 칸을 가른다** (V11 R2 감사 B-10).
 *
 * 일괄 예측 표가 `answer.value`만 봐서 넷을 같은 빈 칸으로 그렸다 — 사유로 꺼진 모델,
 * 빈 값이 있어 못 푼 행, 모델이 보는 열이 파일에 없는 칸, 답을 안 낸 칸. 500행 중 세
 * 줄이 왜 비었는지 학생이 알 방법이 없었다.
 *
 * **칸에 무엇이 그려지는지는 화면이지만, 무엇이 실패인가는 순수 함수다.**
 */
describe('칸의 상태를 가른다', () => {
  it('값이 있으면 답이다', () => {
    expect(answerState({ value: 'setosa' })).toBe('value')
  })

  it('값이 없고 사유가 있으면 실패다', () => {
    expect(answerState({ failure: { code: 'PREDICTION_INPUT_INCOMPLETE', params: {} } })).toBe(
      'failed',
    )
  })

  it('둘 다 없으면 아무 일도 안 일어난 칸이다', () => {
    expect(answerState({})).toBe('none')
    expect(answerState(undefined)).toBe('none')
  })

  /** 값이 나온 칸은 부수적인 사유가 함께 담겨 있어도 **답이 있는 칸**이다. */
  it('값이 있으면 사유가 있어도 답이다', () => {
    expect(
      answerState({ value: 'setosa', failure: { code: 'MODEL_FILE_INVALID', params: {} } }),
    ).toBe('value')
  })

  /** 회귀는 0을 답으로 낸다. `!value`로 보면 그 칸이 통째로 사라진다. */
  it('0도 답이다', () => {
    expect(answerState({ value: 0 })).toBe('value')
  })
})

/**
 * **제자리에서 안 바꾼다.** 그 함수의 주석이 *"원본을 공유하는 곳이 있으면 그쪽이
 * 놀란다"*고 적는데, `[...items]`를 지워도 검사도 타입도 조용했다 (R13-5 감사 C-3).
 * 지금 부르는 두 곳이 배열 리터럴을 넘겨서 해가 없을 뿐이다.
 */
describe('섞기', () => {
  it('원본을 안 건드리고 같은 원소를 돌려준다', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const before = [...items]

    const mixed = shuffled(items)

    expect(items, 'the original was mutated in place').toEqual(before)
    expect([...mixed].sort((a, b) => a - b)).toEqual(before)
  })
})
