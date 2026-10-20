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
 * - **로지스틱 회귀** — 계수·절편(`sklearn-parity.spec.ts`와 같은 여유)은 모든 판에서, 라벨은 **허용오차 안의
 *   어떤 해에서도 같은 행**에서 견준다. 생성기가 행마다 |w·x + b| > Σ ε_j·|x_j| + ε_b(ε는 아래 계수 여유)를 보고
 *   그 행을 `labelRows`로 적는다. 두 솔버는 같은 최적점 근처의 서로 다른 점에서 멈추고(이 76판의 실측 최대
 *   절대 5.3e-3·상대 1.2%), 특성이 약한 판은 모델 자신이 경계 근처 행을 가져서 KNN처럼 표로 없앨 수 없다
 *   (구현 감사 B-1). 빠진 행이 없는 판은 혼동 행렬까지 같다.
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
  labelRows?: number[]
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
  logisticTolerance: { abs: number; rel: number }
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

  it('로지스틱 라벨 행을 끌어낸 여유가 이 스펙의 여유와 같다', () => {
    expect(fixture.logisticTolerance).toEqual({
      abs: PARAM_ABS_TOLERANCE,
      rel: PARAM_REL_TOLERANCE,
    })
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
        // 선택 필드라 없으면 forEach가 한 번도 안 돈다 — 단언이 조용히 사라진다(sklearn-parity.spec.ts R9 C-2).
        expect(params?.theta, 'naive bayes theta').toBeDefined()
        expect(params?.var, 'naive bayes var').toBeDefined()
        expect(params?.classLogPrior, 'naive bayes prior').toBeDefined()
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
      it('로지스틱 회귀 — 계수·절편과, 뒤집힐 수 없는 행의 라벨이 sklearn과 같다', async () => {
        const { runs, modelOf, preprocessor } = await run(
          scenario.preprocessing,
          'classification',
          'level',
          ['logistic_regression'],
        )
        const logistic = scenario.logistic_regression
        expect(runs.get('logistic_regression')?.status).toBe('done')
        expect(logistic.converged, 'sklearn logistic converged').toBe(true)
        const trained = modelOf('logistic_regression') as LinearModelV2 | undefined
        expect(trained?.classes).toEqual(logistic.labels)
        expect(logistic.params?.coef, 'logistic coef').toBeDefined()
        expect(logistic.params?.intercept, 'logistic intercept').toBeDefined()
        // **이진은 우리가 두 줄로 담는다**(mlpx-spec.md §5.4.1) — sklearn의 한 줄은 둘의 차다. 차로 쓰면
        // 우리 해가 ±절반으로 대칭이라는 전제 없이도 성립한다(구현 감사 C-2).
        expect(logistic.params?.coef, 'pass/fail target').toHaveLength(1)
        const ourCoef = [
          (trained?.weights[1] ?? []).map(
            (value, j) => value - (trained?.weights[0]?.[j] ?? Number.NaN),
          ),
        ]
        const ourIntercept = [
          (trained?.intercepts[1] ?? Number.NaN) - (trained?.intercepts[0] ?? Number.NaN),
        ]
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

        // 라벨 — 허용오차 안의 어떤 해에서도 같은 행만. 우리 예측은 run과 같은 전처리기·엔진으로 다시 낸다.
        const trainRows = train.rows.map((_row, index) => index)
        const testRows = test.rows.map((_row, index) => index)
        const { predict } = await fit('logistic_regression', {
          features: transform(preprocessor, train, trainRows),
          rowIndices: trainRows,
          target: targetValues(train, trainRows, 'level'),
          taskType: 'classification',
          hyperparameters: {},
          randomState: 42,
        })
        const ours = predict(transform(preprocessor, test, testRows)).map(String)
        const labelRows = logistic.labelRows ?? []
        expect(logistic.predictions, 'logistic reference').toHaveLength(testRows.length)
        expect(labelRows.length, 'most rows are label-comparable').toBeGreaterThanOrEqual(
          testRows.length - 2,
        )
        for (const index of labelRows) {
          expect(ours[index], `row ${index}`).toBe(logistic.predictions?.[index])
        }
        if (labelRows.length === testRows.length) {
          expect(runs.get('logistic_regression')?.confusionMatrix?.matrix).toEqual(
            logistic.confusionMatrix,
          )
        }
      })
    })
  }
})
