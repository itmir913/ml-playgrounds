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
  showsClusterNames,
  applyPredictFilter,
  assignAnswerColors,
  chosenProbability,
  defaultFilter,
  inputFields,
  isAllSelected,
  mergeFields,
  inputVector,
  numericRanges,
  predictDownloadGrid,
  predictPage,
  predictPageSignature,
  toggleAllFilter,
  toggleFilter,
  rankAnswers,
  sampleRow,
  predictableModels,
  tallyClassificationAnswers,
  trainingRowsFor,
  type Answer,
  type PredictableModel,
} from '../src/ml/predict'
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

  it('평가에 쓴 행에서 뽑는다 - 학습한 행을 다시 맞히는 장면은 아무것도 안 가르친다', () => {
    const subject = experiment([0, 1, 3], onehot, { testIndices: [2, 4] })
    const fields = inputFields(fitFor(subject))

    // 난수를 어느 쪽으로 돌려도 평가 행 밖으로는 안 나간다.
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

  it('평가 행이 없으면 학습 행뿐이다 - 없는 것을 지어내지 않는다', () => {
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
  describe('평가 데이터가 파일로 온 실험', () => {
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

    it('평가 표에서 뽑는다 - 학습 표에서 뽑으면 모델이 외운 행을 준다', () => {
      const subject = providedExperiment()
      const fields = inputFields(fitFor(subject))
      const sample = sampleRow(subject, fields, { dataset, testDataset }, undefined, picks(0))

      // 학습 표의 0번은 키 150이다. 평가 표의 0번이 나와야 한다.
      expect(sample?.values).toEqual({ 키: '101', 몸무게: '11', 지역: '서울' })
    })

    it('평가 표가 학습 표보다 길어도 뽑는다 - 학습 표를 보면 여기서 조용히 null이 된다', () => {
      const longer: Dataset = {
        columns: testDataset.columns,
        rows: [...testDataset.rows, ['104', '14', '서울', 'b'], ['105', '15', '부산', 'a']],
      }
      const subject = experiment([0, 1], onehot, {
        split: { method: 'provided', testSize: 0.3, stratify: true, randomState: 42 },
        // 학습 표는 5행뿐이라 이 번호들은 그쪽에서 못 찾는다.
        testIndices: [3, 4],
      })
      const fields = inputFields(fitFor(subject))

      expect(
        sampleRow(subject, fields, { dataset, testDataset: longer }, undefined, picks(0))?.index,
      ).toBe(3)
    })

    it('평가 표가 없으면 null이다 - 학습 표로 조용히 떨어지지 않는다', () => {
      const subject = providedExperiment()
      const fields = inputFields(fitFor(subject))

      expect(sampleRow(subject, fields, { dataset }, undefined, picks(0))).toBeNull()
    })

    it('학습 행으로 떨어질 때는 학습 표를 본다 - trainIndices는 언제나 data.csv다', () => {
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
      portfolio: { template: { id: 'default-v1' }, answers: {} },
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

  it('범주 목록도 합친다 - 학습셋이 달라 못 본 값이 있다', () => {
    const seoulBusan = inputFields(fitFor(experiment([0, 1], onehot)))
    const daegu = inputFields(fitFor(experiment([3], onehot)))
    const merged = mergeFields([seoulBusan, daegu])

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

    // 학습셋은 150~160뿐이지만 표에는 150~190이 있다.
    expect(ranges.get('키')).toEqual({ min: 150, max: 190 })
    expect(ranges.get('몸무게')).toEqual({ min: 40, max: 80 })
  })

  it('평가 파일까지 함께 본다 - 가져온 값이 힌트 범위 밖에 있으면 안 된다', () => {
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

  it('모델의 답 등수는 분류에만, 등수가 있을 때만 있다', () => {
    const classification = experiment([0], onehot)
    const regression = experiment([0], onehot, { taskType: 'regression' })
    const models: PredictableModel[] = [
      { experiment: classification, run: runOf('r1') },
      { experiment: regression, run: runOf('r2') },
    ]
    const answers = new Map<string, Answer>([
      ['r1', { value: 'b' }],
      ['r2', { value: 3.14 }],
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

  it('서명은 파일 해시·모델·전처리 설정이 바뀌면 달라진다', () => {
    const base = predictPageSignature('hash-1', [model])

    expect(predictPageSignature('hash-2', [model])).not.toBe(base)
    expect(predictPageSignature('hash-1', [])).not.toBe(base)

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
    expect(predictPageSignature('hash-1', [changed])).not.toBe(base)
  })

  it('서명은 같은 입력에서 같다', () => {
    expect(predictPageSignature('hash-1', [model])).toBe(predictPageSignature('hash-1', [model]))
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

    it('답을 못 낸 칸은 빈 칸이다 - 사람이 읽는 문장을 데이터에 넣지 않는다', () => {
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
      expect(grid[1]).toEqual(['1', ''])
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
