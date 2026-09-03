/**
 * 순수 JS 학습 엔진.
 *
 * **숫자를 고정하는 것이 이 파일의 목적이다.** 학생이 같은 데이터와 같은 설정으로
 * 두 번 돌리면 같은 결과가 나와야 하고(재현 가능성), 우리가 의존성을 올릴 때
 * 그 결과가 움직였는지 알아야 한다(재실행 대조가 엔진 버전에 걸려 있으므로).
 *
 * 붓꽃은 sklearn과 대조한 값이 있다 - 결정트리 0.9333, KNN 1.0.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { ALGORITHMS } from '../src/ml/algorithms'
import { logisticObjectiveForTest } from '../src/ml/engines/logistic'
import { MLJS_ALGORITHMS, MLJS_ENGINE, fit, resolve } from '../src/ml/engines/mljs'
import { evaluate } from '../src/ml/metrics'
import { holdoutSplit } from '../src/ml/split'
import packageJson from '../package.json'
import { IRIS_FEATURES, IRIS_LABELS } from './fixtures/iris'

const split = holdoutSplit(
  { rows: [...IRIS_FEATURES.keys()], labels: IRIS_LABELS },
  { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
)

function run(algorithm: string, hyperparameters: Record<string, unknown> = {}) {
  const pick = (indices: readonly number[]) => indices.map((i) => IRIS_FEATURES[i] as number[])
  const labelsOf = (indices: readonly number[]) => indices.map((i) => IRIS_LABELS[i] as string)

  const { predict } = fit(algorithm, {
    features: pick(split.trainIndices),
    rowIndices: split.trainIndices,
    target: labelsOf(split.trainIndices),
    taskType: 'classification',
    hyperparameters,
    randomState: 42,
  })
  return evaluate('classification', labelsOf(split.testIndices), predict(pick(split.testIndices)))
}

describe('등록부가 서로 맞는다', () => {
  it('mljs로 선언된 알고리즘은 전부 여기 구현이 있다', () => {
    const declared = ALGORITHMS.filter((a) => a.runtimes.mljs).map((a) => a.id)
    for (const id of declared) {
      expect(MLJS_ALGORITHMS, id).toContain(id)
    }
  })

  it('구현만 있고 등록되지 않은 알고리즘은 없다 - 화면에 안 나오면 없는 것이다', () => {
    const declared = new Set(ALGORITHMS.map((a) => a.id))
    for (const id of MLJS_ALGORITHMS) {
      expect(declared.has(id), id).toBe(true)
    }
  })

  it('svm도 여기 있다 - 벤더링한 SMO가 들어왔다', () => {
    // 예전에는 없었고, 그 상태가 공식 배포의 기본값이라 대부분의 학생에게 SVM은
    // 없는 물건이었다 (open-decisions.md "순수 JS 서포트 벡터 머신을 넣는다").
    expect(MLJS_ALGORITHMS).toContain('svm')
    expect(ALGORITHMS.find((a) => a.id === 'svm')?.runtimes.mljs).toBe(true)
  })
})

describe('엔진 버전이 의존성에 묶여 있다', () => {
  it('ml.js 버전이 바뀌면 알아차린다', () => {
    // 여기가 깨지면 숫자가 움직였는지 확인하고 MLJS_ENGINE.version을 올릴지 정하라.
    // 재실행 대조가 엔진 버전에 걸려 있어서(architecture.md 3.2), 조용히 올라가면
    // 옛 .mlpx가 "재현되지 않음"으로 뒤집힌다.
    expect({
      'ml-cart': packageJson.dependencies['ml-cart'],
      'ml-random-forest': packageJson.dependencies['ml-random-forest'],
    }).toEqual({
      'ml-cart': '^2.1.1',
      'ml-random-forest': '^2.1.0',
    })
  })

  it('ml-logistic-regression은 의존성에서 빠졌다 - 로지스틱은 저장소 안 솔버가 푼다', () => {
    // 2026-08-10, V2 감사 1단계-B (ml/engines/logistic.ts). 다시 들어오면 그건
    // 솔버 교체 결정(open-decisions.md)을 되돌리는 일이니 여기가 시끄럽게 알린다.
    expect('ml-logistic-regression' in packageJson.dependencies).toBe(false)
  })

  it('ml-regression-multivariate-linear도 빠졌다 - 선형회귀는 센터링 + SVD로 푼다', () => {
    // 2026-09-03 R25 B-2 (open-decisions.md #40). 정규방정식이 척도가 갈린 표에서 부호까지
    // 틀렸다. 다시 들어오면 그 결정을 되돌리는 일이니 여기가 시끄럽게 알린다.
    expect('ml-regression-multivariate-linear' in packageJson.dependencies).toBe(false)
  })

  it('엔진 이름이 실행 방법의 engineKind와 같다', () => {
    expect(MLJS_ENGINE.kind).toBe('mljs')
  })
})

/**
 * **여기서 보는 것은 "두 번 돌려도 같다"까지다.**
 *
 * 이 축은 씨앗을 엔진 안에 상수로 못 박아도 통과한다 — 두 번 다 같은 상수로 도니까.
 * 한때 `랜덤포레스트는 시드가 다르면 모델도 다를 수 있다`라는 검사가 여기 있었는데,
 * 몸통은 **같은 씨앗으로 두 번** 돌려 같은지 보고 있었다. 위의 루프와 글자만 다른
 * 같은 검사였고, 제목과 주석만 더 많은 것을 주장했다 (R8 감사 A-2·C-6).
 *
 * **씨앗이 라이브러리까지 가는지는 여기가 아니다** — `experiment.spec.ts`("씨앗이
 * 분할만이 아니라 fit까지 간다")와 `sklearn-parity.spec.ts`가 그 고리를 잡는다.
 * 붓꽃 30행은 씨앗에 둔감해서 이 파일의 픽스처로는 애초에 못 가른다.
 */
describe('재현 가능성', () => {
  for (const algorithm of ['decision_tree', 'knn', 'random_forest', 'naive_bayes']) {
    it(`${algorithm}은 두 번 돌려도 같은 결과다`, () => {
      expect(run(algorithm).metrics).toEqual(run(algorithm).metrics)
    })
  }

  /**
   * **나무를 적게 잡아도 학습된다.**
   *
   * ml.js는 학습 끝에 out-of-bag 예측을 모으는데, 어떤 행이 모든 나무의 훈련 표본에
   * 들어가면 그 행의 표가 빈 배열이 되고 거기서 던진다. 한 행이 그럴 확률이 나무 하나당
   * 약 0.632이므로 **나무가 적을수록 반드시 터진다** - 기본값 100그루에서는 확률이 0에
   * 수렴해서 안 보이고, 나무 개수를 줄여 본 학생만 만난다.
   *
   * 우리는 OOB를 안 쓰므로 꺼서 막았다(mljs.ts의 noOOB). 위의 고정된 숫자들이 그 변경으로
   * 모델이 안 달라졌음을 지킨다.
   */
  for (const nEstimators of [1, 3, 10]) {
    it(`랜덤포레스트를 ${nEstimators}그루로 잡아도 학습된다`, () => {
      expect(run('random_forest', { nEstimators }).metrics.accuracy).toBeGreaterThan(0)
    })
  }
})

describe('붓꽃을 실제로 학습한다', () => {
  /**
   * **숫자를 그대로 못 박는다.**
   *
   * 임의의 하한선("0.8 이상")은 아무것도 지키지 못한다 - 의존성이 올라가면서 결과가
   * 0.89에서 0.82로 움직여도 통과한다. 그런데 재실행 대조는 지표가 재현되는지를 보므로
   * (mlpx-spec.md 7), 그 움직임이 곧 옛 .mlpx의 "재현되지 않음"이다.
   *
   * 여기가 깨졌다는 것은 **학생의 결과가 바뀌었다**는 뜻이다. 값을 고쳐 통과시키기 전에
   * MLJS_ENGINE.version을 올릴지부터 정하라.
   *
   * **naive_bayes의 3/9는 라이브러리 결함의 숫자였다.** `ml-naivebayes`가 예측할 때
   * 특성을 앞 2개만 읽어서, 판별력 없는 꽃받침 둘만 쓴 모델의 값이 여기 고정돼 있었다.
   * 그리고 그 값이 "폭이 제일 크다"의 근거로 문서 두 곳에 올라가 있었다. 자체 구현으로
   * 바꾼 뒤 8/9다 (open-decisions.md "가우시안 나이브 베이즈는 의존성을 빼고 우리가
   * 구현한다").
   *
   * **고정 테스트가 결함을 못 잡는 자리가 여기다.** 값을 못 박는 것은 옳지만, 못 박은
   * 값이 처음부터 틀렸으면 고정은 그것을 지켜 줄 뿐이다. 낮은 숫자를 "구현 차이"로
   * 설명하고 넘어가기 전에 입력이 실제로 다 쓰이는지부터 본다.
   */
  /**
   * **logistic_regression은 9/9였다가 8/9가 됐다 (2026-08-10, V2 감사 1단계-A).**
   * 엔진이 내부 표준화와 절편을 넣으면서다(mlpx-spec.md 5.4.1) - 이 축소판(행 30개,
   * 평가 9행)에서는 한 줄 내려갔지만, 같은 변경이 붓꽃 150행 전체에서 0.9333→0.9667,
   * 값의 높낮이로 갈리는 교실 데이터에서 기준선 이하→sklearn 수준이다. 실측표는
   * open-decisions.md에 있다. 배포 전이라 MLJS_ENGINE.version은 안 올린다(파일 머리말).
   */
  const PINNED: Record<string, number> = {
    decision_tree: 7 / 9,
    knn: 8 / 9,
    random_forest: 8 / 9,
    logistic_regression: 8 / 9,
    naive_bayes: 8 / 9,
  }

  for (const [algorithm, accuracy] of Object.entries(PINNED)) {
    it(`${algorithm}의 붓꽃 정확도가 그대로다`, () => {
      const { metrics, confusionMatrix } = run(algorithm)
      expect(Number.isFinite(metrics.accuracy)).toBe(true)
      expect(confusionMatrix?.labels).toEqual(['setosa', 'versicolor', 'virginica'])
      expect(metrics.accuracy, algorithm).toBeCloseTo(accuracy, 10)
    })
  }

  it('예측 결과가 학습에서 본 라벨 안에서만 나온다', () => {
    const known = new Set(IRIS_LABELS)
    const { confusionMatrix } = run('decision_tree')
    for (const label of confusionMatrix?.labels ?? []) {
      expect(known.has(label), label).toBe(true)
    }
  })
})

describe('하이퍼파라미터', () => {
  it('넘긴 값이 실제로 쓰인다 - 깊이 1이면 성능이 떨어진다', () => {
    const shallow = run('decision_tree', { maxDepth: 1 }).metrics.accuracy ?? 0
    const deep = run('decision_tree', { maxDepth: 100 }).metrics.accuracy ?? 0
    expect(shallow).toBeLessThan(deep)
  })

  it('모르는 값은 무시하고 기본값으로 돈다', () => {
    expect(run('knn', { max_depth: 3, 이상한값: 'x' }).metrics).toEqual(run('knn').metrics)
  })

  it('숫자가 아닌 값이 와도 기본값으로 떨어진다', () => {
    expect(run('knn', { k: null }).metrics).toEqual(run('knn', { k: 5 }).metrics)
  })
})

describe('로지스틱 수렴 경고 (mlpx-spec.md 5.9)', () => {
  it('maxIter에 닿으면 LOGISTIC_NOT_CONVERGED가 붙는다', () => {
    const { warning } = fit('logistic_regression', {
      features: IRIS_FEATURES,
      rowIndices: IRIS_FEATURES.map((_, index) => index),
      target: IRIS_LABELS,
      taskType: 'classification',
      hyperparameters: { maxIter: 1 },
      randomState: 42,
    })
    expect(warning?.code).toBe('LOGISTIC_NOT_CONVERGED')
    expect(warning?.params?.iterations).toBe(1)
  })

  it('기본값으로 수렴하면 경고가 없다 - L2 덕에 최적점이 유한하다', () => {
    // 규제 없는 옛 솔버는 분리 가능한 데이터에서 좋은 모델에도 경고가 떴다.
    // 이 검사가 그 상태로 돌아가는 것을 막는다 (open-decisions.md "솔버를 sklearn과
    // 같은 구조로 바꾼다").
    const { warning } = fit('logistic_regression', {
      features: IRIS_FEATURES,
      rowIndices: IRIS_FEATURES.map((_, index) => index),
      target: IRIS_LABELS,
      taskType: 'classification',
      hyperparameters: {},
      randomState: 42,
    })
    expect(warning).toBeUndefined()
  })

  /**
   * **스케일이 갈린 데이터에서는 반복을 늘려도 안 된다** (2026-08-31, 실물 `.mlpx`).
   *
   * 경고문이 `maxIter`를 늘리라고만 말하던 것이 막다른 길이었다 — 기압과 기온이 함께
   * 있는 3,652행에서 20,000회를 돌려도 기울기가 소수점까지 같았고, 표준화하면 41회에
   * 수렴했다. 여기서는 같은 병을 작은 합성 데이터로 못 박는다: 한 열의 규모만 1,000배
   * 키운다 (`open-decisions.md` "로지스틱 회귀 솔버를 sklearn과 같은 구조로 바꾼다"의
   * "실물이 꺼낸 것").
   */
  describe('스케일이 갈리면 반복을 늘려도 안 되고, 표준화하면 수렴한다', () => {
    const ROWS = 240
    // 두 열은 같은 신호를 담고 규모만 다르다. 결정적이라 난수가 없다.
    const raw: number[][] = []
    const labels: string[] = []
    for (let i = 0; i < ROWS; i += 1) {
      const t = (i % 40) - 20 + (i % 7) * 0.3
      raw.push([t, 1000 * t + 1_000_000])
      labels.push(t > 0 ? 'yes' : 'no')
    }
    const standardized = raw.map(([small, large]) => [
      small as number,
      ((large as number) - 1_000_000) / 1000,
    ])
    const rowIndices = raw.map((_, index) => index)

    it('스케일이 갈리면 반복을 스무 배 줘도 같은 자리에 선다', () => {
      const at = (maxIter: number) =>
        fit('logistic_regression', {
          features: raw,
          rowIndices,
          target: labels,
          taskType: 'classification',
          hyperparameters: { maxIter },
          randomState: 42,
        })
      const few = at(100)
      const many = at(2000)
      expect(few.warning?.code).toBe('LOGISTIC_NOT_CONVERGED')
      expect(many.warning?.code).toBe('LOGISTIC_NOT_CONVERGED')
      // **경고 유무만 보면 이 사실이 안 잡힌다** - 반복을 늘리면 조금이라도 나아진다는
      // 기대가 여기서 깨진다. 두 모델의 계수가 같은 자리다.
      expect(many.model).toEqual(few.model)
    })

    it('표준화하면 같은 데이터가 기본값 안에서 수렴한다', () => {
      const { warning } = fit('logistic_regression', {
        features: standardized,
        rowIndices,
        target: labels,
        taskType: 'classification',
        hyperparameters: {},
        randomState: 42,
      })
      expect(warning).toBeUndefined()
    })
  })
})

describe('로지스틱 목적함수 - 기울기가 유한차분과 맞는다', () => {
  // 솔버는 기울기만 믿고 걷는다. 기울기 식이 틀리면 엉뚱한 곳에 수렴하고, 그건
  // 에러 없이 그럴듯한 숫자다 - 여기서 수식 자체를 못 박는다.
  for (const [name, classCount, labels] of [
    ['이진(binomial)', 2, ['a', 'b', 'a', 'b', 'b']],
    ['다중(multinomial)', 3, ['a', 'b', 'c', 'b', 'a']],
  ] as const) {
    it(name, () => {
      const features = [
        [0.5, -1.2],
        [1.5, 0.3],
        [-0.7, 2.1],
        [0.9, 0.9],
        [-1.1, -0.4],
      ]
      const encoded = labels.map((label) => ['a', 'b', 'c'].indexOf(label))
      const objective = logisticObjectiveForTest(features, encoded, classCount, 1)

      const theta = Float64Array.from(
        { length: objective.size },
        (_, index) => 0.1 * (index + 1) * (index % 2 === 0 ? 1 : -1),
      )
      const gradient = new Float64Array(objective.size)
      objective.evaluate(theta, gradient)

      const h = 1e-6
      const scratch = new Float64Array(objective.size)
      for (let j = 0; j < objective.size; j += 1) {
        const bumped = Float64Array.from(theta)
        bumped[j] = (bumped[j] as number) + h
        const forward = objective.evaluate(bumped, scratch)
        bumped[j] = (bumped[j] as number) - 2 * h
        const backward = objective.evaluate(bumped, scratch)
        const numeric = (forward - backward) / (2 * h)
        expect(Math.abs((gradient[j] as number) - numeric), `component ${j}`).toBeLessThan(1e-5)
      }
    })
  }
})

describe('resolve - 무엇을 먹였는지 확정한다', () => {
  it('학생이 안 건드린 자리를 기본값으로 채운다', () => {
    // 이게 없으면 run.hyperparameters가 빈 객체로 남아, 교사가 파일을 열고 "이 결정트리는
    // 깊이 몇이었나"에 답할 수 없다 (mlpx-spec.md 3).
    expect(resolve('decision_tree', {})).toEqual({ maxDepth: 100, minNumSamples: 3 })
    expect(resolve('knn', {})).toEqual({ k: 5 })
  })

  it('학생이 준 값이 이긴다', () => {
    expect(resolve('decision_tree', { maxDepth: 3 })).toEqual({ maxDepth: 3, minNumSamples: 3 })
  })

  it('못 쓰는 값은 기본값으로 확정한다 - 파일과 엔진이 갈리면 안 된다', () => {
    // 파일에 k: null이라 적어 놓고 5로 도는 상태를 만들지 않는다. 확정이 곧 기록이다.
    expect(resolve('knn', { k: null })).toEqual({ k: 5 })
    expect(resolve('knn', { k: '다섯' })).toEqual({ k: 5 })
    expect(resolve('knn', { k: Number.NaN })).toEqual({ k: 5 })
  })

  it('모르는 키는 손대지 않고 통과시킨다', () => {
    // 엔진이 받고 무시한 것까지가 "먹인 것"의 사실이다. 버리면 실패한 run에서
    // 학생이 무엇을 시도했는지가 지워진다.
    expect(resolve('knn', { max_depth: 3 })).toEqual({ k: 5, max_depth: 3 })
  })

  it('손잡이가 없는 알고리즘은 빈 객체가 정답이다', () => {
    expect(resolve('naive_bayes', {})).toEqual({})
    expect(resolve('linear_regression', {})).toEqual({})
  })

  it('모르는 알고리즘이면 던지지 않고 준 값을 돌려준다', () => {
    // 판정은 fit의 일이다. 여기서 던지면 실패 run을 만들기도 전에 실험이 죽는다.
    expect(resolve('없는알고리즘', { k: 3 })).toEqual({ k: 3 })
  })

  it('두 번 걸어도 결과가 같다 - fit이 안에서 한 번 더 부른다', () => {
    const once = resolve('decision_tree', { maxDepth: 3 })
    expect(resolve('decision_tree', once)).toEqual(once)
  })

  it('fit은 resolve를 안 거친 호출에도 견딘다', () => {
    // 안 그러면 k가 0인 KNN처럼 조용히 망가지고, 원인은 여기서 멀리 떨어진 곳에서 터진다.
    expect(run('knn', {}).metrics.accuracy).toBeGreaterThan(0.5)
  })
})

describe('회귀', () => {
  it('선형 회귀가 직선을 찾는다', () => {
    // y = 2x + 1
    const features = [[0], [1], [2], [3], [4]]
    const { predict } = fit('linear_regression', {
      features,
      rowIndices: [0, 1, 2, 3, 4],
      target: [1, 3, 5, 7, 9],
      taskType: 'regression',
      hyperparameters: {},
      randomState: 42,
    })
    const { metrics } = evaluate('regression', [11, 13], predict([[5], [6]]))
    expect(metrics.r2).toBeGreaterThan(0.99)
    expect(metrics.mae).toBeLessThan(0.01)
  })

  /**
   * **분산 0짜리 타깃에서 sklearn과 같은 답을 낸다** (2026-09-03에 재서 맞췄다).
   *
   * 값이 전부 같은 열로 회귀를 돌리면 참해는 `계수 0 · 절편 그 값`이다. 그런데
   * `ml-regression-multivariate-linear`은 **정규방정식**을 써서 계수에 1e-14 먼지를
   * 남기고, `metrics.ts`의 R²는 분모가 0일 때 **잔차가 정확히 0인지**로 1과 0을
   * 가르므로(sklearn과 같은 규칙) 그 먼지 하나가 **1.0이어야 할 점수를 0.0으로
   * 뒤집었다.** 실제 화면에서 결정계수 0.000이 나왔다.
   *
   * **그래서 sklearn처럼 타깃을 센터링해서 푼다**(`ml/engines/mljs.ts`). 상수 타깃이면
   * `y - ȳ`가 정확히 0이라 계수도 정확히 0이 된다.
   *
   * **`toBeCloseTo`를 쓰지 않는다.** 이 검사가 무는 것은 *"가깝다"*가 아니라
   * **"정확히 0이다"**이고, 그 정확함이 곧 R²의 갈림이다. 가까움으로 재면 센터링을
   * 걷어내도 초록이다(실제로 걷어낸 값이 −2.8e−14였다).
   */
  /**
   * **척도가 크게 갈린 표에서 작은 방향을 안 잃는다** (2026-09-03 R25 B-2).
   *
   * 옛 풀이(`ml-regression-multivariate-linear`의 정규방정식)는 여기서 x2 계수를
   * **−120.68**로 냈다 — 참값이 **3986.58**이라 부호까지 틀린 수가 화면의 "모델이 배운
   * 값"에 그대로 떴다. 정규방정식이 **조건수를 제곱하기** 때문이다(2.0e9 → 4e18, 배정밀도
   * 밖). 지금은 sklearn처럼 센터링한 뒤 SVD로 푼다.
   *
   * **여유가 넉넉한 것은 씨앗과 잡음 때문이 아니다** — 이 데이터는 결정적이다. 참값에서
   * 1% 안이면 되고, **옛 풀이는 부호가 반대라 어떤 여유로도 안 통과한다.**
   */
  it('척도가 갈린 표에서도 작은 계수를 맞힌다 - 정규방정식이 부호까지 틀렸던 자리', () => {
    let state = 23 >>> 0
    const random = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
    const features: number[][] = []
    const target: string[] = []
    for (let index = 0; index < 60; index += 1) {
      const big = random() * 1_000_000
      const small = random() * 0.001
      features.push([big, small])
      target.push(String(0.5 * big + 4000 * small + 7 + (random() - 0.5) * 0.1))
    }
    const { model } = fit('linear_regression', {
      features,
      rowIndices: features.map((_, index) => index),
      target,
      taskType: 'regression',
      hyperparameters: {},
      randomState: 1,
    })
    const stored = model as unknown as { coefficients: number[]; intercept: number }
    expect(stored.coefficients[0]).toBeCloseTo(0.5, 6)
    // 참값 3986.58. 옛 풀이는 −120.68이었다.
    expect(stored.coefficients[1]).toBeGreaterThan(3946)
    expect(stored.coefficients[1]).toBeLessThan(4026)
  })

  it('타깃이 상수면 계수가 정확히 0이고 결정계수가 1이다 - sklearn과 같다', () => {
    const features = [
      [150, 45],
      [153, 52],
      [156, 48],
      [159, 61],
      [162, 50],
      [165, 58],
    ]
    const { predict, model } = fit('linear_regression', {
      features,
      rowIndices: [0, 1, 2, 3, 4, 5],
      target: [42, 42, 42, 42, 42, 42],
      taskType: 'regression',
      hyperparameters: {},
      randomState: 42,
    })

    const stored = model as unknown as { coefficients: number[]; intercept: number }
    expect(stored.coefficients).toEqual([0, 0])
    expect(stored.intercept).toBe(42)

    // 예측도 정확히 그 값이어야 잔차가 정확히 0이 된다.
    expect(predict([[168, 44]])).toEqual([42])

    const { metrics } = evaluate('regression', [42, 42], predict(features.slice(0, 2)))
    expect(metrics.r2).toBe(1)
    expect(metrics.rmse).toBe(0)
  })
})

describe('모르는 알고리즘', () => {
  it('ALGORITHM_UNSUPPORTED로 실패한다', () => {
    try {
      fit('없는알고리즘', {
        features: [[1]],
        rowIndices: [0],
        target: ['a'],
        taskType: 'classification',
        hyperparameters: {},
        randomState: 1,
      })
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('ALGORITHM_UNSUPPORTED')
        expect(error.params.algorithm).toBe('없는알고리즘')
      }
    }
  })
})
