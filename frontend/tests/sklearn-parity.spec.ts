/**
 * 순수 JS 엔진 vs scikit-learn — **픽스처 대조가 CI 관문이다**
 * (open-decisions.md "sklearn 대조 픽스처가 CI 관문에 들어간다").
 *
 * `tests/models.spec.ts`는 "저장했다 읽으면 같은 예측"을 지키지만 **찍기보다 못한 모델도
 * 충실하게 왕복한다.** 이 엔진의 결함 셋이 전부 sklearn 대조에서만 잡혔다 —
 * `ml-naivebayes`의 특성 2개, 로지스틱 원좌표 발산, `ml-svm`의 H 수식 (V2 감사 1단계-A).
 * 그 대조를 상시 장치로 만든 것이 이 파일이다.
 *
 * 기대값은 `fixtures/sklearn/expected.json`이고 `scripts/generate_sklearn_fixtures.py`가
 * 만든다. **여기서는 파이썬이 필요 없다** — CI의 별도 잡이 픽스처가 낡지 않았는지를
 * sklearn 재계산으로 따로 지킨다.
 *
 * **분할 인덱스는 픽스처에 굳어 있다.** 여기서 다시 나누지 않는다 — 분할 코드가 바뀌어도
 * 이 대조는 같은 행 위에서 성립하고, 분할 자체는 tests/split.spec.ts가 지킨다.
 *
 * 판정 문턱은 전부 감사 실측에서 유도했다 (open-decisions.md의 표). 임의 상수가 아니다.
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { fit } from '../src/ml/engines/mljs'
import { evaluate } from '../src/ml/metrics'
import type { LinearRegressionModel, NaiveBayesModel } from '../src/ml/models'
import { fitPreprocessor, targetValues, transform, type Dataset } from '../src/ml/preprocess'

const FIXTURES = path.join(__dirname, 'fixtures', 'sklearn')

interface FixtureEntry {
  meta: { target: string; taskType: 'classification' | 'regression'; features: string[] }
  randomState: number
  trainIndices: number[]
  testIndices: number[]
  baseline?: number
  sklearn: Record<
    string,
    {
      accuracy?: number
      labels?: (string | null)[]
      params?: { theta: number[][]; var: number[][]; classLogPrior: number[] }
      coefficients?: number[]
      intercept?: number
      r2?: number
    }
  >
}

const document: { sklearnVersion: string; datasets: Record<string, FixtureEntry> } = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'),
)

/**
 * 정확도 여유. 실측 최대 결손(트리 계열 0.075)의 여유 배수다 —
 * 동점 분할·배깅 난수·수렴 경로가 정당하게 갈리는 자리만 흡수하고,
 * "찍기보다 못하다"급 결함은 기준선 검사가 따로 잡는다.
 *
 * 로지스틱은 여기 없다 — L2 솔버 교체(1단계-B) 뒤로는 나이브베이즈·KNN처럼 **라벨
 * 단위로 굳힌다**(경계 위의 행만 생성기가 null로 비워 둔다). 0.05였던 여유를 라벨
 * 일치로 좁힌 것이 교체가 성공했다는 증거다 — 실측 근거는 open-decisions.md의
 * "로지스틱 회귀 솔버를 sklearn과 같은 구조로 바꾼다".
 */
const TREE_FAMILY_TOLERANCE = 0.1
/** 닫힌 식 파라미터의 허용 상대차. 실측은 비트 일치였다 — 여유는 플랫폼 몫이다. */
const PARAM_RELATIVE_TOLERANCE = 1e-9
/** 최소제곱 해석해의 허용 절대차. 실측은 1e-11 이하였다. */
const LSTSQ_TOLERANCE = 1e-6

function readCsv(name: string): Dataset {
  const text = fs.readFileSync(path.join(FIXTURES, 'data', `${name}.csv`), 'utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  const [header, ...rows] = lines
  return {
    columns: (header as string).split(','),
    rows: rows.map((line) => line.split(',')),
  }
}

function relativeGap(ours: readonly number[], sklearn: readonly number[]): number {
  let worst = 0
  ours.forEach((value, index) => {
    const reference = sklearn[index] ?? 0
    worst = Math.max(worst, Math.abs(value - reference) / (Math.abs(reference) + 1e-12))
  })
  return worst
}

for (const [name, entry] of Object.entries(document.datasets)) {
  describe(`sklearn 대조 · ${name}`, () => {
    const dataset = readCsv(name)
    const preprocessor = fitPreprocessor(dataset, entry.trainIndices, entry.meta.features, {
      missing: 'drop',
      scaling: 'none',
      categoricalEncoding: 'onehot',
    })
    const trainFeatures = transform(preprocessor, dataset, entry.trainIndices, 'onehot')
    const testFeatures = transform(preprocessor, dataset, entry.testIndices, 'onehot')
    const trainTarget = targetValues(dataset, entry.trainIndices, entry.meta.target)
    const testTarget = targetValues(dataset, entry.testIndices, entry.meta.target)

    if (entry.meta.taskType === 'regression') {
      it('선형 회귀 — 계수·절편·R²가 최소제곱 해석해와 같다', () => {
        const expected = entry.sklearn.linear_regression
        const { predict, model } = fit('linear_regression', {
          features: trainFeatures,
          rowIndices: entry.trainIndices,
          target: trainTarget.map(Number),
          hyperparameters: {},
          randomState: entry.randomState,
        })
        const coefficients = (model as LinearRegressionModel).coefficients
        expected?.coefficients?.forEach((value, index) => {
          expect(Math.abs((coefficients[index] ?? 0) - value)).toBeLessThan(LSTSQ_TOLERANCE)
        })
        expect(
          Math.abs((model as LinearRegressionModel).intercept - (expected?.intercept ?? 0)),
        ).toBeLessThan(LSTSQ_TOLERANCE)

        const evaluation = evaluate('regression', testTarget.map(Number), predict(testFeatures))
        expect(Math.abs((evaluation.metrics.r2 ?? 0) - (expected?.r2 ?? 0))).toBeLessThan(
          LSTSQ_TOLERANCE,
        )
      })
      return
    }

    for (const [algorithm, expected] of Object.entries(entry.sklearn)) {
      it(`${algorithm} — sklearn 수준이고 기준선을 넘는다`, () => {
        const { predict } = fit(algorithm, {
          features: trainFeatures,
          rowIndices: entry.trainIndices,
          target: trainTarget,
          hyperparameters: {},
          randomState: entry.randomState,
        })
        const predicted = predict(testFeatures)
        const evaluation = evaluate('classification', testTarget, predicted)
        const accuracy = evaluation.metrics.accuracy ?? 0

        // **기준선 검사가 이 파일의 핵심이다.** 다수 클래스로 전부 찍는 것보다 못한
        // 모델이 조용히 지나가는 일이 다시는 없어야 한다.
        expect(accuracy, `${name}/${algorithm} 기준선`).toBeGreaterThan(entry.baseline ?? 0)

        if (expected.labels) {
          // 답이 하나뿐인 알고리즘(나이브베이즈·KNN·로지스틱)은 라벨 단위로 완전히
          // 같아야 한다. **null은 판정 불능 행이다** — KNN의 이웃 선택 동점, 로지스틱의
          // 경계 위 행처럼 규약 또는 tol 수준 잔차가 답을 가르는 자리라 생성기가 라벨을
          // 굳히지 않았다. 그 행만 건너뛴다.
          expected.labels.forEach((label, index) => {
            if (label === null) return
            expect(predicted[index], `${name}/${algorithm} 라벨 ${index}행`).toBe(label)
          })
        } else {
          expect(accuracy, `${name}/${algorithm} vs sklearn`).toBeGreaterThanOrEqual(
            (expected.accuracy ?? 0) - TREE_FAMILY_TOLERANCE,
          )
        }

        if (algorithm === 'naive_bayes' && expected.params) {
          const { model } = fit('naive_bayes', {
            features: trainFeatures,
            rowIndices: entry.trainIndices,
            target: trainTarget,
            hyperparameters: {},
            randomState: entry.randomState,
          })
          const trained = model as NaiveBayesModel
          trained.means.forEach((row, index) => {
            expect(relativeGap(row, expected.params?.theta[index] ?? [])).toBeLessThan(
              PARAM_RELATIVE_TOLERANCE,
            )
          })
          trained.variances.forEach((row, index) => {
            expect(relativeGap(row, expected.params?.var[index] ?? [])).toBeLessThan(
              PARAM_RELATIVE_TOLERANCE,
            )
          })
          expect(relativeGap(trained.logPriors, expected.params.classLogPrior)).toBeLessThan(
            PARAM_RELATIVE_TOLERANCE,
          )
        }
      })
    }
  })
}
