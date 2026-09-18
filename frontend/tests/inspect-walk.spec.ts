// @vitest-environment jsdom
// 학습 경로가 워커 풀을 들여다보므로 DOM 전역이 필요하다 (`ml/worker/pool.ts`).
/**
 * **교사가 실제로 밟는 걸음** — `.mlpx` 바이트에서 판정까지 한 줄로.
 *
 * ```
 * readProject → readDataset → 조립(reproduceInputOf) → structuredClone
 *   → handleRequest({ type: 'train' }) → 메시지 → 견주기
 * ```
 *
 * **조각마다 초록인데 길이 끊길 수 있다** (R10에서 배운 것). 조립도, 기록된 분할도,
 * 워커 핸들러도 각자 검사가 있지만 **파일 데이터로 그 넷을 한 번에 지나는 검사**는
 * 여기 하나다.
 *
 * **요청을 손으로 짓지 않는다.** 진짜 조립 함수가 만든 것을 그대로 태운다 — 손으로
 * 지으면 조립이 틀려도 이 검사가 초록이고, 그건 이 저장소가 여러 번 밟은 자리다
 * (`reachability-through-real-entry`).
 *
 * **워커 경계를 진짜로 지난다.** `structuredClone`을 태우는 이유는 프로토타입이 벗겨지는
 * 것을 가짜 풀이 안 잡은 전례가 있어서다 — 검사는 초록인데 브라우저에서 죽었다.
 */

import { describe, expect, it } from 'vitest'

import { toCanonicalCsv } from '../src/data/serialize'
import { runExperiment as runExperimentRaw, type ExperimentInput } from '../src/ml/experiment'
import type { Dataset } from '../src/ml/preprocess'
import { reproduceExperiment, reproduceInputOf } from '../src/ml/reproduce'
import { handleRequest } from '../src/ml/worker/handler'
import type { WorkerMessage } from '../src/ml/worker/protocol'
import { applyExperiment } from '../src/project/attach'
import { readDataset } from '../src/project/dataset'
import { readProject, type ProjectFile } from '../src/project/format'
import { dataSnapshot, type Experiment, type Settings } from '../src/project/schema'
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

function settingsFor(method: 'holdout' | 'provided'): Settings {
  return {
    data: {
      dataset: {
        path: 'dataset/data.csv',
        originalFileName: 'iris.csv',
        hasHeader: true,
        encoding: 'utf-8',
      },
      ...(method === 'provided'
        ? {
            testDataset: {
              path: 'dataset/test.csv',
              originalFileName: 'iris_test.csv',
              hasHeader: true,
              encoding: 'utf-8',
            },
          }
        : {}),
      features: [...IRIS_FEATURE_COLUMNS],
      target: IRIS_TARGET_COLUMN,
      preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    },
    split: { method, testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'decision_tree' }, { algorithm: 'knn' }],
    hyperparameters: {},
  }
}

function csvBytes(dataset: Dataset): Uint8Array {
  return toCanonicalCsv([[...dataset.columns], ...dataset.rows.map((row) => [...row])])
}

/** 표 절반씩. `provided`는 시험 행이 **다른 표의 번호**라 그 갈래를 갈라 본다. */
function halves(): { train: Dataset; test: Dataset } {
  const half = Math.floor(table.rows.length / 2)
  return {
    train: { columns: table.columns, rows: table.rows.slice(0, half) },
    test: { columns: table.columns, rows: table.rows.slice(half) },
  }
}

/**
 * 학생이 학습하고 제출한 `.mlpx` 바이트. **여기까지가 학생이 하는 일이다.**
 */
async function submitted(method: 'holdout' | 'provided' = 'holdout'): Promise<Uint8Array> {
  const settings = settingsFor(method)
  const { train, test } = halves()
  const dataset = method === 'provided' ? train : table
  const testDataset = method === 'provided' ? test : null

  const result = await runExperimentRaw(
    {
      dataset,
      testDataset,
      taskType: 'classification',
      dataType: 'tabular',
      settings,
      context: OFFLINE,
      snapshot: dataSnapshot('tabular', settings),
    },
    { now: () => '2026-09-18T00:00:00.000Z' },
  )

  const base = emptyProjectFile()
  const project: ProjectFile = {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, taskType: 'classification' },
      settings,
    },
    dataset: { bytes: csvBytes(dataset), hash: 'x'.repeat(64) },
    ...(testDataset ? { testDataset: { bytes: csvBytes(testDataset), hash: 'y'.repeat(64) } } : {}),
  }

  const applied = applyExperiment(project, result, '2026-09-18T00:00:00.000Z')
  const { bytes } = await writeProjectBytes(applied, '# 정리\n')
  return bytes
}

/** 교사가 연 파일에서 대조에 필요한 재료를 꺼낸다. 점검 화면이 하는 일과 같다. */
async function opened(bytes: Uint8Array): Promise<{
  experiment: Experiment
  dataset: Dataset
  testDataset: Dataset | null
}> {
  const { project } = await readProject(bytes)
  const experiment = project.document.runs.experiments.at(-1)
  expect(experiment, 'the submitted file has an experiment').toBeDefined()
  const dataset = readDataset(project)
  expect(dataset, 'the submitted file has its dataset').not.toBeNull()
  return {
    experiment: experiment!,
    dataset: dataset!,
    testDataset: testDatasetOf(project),
  }
}

/** 테스트 정본. `provided`가 아니면 없다. */
function testDatasetOf(project: ProjectFile): Dataset | null {
  const bytes = project.testDataset?.bytes
  if (!bytes) return null
  const text = new TextDecoder().decode(bytes)
  const [header, ...rows] = text.replace(/^﻿/, '').trim().split(/\r?\n/)
  return {
    columns: (header ?? '').split(','),
    rows: rows.map((row) => row.split(',')),
  }
}

/** 워커가 받은 것을 그대로 처리하고 메시지를 돌려준다. **진짜 핸들러다.** */
async function throughWorker(input: ExperimentInput): Promise<Experiment | undefined> {
  // **경계를 진짜로 지난다.** 복제할 수 없는 것이 섞여 있으면 여기서 던진다.
  const request = structuredClone({ type: 'train', input } as const)
  let done: Experiment | undefined
  const seen: WorkerMessage[] = []
  await handleRequest(request as never, (message) => {
    seen.push(message)
    if (message.type === 'done') done = message.experiment
  })
  expect(
    seen.some((message) => message.type === 'failed'),
    'no failure message',
  ).toBe(false)
  return done
}

describe('파일에서 판정까지 한 줄로', () => {
  it('제출물을 열어 워커로 다시 돌리면 같은 숫자가 나온다', async () => {
    const { experiment, dataset, testDataset } = await opened(await submitted())

    const fresh = await throughWorker(reproduceInputOf({ experiment, dataset, testDataset }))

    expect(fresh?.runs).toHaveLength(experiment.runs.length)
    for (const [index, run] of experiment.runs.entries()) {
      // **지표가 같아야 한다.** 조립이 한 자리라도 틀리면 여기서 갈린다 — 손잡이를
      // 다른 데서 읽거나, 실행 방법을 요청한 것으로 쓰거나, 분할을 다시 계산하면.
      expect(fresh?.runs[index]?.metrics, run.algorithm).toEqual(run.metrics)
    }
  })

  it('기록된 분할이 그대로 실려 간다 - 다시 나누지 않는다', async () => {
    const { experiment, dataset, testDataset } = await opened(await submitted())

    const fresh = await throughWorker(reproduceInputOf({ experiment, dataset, testDataset }))

    expect(fresh?.settings.trainIndices).toEqual(experiment.settings.trainIndices)
    expect(fresh?.settings.testIndices).toEqual(experiment.settings.testIndices)
  })

  it('테스트 표가 따로 온 제출물도 같은 길을 지난다', async () => {
    // **`provided`는 시험 행이 다른 표의 번호다** (mlpx-spec.md §1.1) — 조립이 그 표를
    // 안 넘기면 훈련 표에서 그 번호를 잘라 **조용히 딴 행으로 채점한다.**
    const { experiment, dataset, testDataset } = await opened(await submitted('provided'))
    expect(testDataset, 'the provided split carries its test table').not.toBeNull()

    const fresh = await throughWorker(reproduceInputOf({ experiment, dataset, testDataset }))

    for (const [index, run] of experiment.runs.entries()) {
      expect(fresh?.runs[index]?.metrics, run.algorithm).toEqual(run.metrics)
    }
  })

  it('그 파일의 판정은 재현됨이다', async () => {
    const { experiment, dataset, testDataset } = await opened(await submitted())

    const found = await reproduceExperiment({ experiment, dataset, testDataset })

    expect(found).toHaveLength(experiment.runs.length)
    for (const one of found) expect(one.status, one.algorithm).toBe('REPRODUCED')
  })
})
