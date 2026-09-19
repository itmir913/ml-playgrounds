/**
 * **sklearn이 배운 것을 우리 형식으로 옮긴 것이 같은 답을 내는가.**
 *
 * 이것이 없으면 학생이 보는 두 숫자가 갈린다 — 학습 화면의 정확도는 **sklearn이** 낸
 * 것이고, 예측 화면의 답은 **우리 해석기가** 파일을 읽어 낸 것이다. 옮기다 한 칸이라도
 * 어긋나면 그 둘이 다른 말을 하고, **아무 오류도 안 난다.**
 *
 * **Pyodide는 안 띄운다.** 여기서 재는 것은 *옮기는 규칙*이고, 그 규칙의 입력은
 * `expected.json`에 굳어 있는 **진짜 sklearn이 배운 것**이다
 * (`scripts/generate_sklearn_fixtures.py`). 27.3MB를 받는 일은 브라우저의 몫이다.
 *
 * **`sklearn-parity.spec.ts`와 다른 것을 잰다.** 저쪽은 *우리 엔진이 sklearn만큼 하는가*
 * 이고 여기는 *sklearn이 한 것을 우리가 그대로 옮기는가*다. 그래서 같은 픽스처의 같은
 * 필드를 읽어도 판정이 다르다 — 저쪽은 정확도에 여유가 있고 **여기는 한 줄도 안 갈려야
 * 한다.**
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  sklearnKMeansModel,
  sklearnLinearModel,
  sklearnLinearRegressionModel,
  sklearnNaiveBayesModel,
  sklearnReferenceModel,
  sklearnSvmModel,
  sklearnTreeModel,
  splitBoundary,
  type SklearnForestDump,
  type SklearnKMeansDump,
  type SklearnLinearDump,
  type SklearnNaiveBayesDump,
} from '../src/ml/engines/pyodide-serialize'
import { loadModel, type ModelFile } from '../src/ml/models'
import { fitPreprocessor, transform, type Dataset } from '../src/ml/preprocess'

const FIXTURES = path.join(__dirname, 'fixtures', 'sklearn')

/** 픽스처가 알고리즘 하나에 대해 담고 있는 것 중 **이 파일이 읽는 것**. */
interface Recorded {
  /**
   * **어댑터가 꺼낸 것 그대로다** (2026-09-19 R30 C-3). 픽스처 생성기가 `pyodide-sklearn.ts`의
   * `dump` 문자열을 읽어 진짜 sklearn에 먹여 만든다(`scripts/adapter_python.py`) — 그러니
   * 여기 담긴 모양은 **앱이 브라우저에서 만드는 바로 그 모양**이다.
   *
   * 타입이 `unknown`인 이유는 알고리즘마다 다른 사전이기 때문이고, 어느 모양인지는
   * 아래 `CASES`가 안다.
   */
  readonly dump?: unknown
  /** sklearn 자신의 예측. **전 행이 굳어 있다.** */
  readonly dumpLabels?: readonly string[]
  /** sklearn 자신의 예측 중 **판정 가능한 행만.** `null`은 규약이 안 정해진 자리다. */
  readonly labels?: readonly (string | null)[]
  readonly params?: {
    readonly coef?: readonly (readonly number[])[]
    readonly intercept?: readonly number[]
    readonly theta?: readonly (readonly number[])[]
    readonly var?: readonly (readonly number[])[]
    readonly classLogPrior?: readonly number[]
  }
}

interface FixtureEntry {
  meta: { target: string; taskType: 'classification' | 'regression'; features: string[] }
  trainIndices: number[]
  testIndices: number[]
  sklearn: Record<string, Recorded> & {
    linear_regression?: {
      readonly coefficients?: readonly number[]
      readonly intercept?: number
      readonly dumpValues?: readonly number[]
    }
  }
}

const document = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8')) as {
  datasets: Record<string, FixtureEntry>
}

function readCsv(name: string): Dataset {
  const text = fs.readFileSync(path.join(FIXTURES, 'data', `${name}.csv`), 'utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  const [header, ...rows] = lines
  return {
    columns: (header as string).split(','),
    rows: rows.map((line) => line.split(',')),
  }
}

/**
 * 그 벌의 훈련·시험 행렬과 클래스. **학습 화면이 하는 것과 같은 전처리다** — 이 대조가
 * 성립하려면 sklearn이 배운 행렬과 같은 행렬 위에 서야 한다.
 */
function preparedFor(name: string, entry: FixtureEntry) {
  const dataset = readCsv(name)
  const preprocessor = fitPreprocessor(dataset, entry.trainIndices, entry.meta.features, {
    missing: 'drop',
    scaling: 'none',
    categoricalEncoding: 'onehot',
  })
  const train = transform(preprocessor, dataset, entry.trainIndices, 'onehot')
  const test = transform(preprocessor, dataset, entry.testIndices, 'onehot')
  const column = dataset.columns.indexOf(entry.meta.target)
  const targetOf = (rows: readonly number[]): string[] =>
    rows.map((row) => String(dataset.rows[row]?.[column]))
  const trainTarget = targetOf(entry.trainIndices)
  const classes = [...new Set(trainTarget)].sort()
  return {
    train,
    test,
    classes,
    // **파일이 아니라 데이터에서 센다** — 우리 어댑터도 학습 행렬의 폭을 쓴다.
    featureCount: test[0]?.length ?? 0,
    trainIndices: entry.trainIndices,
    // 참조형만 쓴다. 나머지 형식은 이 값을 쳐다보지 않는다 (`models/types.ts`).
    context: {
      trainingRows: { indices: entry.trainIndices, features: train, target: trainTarget },
    },
  }
}

type Prepared = ReturnType<typeof preparedFor>

/**
 * 알고리즘 하나를 옮기는 법과, 옮긴 것이 내야 하는 답.
 *
 * **등록부다.** 여기 한 줄을 더하는 것이 "이 알고리즘의 직렬화기를 대조한다"의 전부여야
 * 한다 — 어댑터가 `SKLEARN_CLASSES`의 칸 하나로 자라는 것과 같은 모양이다.
 */
interface SerializeCase {
  readonly algorithm: string
  readonly build: (recorded: Recorded, prepared: Prepared) => ModelFile | null
  readonly expected: (recorded: Recorded) => readonly (string | null)[] | undefined
}

const CASES: readonly SerializeCase[] = [
  {
    algorithm: 'decision_tree',
    build: (recorded, prepared) =>
      recorded.dump
        ? sklearnTreeModel(
            recorded.dump as SklearnForestDump,
            prepared.classes,
            prepared.featureCount,
          )
        : null,
    expected: (recorded) => recorded.dumpLabels,
  },
  {
    algorithm: 'naive_bayes',
    build: (recorded, prepared) =>
      sklearnNaiveBayesModel(
        recorded.dump as SklearnNaiveBayesDump,
        prepared.classes,
        prepared.featureCount,
      ),
    expected: (recorded) => recorded.labels,
  },
  {
    algorithm: 'logistic_regression',
    build: (recorded, prepared) =>
      sklearnLinearModel(
        recorded.dump as SklearnLinearDump,
        prepared.classes,
        prepared.featureCount,
      ),
    expected: (recorded) => recorded.labels,
  },
  {
    algorithm: 'svm',
    build: (recorded, prepared) =>
      sklearnSvmModel(recorded.dump as SklearnLinearDump, prepared.classes, prepared.featureCount),
    expected: (recorded) => recorded.dumpLabels,
  },
  {
    /**
     * **군집화도 같은 특성 행렬 위에서 본다** (2026-09-19). 타깃을 안 보므로 분류 벌을
     * 그대로 재료로 쓸 수 있고, 그래서 **군집 전용 벌을 새로 만들지 않고** 이 대조가 선다.
     *
     * 답이 라벨이 아니라 **군집 번호**다 — 우리 해석기가 `String(가장 가까운 중심의 번호)`를
     * 돌려주고(`ml/models/kmeans.ts`) sklearn의 `predict`도 같은 번호를 준다. 번호가 같은
     * 것은 **중심의 순서를 우리가 안 바꾸기 때문**이고, 그게 이 검사가 지키는 것이다.
     */
    algorithm: 'k_means',
    build: (recorded, prepared) =>
      sklearnKMeansModel(recorded.dump as SklearnKMeansDump, prepared.featureCount),
    expected: (recorded) => recorded.labels,
  },
  {
    algorithm: 'knn',
    // **파이썬이 준 것이 없다** — 참조형은 배운 값이 아니라 본 행을 담는다. 이웃 수는
    // 픽스처를 만든 쪽이 고정한 값이다 (`generate_sklearn_fixtures.py`의 `build_model`).
    build: (_recorded, prepared) =>
      sklearnReferenceModel(prepared.classes, prepared.featureCount, prepared.trainIndices, 5),
    expected: (recorded) => recorded.labels,
  },
]

/** 파일이 담은 것이 실제로 몇 칸인가. **검사가 자기 그물의 크기를 센다** (R9 B-5). */
describe('옮긴 것을 대조할 재료가 있다', () => {
  /**
   * **등록부의 크기를 등록부 자신이 세면 안 된다** (2026-09-19 R30 C-2). 아래 반복이
   * `CASES`를 도는데 그 크기를 `CASES`로 세면, **한 줄을 지웠을 때 검사 수만 줄고 전부
   * 초록이다** — 감사자가 `svm`을 지워 71 → 63이 됐는데 아무것도 안 울었다.
   */
  it('대조하는 알고리즘이 정확히 이 여섯이다', () => {
    expect(CASES.map((one) => one.algorithm)).toEqual([
      'decision_tree',
      'naive_bayes',
      'logistic_regression',
      'svm',
      'k_means',
      'knn',
    ])
  })

  it('분류 데이터셋마다 그 여섯을 굳혀 두었다', () => {
    const missing: string[] = []
    for (const [name, entry] of Object.entries(document.datasets)) {
      if (entry.meta.taskType === 'regression') continue
      for (const one of CASES) {
        const recorded = entry.sklearn[one.algorithm]
        if (!recorded || !one.expected(recorded)) missing.push(`${name}/${one.algorithm}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('포레스트도 굳혀 두었다 — 안 담는 이유를 세는 데 쓴다', () => {
    const missing: string[] = []
    for (const [name, entry] of Object.entries(document.datasets)) {
      if (entry.meta.taskType === 'regression') continue
      const found = entry.sklearn['random_forest']
      if (!found?.dump || !found.dumpLabels) missing.push(name)
    }
    expect(missing).toEqual([])
  })
})

for (const [name, entry] of Object.entries(document.datasets)) {
  if (entry.meta.taskType === 'regression') continue

  describe(`옮긴 모델이 sklearn과 같은 답을 낸다 · ${name}`, () => {
    const prepared = preparedFor(name, entry)

    for (const one of CASES) {
      it(`${one.algorithm}의 예측이 한 줄도 안 갈린다`, () => {
        const recorded = entry.sklearn[one.algorithm]
        // **없는 것을 조용히 건너뛰지 않는다** — 그러면 단언이 사라진다 (R9 C-2).
        expect(recorded, `${name}/${one.algorithm}`).toBeDefined()
        if (!recorded) return
        const expectedLabels = one.expected(recorded)
        expect(expectedLabels, `${name}/${one.algorithm} labels`).toBeDefined()
        if (!expectedLabels) return

        const model = one.build(recorded, prepared)
        expect(model, 'the dump must map onto our format').not.toBeNull()
        if (model === null) return

        // **파일을 거쳐 읽는다.** 만든 객체를 그대로 부르면 해석기의 검증을 건너뛴다.
        const predict = loadModel(JSON.parse(JSON.stringify(model)) as unknown, prepared.context)
        const ours = predict(prepared.test)
        // **`null`은 sklearn이 규약을 안 정한 행이다** — 이웃 동점, 경계 위의 확률.
        // 그 행에서 갈리는 것은 결함이 아니라 판정 불능이고, 생성기가 그렇게 표시해 두었다.
        expectedLabels.forEach((label, row) => {
          if (label === null) return
          expect(ours[row], `${name}/${one.algorithm} row ${row}`).toBe(label)
        })
        // 전 행이 `null`이면 위 반복은 아무것도 안 본다. **그물이 비었는지 센다.**
        expect(
          expectedLabels.filter((label) => label !== null).length,
          `${name}/${one.algorithm} has judgeable rows`,
        ).toBeGreaterThan(0)
      })
    }
  })
}

/**
 * 회귀는 답이 수다. **완전 일치를 요구할 수 없다** — 같은 계수라도 곱하고 더하는 순서가
 * 넘파이와 우리가 다르고, 그 차이는 마지막 자리에서 난다.
 *
 * **허용차는 상대값이다.** 이 벌들의 타깃은 점수(수십)부터 합계(수백)까지 자릿수가
 * 다르고, 절대 허용차 하나로는 큰 쪽이 무뎌지거나 작은 쪽이 못 지나간다.
 */
const REGRESSION_RELATIVE_TOLERANCE = 1e-9

for (const [name, entry] of Object.entries(document.datasets)) {
  if (entry.meta.taskType !== 'regression') continue

  describe(`옮긴 모델이 sklearn과 같은 답을 낸다 · ${name}`, () => {
    it('선형 회귀의 예측값이 마지막 자리까지 같다', () => {
      const recorded = entry.sklearn.linear_regression
      expect(recorded?.dumpValues, `${name} values`).toBeDefined()
      expect(recorded?.coefficients, `${name} coefficients`).toBeDefined()
      if (!recorded?.dumpValues || !recorded.coefficients) return

      const prepared = preparedFor(name, entry)
      const model = sklearnLinearRegressionModel(
        { coef: recorded.coefficients, intercept: recorded.intercept ?? 0 },
        prepared.featureCount,
      )
      expect(model, 'the dump must map onto our format').not.toBeNull()
      if (model === null) return

      const ours = loadModel(JSON.parse(JSON.stringify(model)) as unknown)(prepared.test)
      recorded.dumpValues.forEach((value, row) => {
        const got = ours[row]
        expect(typeof got, `${name} row ${row}`).toBe('number')
        expect(Math.abs((got as number) - value)).toBeLessThanOrEqual(
          Math.abs(value) * REGRESSION_RELATIVE_TOLERANCE,
        )
      })
      expect(recorded.dumpValues.length).toBeGreaterThan(0)
    })
  })
}

/**
 * **갈림값을 옮기는 규칙이 무엇을 지켜야 하는가.**
 *
 * 위 줄 대조가 이 함수를 이미 지나가지만, **그건 픽스처가 담은 나무에서만 그렇다.**
 * 여기서는 규칙 자체를 적는다 — `sklearn이 왼쪽으로 보내는 값` 과 `우리 해석기가 왼쪽으로
 * 보내는 값`이 **같은 집합**이어야 한다.
 *
 * sklearn: 단정도로 재서 `float32(x) <= t`면 왼쪽.
 * 우리:    배정도 그대로 `x < b`면 왼쪽 (`ml/models/tree.ts`의 `classify`).
 */
describe('갈림값을 옮기는 규칙', () => {
  /** `5.6`은 실제로 갈렸던 값이다 — `categorical` 벌의 `주당활동시간`. */
  const thresholds = [5.6, 0, -0.5, 1, 2.5, 1e-7, 1234.5678, -9876.5]

  it('sklearn이 왼쪽으로 보내는 값과 우리가 왼쪽으로 보내는 값이 같다', () => {
    const wrong: string[] = []
    for (const threshold of thresholds) {
      const boundary = splitBoundary(threshold)
      // 경계 언저리의 값들. **단정도 한 칸씩** 움직여야 규칙이 갈리는 자리를 지나간다.
      const probes = [threshold, Math.fround(threshold), boundary, boundary * (1 + 1e-9)]
      for (const near of probes) {
        for (const step of [-2, -1, 0, 1, 2]) {
          const x = near * (1 + step * 1e-7)
          const sklearnGoesLeft = Math.fround(x) <= threshold
          const weGoLeft = x < boundary
          if (sklearnGoesLeft !== weGoLeft) {
            wrong.push(`t=${threshold} x=${x}: sklearn=${String(sklearnGoesLeft)}`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })

  /**
   * **임계값 자신이 데이터에 나타난다** — sklearn의 임계값은 관측값 둘의 중점이다.
   * 그래서 이 한 점이 어느 쪽으로 가는지가 실제로 갈리는 자리다.
   *
   * **"경계는 늘 임계값보다 크다"고 적었다가 틀렸다** (2026-09-19). `float32(t) > t`인
   * 임계값에서는 **경계가 임계값보다 작은 것이 맞다** — 그때는 sklearn도 `t`를 오른쪽으로
   * 보내기 때문이다. 방향을 외우지 말고 **sklearn에게 물어서** 견준다.
   */
  it('임계값 자신을 sklearn과 같은 쪽으로 보낸다', () => {
    for (const threshold of thresholds) {
      expect(threshold < splitBoundary(threshold), `t=${threshold}`).toBe(
        Math.fround(threshold) <= threshold,
      )
    }
  })

  it('유한하지 않은 값은 옮기지 않는다', () => {
    expect(Number.isNaN(splitBoundary(Number.POSITIVE_INFINITY))).toBe(true)
    expect(Number.isNaN(splitBoundary(Number.NaN))).toBe(true)
  })
})

/**
 * **옮길 수 없는 것은 안 옮긴다** — 던지지 않고 `null`이다. 부르는 쪽이 그것을
 * `modelOmitted`로 적고 학습은 그대로 끝난다.
 *
 * **픽스처로는 이 갈래를 못 지나간다.** 진짜 sklearn은 언제나 정렬된 `classes_`를 주고
 * 성한 배열을 주기 때문이다 — 그래서 **손으로 어긋난 것을 만들어 본다.** 이 갈래가
 * 죽으면 **라벨이 밀린 모델이 조용히 담긴다**(번호가 다른 라벨을 가리킨다).
 */
describe('어긋난 것은 안 담는다 · 나무', () => {
  /** 잎 둘짜리 나무 하나. 노드 0에서 갈리고 자식이 잎이다. */
  const dump = {
    trees: [
      {
        left: [1, -1, -1],
        right: [2, -1, -1],
        feature: [0, -2, -2],
        threshold: [0.5, -2, -2],
        leafClass: [0, 0, 1],
      },
    ],
    classes: ['가', '나'],
  }

  it('성한 것은 담는다 - 바닥', () => {
    expect(sklearnTreeModel(dump, ['가', '나'], 1)).not.toBeNull()
  })

  it('클래스 순서가 다르면 안 담는다', () => {
    // sklearn이 `['나', '가']`로 줬다면 잎의 0번은 `나`다. 우리 순서로 읽으면 `가`가 되어
    // **모든 예측이 반대 라벨로 나온다.**
    expect(sklearnTreeModel({ ...dump, classes: ['나', '가'] }, ['가', '나'], 1)).toBeNull()
  })

  it('클래스 수가 다르면 안 담는다', () => {
    expect(sklearnTreeModel({ ...dump, classes: ['가'] }, ['가', '나'], 1)).toBeNull()
  })

  it('잎이 없는 클래스를 가리키면 안 담는다', () => {
    const broken = { ...dump, trees: [{ ...dump.trees[0]!, leafClass: [0, 0, 7] }] }
    expect(sklearnTreeModel(broken, ['가', '나'], 1)).toBeNull()
  })

  it('갈림이 없는 열을 가리키면 안 담는다', () => {
    const broken = { ...dump, trees: [{ ...dump.trees[0]!, feature: [3, -2, -2] }] }
    expect(sklearnTreeModel(broken, ['가', '나'], 1)).toBeNull()
  })

  it('배열 길이가 어긋나면 안 담는다', () => {
    const broken = { ...dump, trees: [{ ...dump.trees[0]!, right: [2, -1] }] }
    expect(sklearnTreeModel(broken, ['가', '나'], 1)).toBeNull()
  })

  it('나무가 없으면 안 담는다', () => {
    expect(sklearnTreeModel({ ...dump, trees: [] }, ['가', '나'], 1)).toBeNull()
  })
})

/**
 * 나머지 형식도 같은 규칙이다. **줄 수·폭·유한성이 어긋나면 안 담는다.**
 *
 * 여기 걸리는 것들은 픽스처가 못 만드는 모양이다 — 진짜 sklearn에서는 안 나오지만
 * **`JSON.parse`가 준 것이 우리 기대와 같다는 보장은 어디에도 없다.**
 */
describe('어긋난 것은 안 담는다 · 나머지', () => {
  const three = ['가', '나', '다']

  it('로지스틱: 다중 클래스는 클래스마다 한 줄이어야 한다', () => {
    expect(sklearnLinearModel({ coef: [[1, 2]], intercept: [0] }, three, 2)).toBeNull()
  })

  it('로지스틱: 이진은 한 줄을 ±절반 두 줄로 나눈다', () => {
    const model = sklearnLinearModel({ coef: [[2, 4]], intercept: [6] }, ['가', '나'], 2)
    expect(model?.weights).toEqual([
      [-1, -2],
      [1, 2],
    ])
    expect(model?.intercepts).toEqual([-3, 3])
  })

  it('로지스틱: 줄의 폭이 다르면 안 담는다', () => {
    expect(sklearnLinearModel({ coef: [[1]], intercept: [0] }, ['가', '나'], 2)).toBeNull()
  })

  it('로지스틱: 유한하지 않은 값이 있으면 안 담는다', () => {
    expect(
      sklearnLinearModel({ coef: [[1, Number.NaN]], intercept: [0] }, ['가', '나'], 2),
    ).toBeNull()
  })

  it('SVM: 쌍의 수가 클래스 수와 안 맞으면 안 담는다', () => {
    // 클래스 셋이면 쌍은 셋이다. 둘만 오면 한 쌍이 빈다.
    expect(
      sklearnSvmModel(
        {
          coef: [
            [1, 1],
            [1, 1],
          ],
          intercept: [0, 0],
        },
        three,
        2,
      ),
    ).toBeNull()
  })

  it('SVM: 다중 클래스는 부호를 뒤집어 담는다', () => {
    const model = sklearnSvmModel(
      {
        coef: [
          [1, 0],
          [0, 1],
          [1, 1],
        ],
        intercept: [1, 2, 3],
      },
      three,
      2,
    )
    expect(model?.classifiers.map((one) => [one.a, one.b])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ])
    expect(model?.classifiers[0]?.weights).toEqual([-1, -0])
    expect(model?.classifiers[0]?.intercept).toBe(-1)
  })

  it('SVM: 이진은 sklearn이 이미 뒤집어 놓았으므로 그대로 담는다', () => {
    const model = sklearnSvmModel({ coef: [[1, 2]], intercept: [3] }, ['가', '나'], 2)
    expect(model?.classifiers[0]?.weights).toEqual([1, 2])
    expect(model?.classifiers[0]?.intercept).toBe(3)
  })

  it('나이브 베이즈: 평균과 분산의 줄 수가 클래스 수와 같아야 한다', () => {
    expect(
      sklearnNaiveBayesModel(
        { theta: [[0, 0]], var: [[1, 1]], logPriors: [0, 0] },
        ['가', '나'],
        2,
      ),
    ).toBeNull()
  })

  it('선형 회귀: 계수의 수가 열 수와 같아야 한다', () => {
    expect(sklearnLinearRegressionModel({ coef: [1, 2], intercept: 0 }, 3)).toBeNull()
  })

  it('선형 회귀: 절편이 수가 아니면 안 담는다', () => {
    expect(
      sklearnLinearRegressionModel({ coef: [1, 2], intercept: Number.POSITIVE_INFINITY }, 2),
    ).toBeNull()
  })

  it('K-평균: 중심이 없으면 안 담는다', () => {
    expect(sklearnKMeansModel({ centroids: [] }, 2)).toBeNull()
  })

  it('K-평균: k는 손잡이가 아니라 중심의 수다', () => {
    const model = sklearnKMeansModel(
      {
        centroids: [
          [0, 0],
          [1, 1],
        ],
      },
      2,
    )
    expect(model?.k).toBe(2)
  })

  it('K-평균: 중심의 폭이 다르면 안 담는다', () => {
    expect(sklearnKMeansModel({ centroids: [[0, 0], [1]] }, 2)).toBeNull()
  })

  it('참조형: 이웃 수가 0 이하면 안 담는다', () => {
    expect(sklearnReferenceModel(['가'], 2, [0, 1], 0)).toBeNull()
  })

  it('참조형: 본 행이 없으면 안 담는다', () => {
    expect(sklearnReferenceModel(['가'], 2, [], 3)).toBeNull()
  })
})

/**
 * **포레스트는 옮길 수 있지만 안 담는다** — 예측 규칙이 다르기 때문이다. sklearn은
 * 나무마다의 확률을 평균해 고르고, 우리 형식의 해석기는 다수결이다
 * (`ml/models/tree.ts`의 `vote`, ml.js가 그렇게 한다).
 *
 * **갈린 줄이 몇인지가 그 결정의 근거다** (2026-09-19). 이유가 *"조금 다르다"*가 아니라
 * **387행 중 12행**이라는 실측이고, 그 수가 여기 있어야 다음 사람이 같은 판단을 다시 할
 * 수 있다. **0이 되는 날은 규칙이 같아졌거나 대조가 사라진 것**이고, 둘 다 사람이 봐야
 * 하는 변화다.
 *
 * **여기서 한 번에 센다.** 벌마다 나눠 담아 두면 검사 하나만 돌릴 때 합계가 0이 되어
 * **실행 순서에 기대는 검사**가 된다.
 */
/**
 * **참조형은 담되, 갈릴 수 있는 자리가 어디인지 세어 둔다** (2026-09-19).
 *
 * KNN의 파일은 배운 값이 아니라 *본 행*이라, 학습 화면의 지표는 sklearn이 내고 예측
 * 화면의 답은 **우리 해석기가** 낸다. 둘이 갈릴 수 있는 곳은 **sklearn이 규약을 정하지
 * 않은 자리** 하나다 — k번째와 k+1번째 이웃의 거리가 같은 행.
 *
 * **그 행이 387 중 32이고, 실제로 갈린 줄은 1이다** (픽스처 여덟 벌, sklearn 1.9.1).
 * "규약이 없다"는 사실만으로는 몇 줄이 다른지 모르고, **모르는 채로 담을지 말지를 정할
 * 수는 없다** — 포레스트를 안 담기로 한 판단도 3.1%라는 수 위에 섰다.
 *
 * **둘의 차이가 담고 안 담는 선이다.** 포레스트가 갈리는 자리는 sklearn이 답을 정해 둔
 * 곳이라 우리가 틀린 것이고, 여기가 갈리는 자리는 **아무도 답을 안 정한 곳**이다.
 */
describe('참조형이 갈릴 수 있는 자리를 센다', () => {
  it('이웃 동점 행에서 실제로 갈리는 줄이 몇인가', () => {
    let rows = 0
    let undecided = 0
    let diverged = 0
    for (const [name, entry] of Object.entries(document.datasets)) {
      if (entry.meta.taskType === 'regression') continue
      const recorded = entry.sklearn['knn']
      expect(recorded?.dumpLabels, `${name}/knn dumpLabels`).toBeDefined()
      expect(recorded?.labels, `${name}/knn labels`).toBeDefined()
      if (!recorded?.dumpLabels || !recorded.labels) continue

      const prepared = preparedFor(name, entry)
      const model = sklearnReferenceModel(
        prepared.classes,
        prepared.featureCount,
        prepared.trainIndices,
        5,
      )
      expect(model, `${name}: the reference model must map onto our format`).not.toBeNull()
      if (model === null) continue

      const ours = loadModel(
        JSON.parse(JSON.stringify(model)) as unknown,
        prepared.context,
      )(prepared.test)
      rows += recorded.dumpLabels.length
      undecided += recorded.labels.filter((label) => label === null).length
      diverged += ours.filter((value, index) => value !== recorded.dumpLabels?.[index]).length
    }

    expect(rows, 'every classification fixture must be counted').toBeGreaterThan(0)
    // **판정 불능 행이 있다는 것 자체가 실측이다.** 0이 되면 sklearn이 규약을 정했거나
    // 픽스처가 그 모양을 잃은 것이고, 둘 다 사람이 봐야 하는 변화다.
    expect(undecided, 'ties exist — that is why this count is here').toBeGreaterThan(0)
    // **갈린 줄은 판정 불능 행을 넘을 수 없다.** 넘었다면 규약 차이가 아니라 결함이다 —
    // 이웃 집합이 같은 행에서 다른 답이 나온 것이기 때문이다.
    expect(diverged, `KNN diverges only where the tie rule is undefined`).toBeLessThanOrEqual(
      undecided,
    )
  })
})

describe('포레스트를 안 담는 이유가 수로 남아 있다', () => {
  it('다수결과 확률 평균이 갈리는 줄이 있다', () => {
    let counted = 0
    let diverged = 0
    for (const [name, entry] of Object.entries(document.datasets)) {
      if (entry.meta.taskType === 'regression') continue
      const found = entry.sklearn['random_forest']
      expect(found?.dump, `${name}/random_forest dump`).toBeDefined()
      if (!found?.dump || !found.dumpLabels) continue

      const prepared = preparedFor(name, entry)
      const model = sklearnTreeModel(
        found.dump as SklearnForestDump,
        prepared.classes,
        prepared.featureCount,
      )
      expect(model, `${name}: the dump still maps onto our format`).not.toBeNull()
      if (model === null) continue

      const ours = loadModel(JSON.parse(JSON.stringify(model)) as unknown)(prepared.test)
      const labels = found.dumpLabels
      counted += 1
      diverged += ours.filter((value, index) => value !== labels[index]).length
    }
    expect(counted, 'every classification fixture must be counted').toBeGreaterThan(0)
    expect(diverged, 'soft voting and majority voting still disagree').toBeGreaterThan(0)
  })

  it('어댑터가 포레스트를 안 담는다', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'ml', 'engines', 'pyodide-sklearn.ts'),
      'utf8',
    )
    const forest = /random_forest: \{[^}]*\}/.exec(source)?.[0] ?? ''
    expect(forest, 'random_forest entry not found').not.toBe('')
    expect(forest).not.toContain('serializer')
  })
})
