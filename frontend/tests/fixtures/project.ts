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
  type Experiment,
  type Manifest,
  type Run,
} from '../../src/project/schema'

/**
 * 공유 상수를 **팩토리 밖으로 내보낼 때마다** 통과시킨다.
 *
 * 아래 `manifest`·`settings`·`dataset` 같은 것들은 검사가 기대값으로도 쓰기 때문에
 * `export const`로 남는다. 그런데 그것을 팩토리가 그대로 넣어 주면 **모든 프로젝트가
 * 같은 객체를 공유하게 되고**, 어느 검사가 `project.document.settings.<키> = 값`처럼
 * 제자리에서 고치는 순간 같은 파일의 뒤따르는 검사가 전부 그 값을 물려받는다.
 *
 * **그 오염은 격리 실행에서 안 보인다.** `vitest -t`로 하나만 돌리면 통과하고 전체를
 * 돌릴 때만 빨개져서, 원인이 자기 검사 안에 없다 (2026-08-12에 실제로 밟았다 —
 * `format.spec.ts`의 `nSamples` 왕복 검사).
 *
 * 얕은 복사로는 부족하다. `settings.split`·`settings.preprocessing`처럼 한 겹 아래가
 * 여전히 같은 객체다.
 */
const fresh = <T>(value: T): T => structuredClone(value)

export const manifest: Manifest = {
  formatVersion: FORMAT_VERSION,
  appVersion: '0.0.0',
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  name: '붓꽃 품종 분류',
  createdAt: '2026-08-04T09:00:00Z',
  updatedAt: '2026-08-04T10:30:00Z',
  kind: PROJECT_KIND_ML,
  // 학생이 학습 화면에서 골랐다. **새 프로젝트에는 이 필드가 아예 없다** -
  // emptyProjectFile이 그 상태다 (open-decisions.md "기계학습 유형은 모델을 고르는
  // 자리에서 고른다").
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
  // SVM은 순수 JS 구현이 없어 학생이 개별로 서버를 골랐다. 실험 안에 엔진이 섞이는
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

export function experiment(id: string, runs: Run[]): Experiment {
  return {
    id,
    startedAt: '2026-08-04T10:30:00Z',
    settings: {
      // manifest에 있는 것을 다시 적는 것이 아니다 - 학생이 과제 유형을 바꾸면
      // manifest는 따라가고 옛 실험은 안 따라간다. **여기서는 필수다** - 학습이 돈
      // 이상 유형은 반드시 정해져 있었다 (manifest 쪽은 선택 항목이다).
      taskType: manifest.taskType ?? 'classification',
      runtime: 'mljs',
      selectedAlgorithms: [
        { algorithm: 'decision_tree', runtime: 'mljs' },
        { algorithm: 'svm', runtime: 'server-sklearn' },
      ],
      // **여기도 복사한다.** 실험 스냅샷이 settings의 중첩 객체를 그대로 물면
      // `experiment.settings.split.testSize = …` 하나로 위 상수까지 오염된다.
      features: fresh(settings.features),
      target: settings.target,
      preprocessing: fresh(settings.preprocessing),
      split: fresh(settings.split),
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

/** 평가 데이터(test.csv). data.csv와 같은 열이다 - 정본 열 전체와 대조해 받은 뒤다. */
export const testDatasetBytes = new TextEncoder().encode('﻿꽃받침,품종\r\n6.0,virginica\r\n')

export const testDataset: Dataset = { bytes: testDatasetBytes, hash: hashBytes(testDatasetBytes) }

/**
 * `projectFile()`에 평가 데이터를 붙인 것. `split.method`를 `provided`로 바꾸고
 * `settings.testDataset`과 zip 본체를 함께 채운다 - 한쪽만 있으면 우리 버그다.
 */
export function projectFileWithTestDataset(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const base = projectFile(overrides)
  return {
    ...base,
    document: {
      ...base.document,
      settings: {
        ...base.document.settings,
        split: { ...base.document.settings.split, method: 'provided' },
        testDataset: {
          path: 'dataset/test.csv',
          originalFileName: 'iris_test.csv',
          hasHeader: true,
          encoding: 'utf-8',
        },
      },
    },
    testDataset: fresh(testDataset),
  }
}

/** 예측 데이터(predict.csv). 타깃 열이 없다 - 답을 모르는 새 줄이라서다. */
export const predictDatasetBytes = new TextEncoder().encode('﻿꽃받침\r\n5.5\r\n')

export const predictDataset: Dataset = {
  bytes: predictDatasetBytes,
  hash: hashBytes(predictDatasetBytes),
}

/**
 * `projectFile()`에 예측 데이터를 붙인 것. `settings.predictDataset`과 zip 본체를
 * 함께 채운다 - 한쪽만 있으면 우리 버그다. **`applyTestDataset`과 달리 실험도
 * `split.method`도 건드리지 않는다** - 이 픽스처가 그 규칙을 그대로 반영한다.
 */
export function projectFileWithPredictDataset(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const base = projectFile(overrides)
  return {
    ...base,
    document: {
      ...base.document,
      settings: {
        ...base.document.settings,
        predictDataset: {
          path: 'dataset/predict.csv',
          originalFileName: 'iris_predict.csv',
          hasHeader: true,
          encoding: 'utf-8',
        },
      },
    },
    predictDataset: fresh(predictDataset),
  }
}

/**
 * 아직 표를 올리지 않은 프로젝트. **정상 상태다**
 * (open-decisions.md "데이터 없는 프로젝트는 정상 상태다").
 *
 * settings에서 dataset을 빼고 본체도 뺀다. 둘은 함께 있고 함께 없다.
 */
export function emptyProjectFile(): ProjectFile {
  return {
    document: {
      // **유형도 아직 없다.** 학습 화면에서 고르는 것이라 새 프로젝트에는 없는 것이
      // 맞다 (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
      manifest: { ...fresh(manifest), taskType: undefined },
      // 전처리·분할·기본 실행 방법은 데이터가 없어도 고를 수 있는 값이라 남는다.
      // 열 이름을 아는 것들만 빈다 - 표를 봐야 정할 수 있기 때문이다.
      settings: {
        ...fresh(settings),
        dataset: undefined,
        features: [],
        target: undefined,
        selectedAlgorithms: [],
      },
      runs: { experiments: [] },
      portfolio: { template: { id: 'default-v1' }, answers: {} },
    },
    models: new Map(),
  }
}

export function projectFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    document: {
      manifest: fresh(manifest),
      settings: fresh(settings),
      runs: { experiments: [experiment('experiment-1', [run('run-1')])] },
      portfolio: { template: { id: 'default-v1' }, answers: { motivation: '꽃이 좋아서' } },
    },
    dataset: fresh(dataset),
    models: new Map([
      ['model/run-1.json', new TextEncoder().encode('{"tree":[]}')],
      ['model/preprocessor-experiment-1.json', new TextEncoder().encode('{"columns":[]}')],
    ]),
    ...overrides,
  }
}
