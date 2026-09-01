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
import type { LinearModelV2, LinearRegressionModel, NaiveBayesModel } from '../src/ml/models'
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
      /** 로지스틱만. sklearn이 수렴했는가 - 라벨 완전 일치 관문의 전제다 (1단계-C). */
      converged?: boolean
      nIter?: number
      /**
       * 알고리즘마다 담는 것이 다르다 — 나이브베이즈는 `theta`·`var`·`classLogPrior`,
       * 로지스틱은 `coef`·`intercept`다. **각 필드가 선택인 이유가 그것이고, 읽는 쪽은
       * 자기 알고리즘의 필드가 실제로 왔는지를 먼저 단언한다** — 없는 필드를 조용히
       * 건너뛰면 단언이 사라진다 (R9 감사 C-2와 같은 자리).
       */
      params?: {
        theta?: number[][]
        var?: number[][]
        classLogPrior?: number[]
        coef?: number[][]
        intercept?: number[]
      }
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

/**
 * 경고 발화가 sklearn과 갈리는 것이 **기록된 예외**인 데이터셋 (1단계-C).
 *
 * iris: sklearn은 83회에 아슬아슬하게 수렴하고(전처리 안내를 문서에 둘 만큼 유명한
 * 자리다), 우리 선탐색(Armijo 역추적)은 scipy(강한 Wolfe)보다 tol 도달 꼬리가 길어
 * 100회를 넘긴다 - **보수적인 쪽**(경고를 내는 쪽)으로 갈린다. 문턱을 조정해
 * 침묵시키지 않는다 - 그러면 근거 없는 임계값이 된다. 여기 없는 데이터셋에서
 * 발화가 갈리면 그건 예외가 아니라 결함이다.
 */
const CONVERGENCE_MISMATCH_EXCEPTIONS: Readonly<Record<string, 'ours-warns'>> = {
  iris: 'ours-warns',
}
/** 닫힌 식 파라미터의 허용 상대차. 실측은 비트 일치였다 — 여유는 플랫폼 몫이다. */
const PARAM_RELATIVE_TOLERANCE = 1e-9

/**
 * 로지스틱 계수의 허용차. **절대와 상대를 함께 쓴다** (`|ours − sk| ≤ 절대 + 상대·|sk|`).
 *
 * **어느 하나로는 못 잡는다** — 계수가 큰 벌(`sum120`)은 절대차가 6.8e-3인데 상대차는
 * 4.8e-5이고, 계수가 0에 가까운 벌(`missing`)은 절대차가 4.0e-4인데 상대차가 7.3e-3이다.
 * 하나만 쓰면 둘 중 한쪽에서 근거 없이 빡빡하거나 근거 없이 헐렁해진다.
 *
 * 값은 **수렴한 일곱 벌의 실측(절대 최대 9.98e-4 · 상대 최대 7.3e-3)의 다섯 배 여유**다.
 * 우리 솔버가 기울기 `tol`(1e-4)에서 멈추므로 계수의 마지막 자리는 원래 이만큼 흔들린다.
 *
 * **처음에 1e-2로 잡았다가 좁혔다.** 트립와이어(이진 계수에 2%를 태우는 것)가 그 값에서
 * **안 물었다** — 상대 여유가 곧 "몇 %까지 봐준다"라서, 1e-2는 1% 오차를 정의상 통과시킨다.
 * 지금 값은 실측에 다섯 배 여유를 두면서 **1% 오차부터 문다.**
 */
const PARAM_ABS_TOLERANCE = 5e-3
const PARAM_REL_TOLERANCE = 5e-3
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

/**
 * **검사의 수가 픽스처에서 나온다. 그래서 픽스처가 얇아지면 검사가 조용히 사라진다.**
 *
 * 실제로 `expected.json`에서 데이터셋 하나와 알고리즘 하나를 지우니 **49개가 42개로
 * 줄고 그대로 초록**이었다 (R9 감사 B-5). 이 파일은 이 저장소의 수치 정확성 **마지막
 * 그물**이라 — 엔진 안에서 씨앗을 상수로 못 박았을 때 우는 두 파일 중 하나다 —
 * 그물이 몇 칸인지를 자기가 세야 한다.
 *
 * **재생성 대조(`generate_sklearn_fixtures.py --check`)는 이것을 잡지만 `npm run ci`에
 * 없다.** 파이썬이 필요해서 관문 밖에 있고, `CLAUDE.md`는 관문이 명령 하나라고 못 박았다.
 */
describe('대조가 줄어들지 않았다', () => {
  it('데이터셋 아홉이 그대로 있다', () => {
    expect(Object.keys(document.datasets).sort()).toEqual([
      'categorical',
      'iris',
      'missing',
      'multi',
      'origin',
      'overlap',
      'regress',
      'scale',
      'sum120',
    ])
  })

  it('분류 데이터셋마다 알고리즘 여섯을 다 견준다', () => {
    for (const [name, entry] of Object.entries(document.datasets)) {
      if (entry.meta.taskType === 'regression') {
        expect(Object.keys(entry.sklearn), name).toEqual(['linear_regression'])
        continue
      }
      expect(Object.keys(entry.sklearn).sort(), name).toEqual([
        'decision_tree',
        'knn',
        'logistic_regression',
        'naive_bayes',
        'random_forest',
        'svm',
      ])
    }
  })
})

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
        // **선택 필드라 없으면 forEach가 한 번도 안 돈다** - 단언이 조용히 사라진다
        // (R9 감사 C-2). 픽스처가 주기로 한 것을 주는지를 먼저 본다.
        expect(expected?.coefficients, `${name}: coefficient reference`).toBeDefined()
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
        const { predict, warning } = fit(algorithm, {
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
        expect(accuracy, `${name}/${algorithm} baseline`).toBeGreaterThan(entry.baseline ?? 0)

        // **경고 발화 자체가 관문이다** (1단계-C). 우리 run.warning의 유무가 sklearn의
        // 수렴 실패 여부와 같아야 한다 — 11벌 + 독립 2벌에서 같은 자리에 떴다는 것이
        // 이 감사의 가장 값진 실측이고, 관찰로만 두면 다음 변경에서 조용히 사라진다.
        const ourWarned = warning !== undefined
        if (algorithm === 'logistic_regression') {
          if (CONVERGENCE_MISMATCH_EXCEPTIONS[name] === 'ours-warns') {
            // 기록된 예외 — 우리가 보수적인 쪽. 이 상태가 바뀌는 것도 알아야 한다.
            expect(ourWarned, `${name} exception: only we warn`).toBe(true)
            expect(expected.converged, `${name} exception: sklearn converges`).toBe(true)
          } else {
            expect(ourWarned, `${name} warns exactly where sklearn does`).toBe(
              expected.converged === false,
            )
          }
        }

        // **양쪽이 수렴했을 때만 라벨 완전 일치가 구조다** (L2의 유일 최적점, 1단계-C).
        // 한쪽이라도 반복 예산에서 멈췄으면 둘은 경로 중간의 서로 다른 지점이다 —
        // 트리 계열과 같은 갈래 (2)이므로 같은 여유를 쓰고, 얼마나 갈렸는지(일치율)를
        // 판정에 남긴다.
        const bothConverged =
          algorithm !== 'logistic_regression' || (expected.converged === true && !ourWarned)

        if (expected.labels && bothConverged) {
          // 답이 하나뿐인 알고리즘(나이브베이즈·KNN·수렴한 로지스틱)은 라벨 단위로
          // 완전히 같아야 한다. **null은 판정 불능 행이다** — KNN의 이웃 선택 동점,
          // 로지스틱의 경계 위 행처럼 규약 또는 tol 수준 잔차가 답을 가르는 자리라
          // 생성기가 라벨을 굳히지 않았다. 그 행만 건너뛴다.
          expected.labels.forEach((label, index) => {
            if (label === null) return
            expect(predicted[index], `${name}/${algorithm} label row ${index}`).toBe(label)
          })
        } else if (expected.labels) {
          // 비수렴 로지스틱: 정확도·기준선에 더해 라벨 일치율을 판정에 남긴다.
          const agreement =
            expected.labels.filter((label, index) => label === null || predicted[index] === label)
              .length / expected.labels.length
          expect(
            accuracy,
            `${name}/${algorithm} (not converged) vs sklearn`,
          ).toBeGreaterThanOrEqual((expected.accuracy ?? 0) - TREE_FAMILY_TOLERANCE)
          expect(
            agreement,
            `${name}/${algorithm} (not converged) label agreement ${agreement.toFixed(4)}`,
          ).toBeGreaterThanOrEqual(1 - TREE_FAMILY_TOLERANCE)
        } else {
          expect(accuracy, `${name}/${algorithm} vs sklearn`).toBeGreaterThanOrEqual(
            (expected.accuracy ?? 0) - TREE_FAMILY_TOLERANCE,
          )
        }

        if (algorithm === 'naive_bayes' && expected.params) {
          expect(expected.params.theta, `${name}: naive bayes reference`).toBeDefined()
          const { model } = fit('naive_bayes', {
            features: trainFeatures,
            rowIndices: entry.trainIndices,
            target: trainTarget,
            hyperparameters: {},
            randomState: entry.randomState,
          })
          const trained = model as NaiveBayesModel
          trained.means.forEach((row, index) => {
            expect(relativeGap(row, expected.params?.theta?.[index] ?? [])).toBeLessThan(
              PARAM_RELATIVE_TOLERANCE,
            )
          })
          trained.variances.forEach((row, index) => {
            expect(relativeGap(row, expected.params?.var?.[index] ?? [])).toBeLessThan(
              PARAM_RELATIVE_TOLERANCE,
            )
          })
          expect(relativeGap(trained.logPriors, expected.params.classLogPrior ?? [])).toBeLessThan(
            PARAM_RELATIVE_TOLERANCE,
          )
        }

        /**
         * **로지스틱 계수를 sklearn과 견준다** (2026-08-31). 화면이 이 값을 학생에게
         * 보여주기로 했으므로(`open-decisions.md` "모델이 무엇을 배웠는지 화면이 보여준다")
         * 보여주는 숫자가 대조 밑에 있어야 한다.
         *
         * **양쪽이 수렴했을 때만이다.** 갈래 (2)에서는 둘이 경로 중간의 서로 다른 점이라
         * 계수가 3배까지 갈리고(1단계-C), 그건 결함이 아니다 — 라벨 판정과 같은 전제다.
         *
         * **이진은 우리가 ±절반 두 줄로 담는다** (`mlpx-spec.md` §5.4.1). 위쪽 줄을 두 배
         * 하면 sklearn의 한 줄이다. 픽스처는 sklearn의 모양 그대로 갖고, 맞추는 일은
         * 여기서 한다.
         */
        if (algorithm === 'logistic_regression' && expected.params && bothConverged) {
          expect(expected.params.coef, `${name}: logistic coefficient reference`).toBeDefined()
          const { model } = fit('logistic_regression', {
            features: trainFeatures,
            rowIndices: entry.trainIndices,
            target: trainTarget,
            hyperparameters: {},
            randomState: entry.randomState,
          })
          const trained = model as LinearModelV2
          const coef = expected.params.coef ?? []
          const intercept = expected.params.intercept ?? []
          const binary = coef.length === 1
          const ourCoef = binary
            ? [(trained.weights[1] ?? []).map((value) => value * 2)]
            : trained.weights
          const ourIntercept = binary ? [(trained.intercepts[1] ?? 0) * 2] : trained.intercepts
          coef.forEach((row, index) => {
            row.forEach((reference, position) => {
              const ours = (ourCoef[index] ?? [])[position] ?? 0
              expect(
                Math.abs(ours - reference),
                `${name} coefficient [${index}][${position}]`,
              ).toBeLessThanOrEqual(PARAM_ABS_TOLERANCE + PARAM_REL_TOLERANCE * Math.abs(reference))
            })
          })
          intercept.forEach((reference, index) => {
            expect(
              Math.abs((ourIntercept[index] ?? 0) - reference),
              `${name} intercept [${index}]`,
            ).toBeLessThanOrEqual(PARAM_ABS_TOLERANCE + PARAM_REL_TOLERANCE * Math.abs(reference))
          })
        }
      })
    }
  })
}
