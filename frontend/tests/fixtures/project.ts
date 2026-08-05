/**
 * 테스트가 함께 쓰는 프로젝트 표본.
 *
 * 한글 컬럼명, BOM과 CRLF가 든 CSV처럼 **교실에서 실제로 들어오는 모양**을 담는다.
 * 깨끗한 표본만 쓰면 깨끗한 입력에서만 도는 코드가 나온다.
 */

import { hashBytes } from '../../src/hash'
import type { Dataset, ProjectFile } from '../../src/project/format'
import {
  FORMAT_VERSION,
  PROJECT_KIND_ML,
  type Batch,
  type Manifest,
  type Run,
} from '../../src/project/schema'

export const manifest: Manifest = {
  formatVersion: FORMAT_VERSION,
  appVersion: '0.1.0',
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  name: '붓꽃 품종 분류',
  createdAt: '2026-08-04T09:00:00Z',
  updatedAt: '2026-08-04T10:30:00Z',
  kind: PROJECT_KIND_ML,
  taskType: 'classification',
  dataType: 'tabular',
  locale: 'ko',
}

export const settings = {
  dataset: {
    path: 'dataset/data.csv',
    originalFileName: 'iris_data_final(1).csv',
    hasHeader: true,
    // 정본은 언제나 utf-8이고, 올라온 파일이 무엇이었는지는 따로 남는다.
    // 한국 윈도우 엑셀의 "CSV로 저장"이 정확히 이 조합이다.
    encoding: 'utf-8',
    sourceEncoding: 'cp949' as const,
  },
  features: ['꽃받침 길이', 'petal_length'],
  target: '품종',
  preprocessing: { missing: 'drop', scaling: 'standard', categoricalEncoding: 'onehot' } as const,
  split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 } as const,
  runtime: 'mljs',
  // SVM은 순수 JS 구현이 없어 학생이 개별로 서버를 골랐다. 묶음 안에 엔진이 섞이는
  // 정상적인 모양이다 - 같은 데이터·전처리·분할을 쓰므로 비교는 그대로 성립한다.
  selectedAlgorithms: [
    { algorithm: 'decision_tree' },
    { algorithm: 'svm', runtime: 'server-sklearn' },
  ],
  // 알고리즘 -> 실행 방법 -> 값. 같은 결정트리라도 어휘가 갈린다 (maxDepth / max_depth).
  hyperparameters: {
    decision_tree: { mljs: { maxDepth: 5 }, 'server-sklearn': { max_depth: null } },
    svm: { 'server-sklearn': { C: 1.0 } },
  },
}

export function run(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    algorithm: 'decision_tree',
    hyperparameters: { max_depth: null },
    computedBy: 'browser',
    trainedAt: '2026-08-04T10:30:04Z',
    status: 'done',
    metrics: { accuracy: 0.9333 },
    model: {
      format: 'mlpx-tree-v1',
      path: `model/${id}.json`,
      includesPreprocessing: false,
      sizeBytes: 1284,
    },
    ...overrides,
  }
}

export function batch(id: string, runs: Run[]): Batch {
  return {
    id,
    startedAt: '2026-08-04T10:30:00Z',
    settings: {
      // manifest에 있는 것을 다시 적는 것이 아니다 - 학생이 과제 유형을 바꾸면
      // manifest는 따라가고 옛 묶음은 안 따라간다.
      taskType: manifest.taskType,
      runtime: 'mljs',
      selectedAlgorithms: [
        { algorithm: 'decision_tree', runtime: 'mljs' },
        { algorithm: 'svm', runtime: 'server-sklearn' },
      ],
      features: settings.features,
      target: settings.target,
      preprocessing: settings.preprocessing,
      split: settings.split,
      trainIndices: [0, 2, 3],
      testIndices: [1],
    },
    preprocessor: { format: 'mlpx-preprocess-v1', path: `model/preprocessor-${id}.json` },
    runs,
  }
}

/** BOM과 CRLF, 한글이 든 CSV. 이 바이트가 그대로 돌아와야 한다. */
export const datasetBytes = new TextEncoder().encode('﻿꽃받침,품종\r\n5.1,setosa\r\n')

export const dataset: Dataset = { bytes: datasetBytes, hash: hashBytes(datasetBytes) }

/**
 * 아직 표를 올리지 않은 프로젝트. **정상 상태다**
 * (open-decisions.md "데이터 없는 프로젝트는 정상 상태다").
 *
 * settings에서 dataset을 빼고 본체도 뺀다. 둘은 함께 있고 함께 없다.
 */
export function emptyProjectFile(): ProjectFile {
  return {
    document: {
      manifest,
      // 전처리·분할·기본 실행 방법은 데이터가 없어도 고를 수 있는 값이라 남는다.
      // 열 이름을 아는 것들만 빈다 - 표를 봐야 정할 수 있기 때문이다.
      settings: {
        ...settings,
        dataset: undefined,
        features: [],
        target: undefined,
        selectedAlgorithms: [],
      },
      runs: { batches: [] },
      portfolio: { template: { id: 'default-v1' }, answers: {} },
    },
    models: new Map(),
  }
}

export function projectFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    document: {
      manifest,
      settings,
      runs: { batches: [batch('batch-1', [run('run-1')])] },
      portfolio: { template: { id: 'default-v1' }, answers: { motivation: '꽃이 좋아서' } },
    },
    dataset,
    models: new Map([
      ['model/run-1.json', new TextEncoder().encode('{"tree":[]}')],
      ['model/preprocessor-batch-1.json', new TextEncoder().encode('{"columns":[]}')],
    ]),
    ...overrides,
  }
}
