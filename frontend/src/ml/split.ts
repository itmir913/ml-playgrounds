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

import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'

import { ClientError } from '../errors'
import { hashText } from '../hash'
import { MIN_SPLIT_ROWS } from '../limits'
import type { Split } from '../project/schema'

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
 * 결정적 셔플. 같은 시드면 언제나 같은 순서다.
 *
 * Math.random을 쓰면 안 된다 - 시드를 줄 수 없어서 재현이 불가능하다.
 */
function shuffled(values: readonly number[], seed: number): number[] {
  const out = [...values]
  const rng = xoroshiro128plus(seed)
  // Fisher-Yates. 뒤에서부터 훑는다.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = uniformInt(rng, 0, i)
    const swap = out[i] as number
    out[i] = out[j] as number
    out[j] = swap
  }
  return out
}

/**
 * 라벨마다 시드를 흔든다.
 *
 * 라벨을 무시하고 randomState를 그대로 쓰면 **크기가 같은 두 라벨이 완전히 같은 순열을
 * 얻는다.** 데이터가 어떤 순서로 정렬돼 있으면(교실 CSV는 대개 정렬돼 있다) 그 상관이
 * 평가셋에 그대로 새겨진다. 라벨 길이만 더하는 식으로는 'cat'과 'dog'가 또 겹친다.
 *
 * 해시를 쓰는 이유는 안전이 아니라 **고르게 흩어지고 버전이 바뀌어도 같기 때문**이다.
 */
function labelSeed(randomState: number, label: string): number {
  return randomState ^ Number.parseInt(hashText(label).slice(0, 8), 16)
}

/**
 * 한 덩어리에서 평가셋으로 보낼 개수.
 *
 * **양쪽 모두 최소 하나는 남긴다.** 반올림해서 0이 나오면 평가할 것이 없고,
 * 전부 가져가면 학습할 것이 없다. 어느 쪽이든 지표가 의미를 잃는다.
 */
function testCountFor(total: number, testSize: number): number {
  return Math.min(Math.max(Math.round(total * testSize), 1), total - 1)
}

/** 라벨별로 원본 행 번호를 모은다. 등장 순서를 지켜야 결과가 결정적이다. */
function groupByLabel(rows: readonly number[], labels: readonly string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>()
  rows.forEach((row, position) => {
    const label = labels[position] ?? ''
    const group = groups.get(label)
    if (group) group.push(row)
    else groups.set(label, [row])
  })
  return groups
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
    for (const [label, group] of groupByLabel(rows, labels)) {
      if (group.length < MIN_SPLIT_ROWS) {
        // 조용히 층화를 끄지 않는다. 학생은 자기 데이터가 왜 그런지 알아야
        // 층화를 끌지 데이터를 더 모을지 고를 수 있다.
        throw new ClientError('SPLIT_STRATIFY_IMPOSSIBLE', {
          label,
          count: group.length,
          minRows: MIN_SPLIT_ROWS,
        })
      }
      const order = shuffled(group, labelSeed(split.randomState, label))
      const testCount = testCountFor(order.length, split.testSize)
      testIndices.push(...order.slice(0, testCount))
      trainIndices.push(...order.slice(testCount))
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
 * 안 나눈다. **가진 행을 전부 학습에 쓰고 점수도 그 행으로 매긴다.**
 *
 * 오렌지3의 "Test on train data"와 같다. `testIndices`에 학습 행을 그대로 적는 것은
 * 거짓말이 아니라 사실이고, 재실행 대조도 그 행으로 다시 채점하므로 그대로 성립한다.
 *
 * **숫자는 거의 언제나 부푼다.** 결정트리는 100%가 흔하다. 그걸 아는 것은 화면의 일이고
 * 여기서 할 수 있는 것은 사실을 정확히 적는 것뿐이다.
 */
function wholeSet(input: SplitInput): SplitIndices {
  if (input.rows.length === 0) {
    throw new ClientError('SPLIT_TOO_FEW_ROWS', { minRows: 1, actualRows: 0 })
  }
  const ascending = (a: number, b: number): number => a - b
  const rows = [...input.rows].sort(ascending)
  return { trainIndices: rows, testIndices: [...rows] }
}

/**
 * 분할 방식마다의 구현. **`if (method === 'holdout')`을 만들지 마라** - 표에 줄을
 * 더하면 부르는 쪽이 따라온다 (ml/algorithms.ts, ml/metrics.ts와 같은 방식).
 */
const SPLIT_BY_METHOD: Record<Split['method'], (input: SplitInput, split: Split) => SplitIndices> =
  {
    holdout: holdoutSplit,
    none: wholeSet,
  }

/** 설정이 고른 방식으로 나눈다. 실험 실행이 부르는 유일한 입구다. */
export function splitRows(input: SplitInput, split: Split): SplitIndices {
  return SPLIT_BY_METHOD[split.method](input, split)
}
