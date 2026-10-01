/**
 * 혼동 행렬 **칸마다의 테스트 행** (`open-decisions.md` "98. 혼동 행렬의 칸을 누르면 그 칸의 행을
 * 보일 것인가").
 *
 * Orange3의 Confusion Matrix 위젯이 칸을 누르면 그 칸의 행을 내보내는 것과 같은 자리다. 틀린 것은
 * 숫자가 아니라 구체적인 행이고, 그 행을 봐야 왜 헷갈렸는지(경계에 선 값, 라벨 오류) 보인다.
 *
 * **저장된 모델로 테스트 데이터를 다시 예측한다 — 재학습이 아니다** (`ml/regression-fit.ts`와 같은
 * 길). 다시 센 혼동 행렬이 파일의 것과 **칸 하나라도 다르면 행을 내지 않는다** — 다른 행을 그 칸의
 * 행이라고 말하게 된다. 무는 검사: `tests/confusion-rows.spec.ts`.
 *
 * **표 데이터만이다.** 사진 분류의 칸은 사진으로 보여야 하고 임베딩을 꺼내는 길이 따로다 — 결정문의
 * "넣지 않은 것".
 */

import type { ConfusionMatrix, Experiment, Run } from '@/project/schema'
import { dataSnapshot } from '@/project/schema'

import { evaluate } from './metrics'
import { loadModel } from './models'
import { trainingRowsFor } from './predict'
import { transform, targetValues, type Dataset, type Preprocessor } from './preprocess'

export interface ConfusionRows {
  /** 행이 놓인 정본 — `provided` 분할이면 테스트 표다. 화면이 원래 값을 이것으로 보인다. */
  readonly source: Dataset
  /** `cells[실제][예측]` = 그 칸의 테스트 행 번호들(`source` 안의). 파일의 행렬과 같은 차례다. */
  readonly cells: readonly (readonly (readonly number[])[])[]
}

export type ConfusionRowsResult =
  | { readonly kind: 'rows'; readonly rows: ConfusionRows }
  /** 다시 센 혼동 행렬이 파일의 것과 다르다. 행을 내지 않고 그 사실만 말한다. */
  | { readonly kind: 'mismatch' }

export interface ConfusionRowsInput {
  readonly run: Run
  readonly experiment: Experiment
  readonly dataset: Dataset | null
  /** `provided` 분할의 테스트 표. 그 밖에는 안 쓴다. */
  readonly testDataset: Dataset | null
  readonly preprocessor: Preprocessor | null
  readonly modelBytes: Uint8Array | undefined
}

/**
 * 칸마다의 행. **재료가 하나라도 없으면 `null`** — 모델이 안 담긴 파일, 데이터를 뺀 파일, 사진
 * 프로젝트다. 그때 화면은 칸을 눌러도 행 목록을 안 연다(사유는 다른 자리가 말한다).
 */
export function confusionRowsFor(input: ConfusionRowsInput): ConfusionRowsResult | null {
  const { run, experiment, dataset, testDataset, preprocessor, modelBytes } = input
  const stored = run.confusionMatrix
  if (!stored || !modelBytes || !dataset || !preprocessor) return null

  const { settings } = experiment
  let snapshot: ReturnType<typeof dataSnapshot<'tabular'>>
  try {
    snapshot = dataSnapshot('tabular', settings)
  } catch {
    // 사진 프로젝트의 설정은 표의 모양이 아니다.
    return null
  }
  const target = snapshot.target
  if (target === undefined || target === '') return null
  const source = settings.split.method === 'provided' ? testDataset : dataset
  if (!source) return null
  const rows = settings.testIndices
  if (rows.length === 0) return null

  const encoding = snapshot.preprocessing.categoricalEncoding
  let guesses: ReturnType<ReturnType<typeof loadModel>>
  try {
    // 참조형(KNN)은 훈련 행이 있어야 예측한다. 아닌 형식은 이 값을 안 본다(`LoadContext`).
    const predict = loadModel(JSON.parse(new TextDecoder().decode(modelBytes)), {
      trainingRows: trainingRowsFor(experiment, preprocessor, dataset),
    })
    guesses = predict(transform(preprocessor, source, rows, encoding))
  } catch {
    return null
  }

  const truth = targetValues(source, rows, target)
  let recounted: ConfusionMatrix | undefined
  try {
    recounted = evaluate('classification', truth, guesses).confusionMatrix
  } catch {
    return { kind: 'mismatch' }
  }
  if (!recounted || !sameMatrix(recounted, stored)) return { kind: 'mismatch' }

  const position = new Map(stored.labels.map((label, index) => [label, index]))
  const cells = stored.labels.map(() => stored.labels.map((): number[] => []))
  rows.forEach((row, index) => {
    const actual = position.get(truth[index] ?? '')
    const predicted = position.get(String(guesses[index] ?? ''))
    if (actual === undefined || predicted === undefined) return
    cells[actual]?.[predicted]?.push(row)
  })
  return { kind: 'rows', rows: { source, cells } }
}

function sameMatrix(a: ConfusionMatrix, b: ConfusionMatrix): boolean {
  if (a.labels.length !== b.labels.length) return false
  if (a.labels.some((label, index) => label !== b.labels[index])) return false
  return a.matrix.every((row, i) => row.every((count, j) => count === b.matrix[i]?.[j]))
}
