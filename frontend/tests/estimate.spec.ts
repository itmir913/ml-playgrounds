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

import { describe as group, expect, it } from 'vitest'

import {
  BASELINE_COLUMNS,
  MLJS_DECISION_TREE_BASELINE_MS,
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

/** 손잡이를 안 건드린 기본 상태. 기준표를 잰 모양 그대로다. */
function input(algorithm: string, rows: number, columns = BASELINE_COLUMNS) {
  return { algorithm, dataType: 'tabular' as const, rows, columns, hyperparameters: {} }
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
    const naive = ALGORITHMS.find((entry) => entry.id === 'naive_bayes')?.baseline.tabular.ms ?? []
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
      expect(algorithm.baseline.tabular.ms.length, algorithm.id).toBeGreaterThan(1)
      expect(['linear', 'flat'], algorithm.id).toContain(algorithm.baseline.tabular.columns)
      /**
       * **이미지 칸은 비었거나 제대로 된 표다.** 안 잰 칸이 조용히 숫자를 갖지 않는다는
       * 것이 원래 규칙이었고, 2026-09-03에 첫 표가 채워지면서 **"비어 있다"에서 "점 하나
       * 짜리 가짜가 아니다"로** 넓어졌다.
       *
       * **채워졌으면 `flat`이어야 한다** — 사진 표는 임베딩 차원에서 재어지므로 특성
       * 배수를 한 번 더 곱하면 그 차원을 두 번 센다 (`backend.ts`의 `UNMEASURED_BASELINE`).
       */
      const image = algorithm.baseline.image
      if (image.ms.length > 0) {
        expect(image.ms.length, algorithm.id).toBeGreaterThan(1)
        expect(image.columns, algorithm.id).toBe('flat')
      }
    }
  })

  it('기준표의 행 수가 오름차순이다 - 보간이 그것을 전제한다', () => {
    for (const algorithm of ALGORITHMS) {
      for (const baseline of [algorithm.baseline.tabular, algorithm.baseline.image]) {
        const rows = baseline.ms.map(([value]) => value)
        expect(rows, algorithm.id).toEqual([...rows].sort((a, b) => a - b))
      }
    }
  })

  /** **채워진 사진 표가 하나라도 있어야 위 검사가 빈 배열을 훑지 않는다.** */
  it('사진 기준표가 적어도 하나는 차 있다', () => {
    expect(ALGORITHMS.filter((one) => one.baseline.image.ms.length > 0).length).toBeGreaterThan(0)
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
  })

  it('기본 손잡이면 기준표의 값 그대로다', () => {
    const table = ALGORITHMS.find((one) => one.id === 'neural_network')?.baseline.image.ms ?? []
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
      baseline: { ...entry.baseline, image: { ms: [], columns: 'flat' as const } },
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
