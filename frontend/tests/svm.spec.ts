/**
 * 선형 SVM — 벤더링한 솔버와 `mlpx-svm-v1` (mlpx-spec.md 5.8).
 *
 * **확인하는 것 넷.**
 *
 * 1. **결정적인가.** 원본은 `Math.random`으로 짝을 골라 같은 설정이 두 번 다른 답을 냈다.
 * 2. **수렴 못 해도 안 던지는가.** 겹치는 데이터가 교실의 기본값이고, 거기서 던지면
 *    학생은 숫자를 하나도 못 본다. 대신 그 사실이 warning으로 남아야 한다.
 * 3. **정규화가 접혀 있는가.** 예측 때 다시 적용해야 하면 그걸 잊는 경로가 생긴다.
 * 4. **왕복이 같은가.** 이건 사실 구조로 보장된다 - 학습과 해석기가 같은 예측 함수를
 *    쓰기 때문이다. 그래도 확인한다: 그 구조가 깨지면 여기서 먼저 걸린다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { fit } from '../src/ml/engines/mljs'
import { SMO_DEFAULTS, seededRandom, trainLinearSvm } from '../src/ml/engines/svm-smo'
import { SVM_FORMAT, loadModel, svmPredict, type SvmModel } from '../src/ml/models'
import { IRIS_FEATURES, IRIS_LABELS } from './fixtures/iris'

const options = { ...SMO_DEFAULTS, C: 1, random: seededRandom(42) }

/** 가르기 쉬운 이진 데이터. 마지막 특성에만 신호가 있고 경계에 여백이 있다. */
function separable(rows: number): { features: number[][]; labels: number[] } {
  const random = seededRandom(7)
  const features: number[][] = []
  const labels: number[] = []
  while (features.length < rows) {
    const row = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1]
    const signal = row[2] as number
    if (Math.abs(signal) < 0.2) continue
    features.push(row)
    labels.push(signal > 0 ? 1 : -1)
  }
  return { features, labels }
}

/** 라벨을 반쯤 뒤집어 경계를 지운다. 어떤 초평면으로도 못 가른다. */
function noisy(rows: number): { features: number[][]; labels: number[] } {
  const random = seededRandom(11)
  const features: number[][] = []
  const labels: number[] = []
  for (let i = 0; i < rows; i += 1) {
    features.push([random() * 2 - 1, random() * 2 - 1])
    labels.push(random() > 0.5 ? 1 : -1)
  }
  return { features, labels }
}

function train(hyperparameters: Record<string, unknown> = {}, randomState = 42) {
  return fit('svm', {
    features: IRIS_FEATURES,
    rowIndices: IRIS_FEATURES.map((_, index) => index),
    target: IRIS_LABELS,
    hyperparameters,
    randomState,
  })
}

describe('벤더링한 SMO', () => {
  it('가를 수 있는 데이터를 가른다', () => {
    const { features, labels } = separable(200)
    const model = trainLinearSvm(features, labels, options)

    expect(model.converged).toBe(true)
    const predicted = features.map((row) =>
      row.reduce((sum, value, j) => sum + value * (model.weights[j] as number), 0) +
        model.intercept >
      0
        ? 1
        : -1,
    )
    expect(predicted).toEqual(labels)
  })

  it('같은 시드면 같은 계수다 - 원본은 Math.random이라 매번 달랐다', () => {
    const { features, labels } = separable(120)
    const first = trainLinearSvm(features, labels, {
      ...SMO_DEFAULTS,
      C: 1,
      random: seededRandom(3),
    })
    const second = trainLinearSvm(features, labels, {
      ...SMO_DEFAULTS,
      C: 1,
      random: seededRandom(3),
    })

    expect(first.weights).toEqual(second.weights)
    expect(first.intercept).toBe(second.intercept)
  })

  it('수렴하지 못해도 던지지 않고 사실을 남긴다', () => {
    const { features, labels } = noisy(60)
    // 반복을 아주 적게 줘서 예산을 확실히 넘긴다. 실제 기본값에서도 겹치는 데이터는
    // 여기 도달한다 (open-decisions.md의 실측).
    const model = trainLinearSvm(features, labels, { ...options, maxIterations: 3 })

    expect(model.converged).toBe(false)
    expect(model.iterations).toBe(3)
    expect(model.weights).toHaveLength(2)
    expect(model.weights.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('열의 단위가 달라도 같은 답을 낸다 - 정규화가 접혀 있다', () => {
    const { features, labels } = separable(150)
    // 두 번째 열만 1000배. 정규화가 없거나 접히다 말면 여기서 답이 갈린다.
    const stretched = features.map((row) => [
      row[0] as number,
      (row[1] as number) * 1000,
      row[2] as number,
    ])

    const plain = trainLinearSvm(features, labels, {
      ...SMO_DEFAULTS,
      C: 1,
      random: seededRandom(5),
    })
    const scaled = trainLinearSvm(stretched, labels, {
      ...SMO_DEFAULTS,
      C: 1,
      random: seededRandom(5),
    })

    const decide = (model: { weights: number[]; intercept: number }, rows: number[][]) =>
      rows.map((row) =>
        row.reduce((sum, value, j) => sum + value * (model.weights[j] as number), model.intercept) >
        0
          ? 1
          : -1,
      )

    expect(decide(scaled, stretched)).toEqual(decide(plain, features))
  })

  it('값이 하나뿐인 열이 있어도 NaN이 안 나온다 - 폭 0은 1로 둔다', () => {
    const { features, labels } = separable(80)
    const withConstant = features.map((row) => [...row, 3])
    const model = trainLinearSvm(withConstant, labels, options)

    expect(model.weights.every((value) => Number.isFinite(value))).toBe(true)
    expect(Number.isFinite(model.intercept)).toBe(true)
  })
})

describe('one-vs-one 투표', () => {
  const classes = ['a', 'b', 'c']

  it('쌍마다 이긴 쪽에 표를 준다', () => {
    // 첫 특성만 본다. 값이 크면 뒤쪽 클래스가 이기게 세운다.
    const predict = svmPredict({
      classes,
      featureCount: 1,
      classifiers: [
        { a: 0, b: 1, weights: [1], intercept: 0 },
        { a: 0, b: 2, weights: [1], intercept: 0 },
        { a: 1, b: 2, weights: [1], intercept: 0 },
      ],
    })

    // 양수면 b쪽이 이긴다 - c가 두 표, b가 한 표, a가 0표.
    expect(predict([[1]])).toEqual(['c'])
    // 음수면 a가 두 표다.
    expect(predict([[-1]])).toEqual(['a'])
  })

  it('표가 같으면 결정함수 값의 합으로 가른다 - sklearn SVC와 같다', () => {
    // 셋이 한 표씩 나눠 갖는 3파전. a>b, b>c, c>a로 돌게 세운다.
    const predict = svmPredict({
      classes,
      featureCount: 1,
      // a-b는 a가 크게 이기고, 나머지 둘은 아슬아슬하다.
      classifiers: [
        { a: 0, b: 1, weights: [0], intercept: -5 },
        { a: 1, b: 2, weights: [0], intercept: -0.5 },
        { a: 0, b: 2, weights: [0], intercept: 0.5 },
      ],
    })

    // 표는 a 1표(a-b), b 1표(b-c), c 1표(a-c). 합은 a가 +4.5로 가장 크다.
    expect(predict([[0]])).toEqual(['a'])
  })

  it('클래스가 여럿인데 가르는 쌍이 없으면 거부한다 - 전부 첫 클래스로 답한다', () => {
    try {
      svmPredict({ classes, featureCount: 1, classifiers: [] })
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('MODEL_FILE_INVALID')
    }
  })

  it('특성 수가 다른 입력은 거부한다', () => {
    const predict = svmPredict({
      classes: ['a', 'b'],
      featureCount: 2,
      classifiers: [{ a: 0, b: 1, weights: [1, 1], intercept: 0 }],
    })
    try {
      predict([[1]])
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('MODEL_FILE_INVALID')
    }
  })
})

describe('mljs 엔진의 svm', () => {
  it('붓꽃 세 품종을 쌍마다 하나씩 감싼다', () => {
    const { model } = train()
    const svm = model as SvmModel

    expect(svm.format).toBe(SVM_FORMAT)
    expect(svm.classes).toEqual(['setosa', 'versicolor', 'virginica'])
    expect(svm.featureCount).toBe(4)
    // 3클래스면 쌍은 셋이다. a < b가 지켜져야 해석기가 방향을 안다.
    expect(svm.classifiers.map((pair) => [pair.a, pair.b])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
  })

  it('학습한 예측과 파일에서 읽은 예측이 같다', () => {
    const { predict, model } = train()
    const revived = loadModel(JSON.parse(JSON.stringify(model)) as unknown)

    expect(revived(IRIS_FEATURES)).toEqual(predict(IRIS_FEATURES))
  })

  it('붓꽃을 맞힌다', () => {
    const { predict } = train()
    const predicted = predict(IRIS_FEATURES)
    const hit = predicted.filter((value, index) => value === IRIS_LABELS[index]).length

    // 학습한 데이터를 다시 맞히는 것이라 높아야 정상이다. 낮으면 라벨 부호가
    // 뒤집혔다는 뜻이고, 그건 지표만 보면 상쇄로 가려진다.
    expect(hit / IRIS_LABELS.length).toBeGreaterThan(0.9)
  })

  it('원본 데이터가 필요 없다 - 참조형과 갈리는 자리다', () => {
    const { model } = train()
    // context 없이 부른다. 참조형이면 여기서 MODEL_NEEDS_DATASET이 난다.
    expect(() => loadModel(JSON.parse(JSON.stringify(model)) as unknown)).not.toThrow()
  })

  it('C를 안 주면 확정된 기본값으로 돈다', () => {
    const first = train()
    const second = train({ C: 1 })
    expect(first.predict(IRIS_FEATURES)).toEqual(second.predict(IRIS_FEATURES))
  })

  it('같은 randomState면 같은 모델이다', () => {
    expect(JSON.stringify(train().model)).toBe(JSON.stringify(train().model))
  })

  /**
   * **씨앗이 SMO 안까지 닿는가.**
   *
   * 위 검사만으로는 못 본다 — 같은 씨앗을 두 번 쓰므로 씨앗을 버려도 참이다.
   * 실제로 `seededRandom(input.randomState)`를 상수로 바꿔도 **저장소 전체
   * 2028개가 전부 초록이었다** (R9 감사 A-4). SMO의 쌍 고르기가 그 값을 먹는다.
   */
  it('다른 randomState면 모델이 갈린다 - 씨앗이 안 쓰이면 여기가 빨개진다', () => {
    const models = [42, 7, 29].map((seed) => JSON.stringify(train({}, seed).model))
    expect(new Set(models).size, '씨앗이 SMO 안까지 안 닿았다').toBeGreaterThan(1)
  })
})
