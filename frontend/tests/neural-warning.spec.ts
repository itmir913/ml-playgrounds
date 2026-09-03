/**
 * **인공신경망의 경고 배선과 손실 곡선의 가장자리** (2026-09-03 R25 B-4·C-5·C-6).
 *
 * **여기 있던 것이 통째로 무검사였다.** 감사가 넷을 뒤집어도 저장소가 초록이었다 —
 * `converged`를 영원히 거짓으로 · 경고를 통째로 제거 · 분류와 회귀의 경고 코드를 맞바꿈
 * (회귀 학생에게 스케일링을 권하게 되는데, 결정문이 그 처방을 R² −0.20 → −10.2로 **해롭다**고
 * 재 두었다) · `epochs`를 하나 작게. 로지스틱·SVM·K-평균은 같은 배선에 검사가 넷씩 있었다.
 *
 * **코드는 옳았다.** 잃은 것은 그 옳음을 지키는 장치뿐이다.
 *
 * **두 가지가 다 도는 픽스처를 써야 한다.** 감사의 첫 처방은 `converged`를 못 물었다 —
 * 그 데이터에서는 아무것도 200 에폭 전에 안 멈춰 **`converged = true` 가지가 한 번도 안
 * 돌았기** 때문이다. 아래 "스스로 멈추는 실행이 실제로 있다"가 그 자리를 지킨다.
 */

import { describe, expect, it } from 'vitest'

import { toCanonicalCsv } from '../src/data/serialize'
import { NEURAL_MAX_EPOCHS } from '../src/limits'
import { fit } from '../src/ml/engines/mljs'
import { runExperiment as runExperimentRaw, type ExperimentInput } from '../src/ml/experiment'
import { lossCurveOf, lossDescended } from '../src/ml/loss-curve'
import { NEURAL_FORMAT, parseNeural } from '../src/ml/models'
import { predictableModels } from '../src/ml/predict'
import type { Dataset } from '../src/ml/preprocess'
import { reproduceExperiment } from '../src/ml/reproduce'
import { applyExperiment } from '../src/project/attach'
import { readDataset } from '../src/project/dataset'
import { readProject, type ProjectFile } from '../src/project/format'
import {
  dataSnapshot,
  type Settings,
  type TabularSettings,
  type TaskType,
} from '../src/project/schema'
import { irisDataset, IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN } from './fixtures/iris'
import { emptyProjectFile } from './fixtures/project'
import { writeProjectBytes } from './fixtures/write'

const OFFLINE = {
  limitsOff: false,
  serverStatus: 'unavailable' as const,
  rowCount: 30,
  dataType: 'tabular' as const,
}
const table = irisDataset()

function runExperiment(
  input: Omit<ExperimentInput, 'snapshot'>,
  options?: Parameters<typeof runExperimentRaw>[1],
): ReturnType<typeof runExperimentRaw> {
  return runExperimentRaw({ ...input, snapshot: dataSnapshot('tabular', input.settings) }, options)
}

function csvBytes(dataset: Dataset): Uint8Array {
  return toCanonicalCsv([[...dataset.columns], ...dataset.rows.map((row) => [...row])])
}

const baseData: TabularSettings = {
  dataset: {
    path: 'dataset/data.csv',
    originalFileName: 'iris.csv',
    hasHeader: true,
    encoding: 'utf-8',
  },
  features: [...IRIS_FEATURE_COLUMNS],
  target: IRIS_TARGET_COLUMN,
  preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
}

function settingsFor(taskType: TaskType): Settings {
  const regression = taskType === 'regression'
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: !regression, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'neural_network' }],
    hyperparameters: {},
    data: regression
      ? {
          ...baseData,
          features: ['sepal_length', 'sepal_width', 'petal_width'],
          target: 'petal_length',
        }
      : baseData,
  }
}

function projectWith(settings: Settings, taskType: TaskType): ProjectFile {
  const base = emptyProjectFile()
  return {
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, taskType },
      settings,
    },
    dataset: { bytes: csvBytes(table), hash: 'x'.repeat(64) },
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

function neuralRunOf(project: ProjectFile) {
  const entries = predictableModels(project.document, true).filter(
    (entry) => entry.run.algorithm === 'neural_network',
  )
  expect(entries).toHaveLength(1)
  return entries[0]!
}

/** 두 범주가 섞여 200 에폭을 다 쓰게 하는 작은 벌. */
const blobs = (() => {
  const features: number[][] = []
  const target: string[] = []
  let state = 7
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let index = 0; index < 60; index += 1) {
    const label = index % 2
    features.push([random() + label * 1.5, random() - label * 0.8, random()])
    target.push(label === 1 ? 'b' : 'a')
  }
  return { features, target }
})()

describe('경고는 에폭 상한에 닿았을 때만 붙는다', { timeout: 60_000 }, () => {
  /**
   * **경고의 유무가 곡선의 길이와 정확히 맞물린다.** 이 한 줄이 A2(경고 제거)와
   * N14(`epochs`를 하나 작게)를 함께 문다.
   */
  it('분류: 경고 ⇔ 곡선이 상한에 닿음, 그리고 iterations가 곡선 길이다', async () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const neurons of [4, 100]) {
        const result = await fit('neural_network', {
          features: blobs.features,
          rowIndices: blobs.features.map((_, index) => index),
          target: blobs.target,
          taskType: 'classification',
          hyperparameters: { hiddenLayers: 1, neuronsPerLayer: neurons },
          randomState: seed,
        })
        const curve = (result.model as unknown as { lossCurve: number[] }).lossCurve
        expect(result.warning !== undefined, `seed ${seed} neurons ${neurons}`).toBe(
          curve.length >= NEURAL_MAX_EPOCHS,
        )
        if (result.warning) {
          expect(result.warning.code).toBe('NEURAL_NOT_CONVERGED')
          expect(result.warning.params).toEqual({ iterations: curve.length })
        }
      }
    }
  })

  /**
   * **회귀는 코드가 갈린다.** 맞바꾸면(A1) 회귀 학생이 *"스케일링을 켜라"*를 읽는데,
   * 결정문이 그것을 R² −0.20 → **−10.2**로 재 두었다 — 시킨 대로 하면 더 나빠진다.
   */
  it('회귀: 같은 규칙이되 회귀 코드로 붙는다', async () => {
    const features = table.rows.map((row) => [Number(row[0]), Number(row[1]), Number(row[3])])
    const target = table.rows.map((row) => String(row[2]))
    for (const seed of [0, 1, 2, 3]) {
      const result = await fit('neural_network', {
        features,
        rowIndices: features.map((_, index) => index),
        target,
        taskType: 'regression',
        hyperparameters: {},
        randomState: seed,
      })
      const curve = (result.model as unknown as { lossCurve: number[] }).lossCurve
      expect(result.warning !== undefined, `seed ${seed}`).toBe(curve.length >= NEURAL_MAX_EPOCHS)
      if (result.warning) {
        expect(result.warning.code).toBe('NEURAL_REGRESSION_NOT_CONVERGED')
        expect(result.warning.params).toEqual({ iterations: curve.length })
      }
    }
  })

  /**
   * **스스로 멈추는 가지가 실제로 도는 벌이 있어야 한다.** 위 둘만 있으면
   * `converged = false`(영원히 경고)를 심어도 조용하다 — 그 데이터에서는 아무것도 상한
   * 전에 안 멈추기 때문이다. 감사의 첫 처방이 그래서 N5를 못 물었다.
   */
  it('스스로 멈추는 실행이 실제로 있다 - 없으면 위 검사가 한쪽만 잰다', async () => {
    /**
     * **간격이 아주 넓으면 곧바로 평평해진다.** 재 보니 이 벌은 씨앗 다섯이 **전부**
     * 상한 전에 멈춘다(에폭 44·13·33·39·33). 위의 `blobs`는 **전부** 상한을 채운다 —
     * 둘을 같은 파일에 두어야 `converged`의 두 가지가 다 돈다.
     *
     * **간격을 좁히지 마라.** `±10`으로 재 보니 다섯 다 200을 채워 이 검사가 죽는다.
     */
    const features = Array.from({ length: 20 }, (_, index) => [index < 10 ? -50 : 50])
    const target = Array.from({ length: 20 }, (_, index) => (index < 10 ? 'a' : 'b'))
    let stopped = 0
    for (const seed of [0, 1, 2, 3, 4]) {
      const result = await fit('neural_network', {
        features,
        rowIndices: features.map((_, index) => index),
        target,
        taskType: 'classification',
        hyperparameters: { hiddenLayers: 1, neuronsPerLayer: 100 },
        randomState: seed,
      })
      const curve = (result.model as unknown as { lossCurve: number[] }).lossCurve
      if (curve.length < NEURAL_MAX_EPOCHS) stopped += 1
      expect(result.warning !== undefined, `seed ${seed}`).toBe(curve.length >= NEURAL_MAX_EPOCHS)
    }
    expect(stopped, 'no run stopped early, so the converged branch never ran').toBe(5)
  })
})

/**
 * **두 시점: 파일로 나갔다 돌아오기 전후** (요청서의 사각 축).
 *
 * 경고·지표·모델 바이트·곡선이 그대로여야 하고, 재실행 대조가 그 run을 재현해야 한다.
 */
describe('.mlpx 왕복 전후', { timeout: 60_000 }, () => {
  for (const taskType of ['classification', 'regression'] as const) {
    it(`${taskType}: 곡선·경고·지표·모델 바이트가 같고 재실행 대조가 재현한다`, async () => {
      const settings = settingsFor(taskType)
      const result = await runExperiment(
        {
          dataset: table,
          testDataset: null,
          taskType,
          dataType: 'tabular',
          settings,
          context: OFFLINE,
        },
        { now: () => '2026-09-03T00:00:00.000Z' },
      )
      const applied = applyExperiment(
        projectWith(settings, taskType),
        result,
        '2026-09-03T00:00:00.000Z',
      )
      const before = neuralRunOf(applied)
      const bytesBefore = applied.models.get(before.run.model?.path ?? '')
      expect(bytesBefore).toBeDefined()
      const curveBefore = lossCurveOf(before.run.model?.format, bytesBefore)
      expect(curveBefore).not.toBeNull()

      const { bytes } = await writeProjectBytes(applied, '# 정리\n')
      const reopened = (await readProject(bytes)).project
      const after = neuralRunOf(reopened)
      const bytesAfter = reopened.models.get(after.run.model?.path ?? '')
      expect(bytesAfter).toBeDefined()

      expect(after.run.warning).toEqual(before.run.warning)
      expect(after.run.metrics).toEqual(before.run.metrics)
      expect(Buffer.from(bytesAfter!).equals(Buffer.from(bytesBefore!))).toBe(true)
      expect(lossCurveOf(after.run.model?.format, bytesAfter)).toEqual(curveBefore)

      const dataset = readDataset(reopened)
      expect(dataset).not.toBeNull()
      const mine = (
        await reproduceExperiment({
          experiment: after.experiment,
          dataset: dataset!,
          testDataset: null,
        })
      ).find((one) => one.runId === after.run.id)
      expect(mine?.status).toBe('REPRODUCED')
    })
  }
})

/** 곡선과 파일 검사에 쓸 작은 분류 모델 하나. */
const small = (
  await fit('neural_network', {
    features: Array.from({ length: 40 }, (_, index) => [
      (index % 5) / 5 + (index % 2 === 1 ? 1 : 0),
    ]),
    rowIndices: Array.from({ length: 40 }, (_, index) => index),
    target: Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 'a' : 'b')),
    taskType: 'classification',
    hyperparameters: { hiddenLayers: 1, neuronsPerLayer: 4 },
    randomState: 42,
  })
).model as unknown as {
  lossCurve: number[]
  weights: number[][][]
  intercepts: number[][]
  classes: string[]
}

const bytesOf = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

/**
 * **손실 곡선의 가장자리 둘.** `loss-curve.ts`의 머리말이 둘 다 단정하는데 무검사였다.
 */
describe('손실 곡선의 가장자리', () => {
  it('점 하나짜리 곡선은 안 그린다', () => {
    expect(
      lossCurveOf(NEURAL_FORMAT, bytesOf({ ...small, lossCurve: [small.lossCurve[0]] })),
    ).toBeNull()
    expect(
      lossCurveOf(NEURAL_FORMAT, bytesOf({ ...small, lossCurve: small.lossCurve.slice(0, 2) })),
    ).toHaveLength(2)
  })

  it('평평한 곡선은 내려간 것이 아니다', () => {
    expect(
      lossDescended([
        { epoch: 1, loss: 0.5 },
        { epoch: 2, loss: 0.5 },
      ]),
    ).toBe(false)
    expect(
      lossDescended([
        { epoch: 1, loss: 0.5 },
        { epoch: 2, loss: 0.6 },
      ]),
    ).toBe(false)
    expect(
      lossDescended([
        { epoch: 1, loss: 0.5 },
        { epoch: 2, loss: 0.4 },
      ]),
    ).toBe(true)
  })
})

/**
 * **`mlpx-spec.md` §5.11 불변식 5의 분류 쪽.** 회귀 쪽은 무는 검사가 있었는데
 * 분류 쪽은 없었다 — 출력 칸 수가 클래스 수와 안 맞는 파일이 그대로 읽혔다.
 */
describe('분류 파일의 출력 칸 수 (mlpx-spec §5.11 불변식 5)', () => {
  /** 마지막 층에 칸을 하나 더 붙인 파일. */
  function withExtraOutput(classes?: readonly string[]) {
    const broken = JSON.parse(JSON.stringify(small)) as typeof small
    if (classes) broken.classes = [...classes]
    const last = broken.weights.length - 1
    broken.weights[last] = broken.weights[last]!.map((row) => [...row, 0])
    broken.intercepts[last] = [...broken.intercepts[last]!, 0]
    return broken
  }

  it('이진 파일의 마지막 층이 두 칸이면 거부한다', () => {
    expect(() => parseNeural(withExtraOutput())).toThrow()
  })

  it('3클래스 파일의 마지막 층이 두 칸이면 거부한다', () => {
    expect(() => parseNeural(withExtraOutput(['a', 'b', 'c']))).toThrow()
  })
})
