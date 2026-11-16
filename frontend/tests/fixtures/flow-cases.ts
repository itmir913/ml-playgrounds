/**
 * 프로젝트 흐름도 검사들이 나눠 쓰는 **열여섯 경우** (`architecture.md` §8.22).
 *
 * 모델(`flow-model.spec.ts`)·강조(`flow-highlight.spec.ts`)·배치(`flow-layout.spec.ts`)·수
 * (`flow-counts.spec.ts`)가 **같은 프로젝트**를 지나야 한 경우가 두 검사에서 다른 모양이 되지 않는다.
 * 경우마다 `build()`가 **새 객체**를 준다 — 검사가 제자리에서 고쳐도 다음 검사가 오염되지 않는다
 * (`tests/fixtures.spec.ts`).
 */

import { imageEntryPath } from '../../src/data/image/canonical'
import { PREFERRED_CANONICAL_FORMAT } from '../../src/data/image/formats'
import { factsOf } from '../../src/project/facts'
import type { ProjectFile } from '../../src/project/format'
import { imageInitialSettings, type TaskType } from '../../src/project/schema'
import { flowModelOf, type FlowModel, type FlowPrep } from '../../src/ml/flow'
import {
  emptyProjectFile,
  experiment,
  projectFile,
  projectFileWithPredictDataset,
  projectFileWithTestDataset,
  run,
} from './project'

/** 모델을 짓는다. 사실은 진짜 `factsOf`가 낸다 — 사실을 손으로 지어내지 않는다. */
export function modelOf(file: ProjectFile | null, prep?: FlowPrep): FlowModel | null {
  return flowModelOf(file, factsOf(file), prep)
}

export function edit(base: ProjectFile, change: (file: ProjectFile) => void): ProjectFile {
  change(base)
  return base
}

/** 실험을 통째로 바꾼다. 안쪽 배열이 한 실험의 실행들이다. */
export function withRuns(base: ProjectFile, runs: ReturnType<typeof run>[][]): ProjectFile {
  return edit(base, (file) => {
    file.document.runs.experiments = runs.map((list, at) =>
      experiment(`experiment-${at + 1}`, list),
    )
  })
}

/** 모델 없이 끝난 실행. 예산에서 밀렸다. */
export const metricsOnly = (id: string) =>
  run(id, { model: undefined, modelOmitted: 'overBudget', status: 'done' })

export const failed = (id: string) =>
  run(id, {
    status: 'failed',
    metrics: undefined,
    model: undefined,
    failure: { code: 'TRAINING_FAILED' },
  })

/**
 * 그 유형으로 학습할 수 있는 모델 하나. **유형에 안 맞는 모델만 담겨 있으면 학습 상자는 윤곽이다**
 * (`factsOf`의 `algorithmsChosen`, open-decisions.md 55) — 유형을 바꾸는 쪽이 모델도 함께 맞춘다.
 */
const ALGORITHM_FOR: Record<TaskType, string> = {
  classification: 'decision_tree',
  regression: 'linear_regression',
  clustering: 'k_means',
}

export function withTask(file: ProjectFile, taskType: TaskType | undefined): ProjectFile {
  return edit(file, (target) => {
    target.document.manifest.taskType = taskType
    if (taskType !== undefined) {
      target.document.settings.selectedAlgorithms = [{ algorithm: ALGORITHM_FOR[taskType] }]
    }
  })
}

/** 사진 프로젝트. 범주 목록이 사진 한 장씩이다. 설정은 이미지 모양으로 바꿔 둔다. */
export function photos(
  categories: readonly (string | undefined)[],
  overrides: (file: ProjectFile) => void = () => {},
): ProjectFile {
  const file = emptyProjectFile()
  file.document.manifest.dataType = 'image'
  file.document.manifest.taskType = 'classification'
  file.document.settings.data = imageInitialSettings()
  file.document.settings.selectedAlgorithms = [{ algorithm: 'knn' }]
  categories.forEach((category, index) => {
    file.images.set(
      imageEntryPath('data', `hash${index}`, category, PREFERRED_CANONICAL_FORMAT),
      new Uint8Array([1, 2, 3]),
    )
  })
  overrides(file)
  return file
}

export const TWO_CATEGORIES = ['개', '고양이']

export interface FlowCase {
  readonly no: number
  readonly title: string
  /** 열 때마다 새로 짓는다. 데이터가 없는 경우(15)는 `emptyProjectFile()`이다. */
  readonly build: () => ProjectFile
}

/** 열여섯 경우. 번호가 계획의 경우 표와 같다. */
export const FLOW_CASES: readonly FlowCase[] = [
  { no: 1, title: '표 · 분류 · holdout · 학습 후', build: () => projectFile() },
  {
    no: 2,
    title: '표 · 회귀 · 학습 전',
    build: () => withRuns(withTask(projectFile(), 'regression'), []),
  },
  { no: 3, title: '표 · 분류 · provided', build: () => projectFileWithTestDataset() },
  { no: 4, title: '표 · 군집 · holdout', build: () => withTask(projectFile(), 'clustering') },
  {
    no: 5,
    title: '표 · 군집 · provided',
    build: () => withTask(projectFileWithTestDataset(), 'clustering'),
  },
  {
    no: 6,
    title: '표 · 유형 미정',
    build: () => withRuns(withTask(projectFile(), undefined), []),
  },
  {
    no: 7,
    title: '표 · 실행 전부 실패',
    build: () => withRuns(projectFile(), [[failed('r1')], [failed('r2')]]),
  },
  {
    no: 8,
    title: '표 · 모델 없이 지표만',
    build: () => withRuns(projectFile(), [[metricsOnly('r1')]]),
  },
  {
    no: 9,
    title: '표 · 타깃 미선택',
    build: () =>
      withRuns(
        edit(projectFile(), (file) => {
          Object.assign(file.document.settings.data, { target: undefined })
        }),
        [],
      ),
  },
  {
    no: 10,
    title: '표 · 특성 미선택',
    build: () =>
      withRuns(
        edit(projectFile(), (file) => {
          Object.assign(file.document.settings.data, { features: [] })
        }),
        [],
      ),
  },
  {
    no: 11,
    title: '이미지 · 분류 · holdout',
    build: () =>
      photos(TWO_CATEGORIES, (file) => {
        file.document.runs.experiments = [experiment('experiment-1', [run('r1')])]
      }),
  },
  {
    no: 12,
    title: '이미지 · provided',
    build: () =>
      photos(TWO_CATEGORIES, (file) => {
        file.document.settings.split.method = 'provided'
      }),
  },
  {
    no: 13,
    title: '이미지 · 군집',
    build: () =>
      photos(['개'], (file) => {
        file.document.manifest.taskType = 'clustering'
        file.document.settings.selectedAlgorithms = [{ algorithm: 'k_means' }]
      }),
  },
  {
    no: 14,
    title: '이미지 · 유형 미정',
    build: () =>
      photos(TWO_CATEGORIES, (file) => {
        file.document.manifest.taskType = undefined
      }),
  },
  { no: 15, title: '데이터 없음', build: () => emptyProjectFile() },
  { no: 16, title: '예측 파일이 있다', build: () => projectFileWithPredictDataset() },
]
