/**
 * **열마다의 범주형 인코딩으로 돌린 앱의 실험 run이 sklearn과 같은 답을 낸다** (open-decisions.md 116, 코드 소유자).
 *
 * 설정의 거의 모든 조합(공통값 셋 × 등급 열 다섯 × 지역 열 다섯 + 무시돼야 하는 덮어쓰기 판)마다
 * **앱의 `runExperiment`를 그대로 돌리고**, 생성기(`scripts/generate_sklearn_fixtures.py`의
 * `column_encoding_runs_record`)가 sklearn `ColumnTransformer` + 모델로 낸 값과 견준다. 행렬은
 * sklearn이 스스로 지었다 — 우리 전처리 규칙을 파이썬으로 옮겨 적지 않았다.
 *
 * - **선형 회귀** — 계수·절편·R²·MAE·RMSE. 해석해라 엔진의 몫이 없다(`LSTSQ_TOLERANCE`).
 * - **가우시안 나이브 베이즈** — 평균·분산·사전확률(상대 1e-9)과 정확도·혼동 행렬.
 * - **KNN** — 시험 행마다의 예측과 혼동 행렬, 전부. 동점 규칙은 견주지 않는다 — **동점이 날 수 없는 표다**
 *   (생성기의 `_assert_tie_free`가 거리의 k번째·k+1번째와 득표를 보고, 걸리면 생성을 멈춘다. 정답은 두 범주라
 *   k=5에서 득표 동점이 없다). 동점에서 누가 뽑히는지는 sklearn이 정하지 않으므로 그 자리를 견주면
 *   인코딩이 아니라 동점 규칙을 재게 된다(코드 소유자).
 * - **로지스틱 회귀** — 계수·절편(`sklearn-parity.spec.ts`와 같은 여유)과 혼동 행렬. 결정 경계에 붙은 시험
 *   행이 없고 sklearn이 수렴한 표다(생성기가 확인한다).
 *
 * 분할은 `provided`다 — 훈련 표 전체와 따로 올린 시험 표라 양쪽이 같은 행을 본다. 시험 표에는
 * 훈련에 없던 등급(`최상`)과 지역(`제주`)이 있다 — 순서 인코딩은 −1, 원-핫은 전부 0이어야 같다.
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { RuntimeContext } from '../src/ml/backend'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import type {
  LinearModelV2,
  LinearRegressionModel,
  ModelFile,
  NaiveBayesModel,
} from '../src/ml/models'
import { fit } from '../src/ml/engines/mljs'
import { targetValues, transform, type Dataset } from '../src/ml/preprocess'
import { dataSnapshot, type Preprocessing, type Settings } from '../src/project/schema'

interface ClassifierRecord {
  accuracy: number
  labels: string[]
  confusionMatrix: number[][]
  converged?: boolean
  predictions?: string[]
  params?: {
    theta?: number[][]
    var?: number[][]
    classLogPrior?: number[]
    coef?: number[][]
    intercept?: number[]
  }
}

interface Scenario {
  name: string
  preprocessing: Preprocessing
  featureCount: number
  linear_regression: {
    coefficients: number[]
    intercept: number
    r2: number
    mae: number
    rmse: number
  }
  naive_bayes: ClassifierRecord
  knn: ClassifierRecord
  logistic_regression: ClassifierRecord
}

const fixture: {
  columns: string[]
  features: string[]
  trainRows: string[][]
  testRows: string[][]
  scenarios: Scenario[]
} = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'sklearn', 'expected.json'), 'utf8'),
).columnEncodingRuns

/** 최소제곱 해석해의 허용 절대차 (`sklearn-parity.spec.ts`와 같은 값, 실측 1e-11 이하). */
const LSTSQ_TOLERANCE = 1e-6
/** 나이브 베이즈 매개변수의 상대 차 (`sklearn-parity.spec.ts`의 `PARAM_RELATIVE_TOLERANCE`). */
const PARAM_RELATIVE_TOLERANCE = 1e-9
/** 로지스틱 계수의 여유 (`sklearn-parity.spec.ts`의 `PARAM_ABS_TOLERANCE`·`PARAM_REL_TOLERANCE`). */
const PARAM_ABS_TOLERANCE = 5e-3
const PARAM_REL_TOLERANCE = 5e-3

const CONTEXT: RuntimeContext = {
  serverStatus: 'unavailable',
  limitsOff: false,
  rowCount: fixture.trainRows.length,
  dataType: 'tabular',
}
const NOW = { now: () => '2026-10-20T00:00:00.000Z' }

const train: Dataset = { columns: fixture.columns, rows: fixture.trainRows }
const test: Dataset = { columns: fixture.columns, rows: fixture.testRows }

function settingsFor(preprocessing: Preprocessing, target: string, algorithms: string[]): Settings {
  return {
    split: { method: 'provided', testSize: 0.2, stratify: false, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: algorithms.map((algorithm) => ({ algorithm })),
    hyperparameters: {},
    data: {
      dataset: {
        path: 'dataset/data.csv',
        originalFileName: 'train.csv',
        hasHeader: true,
        encoding: 'utf-8',
      },
      features: fixture.features,
      target,
      preprocessing,
    },
  }
}

async function run(
  preprocessing: Preprocessing,
  taskType: 'classification' | 'regression',
  target: string,
  algorithms: string[],
) {
  const settings = settingsFor(preprocessing, target, algorithms)
  const input: ExperimentInput = {
    dataset: train,
    testDataset: test,
    taskType,
    dataType: 'tabular',
    settings,
    context: CONTEXT,
    snapshot: dataSnapshot('tabular', settings),
  }
  const result = await runExperiment(input, NOW)
  const runs = new Map(result.experiment.runs.map((one) => [one.algorithm, one]))
  const modelOf = (algorithm: string): ModelFile | undefined => {
    const id = runs.get(algorithm)?.id
    return id === undefined ? undefined : result.models.get(id)
  }
  return { runs, modelOf, preprocessor: result.preprocessor }
}

function closeRel(ours: number, reference: number): boolean {
  return Math.abs(ours - reference) <= 1e-12 + PARAM_RELATIVE_TOLERANCE * Math.abs(reference)
}

describe('열별 인코딩 · 앱의 실험 run vs sklearn', () => {
  it('조합이 빠짐없이 있다 - 공통값 셋 × 열 다섯 × 열 다섯 + 무시 판 하나', () => {
    expect(fixture.scenarios).toHaveLength(3 * 5 * 5 + 1)
  })

  for (const scenario of fixture.scenarios) {
    describe(scenario.name, () => {
      it('선형 회귀 — 특성 수·계수·절편·R²·MAE·RMSE가 sklearn과 같다', async () => {
        const { runs, modelOf, preprocessor } = await run(
          scenario.preprocessing,
          'regression',
          'y',
          ['linear_regression'],
        )
        expect(preprocessor.featureNames).toHaveLength(scenario.featureCount)
        const record = runs.get('linear_regression')
        expect(record?.status).toBe('done')
        const expected = scenario.linear_regression
        const model = modelOf('linear_regression') as LinearRegressionModel | undefined
        expect(model?.coefficients).toHaveLength(expected.coefficients.length)
        expected.coefficients.forEach((value, index) => {
          expect(Math.abs((model?.coefficients[index] ?? Number.NaN) - value)).toBeLessThan(
            LSTSQ_TOLERANCE,
          )
        })
        expect(Math.abs((model?.intercept ?? Number.NaN) - expected.intercept)).toBeLessThan(
          LSTSQ_TOLERANCE,
        )
        for (const key of ['r2', 'mae', 'rmse'] as const) {
          expect(
            Math.abs((record?.metrics?.[key] ?? Number.NaN) - expected[key]),
            key,
          ).toBeLessThan(LSTSQ_TOLERANCE)
        }
      })

      it('나이브 베이즈 — 평균·분산·사전확률과 정확도·혼동 행렬이 sklearn과 같다', async () => {
        const { runs, modelOf } = await run(scenario.preprocessing, 'classification', 'level', [
          'naive_bayes',
        ])
        const record = runs.get('naive_bayes')
        const expected = scenario.naive_bayes
        expect(record?.status).toBe('done')
        expect(record?.metrics?.accuracy).toBeCloseTo(expected.accuracy, 12)
        expect(record?.confusionMatrix?.labels).toEqual(expected.labels)
        expect(record?.confusionMatrix?.matrix).toEqual(expected.confusionMatrix)

        const bayes = modelOf('naive_bayes') as NaiveBayesModel | undefined
        const params = expected.params
        expect(params?.theta, 'naive bayes reference').toBeDefined()
        params?.theta?.forEach((row, c) =>
          row.forEach((value, j) =>
            expect(closeRel(bayes?.means[c]?.[j] ?? Number.NaN, value), `theta[${c}][${j}]`).toBe(
              true,
            ),
          ),
        )
        params?.var?.forEach((row, c) =>
          row.forEach((value, j) =>
            expect(closeRel(bayes?.variances[c]?.[j] ?? Number.NaN, value), `var[${c}][${j}]`).toBe(
              true,
            ),
          ),
        )
        params?.classLogPrior?.forEach((value, c) =>
          expect(closeRel(bayes?.logPriors[c] ?? Number.NaN, value), `prior[${c}]`).toBe(true),
        )
      })

      it('KNN — 시험 행마다의 예측과 혼동 행렬이 sklearn과 같다', async () => {
        const { runs, preprocessor } = await run(
          scenario.preprocessing,
          'classification',
          'level',
          ['knn'],
        )
        const record = runs.get('knn')
        const expected = scenario.knn
        expect(record?.status).toBe('done')
        expect(record?.metrics?.accuracy).toBeCloseTo(expected.accuracy, 12)
        expect(record?.confusionMatrix?.labels).toEqual(expected.labels)
        expect(record?.confusionMatrix?.matrix).toEqual(expected.confusionMatrix)

        // 행마다 — 혼동 행렬이 같아도 서로 다른 행에서 틀릴 수 있다.
        const trainRows = train.rows.map((_row, index) => index)
        const testRows = test.rows.map((_row, index) => index)
        const { predict } = await fit('knn', {
          features: transform(preprocessor, train, trainRows),
          rowIndices: trainRows,
          target: targetValues(train, trainRows, 'level'),
          taskType: 'classification',
          hyperparameters: {},
          randomState: 42,
        })
        expect(predict(transform(preprocessor, test, testRows)).map(String)).toEqual(
          expected.predictions,
        )
      })

      // 로지스틱 — sklearn이 수렴했을 때만 계수를 견준다(`sklearn-parity.spec.ts`와 같은 전제).
      it('로지스틱 회귀 — 계수·절편과 혼동 행렬이 sklearn과 같다', async () => {
        const { runs, modelOf } = await run(scenario.preprocessing, 'classification', 'level', [
          'logistic_regression',
        ])
        const logistic = scenario.logistic_regression
        expect(runs.get('logistic_regression')?.status).toBe('done')
        expect(logistic.converged, 'sklearn logistic converged').toBe(true)
        const trained = modelOf('logistic_regression') as LinearModelV2 | undefined
        expect(trained?.classes).toEqual(logistic.labels)
        expect(logistic.params?.coef, 'logistic reference').toBeDefined()
        // **이진은 우리가 ±절반 두 줄로 담는다**(mlpx-spec.md §5.4.1) — 위쪽 줄을 두 배 하면 sklearn의
        // 한 줄이다. 맞추는 일은 `sklearn-parity.spec.ts`처럼 여기서 한다.
        const binary = (logistic.params?.coef ?? []).length === 1
        const ourCoef = binary
          ? [(trained?.weights[1] ?? []).map((value) => value * 2)]
          : (trained?.weights ?? [])
        const ourIntercept = binary
          ? [(trained?.intercepts[1] ?? Number.NaN) * 2]
          : (trained?.intercepts ?? [])
        expect(binary, 'pass/fail target').toBe(true)
        logistic.params?.coef?.forEach((row, c) =>
          row.forEach((reference, j) => {
            const ours = ourCoef[c]?.[j] ?? Number.NaN
            expect(Math.abs(ours - reference), `coef[${c}][${j}]`).toBeLessThanOrEqual(
              PARAM_ABS_TOLERANCE + PARAM_REL_TOLERANCE * Math.abs(reference),
            )
          }),
        )
        logistic.params?.intercept?.forEach((reference, c) => {
          const ours = ourIntercept[c] ?? Number.NaN
          expect(Math.abs(ours - reference), `intercept[${c}]`).toBeLessThanOrEqual(
            PARAM_ABS_TOLERANCE + PARAM_REL_TOLERANCE * Math.abs(reference),
          )
        })
        expect(runs.get('logistic_regression')?.confusionMatrix?.matrix).toEqual(
          logistic.confusionMatrix,
        )
      })
    })
  }
})
