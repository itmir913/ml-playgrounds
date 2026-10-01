/**
 * **순열 특성 중요도** (`open-decisions.md` "99. 모델이 어느 특성에 기댔는지 보일 것인가").
 *
 * scikit-learn `permutation_importance`와 같은 계산이다 — 학습한 모델은 그대로 두고, 테스트 데이터에서
 * 원래 열 하나의 값을 행끼리 섞어 점수가 얼마나 떨어지는지를 `PERMUTATION_REPEATS`번 재어 평균과
 * 표준편차를 낸다. 점수는 그 모델의 기본 점수다 — 분류는 정확도, 회귀는 결정계수(sklearn `score`).
 *
 * **재학습하지 않는다.** 저장된 모델로 다시 잰 기준 점수가 파일의 점수와 다르면 내지 않는다(97·98과
 * 같은 대조). 무는 검사: `tests/permutation-importance.spec.ts`.
 *
 * **Vue도 chart.js도 모른다.**
 */

import { PERMUTATION_REPEATS } from '@/limits'
import { dataSnapshot, type Experiment, type Run } from '@/project/schema'

import { evaluate } from './metrics'
import { loadModel } from './models'
import { trainingRowsFor } from './predict'
import { transform, targetValues, type Dataset, type Preprocessor } from './preprocess'
import { labelSeed, shuffled } from './shuffle'

/** 원래 열 하나의 중요도. */
export interface FeatureWeight {
  readonly feature: string
  /** 섞었을 때 점수가 떨어진 양의 평균. **음수일 수 있다** — 섞었더니 오히려 나았다. */
  readonly mean: number
  /** 그 표준편차(모표준편차 — numpy `std`의 기본값). */
  readonly std: number
}

export interface PermutationImportance {
  /** 점수의 이름 — `accuracy` 또는 `r2`. 화면이 단위를 말한다. */
  readonly metric: 'accuracy' | 'r2'
  /** 섞기 전의 점수. 파일의 값과 같다. */
  readonly baseline: number
  /** 평균이 큰 것부터. */
  readonly weights: readonly FeatureWeight[]
}

export type PermutationImportanceResult =
  | { readonly kind: 'importance'; readonly importance: PermutationImportance }
  /** 다시 잰 기준 점수가 파일의 값과 다르다. 그리지 않고 그 사실만 말한다. */
  | { readonly kind: 'mismatch' }

export interface PermutationImportanceInput {
  readonly run: Run
  readonly experiment: Experiment
  readonly dataset: Dataset | null
  /** `provided` 분할의 테스트 표. 그 밖에는 안 쓴다. */
  readonly testDataset: Dataset | null
  readonly preprocessor: Preprocessor | null
  readonly modelBytes: Uint8Array | undefined
}

/** 기준 점수를 견주는 허용오차. 같은 해석기의 같은 연산이라 정확히 같아야 한다(97과 같다). */
const SCORE_TOLERANCE = 1e-9

/**
 * 중요도. **재료가 하나라도 없거나 분류·회귀가 아니면 `null`** — 모델이 안 담긴 파일, 데이터를 뺀 파일,
 * 사진 프로젝트다. 그때 패널은 자리 자체가 없다.
 */
export function permutationImportanceFor(
  input: PermutationImportanceInput,
): PermutationImportanceResult | null {
  const { run, experiment, dataset, testDataset, preprocessor, modelBytes } = input
  if (!modelBytes || !dataset || !preprocessor) return null
  const { settings } = experiment
  const taskType = settings.taskType
  if (taskType !== 'classification' && taskType !== 'regression') return null
  const metric = taskType === 'classification' ? 'accuracy' : 'r2'
  const stored = run.metrics?.[metric]
  if (stored === undefined) return null

  let snapshot: ReturnType<typeof dataSnapshot<'tabular'>>
  try {
    snapshot = dataSnapshot('tabular', settings)
  } catch {
    return null
  }
  const target = snapshot.target
  if (target === undefined || target === '') return null
  const source = settings.split.method === 'provided' ? testDataset : dataset
  if (!source) return null
  const rows = settings.testIndices
  if (rows.length === 0) return null
  const encoding = snapshot.preprocessing.categoricalEncoding

  let predict: ReturnType<typeof loadModel>
  try {
    predict = loadModel(JSON.parse(new TextDecoder().decode(modelBytes)), {
      trainingRows: trainingRowsFor(experiment, preprocessor, dataset),
    })
  } catch {
    return null
  }

  const truth = targetValues(source, rows, target)
  // 테스트 행만 담은 표. 섞을 때마다 이 표의 열 하나를 갈아 끼운다.
  const table: Dataset = {
    columns: source.columns,
    rows: rows.map((row) => source.rows[row] ?? []),
  }
  const all = table.rows.map((_row, index) => index)
  const scoreOf = (candidate: Dataset): number =>
    evaluate(taskType, truth, predict(transform(preprocessor, candidate, all, encoding))).metrics[
      metric
    ] ?? Number.NaN

  let baseline: number
  try {
    baseline = scoreOf(table)
  } catch {
    return { kind: 'mismatch' }
  }
  if (!(Math.abs(baseline - stored) <= SCORE_TOLERANCE)) return { kind: 'mismatch' }

  const weights = preprocessor.columns.map((column): FeatureWeight => {
    const at = table.columns.indexOf(column.name)
    const drops = Array.from({ length: PERMUTATION_REPEATS }, (_value, repeat) => {
      // 열과 반복마다 씨앗을 가른다 — 같은 순열이 두 열에 걸리면 두 열의 상관이 그대로 남는다.
      const order = shuffled(all, labelSeed(settings.split.randomState, `${column.name}#${repeat}`))
      const permuted: Dataset = {
        columns: table.columns,
        rows: table.rows.map((row, index) => {
          const copy = [...row]
          copy[at] = table.rows[order[index] ?? index]?.[at] ?? ''
          return copy
        }),
      }
      return baseline - scoreOf(permuted)
    })
    const mean = drops.reduce((sum, drop) => sum + drop, 0) / drops.length
    const variance = drops.reduce((sum, drop) => sum + (drop - mean) ** 2, 0) / drops.length
    return { feature: column.name, mean, std: Math.sqrt(variance) }
  })

  return {
    kind: 'importance',
    importance: { metric, baseline, weights: [...weights].sort((a, b) => b.mean - a.mean) },
  }
}
