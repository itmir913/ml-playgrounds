/**
 * 학습셋/평가셋 분할. **엔진보다 앞에 있고 엔진과 무관하다.**
 *
 * 여기서 나온 인덱스가 .mlpx의 experiment.settings.trainIndices / testIndices가 되고,
 * 서버로 학습을 보낼 때도 함께 간다. **양쪽이 각자 분할을 계산하면 라이브러리 버전 차이로
 * 테스트셋이 갈리고, 그러면 같은 실험인데 비교가 성립하지 않는다** (mlpx-spec.md 0.3).
 * 계산하는 곳은 여기 하나다.
 *
 * 인덱스는 **정본 CSV의 행 번호**다(헤더 제외, 0부터). 참조형 모델(KNN·SVM)이 이 번호로
 * dataset/data.csv를 가리키므로(mlpx-spec.md 5.1) 다른 기준으로 세면 안 된다.
 * 그래서 쓸 수 없는 행을 걸러내는 일은 **부르는 쪽이** 하고 여기엔 원본 번호만 넘어온다 -
 * 걸러낸 뒤 0부터 다시 세면 그 번호가 조용히 다른 행을 가리킨다.
 *
 * randomState는 항상 저장하고 항상 쓴다. 재현 가능성이 교육용 도구의 생명이다 (CLAUDE.md 2).
 */

import { ClientError } from '../errors'
import { MIN_SPLIT_ROWS } from '../limits'
import type { Split } from '../project/schema'
import { groupByLabel, labelSeed, shuffled } from './shuffle'

export interface SplitIndices {
  trainIndices: number[]
  testIndices: number[]
}

export interface SplitInput {
  /**
   * 학습에 쓸 수 있는 행의 **원본 번호**. 타깃이 비었거나 결측 처리에서 버려진 행은
   * 여기 없어야 한다.
   */
  rows: readonly number[]
  /**
   * rows와 같은 길이의 타깃 값. 층화할 때만 쓴다.
   *
   * 값을 문자열로 받는다 - 분할은 라벨이 같은지만 보면 되고, 숫자인지 범주인지는
   * 알 필요가 없다. 아는 척하면 3과 "3"이 다른 클래스가 된다.
   */
  labels?: readonly string[]
}

/**
 * 몫을 개수로 나눈다 — sklearn `_approximate_mode`와 같은 규칙이다.
 *
 * 비율대로 나눈 뒤 **내리고**, 모자란 만큼을 **소수부가 큰 쪽부터** 하나씩 얹는다.
 * 그래서 총합이 정확히 `draws`가 된다 — 칸마다 따로 올림하면 총합이 넘친다.
 *
 * **소수부가 같은 칸이 여럿이면 씨앗으로 섞어 고른다.** sklearn이 이 자리를 난수로
 * 가르는 이유는 **편향 때문이다** — 늘 앞자리부터 주면 데이터에 먼저 나온 라벨이
 * 언제나 한 장을 더 받는다. 씨앗을 쓰므로 `randomState`가 같으면 우리끼리는 언제나
 * 같은 답이다.
 *
 * **sklearn과 행 단위로 같지는 않다.** 저쪽 난수는 numpy의 것이고 우리 것이 아니다 —
 * 여기서 주장하는 것은 **개수를 세는 규칙**이지 어느 행이 뽑히느냐가 아니고, 동점이
 * 생기면 반별 개수도 갈릴 수 있다.
 */
function approximateMode(counts: readonly number[], draws: number, seed: number): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total === 0) return counts.map(() => 0)

  const exact = counts.map((count) => (count / total) * draws)
  const floored = exact.map((value) => Math.floor(value))
  let missing = draws - floored.reduce((sum, value) => sum + value, 0)
  if (missing <= 0) return floored

  // 소수부마다 그 값을 가진 칸들. 같은 값끼리가 곧 동점이다.
  const tied = new Map<number, number[]>()
  for (const [index, value] of exact.entries()) {
    const remainder = value - floored[index]!
    tied.set(remainder, [...(tied.get(remainder) ?? []), index])
  }

  for (const remainder of [...tied.keys()].sort((left, right) => right - left)) {
    if (missing === 0) break
    // 동점끼리는 씨앗으로 섞는다 - 앞자리부터 주면 먼저 나온 라벨로 편향된다.
    for (const index of shuffled(tied.get(remainder) ?? [], labelSeed(seed, String(remainder)))) {
      if (missing === 0) break
      // 그 반이 가진 것보다 많이 가져갈 수는 없다.
      if (floored[index]! >= counts[index]!) continue
      floored[index]! += 1
      missing -= 1
    }
  }
  return floored
}

/**
 * 한 덩어리에서 평가셋으로 보낼 개수.
 *
 * **`ceil`이다 — sklearn `train_test_split`과 같다** (`n_test = ceil(n * test_size)`,
 * 2026-08-19에 `round`에서 옮겼다). 이 도구는 종착지가 아니라 scikit-learn으로 가는
 * 발판이고, 여기서 익힌 20%가 거기서 다른 20%면 발판이 아니다 (`CLAUDE.md` §2).
 * 7행에서 20%를 고르면 `round`는 1행, `ceil`은 2행을 평가로 보낸다.
 *
 * **층화에서는 이 함수가 전체 개수만 센다.** 반별로 나누는 것은 `approximateMode`이고,
 * 라벨마다 여기를 부르면 총 개수가 sklearn과 갈린다 (R6 감사 B-1).
 *
 * **학습셋에 하나는 남긴다.** 전부 가져가면 학습할 것이 없다. sklearn은 그 자리에서
 * 던지는데 **우리는 하나를 남긴다** — 교실에서 멈추는 것보다 낫다.
 *
 * **아래쪽 클램프는 없다.** 예전에는 `Math.max(…, 1)`이 있었는데 `ceil`로 옮긴 뒤
 * **도달 불가능해졌다** — 스키마가 `testSize`를 `gt(0).lt(1)`로 막으므로(`schema.ts`)
 * 양수의 올림은 언제나 1 이상이다. **검사 둘이 그 죽은 가지를 지킨다고 말하고 있었다**
 * (R7 감사 B-1).
 */
function testCountFor(total: number, testSize: number): number {
  return Math.min(Math.ceil(total * testSize), total - 1)
}

/**
 * holdout 분할. kfold는 없다 - 폴드마다 학습·평가가 생기면 인덱스의 모양 자체가 달라져
 * 어차피 formatVersion이 올라가는 변경이다 (project/schema.ts).
 *
 * 층화(stratify)는 라벨 비율을 학습셋과 평가셋에 똑같이 유지한다. 붓꽃처럼 클래스가
 * 고르면 티가 안 나지만, 교실 데이터는 대개 한쪽으로 쏠려 있어서 층화가 없으면
 * 평가셋에 특정 클래스가 통째로 빠지는 일이 실제로 생긴다.
 *
 * 결과는 **오름차순으로 정렬해서** 돌려준다. 셔플 순서를 그대로 남길 이유가 없고,
 * 학생이 압축을 풀어 runs.json을 들여다보는 것은 교육적으로 좋은 일이다.
 */
export function holdoutSplit(input: SplitInput, split: Split): SplitIndices {
  const { rows, labels } = input

  if (rows.length < MIN_SPLIT_ROWS) {
    throw new ClientError('SPLIT_TOO_FEW_ROWS', {
      minRows: MIN_SPLIT_ROWS,
      actualRows: rows.length,
    })
  }

  const trainIndices: number[] = []
  const testIndices: number[] = []

  if (split.stratify && labels) {
    const groups = groupByLabel(rows, labels)
    // **조용히 층화를 끄지 않는다.** 학생은 자기 데이터가 왜 그런지 알아야 층화를 끌지
    // 데이터를 더 모을지 고를 수 있다. 정상 경로에서는 전처리 화면이 먼저 말해 주고
    // (ml/selection.ts의 stratifyBlock) 여기는 마지막 방어선이다 - 남의 .mlpx를 열어
    // 다시 돌리는 경로에는 우리 화면이 없다.
    const lonely = [...groups].filter(([, group]) => group.length < MIN_SPLIT_ROWS)
    const first = lonely[0]
    if (first && lonely.length > 1) {
      // 1개뿐인 값이 여럿이면 타깃이 사실상 연속이다. "그 값을 더 모아라"는 영원히
      // 불가능한 조언이 된다 (open-decisions.md "층화는 갈리는 값에서만 뜻이 있다").
      throw new ClientError('SPLIT_STRATIFY_TARGET_CONTINUOUS', {
        kinds: groups.size,
        lonely: lonely.length,
      })
    }
    if (first) {
      throw new ClientError('SPLIT_STRATIFY_IMPOSSIBLE', {
        label: first[0],
        count: first[1].length,
        minRows: MIN_SPLIT_ROWS,
      })
    }
    /**
     * **sklearn `StratifiedShuffleSplit`과 같은 순서로 센다** (2026-08-19, R6 감사 B-1).
     *
     * 전에는 라벨마다 따로 `ceil`을 했다. 그러면 **총 개수가 sklearn과 달라진다** —
     * A 7개·B 9개에서 25%를 고르면 저쪽은 4행, 여기는 5행이었다. 범주가 많고 각각 작을수록
     * 벌어져서, 10범주 × 12장에서 10%면 저쪽 12장·여기 20장이다.
     */
    const counts = [...groups.values()].map((group) => group.length)
    const total = rows.length
    const testCount = testCountFor(total, split.testSize)
    // **학습 몫을 먼저 나누고 남은 것에서 평가 몫을 나눈다.** 순서가 sklearn과 같아야 한다.
    const trainPerClass = approximateMode(counts, total - testCount, split.randomState)
    const testPerClass = approximateMode(
      counts.map((count, index) => count - (trainPerClass[index] ?? 0)),
      testCount,
      split.randomState,
    )

    for (const [index, [label, group]] of [...groups].entries()) {
      const order = shuffled(group, labelSeed(split.randomState, label))
      const take = testPerClass[index] ?? 0
      testIndices.push(...order.slice(0, take))
      trainIndices.push(...order.slice(take))
    }
  } else {
    const order = shuffled(rows, split.randomState)
    const testCount = testCountFor(order.length, split.testSize)
    testIndices.push(...order.slice(0, testCount))
    trainIndices.push(...order.slice(testCount))
  }

  const ascending = (a: number, b: number): number => a - b
  return { trainIndices: trainIndices.sort(ascending), testIndices: testIndices.sort(ascending) }
}

/**
 * 평가 데이터가 파일로 왔을 때. **나누지 않는다** - 학습 데이터는 전부 학습에 쓰고,
 * 평가 데이터셋의 usableRows 전부가 testIndices다 (mlpx-spec.md §1.1,
 * open-decisions.md "학습용과 평가용 파일이 따로일 수 있다").
 *
 * **`testIndices`는 `input.rows`와 다른 정본을 가리킨다.** trainIndices는 언제나
 * `data.csv`이고 testIndices는 `test.csv`다 - 두 배열이 서로 다른 표를 가리키는
 * 유일한 경우다. 참조형 모델이 보는 것은 trainIndices뿐이라 그쪽은 흔들리지 않는다.
 *
 * `testInput`이 없는 것은 부르는 쪽 버그다 - `split.method`가 `provided`이면
 * 평가 데이터셋이 확정된 뒤에만 이 함수가 불려야 한다 (전처리 화면이 그 순서를 보장한다).
 */
function providedSplit(input: SplitInput, testInput: SplitInput | undefined): SplitIndices {
  if (input.rows.length === 0) {
    throw new ClientError('SPLIT_TOO_FEW_ROWS', { minRows: 1, actualRows: 0 })
  }
  // **평가 데이터가 없는 것은 학습 데이터가 없는 것과 다른 실패다.** 같은 코드로 뭉치면
  // 평가 파일이 문제인데 "학습에 쓸 수 있는 데이터가 0줄"이라고 말하게 되고, 학생은
  // 멀쩡한 학습 데이터를 들여다본다.
  if (!testInput || testInput.rows.length === 0) {
    throw new ClientError('TEST_DATASET_NO_USABLE_ROWS')
  }
  const ascending = (a: number, b: number): number => a - b
  return {
    trainIndices: [...input.rows].sort(ascending),
    testIndices: [...testInput.rows].sort(ascending),
  }
}

/**
 * 분할 방식마다의 구현. **`if (method === 'holdout')`을 만들지 마라** - 표에 줄을
 * 더하면 부르는 쪽이 따라온다 (ml/algorithms.ts, ml/metrics.ts와 같은 방식).
 *
 * `provided`만 `testInput`을 쓴다. holdout은 한 표 안에서 나누므로 무시한다 - TS가
 * 여분 인자를 허용하는 함수 할당성 규칙이라 시그니처를 하나로 맞출 수 있다.
 */
const SPLIT_BY_METHOD: Record<
  Split['method'],
  (input: SplitInput, split: Split, testInput?: SplitInput) => SplitIndices
> = {
  holdout: holdoutSplit,
  provided: (input, _split, testInput) => providedSplit(input, testInput),
}

/**
 * 설정이 고른 방식으로 나눈다. 실험 실행이 부르는 유일한 입구다.
 *
 * `testInput`은 `provided`일 때만 쓴다 - 평가 데이터셋의 usableRows다 (라벨은
 * 필요 없다. 나누지 않으므로 층화가 없다).
 */
export function splitRows(input: SplitInput, split: Split, testInput?: SplitInput): SplitIndices {
  return SPLIT_BY_METHOD[split.method](input, split, testInput)
}
