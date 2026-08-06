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
import {
  applyPredictFilter,
  defaultFilter,
  inputFields,
  mergeFields,
  inputVector,
  nextSampleRow,
  numericRanges,
  predictableModels,
  trainingRowsFor,
  type PredictableModel,
} from '../src/ml/predict'
import {
  fitPreprocessor,
  parsePreprocessor,
  PREPROCESSOR_FORMAT,
  type Dataset,
} from '../src/ml/preprocess'
import type { Experiment, Preprocessing, ProjectDocument, Run } from '../src/project/schema'

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
  it('평가에 쓴 행을 준다 - 학습한 행을 다시 맞히는 장면은 아무것도 안 가르친다', () => {
    const subject = experiment([0, 1, 3], onehot, { testIndices: [2, 4] })
    const sample = nextSampleRow(subject, inputFields(fitFor(subject)), dataset)

    expect(sample?.index).toBe(2)
    expect(sample?.values).toEqual({ 키: '170', 몸무게: '60', 지역: '서울' })
  })

  it('누를 때마다 다음 줄이고, 끝나면 처음으로 돌아온다', () => {
    const subject = experiment([0, 1, 3], onehot, { testIndices: [2, 4] })
    const preprocessor = fitFor(subject)

    expect(nextSampleRow(subject, inputFields(preprocessor), dataset, 2)?.index).toBe(4)
    expect(nextSampleRow(subject, inputFields(preprocessor), dataset, 4)?.index).toBe(2)
  })

  it('분할을 껐으면 학습 행뿐이다 - 없는 것을 지어내지 않는다', () => {
    const subject = experiment([0, 1], onehot, { testIndices: [] })
    expect(nextSampleRow(subject, inputFields(fitFor(subject)), dataset)?.index).toBe(0)
  })

  it('가져온 줄이 그대로 벡터가 된다 - 한두 칸만 바꿔 보는 길이 여기서 열린다', () => {
    const subject = experiment([0, 1, 3], scaled, { testIndices: [2] })
    const preprocessor = fitFor(subject)
    const sample = nextSampleRow(subject, inputFields(preprocessor), dataset)

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
        appVersion: '0.1.0',
        projectId: '11111111-1111-4111-8111-111111111111',
        name: '테스트',
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        kind: 'machineLearning',
        dataType: 'tabular',
        locale: 'ko',
      },
      settings: {
        features,
        target: '품종',
        preprocessing: onehot,
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
    const ranges = numericRanges(dataset, inputFields(fitFor(subject)))

    // 학습셋은 150~160뿐이지만 표에는 150~190이 있다.
    expect(ranges.get('키')).toEqual({ min: 150, max: 190 })
    expect(ranges.get('몸무게')).toEqual({ min: 40, max: 80 })
  })

  it('범주 칸에는 범위가 없다 - 고를 것이 이미 목록에 있다', () => {
    const subject = experiment([0, 1, 3], onehot)
    expect(numericRanges(dataset, inputFields(fitFor(subject))).has('지역')).toBe(false)
  })

  it('숫자가 하나도 없는 열은 아무 말도 안 한다', () => {
    const empty: Dataset = { columns: ['키'], rows: [[''], ['  ']] }
    expect(numericRanges(empty, [{ name: '키', kind: 'numeric' }]).size).toBe(0)
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
