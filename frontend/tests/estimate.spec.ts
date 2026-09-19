/**
 * 학습 예상 시간 (`ml/estimate.ts`).
 *
 * **여기서 지키는 것은 방향이다.** 값이 몇 초로 나오는지가 아니라, **틀릴 때 길게
 * 틀리는가**를 본다 (open-decisions.md "학습 예상 시간은 실측표에 기기 배수를 곱해
 * 낸다"). 1분이라 해 놓고 3분을 끌면 학생이 화면을 못 믿게 되고, 못 믿는 화면은
 * 다음부터 안 읽힌다.
 *
 * **곱하는 축마다 트립와이어가 하나씩 있다.** 특성·그루 수·`maxIter` 셋은 전부
 * "이론상 이럴 것"과 "재 보니 이랬다"가 갈렸던 자리라, 누가 이론 쪽으로 되돌리면
 * 검사가 울어야 한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe as group, expect, it } from 'vitest'

import {
  BASELINE_COLUMNS,
  MLJS_DECISION_TREE_BASELINE_MS,
  PYODIDE_BOOT_MS,
  PYODIDE_DECISION_TREE_BASELINE_MS,
  PYODIDE_KMEANS_CLUSTERS_MS,
  PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR,
  PYODIDE_RANDOM_FOREST_TREES_MS,
  TRAINING_ELAPSED_VISIBLE_AFTER_MS,
} from '../src/limits'
import { ALGORITHMS } from '../src/ml/algorithms'
import { summarizeColumns } from '../src/data/columns'
import {
  baselineMs,
  describe,
  elapsedOf,
  estimateMs,
  hasEstimates,
  interpolate,
} from '../src/ml/estimate'
import { estimatedFeatureWidth, fitPreprocessor } from '../src/ml/preprocess'

/**
 * 손잡이를 안 건드린 기본 상태. 기준표를 잰 모양 그대로다.
 *
 * **실행 방법을 여기서 적는다.** 소스 쪽 기본값(`?? 'mljs'`)은 없어졌다 — 그 기본값이
 * sklearn 줄의 배수를 순수 JS 기준표로 셈하게 했다(R32 B-1). 이 파일의 아래 묶음들은
 * 순수 JS 표를 재는 것이라 여기서 `mljs`를 **명시한다.**
 */
function input(algorithm: string, rows: number, columns = BASELINE_COLUMNS) {
  return {
    algorithm,
    dataType: 'tabular' as const,
    rows,
    columns,
    hyperparameters: {},
    runtime: 'mljs' as const,
  }
}

group('보간', () => {
  it('표에 있는 점은 그 값 그대로다', () => {
    for (const [rows, ms] of MLJS_DECISION_TREE_BASELINE_MS) {
      expect(interpolate(MLJS_DECISION_TREE_BASELINE_MS, rows), String(rows)).toBeCloseTo(ms, 6)
    }
  })

  it('두 점 사이는 그 사이 값이다', () => {
    const between = interpolate(MLJS_DECISION_TREE_BASELINE_MS, 1500)
    expect(between).toBeGreaterThan(378)
    expect(between).toBeLessThan(1649)
  })

  it('표 아래로는 첫 점의 값을 쓴다 - 아래로 외삽하면 값이 되레 커지는 표가 있다', () => {
    // **아래로 외삽하면 안 되는 이유가 표마다 다르다.** 선형 회귀는 1,000행과 5,000행이
    // 둘 다 23ms라 기울기가 0이고, 그런 표에서 아래로 늘리면 값이 안 줄거나 되레 커진다.
    const naive =
      ALGORITHMS.find((entry) => entry.id === 'naive_bayes')?.baseline.tabular.mljs.ms ?? []
    expect(interpolate(naive, 10)).toBe(naive[0]?.[1])
    expect(interpolate(MLJS_DECISION_TREE_BASELINE_MS, 10)).toBe(49)
  })

  it('표 위로는 가장 가파른 구간으로 늘린다 - 마지막 구간만 보면 짧게 틀린다', () => {
    const last = MLJS_DECISION_TREE_BASELINE_MS[MLJS_DECISION_TREE_BASELINE_MS.length - 1]
    const [lastRows, lastMs] = last as readonly [number, number]
    const lastSlope = Math.log(34_567 / 8457) / Math.log(10_000 / 5000) // 마지막 구간의 기울기
    const doubled = interpolate(MLJS_DECISION_TREE_BASELINE_MS, lastRows * 2)
    expect(doubled).toBeGreaterThan(lastMs * Math.pow(2, lastSlope))
  })

  it('빈 표는 0이다 - 없는 것을 지어내지 않는다', () => {
    expect(interpolate([], 1000)).toBe(0)
  })
})

group('곱하는 축', () => {
  it('특성 수는 트리 계열에만 선형으로 곱한다', () => {
    const eight = baselineMs(input('decision_tree', 2000))
    const thirtyTwo = baselineMs(input('decision_tree', 2000, 32))
    expect(thirtyTwo).toBeCloseTo((eight ?? 0) * 4, 6)
  })

  it('KNN과 로지스틱은 특성 수를 안 곱한다 - 재 보니 선형이 아니었다', () => {
    // KNN은 특성 4에서 32로 1.5배뿐이고, 로지스틱은 오히려 빨라졌다 (2026-08-31).
    for (const algorithm of ['knn', 'logistic_regression']) {
      const eight = baselineMs(input(algorithm, 5000))
      const thirtyTwo = baselineMs(input(algorithm, 5000, 32))
      expect(thirtyTwo, algorithm).toBeCloseTo(eight ?? 0, 6)
    }
  })

  it('랜덤포레스트는 그루 수에 선형이다', () => {
    const ten = baselineMs(input('random_forest', 1000))
    const hundred = baselineMs({
      ...input('random_forest', 1000),
      hyperparameters: { nEstimators: 100 },
    })
    expect(hundred).toBeCloseTo((ten ?? 0) * 10, 6)
  })

  it('로지스틱의 maxIter는 선형이 아니다 - 100회에서 1000회가 10배가 아니라 19배다', () => {
    const hundred = baselineMs(input('logistic_regression', 5000)) ?? 0
    const thousand =
      baselineMs({
        ...input('logistic_regression', 5000),
        hyperparameters: { maxIter: 1000 },
      }) ?? 0
    // 평가까지 넣어 다시 재니 26.5배다 (전에는 19.2배). **곧은 선이 아니라는 것이 요점이다.**
    const factor = thousand / hundred
    expect(factor).toBeGreaterThan(15)
    expect(factor).toBeLessThan(35)
  })

  it('maxIter를 100 아래로 내려도 예상은 안 줄어든다 - 초반 구간이 유난히 싸다', () => {
    const hundred = baselineMs(input('logistic_regression', 5000))
    const few = baselineMs({
      ...input('logistic_regression', 5000),
      hyperparameters: { maxIter: 25 },
    })
    expect(few).toBeCloseTo(hundred ?? 0, 6)
  })

  it('등록부에 없는 알고리즘은 모른다고 한다', () => {
    expect(baselineMs(input('gradient_boosting', 1000))).toBeNull()
  })
})

group('기기 배수', () => {
  it('배수를 그대로 곱한다', () => {
    const one = estimateMs(input('decision_tree', 2000), 1) ?? 0
    expect(estimateMs(input('decision_tree', 2000), 3)).toBeCloseTo(one * 3, 6)
  })
})

group('화면이 적을 것', () => {
  /**
   * **빈칸을 안 남긴다** (2026-08-31, 사용자). 5초 미만을 안 적기로 했었는데, 그러면
   * 화면에서 **빠른 것과 못 재는 것이 같은 모양**이 됐다.
   */
  it('짧아도 적는다 - 빈칸은 빠른 것과 못 재는 것을 못 가린다', () => {
    expect(describe(0)).toEqual({ kind: 'seconds', value: 1 })
    expect(describe(200)).toEqual({ kind: 'seconds', value: 1 })
    expect(describe(4999)).toEqual({ kind: 'seconds', value: 5 })
  })

  it('못 재는 것만 모른다고 한다', () => {
    expect(describe(null).kind).toBe('unknown')
    expect(describe(Number.NaN).kind).toBe('unknown')
  })

  it('올림한다 - 길게 틀리기로 했다', () => {
    expect(describe(3200)).toEqual({ kind: 'seconds', value: 4 })
    expect(describe(61_000)).toEqual({ kind: 'minutes', value: 2 })
  })

  it('짧은 쪽은 1초 단위, 긴 쪽은 5초 단위다 - 같은 단위가 짧은 쪽에서 크게 틀린다', () => {
    expect(describe(9400)).toEqual({ kind: 'seconds', value: 10 })
    expect(describe(10_100)).toEqual({ kind: 'seconds', value: 15 })
    expect(describe(27_000)).toEqual({ kind: 'seconds', value: 30 })
  })

  it('1분부터는 분으로 적는다', () => {
    expect(describe(59_000).kind).toBe('seconds')
    expect(describe(60_000)).toEqual({ kind: 'minutes', value: 1 })
  })
})

group('등록부', () => {
  it('모든 알고리즘이 기준표를 든다 - 새 알고리즘이 빈칸으로 들어오지 않는다', () => {
    for (const algorithm of ALGORITHMS) {
      expect(algorithm.baseline.tabular.mljs.ms.length, algorithm.id).toBeGreaterThan(1)
      expect(['linear', 'flat'], algorithm.id).toContain(algorithm.baseline.tabular.mljs.columns)
      /**
       * **이미지 칸은 비었거나 제대로 된 표다.** 안 잰 칸이 조용히 숫자를 갖지 않는다는
       * 것이 원래 규칙이었고, 2026-09-03에 첫 표가 채워지면서 **"비어 있다"에서 "점 하나
       * 짜리 가짜가 아니다"로** 넓어졌다.
       *
       * **채워졌으면 `flat`이어야 한다** — 사진 표는 임베딩 차원에서 재어지므로 특성
       * 배수를 한 번 더 곱하면 그 차원을 두 번 센다 (`backend.ts`의 `UNMEASURED_BASELINE`).
       */
      const image = algorithm.baseline.image.mljs
      if (image.ms.length > 0) {
        expect(image.ms.length, algorithm.id).toBeGreaterThan(1)
        expect(image.columns, algorithm.id).toBe('flat')
      }
    }
  })

  /**
   * **칸과 상수를 동일성으로 묶는다** (2026-09-19 R31 C-1). 등록부의 `baseline`은 알고리즘
   * 아홉 × 종류 둘 × 엔진 둘 = **서른여섯 칸**인데, 감사자가 KNN 표의 두 엔진을 맞바꿔도
   * 검사 3,524개가 전부 초록이었다 — *"두 엔진이 다른 수를 낸다"*만 보는 검사는
   * **어느 쪽이 어느 엔진인지**를 안 본다.
   *
   * **이름으로 잇는다.** `limits.ts`의 상수 이름에서 접두사(`MLJS`/`PYODIDE`)와 종류
   * (`IMAGE`)를 떼면 알고리즘 id가 남는다(밑줄만 지우면 같다: `k_means` ↔ `KMEANS`).
   * 그 규칙으로 찾은 상수와 칸이 **같은 객체**여야 한다.
   */
  it('기준표 칸마다 이름이 맞는 상수가 들어 있다', async () => {
    const limits = (await import('../src/limits')) as unknown as Record<string, unknown>
    const key = (text: string) => text.replaceAll('_', '').toUpperCase()
    const wrong: string[] = []
    let bound = 0

    for (const algorithm of ALGORITHMS) {
      for (const dataType of ['tabular', 'image'] as const) {
        for (const [runtime, prefix] of [
          ['mljs', 'MLJS'],
          ['pyodide-sklearn', 'PYODIDE'],
        ] as const) {
          const cell = algorithm.baseline[dataType][runtime]
          if (cell.ms.length === 0) continue
          const name = Object.keys(limits).find(
            (one) =>
              one.startsWith(`${prefix}_`) &&
              one.endsWith('_BASELINE_MS') &&
              key(one.slice(prefix.length + 1, -'_BASELINE_MS'.length)) ===
                key(dataType === 'image' ? `IMAGE_${algorithm.id}` : algorithm.id),
          )
          if (name === undefined) {
            wrong.push(`${algorithm.id}/${dataType}/${runtime}: 이름이 맞는 상수가 없다`)
            continue
          }
          bound += 1
          if (limits[name] !== cell.ms) {
            wrong.push(`${algorithm.id}/${dataType}/${runtime}: ${name}이 아니다`)
          }
        }
      }
    }

    // **그물의 크기를 센다** (R9 B-5). 이름 규칙이 바뀌어 한 칸도 안 묶이면 여기가 운다.
    expect(bound, 'no baseline cell was bound to a constant').toBeGreaterThan(20)
    expect(wrong).toEqual([])
  })

  it('기준표의 행 수가 오름차순이다 - 보간이 그것을 전제한다', () => {
    for (const algorithm of ALGORITHMS) {
      for (const baseline of [algorithm.baseline.tabular.mljs, algorithm.baseline.image.mljs]) {
        const rows = baseline.ms.map(([value]) => value)
        expect(rows, algorithm.id).toEqual([...rows].sort((a, b) => a - b))
      }
    }
  })

  /** **채워진 사진 표가 하나라도 있어야 위 검사가 빈 배열을 훑지 않는다.** */
  it('사진 기준표가 적어도 하나는 차 있다', () => {
    expect(
      ALGORITHMS.filter((one) => one.baseline.image.mljs.ms.length > 0).length,
    ).toBeGreaterThan(0)
  })

  /**
   * **사진을 연 알고리즘은 사진 상한을 든다.** 축만 열고 상한을 `UNMEASURED`로 두면
   * 카드는 켜지는데 "몇 장까지"는 아무도 답하지 않는다.
   */
  it('사진을 여는 알고리즘마다 사진 상한이 있다', () => {
    for (const algorithm of ALGORITHMS) {
      if (!algorithm.dataTypes.image) continue
      expect(algorithm.maxRows.image.mljs, algorithm.id).not.toBeNull()
    }
  })
})

/**
 * **사진에서 특성 수를 두 번 세지 않는다** (2026-09-03).
 *
 * 사진 기준표는 임베딩 차원에서 재어져 있고, 학습 화면이 넘기는 `columns`는 **사진에서
 * 0이다**(`TrainView.vue`의 `featureWidth`가 `tabularDataOf`를 읽는다). 그 0을 가중치
 * 식에 그대로 넣으면 손잡이 배수가 **3분의 1로 줄어** 예상이 크게 짧아진다 —
 * `UNMEASURED_BASELINE`의 주석이 `columns: 'flat'`에 대해 경고하는 것과 같은 함정이,
 * 인공신경망의 손잡이 배수에서 한 번 더 나타난 자리다.
 *
 * **그래서 실측값 자체를 못 박는다.** 기본 손잡이의 예상은 기준표에 적힌 그 수여야 한다 —
 * 배수가 1이 아니면 곧바로 갈린다.
 */
group('사진 예상은 기준표를 그대로 낸다', () => {
  const imageInput = (rows: number, hyperparameters: Record<string, unknown> = {}) => ({
    algorithm: 'neural_network',
    dataType: 'image' as const,
    rows,
    // **화면이 실제로 넘기는 값이다.** 사진에서는 0이다.
    columns: 0,
    hyperparameters,
    // 인공신경망은 순수 JS에만 있다 — 등록부가 `'pyodide-sklearn': false`라고 선언한다.
    runtime: 'mljs' as const,
  })

  it('기본 손잡이면 기준표의 값 그대로다', () => {
    const table =
      ALGORITHMS.find((one) => one.id === 'neural_network')?.baseline.image.mljs.ms ?? []
    expect(table.length, 'the image table must be filled').toBeGreaterThan(1)
    for (const [rows, ms] of table) {
      expect(baselineMs(imageInput(rows)), `${rows} photos`).toBeCloseTo(ms, 6)
    }
  })

  /**
   * **손잡이는 여전히 움직인다.** 배수를 통째로 1로 굳혀도 위 검사는 초록이라, 그 자리를
   * 여기서 막는다.
   *
   * **1,280차원에서는 층을 하나 더해도 조금만 는다** — 첫 층이 128,100개인데 은닉층
   * 하나가 10,000개를 더할 뿐이다. 표 데이터에서 같은 조치가 5.7배인 것과 갈리는 자리이고,
   * 그래서 가중치 수로 접어 두었다.
   */
  it('층을 늘리면 늘지만, 사진에서는 조금만 는다', () => {
    const one = baselineMs(imageInput(1000)) ?? 0
    const two = baselineMs(imageInput(1000, { hiddenLayers: 2, neuronsPerLayer: 100 })) ?? 0
    expect(two).toBeGreaterThan(one)
    expect(two / one).toBeLessThan(1.2)
  })

  /** **뉴런을 반으로 줄이면 눈에 띄게 준다.** 첫 층이 그만큼 얇아진다. */
  it('뉴런을 줄이면 예상도 준다', () => {
    const full = baselineMs(imageInput(1000)) ?? 0
    const half = baselineMs(imageInput(1000, { hiddenLayers: 1, neuronsPerLayer: 50 })) ?? 0
    expect(half).toBeLessThan(full * 0.7)
  })
})

group('전처리 뒤의 특성 수', () => {
  /**
   * **`fitPreprocessor`와 같은 수를 내야 한다.** 예상은 열 요약의 `unique`로 세고 학습은
   * 데이터를 훑는데, 원핫 규칙이 한쪽만 바뀌면 **예상 시간이 조용히 몇 배 틀린다** —
   * 트리 계열은 특성 수에 선형이라 그대로 배수가 된다.
   */
  const DATASET = {
    columns: ['키', '지역', '결과'],
    rows: [
      ['150', '서울', '가'],
      ['160', '부산', '가'],
      ['170', '대구', '나'],
      ['180', '서울', '나'],
    ],
  }
  const FEATURES = ['키', '지역']
  const ROWS = DATASET.rows.map((_, index) => index)

  for (const encoding of ['onehot', 'ordinal'] as const) {
    it(`${encoding} — 학습이 세는 수와 같다`, () => {
      const preprocessing = {
        missing: 'drop',
        scaling: 'none',
        categoricalEncoding: encoding,
      } as const
      const fitted = fitPreprocessor(DATASET, ROWS, FEATURES, preprocessing)
      const guessed = estimatedFeatureWidth(summarizeColumns(DATASET), FEATURES, encoding)
      expect(guessed).toBe(fitted.featureNames.length)
    })
  }

  it('부호화를 안 하면 범주 열은 통째로 빠진다', () => {
    expect(estimatedFeatureWidth(summarizeColumns(DATASET), FEATURES, 'none')).toBe(1)
  })
})

/**
 * **K-평균의 군집 수는 지배적인 손잡이다** (2026-09-01 재실측).
 *
 * 처음에는 `C`·최대 깊이와 함께 *"시간을 크게 안 바꾸는 나머지"*로 묶여 있었다.
 * **재 보니 2에서 20 사이가 8배가 넘는다** — 비용이 `행 × k × 특성 × 반복`이라 `k`가
 * 곧바로 붙는다. 누가 그 줄로 되돌리면 이 검사가 운다.
 */
group('K-평균의 군집 수', () => {
  function withClusters(clusters: number): number {
    return (
      baselineMs({ ...input('k_means', 20_000), hyperparameters: { nClusters: clusters } }) ?? 0
    )
  }

  /**
   * **배수가 8.4에서 1.5로 줄었다** (2026-09-01). 평가까지 넣어 재니 실루엣이 바닥을
   * 깔고 그 위에서만 `k`가 움직인다 — **평가를 빼고 재던 때의 배수가 과장이었다.**
   * 그래도 무시하면 안 된다: 지금도 절반이 넘게 짧아진다.
   */
  it('군집 수를 올리면 예상이 그만큼 는다 - 무시하면 짧게 말한다', () => {
    const factor = withClusters(20) / withClusters(2)
    expect(factor).toBeGreaterThan(1.3)
  })

  it('기본값에서는 배수가 1이다 - 기준표를 그 값으로 쟀다', () => {
    expect(withClusters(3)).toBeCloseTo(baselineMs(input('k_means', 20_000)) ?? 0, 6)
  })

  it('특성 수에도 붙는다 - 거리 계산이 특성마다 돈다', () => {
    const wide = baselineMs(input('k_means', 20_000, 32)) ?? 0
    expect(wide).toBeCloseTo(withClusters(3) * 4, 6)
  })
})

/**
 * **이 종류에 예상이 나오기는 하는가** (2026-09-01 감사 B-5).
 *
 * 상한 팝오버가 *"학습 화면의 예상 시간이 말해 줍니다"*라고 안내하는데, 그때 **사진에서는
 * 모든 줄이 `알 수 없음`**이었다 — 등록부의 이미지 기준표 여덟이 전부 비어 있었다. 화면이
 * 그 사실을 `dataType === 'image'`로 알면 **기준표를 채우는 날 그 화면도 함께 고쳐야
 * 하고**, 빠뜨린 것은 컴파일도 검사도 못 잡는다 (`architecture.md` §9.1).
 *
 * **2026-09-03에 그 날이 왔다.** 사진 인공신경망의 기준표가 채워지면서 `hasEstimates`가
 * 사진에도 참이 됐고, **화면의 문구가 저절로 바뀌었다** — 고친 것은 등록부 한 줄뿐이다.
 * 그 성질을 지키는 것이 아래 두 검사다.
 */
group('예상이 나오는 종류인가', () => {
  it('표는 기준표가 있어 예상이 나온다', () => {
    expect(hasEstimates('tabular')).toBe(true)
  })

  /** **사진도 나온다** — 채워진 것은 인공신경망 하나이고, 나머지 줄은 여전히 `알 수 없음`이다. */
  it('사진도 이제 나온다 - 기준표가 하나 채워졌다', () => {
    expect(hasEstimates('image')).toBe(true)
  })

  /**
   * **비면 거짓이 된다.** 위 검사가 값이 아니라 **등록부를 보고 답한다**는 것을 지키려면
   * 반대 방향도 있어야 한다 — 안 그러면 `hasEstimates`가 `true`를 상수로 돌려줘도 초록이다.
   */
  it('그 종류의 표가 전부 비면 거짓이 된다', () => {
    const emptied = ALGORITHMS.map((entry) => ({
      ...entry,
      baseline: {
        ...entry.baseline,
        image: {
          mljs: { ms: [], columns: 'flat' as const },
          'pyodide-sklearn': { ms: [], columns: 'flat' as const },
        },
      },
    }))
    expect(hasEstimates('image', emptied)).toBe(false)
  })

  /**
   * **기준표가 들어오면 저절로 바뀐다.** 이 검사가 지키는 것이 그 성질이다 — 값이 아니라
   * **등록부를 보고 답한다**는 것.
   */
  it('그 칸이 채워지면 참이 된다', () => {
    const filled = ALGORITHMS.map((entry) =>
      entry.id === 'naive_bayes'
        ? { ...entry, baseline: { ...entry.baseline, image: { ms: [[100, 5]], columns: 'flat' } } }
        : entry,
    ) as typeof ALGORITHMS
    expect(hasEstimates('image', filled)).toBe(true)
  })
})

/**
 * **경과 시간** (`elapsedOf`).
 *
 * 학습이 도는 동안 화면에 움직이는 것이 하나도 없어서 **오래 걸리는 학습과 멈춘 탭이
 * 같은 화면**이었다 (2026-09-01, 코드 소유자). 올라가는 숫자가 곧 신호다.
 *
 * **`hidden`이 두 뜻을 겸하지 않게 본다** — 안 돌고 있는 것과 아직 이른 것.
 */
group('경과 시간', () => {
  const after = TRAINING_ELAPSED_VISIBLE_AFTER_MS

  it('안 돌고 있으면 안 띄운다', () => {
    expect(elapsedOf(null, 10_000)).toEqual({ kind: 'hidden' })
  })

  /** 짧은 학습에 떴다 사라지면 읽기 전에 없어지고 여섯 줄이 깜빡인다. */
  it('문턱 아래는 안 띄운다', () => {
    expect(elapsedOf(0, after - 1)).toEqual({ kind: 'hidden' })
  })

  it('문턱에 닿으면 띄운다', () => {
    expect(elapsedOf(0, after)).toEqual({ kind: 'shown', minutes: '00', seconds: '05' })
  })

  /** **앞의 0을 남긴다.** 숫자로 넘기면 `0:5`가 되고 줄마다 폭이 흔들린다. */
  it('두 자리로 채운다', () => {
    expect(elapsedOf(0, 65_000)).toEqual({ kind: 'shown', minutes: '01', seconds: '05' })
    expect(elapsedOf(0, 600_000)).toEqual({ kind: 'shown', minutes: '10', seconds: '00' })
  })

  /** **내림이다.** 5.9초에 `00:06`을 적으면 아직 안 지난 시간을 말하는 것이다. */
  it('초는 내린다 - 아직 안 지난 시간을 안 적는다', () => {
    expect(elapsedOf(0, 5_999)).toEqual({ kind: 'shown', minutes: '00', seconds: '05' })
  })

  /** **시간 단위를 안 만든다.** 상한을 푼 학생에게는 `72:30`이 `1:12:30`보다 낫다. */
  it('한 시간을 넘겨도 분으로 센다', () => {
    expect(elapsedOf(0, 72 * 60_000 + 30_000)).toEqual({
      kind: 'shown',
      minutes: '72',
      seconds: '30',
    })
  })

  /**
   * **뒤로 가는 시계를 안 만든다.** `performance.now()`는 단조라 여기 안 오지만, 두 값이
   * 다른 시계에서 오면 온다 — 그때 `-1:-30`을 적으면 화면이 고장으로 보인다.
   */
  it('시작보다 이른 지금은 안 띄운다', () => {
    expect(elapsedOf(10_000, 0)).toEqual({ kind: 'hidden' })
  })

  it('숫자가 아니면 안 띄운다', () => {
    expect(elapsedOf(0, Number.NaN)).toEqual({ kind: 'hidden' })
  })
})

/**
 * **기준표는 행이 늘수록 시간이 줄 수 없다** (2026-09-19).
 *
 * 이 저장소가 같은 자리에서 두 번 넘어졌다. 한 번은 K-평균 표의 50,000과 100,000이
 * **밀리초까지 같은 수**(13,181)로 들어가 있었고 — 두 번 잰 값일 수가 없다 — 한 번은
 * 다시 쓸어 담은 사다리에서 **20,000행이 100,000행보다 두 배 느리게** 나왔다.
 * 어느 쪽도 사람이 표를 보고 알아채지 못했다.
 *
 * **모양만 본다. 값은 안 본다.** 얼마가 맞는지는 실측이 정하고 여기서 알 수 없지만,
 * *"행이 느는데 시간이 준다"*는 어떤 실측도 낼 수 없는 모양이다 — 그런 표가 들어오면
 * **예상 시간이 큰 데이터에서 짧게 말하고**, 그건 이 화면이 가장 하면 안 되는 거짓말이다
 * (`open-decisions.md` "학습 예상 시간은 실측표에 기기 배수를 곱해 낸다").
 *
 * **같은 값은 막지 않는다.** 선형 회귀의 1,000행과 5,000행이 둘 다 23ms인데, 그건 점마다
 * 드는 고정 비용이 데이터 비용을 덮은 자리라 실제로 일어난다.
 */

/**
 * **실측이 실제로 내려간 자리.** 이 다섯 말고는 어떤 표도 행이 늘 때 시간이 줄면 안 된다.
 *
 * sklearn은 **점마다 드는 고정 비용이 커서** 작은 점에서 데이터 비용이 묻히고, 그때 잡음이
 * 순서를 뒤집는다. 그건 결함이 아니라 그 엔진의 성질이다(`limits.ts`).
 *
 * **문턱을 쓰지 않는다** (2026-09-19 R31 A-1). 한때 *"감소폭이 그 표의 최솟값보다 작으면
 * 넘어간다"*로 두었는데, 그 논증은 **표의 아래쪽에서만** 성립한다 — 위쪽에서 최솟값은 값의
 * 14~45%라, 의사결정트리 100,000행을 4,677에서 1,900ms로 **50,000행보다 빠르게** 뒤집어도
 * 관문이 초록이었다. 목록은 지어낸 수가 없고, **안 쓰인 항목이 남아도 운다** — 낡은 예외가
 * 조용히 사는 것을 막는다.
 */
const MEASURED_DIPS: readonly string[] = [
  'PYODIDE_LINEAR_REGRESSION_BASELINE_MS: 1000행 477ms -> 5000행 453ms',
  'PYODIDE_KNN_BASELINE_MS: 1000행 738ms -> 2000행 651ms',
  'PYODIDE_DECISION_TREE_BASELINE_MS: 250행 644ms -> 500행 642ms',
  'PYODIDE_DECISION_TREE_BASELINE_MS: 1000행 643ms -> 2000행 641ms',
  'PYODIDE_SVM_BASELINE_MS: 500행 509ms -> 1000행 497ms',
]

const dipOf = (name: string, before: number, earlier: number, rows: number, ms: number): string =>
  `${name}: ${before}행 ${earlier}ms -> ${rows}행 ${ms}ms`

group('기준표의 모양', () => {
  it('행이 늘 때 시간이 줄어드는 표가 없다', async () => {
    const limits = (await import('../src/limits')) as unknown as Record<string, unknown>
    const wrong: string[] = []
    let counted = 0
    for (const [name, value] of Object.entries(limits)) {
      // **두 엔진의 표를 다 훑는다.** sklearn 표가 이 그물 밖에 있으면, 그 표에서 같은
      // 결함이 나도 아무도 안 운다.
      if (!/^(MLJS|PYODIDE)_/.test(name) || !name.endsWith('BASELINE_MS')) continue
      const table = value as readonly (readonly [number, number])[]
      counted += 1
      for (let index = 1; index < table.length; index += 1) {
        const [rows, ms] = table[index]!
        const [before, earlier] = table[index - 1]!
        if (ms < earlier) wrong.push(dipOf(name, before, earlier, rows, ms))
      }
    }
    /**
     * **그물의 크기를 소스에서 센다** (2026-09-19 R30 C-4). `> 8`로 두었더니 **열셋 중
     * 넷을 이름만 바꿔 그물 밖으로 내도 통과**했다. 수를 손으로 적는 대신 `limits.ts`가
     * 실제로 내놓는 표의 수와 맞춘다 — 표가 늘면 이 검사가 저절로 따라간다.
     */
    const declared = readFileSync(join(__dirname, '..', 'src', 'limits.ts'), 'utf-8')
    const named = declared.match(/^export const (MLJS|PYODIDE)_[A-Z_]*BASELINE_MS = /gm) ?? []
    expect(counted, 'every declared baseline table must be walked').toBe(named.length)
    expect(counted, 'the tables must not vanish from limits.ts').toBeGreaterThan(8)
    expect(wrong.filter((one) => !MEASURED_DIPS.includes(one))).toEqual([])
    // **안 쓰인 예외가 남아도 운다.** 표를 다시 재면 그 자리가 사라질 수 있고, 목록에 남은
    // 옛 항목은 **다음에 같은 자리가 진짜로 뒤집혔을 때 조용히 통과시킨다.**
    expect(
      MEASURED_DIPS.filter((one) => !wrong.includes(one)),
      'stale entries',
    ).toEqual([])
  })
})

/**
 * **손잡이 표가 실측 원본과 한 글자도 안 다른가** (2026-09-19 R31 §4-1).
 *
 * `limits.ts`의 주석이 *"원본은 `docs/audit/r31-bench.json`이다"*라고 적는데, R31은 그
 * 원본이 **저장소에 없어서** 표의 여덟 점을 하나도 대조하지 못했다. 원본을 넣었으니
 * **말만 하지 말고 실제로 견준다** — 표를 손으로 고치면 여기서 운다.
 */
group('손잡이 표는 실측 원본 그대로다', () => {
  const bench = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'docs', 'audit', 'r31-bench.json'), 'utf-8'),
  ) as { runs: { measured: Record<string, Record<string, number>> }[] }

  const measured = (name: string): [number, number][] => {
    const found = bench.runs.find((one) => one.measured[name] !== undefined)?.measured[name]
    if (found === undefined) throw new Error(`r31-bench.json has no ladder named ${name}`)
    return Object.entries(found).map(([x, ms]) => [Number(x), ms])
  }

  for (const [name, table, key] of [
    ['그루 수', PYODIDE_RANDOM_FOREST_TREES_MS, 'pyodide_random_forest_trees'],
    ['군집 수', PYODIDE_KMEANS_CLUSTERS_MS, 'pyodide_k_means_clusters'],
  ] as const) {
    it(`${name} 표의 점이 잰 값 그대로다`, () => {
      expect(table.map((point) => [...point])).toEqual(measured(key))
    })
  }

  /** **평평하다는 말도 원본이 있다.** 20,000행에서 25·50·100·200회에 추세가 없다. */
  it('반복 횟수는 사다리가 평평해서 1이다', () => {
    const iterations = measured('pyodide_logistic_regression_iterations').map(([, ms]) => ms)
    const worst = Math.max(...iterations) / Math.min(...iterations)
    // 폭이 1.2배 안쪽이고 추세가 없다 - 100회가 50회보다 낮다.
    expect(worst).toBeLessThan(1.2)
    expect(PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR).toBe(1)
  })
})

/**
 * **두 엔진의 예상이 서로 다른 수를 말하는가** (2026-09-19, 로드맵 4단계).
 *
 * 두 엔진은 기준표도 손잡이 배수도 시동도 다르다. **축을 안 태우면 sklearn 줄이 순수 JS의
 * 수를 자기 것처럼 말하고**, 그건 아무 오류 없이 조용하다.
 */
group('실행 방법마다 다른 수를 말한다', () => {
  const at = (runtime: 'mljs' | 'pyodide-sklearn', hyperparameters = {}) =>
    baselineMs({
      algorithm: 'random_forest',
      dataType: 'tabular',
      rows: 1000,
      columns: BASELINE_COLUMNS,
      hyperparameters,
      runtime,
    })

  it('같은 일감에 두 엔진이 다른 수를 낸다', () => {
    expect(at('mljs')).not.toBeCloseTo(at('pyodide-sklearn') ?? 0, 0)
  })

  /**
   * **순수 JS는 그루 수에 선형이고 sklearn은 아니다.**
   *
   * **기준 그루 수부터 다르다** — 순수 JS 표는 10그루에서, sklearn 표는 100그루(그쪽
   * 기본값)에서 쟀다. 그래서 배수 하나를 견주는 대신 **같은 두 점 사이의 기울기**를 본다:
   * 10 → 100그루가 순수 JS에서는 **열 배**이고 sklearn에서는 **1.46배**다.
   */
  it('그루 수를 열 배로 올렸을 때 두 엔진이 다르게 준다', () => {
    const slope = (runtime: 'mljs' | 'pyodide-sklearn', few: string, many: string) =>
      (at(runtime, { [many]: 100 }) ?? 0) / (at(runtime, { [few]: 10 }) ?? 1)
    expect(slope('mljs', 'nEstimators', 'nEstimators')).toBeCloseTo(10, 1)
    expect(slope('pyodide-sklearn', 'n_estimators', 'n_estimators')).toBeLessThan(2)
  })

  /**
   * **손잡이 이름이 엔진마다 다르다.** sklearn 줄에 순수 JS 이름을 주면 **그 값이 안 읽히고
   * 기본값으로 셈한다** — 학생이 그루를 열로 줄였는데 화면은 백 그루의 시간을 말한다.
   */
  it('sklearn은 파이썬 이름을 읽는다 - 순수 JS 이름은 안 읽는다', () => {
    expect(at('pyodide-sklearn', { n_estimators: 10 })).not.toBeCloseTo(
      at('pyodide-sklearn') ?? 0,
      0,
    )
    expect(at('pyodide-sklearn', { nEstimators: 10 })).toBeCloseTo(at('pyodide-sklearn') ?? 0, 6)
  })

  /**
   * **로지스틱의 반복 횟수는 sklearn에서 평평하다** — 재고 나서 적은 1이다. 순수 JS의
   * 표를 빌려 쓰면 열여섯 배 틀린다.
   */
  it('로지스틱 반복 횟수: 순수 JS는 늘고 sklearn은 그대로다', () => {
    const one = (runtime: 'mljs' | 'pyodide-sklearn', hyperparameters: Record<string, unknown>) =>
      baselineMs({
        algorithm: 'logistic_regression',
        dataType: 'tabular',
        rows: 20_000,
        columns: BASELINE_COLUMNS,
        hyperparameters,
        runtime,
      }) ?? 0

    expect(one('mljs', { maxIter: 1000 }) / one('mljs', {})).toBeGreaterThan(5)
    expect(one('pyodide-sklearn', { max_iter: 1000 }) / one('pyodide-sklearn', {})).toBe(1)
  })

  /**
   * **비를 보는 검사는 그 상수가 커지는 것을 구조적으로 못 본다** (2026-09-19 R31 C-2).
   * 위 검사는 `1000회 ÷ 기본값`이라 배수가 2가 되면 분자와 분모가 함께 커져 **여전히 1**이다.
   * 그동안 로지스틱 줄의 예상은 통째로 두 배가 된다 — 그래서 값을 절대값으로 못 박는다.
   */
  it('sklearn 로지스틱의 손잡이 배수는 1이다 - 평평하다고 쟀다', () => {
    expect(PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR).toBe(1)
  })

  /**
   * **그 상수는 로지스틱 하나의 것이다.** 한때 나머지 여섯 알고리즘의 **기본** 배수
   * 자리에 앉아 있어서, 이름은 로지스틱을 가리키면서 값은 여섯에 걸렸다(R31 C-2).
   *
   * **그래서 여기서 재는 것은 "손잡이를 바꿔도 같은가"가 아니다** — 기본 배수가 옮겨지면
   * 손잡이와 무관하게 줄 전체가 그만큼 커지고, 두 번 부르는 비교는 그 둘을 함께 키워
   * 못 본다. **기준표의 값 그대로인지**를 본다.
   */
  it('sklearn 의사결정트리의 예상은 기준표 그대로다 - 곱할 손잡이가 없다', () => {
    const tree = (hyperparameters: Record<string, unknown>) =>
      baselineMs({
        algorithm: 'decision_tree',
        dataType: 'tabular',
        rows: 20_000,
        columns: BASELINE_COLUMNS,
        hyperparameters,
        runtime: 'pyodide-sklearn',
      })
    const table = interpolate(PYODIDE_DECISION_TREE_BASELINE_MS, 20_000)
    expect(tree({})).toBeCloseTo(table, 6)
    // 무엇을 주든 같은 수다 - 읽을 손잡이가 없다.
    expect(tree({ max_iter: 1000 })).toBeCloseTo(table, 6)
    expect(tree({ n_estimators: 500 })).toBeCloseTo(table, 6)
  })

  /**
   * **학생이 기다리는 것은 시동 + 학습이다.** 기준표는 시동을 시계 밖에 두고 쟀으므로
   * 예상이 그것을 더해야 한다 — 안 더하면 27.3MB를 받는 줄이 *"약 1초"*라고 말한다.
   */
  it('sklearn 줄의 예상에 시동이 들어 있다', () => {
    const input = {
      algorithm: 'naive_bayes' as const,
      dataType: 'tabular' as const,
      rows: 1000,
      columns: BASELINE_COLUMNS,
      hyperparameters: {},
    }
    const training = baselineMs({ ...input, runtime: 'pyodide-sklearn' }) ?? 0
    const shown = estimateMs({ ...input, runtime: 'pyodide-sklearn' }, 1) ?? 0
    expect(shown - training).toBe(PYODIDE_BOOT_MS)
    // 순수 JS는 시동이 없다.
    expect(estimateMs({ ...input, runtime: 'mljs' }, 1)).toBe(
      baselineMs({ ...input, runtime: 'mljs' }),
    )
  })
})
