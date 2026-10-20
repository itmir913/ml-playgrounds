/**
 * 과거 배포판 골든의 **답을 지금 코드로 내고 견주는 손** — `legacy-mlpx.spec.ts`와 `legacy-categorical.spec.ts`가
 * 같이 쓴다. 답의 모양은 생성기(`scripts/legacy-mlpx/legacy-generate.mjs`·`legacy-categorical.mjs`)의 `answersOf`와
 * 같다. 열쇠는 `실험/run/알고리즘`, 못 내면 그 코드를 적는다.
 */

import { expect } from 'vitest'

import { isClientError } from '../../src/errors'
import { interpreterFor, loadModel, loadModelProba, type LoadContext } from '../../src/ml/models'
import { inputVector, readPreprocessors, trainingRowsFor } from '../../src/ml/predict'
import type { Preprocessor } from '../../src/ml/preprocess'
import { readDataset } from '../../src/project/dataset'
import type { ProjectFile } from '../../src/project/format'
import type { Experiment } from '../../src/project/schema'

export interface Probabilities {
  readonly classes: readonly string[]
  readonly values: readonly (readonly number[])[]
}

export interface Answers {
  readonly answers: Record<string, unknown>
  readonly probabilities: Record<string, Probabilities>
}

export function needsRows(format: string): boolean {
  return interpreterFor(format)?.needsTrainingRows === true
}

export function answersOf(
  project: ProjectFile,
  contextOf: (experiment: Experiment, preprocessor: Preprocessor, format: string) => LoadContext,
  featuresOf: (experiment: Experiment, preprocessor: Preprocessor) => number[][],
): Answers {
  const preprocessors = readPreprocessors(project.document, project.models)
  const answers: Record<string, unknown> = {}
  const probabilities: Record<string, Probabilities> = {}
  for (const experiment of project.document.runs.experiments) {
    const preprocessor = preprocessors.get(experiment.id)
    for (const run of experiment.runs) {
      const key = `${experiment.id}/${run.id}/${run.algorithm}`
      if (!run.model) {
        answers[key] = { omitted: run.modelOmitted ?? null }
        continue
      }
      const bytes = project.models.get(run.model.path)
      if (!bytes || !preprocessor) {
        answers[key] = { error: 'NO_BYTES_OR_PREPROCESSOR' }
        continue
      }
      const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      try {
        const context = contextOf(experiment, preprocessor, run.model.format)
        const features = featuresOf(experiment, preprocessor)
        answers[key] = loadModel(payload, context)(features)
        const proba = loadModelProba(payload, context)
        if (proba) {
          const values = proba.predict(features).map((row) => Array.from(row ?? []))
          probabilities[key] = { classes: proba.classes, values }
        }
      } catch (error) {
        if (!isClientError(error)) throw error
        answers[key] = { error: error.code }
      }
    }
  }
  return { answers, probabilities }
}

/** 표 프로젝트의 답. 질의는 열 이름 → 값이고, 실험마다 그 특성만 골라 쓴다. */
export function tabularAnswers(project: ProjectFile, queries: Record<string, string>[]): Answers {
  const dataset = readDataset(project)
  return answersOf(
    project,
    (experiment, preprocessor, format) =>
      needsRows(format) && dataset
        ? { trainingRows: trainingRowsFor(experiment, preprocessor, dataset) }
        : {},
    (_experiment, preprocessor) => queries.map((values) => inputVector(preprocessor, values)),
  )
}

/** 숫자는 부동소수 끝자리까지 같으라고 하지 않는다 — 예측 식의 덧셈 순서가 판마다 다를 수 있다. */
export function expectClose(actual: unknown, expected: number, label: string): void {
  expect(typeof actual, label).toBe('number')
  expect(Math.abs((actual as number) - expected), label).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(expected)),
  )
}

export function expectSameAnswer(actual: unknown, recorded: unknown, label: string): void {
  if (Array.isArray(recorded) && recorded.every((value) => typeof value === 'number')) {
    expect(Array.isArray(actual), label).toBe(true)
    expect(actual as unknown[], label).toHaveLength(recorded.length)
    recorded.forEach((value, index) => {
      expectClose((actual as unknown[])[index], value as number, `${label} [${index}]`)
    })
    return
  }
  expect(actual, label).toEqual(recorded)
}

export function expectSameProbabilities(
  actual: Probabilities | undefined,
  recorded: Probabilities,
  label: string,
): void {
  expect(actual, label).toBeDefined()
  expect(actual?.classes, label).toEqual(recorded.classes)
  expect(actual?.values, label).toHaveLength(recorded.values.length)
  recorded.values.forEach((row, rowIndex) => {
    row.forEach((value, column) => {
      expectClose(actual?.values[rowIndex]?.[column], value, `${label} [${rowIndex}][${column}]`)
    })
  })
}
