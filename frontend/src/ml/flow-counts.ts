/**
 * 프로젝트 흐름도가 **열 때 구하는 수** — 막대의 길이와 칩의 글자가 이것으로 선다
 * (`architecture.md` §8.22, `open-decisions.md` 120).
 *
 * **모델(`ml/flow.ts`)과 갈라 둔 이유.** 모델은 첫 화면에 실려 가볍게 서야 하고, 수를 구하려면 계획 코드
 * (`ml/plan.ts`)가 필요하다. 그래서 이 모듈은 **그림이 보일 때 지연해서
 * 싣는다** — 흐름도 창과 대시보드 카드가 `import()`로 부른다.
 *
 * **계획을 새로 세우지 않는다.** 표는 화면들이 나눠 쓰는 계획 캐시(`tabularPlanOf`)를 읽는다 — 학습 뒤에도
 * 같은 수의 출처가 둘이 되지 않고, 이미 선 계획이면 `planRun`이 다시 안 돈다. 이미지는 계획 없이 센다
 * (사진 수에서 `ml/split.ts`와 `ml/sample.ts`의 규칙으로).
 *
 * **칸마다 비어 있을 수 있다.** 행 수는 계획이 섰을 때만 채우고, 계획이 `pending`·`error`이면 `null`로 둔다 —
 * 숫자를 지어내지 않는다. 전처리 모양과 특성 수는 계획이 서지 않아도 구할 수 있는 만큼 채운다.
 *
 * **점검은 `flowCountsLite`를 부른다.** 계획·전처리기를 거치지 않고(`tests/flow-counts.spec.ts`가 점검에서
 * `holdsTabularPlan()`이 거짓으로 남는 것을 문다), 행 수 없이 파일 전체의 열 종류로만 구한다.
 */

import { MIN_CLASSIFICATION_CATEGORIES, MIN_SPLIT_ROWS } from '@/limits'
import { summarizeColumns, type ColumnSummary } from '@/data/columns'
import { splitTestFromFile, type FlowPrep } from '@/ml/flow'
import type { FlowBarValues } from '@/ml/flow-layout'
import { tabularPlanOf, plannedColumnsOf } from '@/ml/plan-cache'
import { fitsAnyBasis, type Dataset } from '@/ml/preprocess'
import { columnPlan, splitsData } from '@/ml/selection'
import { testCountFor } from '@/ml/split'
import { readDataset, readTestDataset } from '@/project/dataset'
import { IMAGE_UNLABELED, type ProjectFile } from '@/project/format'
import { labeledCategoryCount, readImages } from '@/project/images'
import { tabularDataOf, type DataType } from '@/project/schema'

/** 별도 테스트 파일의 수. `usable`은 계획이 서야 안다. */
export interface FlowTestFileCounts {
  readonly total: number
  readonly usable: number | null
}

export interface FlowCounts {
  /** 올린 전체의 행(표)이나 사진(이미지) 수. 데이터가 있으면 늘 있다. */
  readonly total: number | null
  /** 학습에 들 수 있는 행. 표는 타깃이 비었거나 전처리가 버리는 행이 빠진다. 사진은 분류에서 범주가 있는 것이다. */
  readonly usable: number | null
  /** 표본으로 추출된 행. 표본 수를 안 켰으면 `usable`과 같다. */
  readonly sampled: number | null
  readonly train: number | null
  /** 테스트 데이터의 수. 별도 테스트 파일이면 그 파일에서 학습에 드는 수이고, 군집화는 0이다. */
  readonly test: number | null
  /** 전체에서 사용할 수 없어 제외된 몫. 표는 사용할 수 없는 행, 사진은 범주가 없는 사진(분류만)이다. */
  readonly unusable: number | null
  /** 사용할 수 있지만 표본에서 제외된 몫. */
  readonly notDrawn: number | null
  /** 학습에 들어가는 특성 수. 사진은 특성이 없어 `null`이다. */
  readonly featureCount: number | null
  /** 전처리 자리의 모양. 표는 계획과 무관하게 정해지고, 이미지는 늘 백본이다. */
  readonly prep: FlowPrep
  /** 별도 테스트 데이터면 그 파일의 수. 아니면 `null`. */
  readonly testFile: FlowTestFileCounts | null
}

// ---------------------------------------------------------------------------------- 표

/** 계획이 서지 않아 모르는 행 수. */
const NO_ROWS = {
  usable: null,
  sampled: null,
  train: null,
  test: null,
  unusable: null,
  notDrawn: null,
} as const

/**
 * 열 종류와 설정에서 특성 수와 전처리 모양을 낸다. **둘 다 계획이 서지 않아도 구할 수 있다** — 특성 수는
 * `columnPlan`이 세는 학습에 들어가는 수이고(전처리·학습 화면과 같은 함수), 전처리 모양은 그 특성들의 종류로
 * `fitsAnyBasis`가 정한다.
 */
function tabularShape(
  file: ProjectFile,
  dataset: Dataset,
  columns: readonly ColumnSummary[],
): { featureCount: number; prep: FlowPrep } | null {
  const data = tabularDataOf(file.document)
  if (data === null) return null
  const plan = columnPlan({
    columns,
    rowCount: dataset.rows.length,
    taskType: file.document.manifest.taskType,
    target: data.target,
    features: data.features,
    preprocessing: data.preprocessing,
  })
  // 학습에 드는 특성만 넘긴다(`fitsAnyBasis`의 머리말) — `usableFeatures`와 같은 판정이다. 값이 전부 빈 열처럼
  // 학습이 빼는 열이 남아 있으면 구할 값이 없는데도 기준 화살표가 선다.
  const features = plan.columns
    .filter(
      (column) =>
        column.role === 'feature' &&
        column.featureIssue === undefined &&
        column.featureNote === undefined,
    )
    .map((column) => ({ name: column.summary.name, kind: column.summary.kind }))
  return {
    featureCount: plan.usableFeatures,
    prep: fitsAnyBasis(data.preprocessing, features) ? 'preprocess' : 'preprocessOff',
  }
}

function testFileOf(file: ProjectFile, usable: number | null): FlowTestFileCounts | null {
  const test = readTestDataset(file)
  return test === null ? null : { total: test.rows.length, usable }
}

function tabularCounts(file: ProjectFile): FlowCounts | null {
  const dataset = readDataset(file)
  if (dataset === null) return null
  const plan = tabularPlanOf(file)
  // 열 종류는 계획이 본 것이다 — 전처리 판·학습 화면과 같은 덮기다(`plannedColumnsOf`).
  const shape = tabularShape(file, dataset, plannedColumnsOf(file))
  const common = {
    total: dataset.rows.length,
    featureCount: shape?.featureCount ?? null,
    prep: shape?.prep ?? 'unknown',
  } as const
  if (plan === null || !plan.ok) {
    return { ...common, ...NO_ROWS, testFile: testFileOf(file, null) }
  }
  const usable = plan.usable.length
  return {
    ...common,
    usable,
    sampled: plan.sampled.length,
    train: plan.split.trainIndices.length,
    test: plan.split.testIndices.length,
    unusable: plan.totalRows - usable,
    notDrawn: usable - plan.sampled.length,
    testFile: plan.testFromProvided ? testFileOf(file, plan.split.testIndices.length) : null,
  }
}

/** 점검용. 계획·전처리기를 거치지 않고 파일 전체의 열 종류로 센다. 행 수는 비어 있다. */
function tabularLite(file: ProjectFile): FlowCounts | null {
  const dataset = readDataset(file)
  if (dataset === null) return null
  const shape = tabularShape(file, dataset, summarizeColumns(dataset))
  return {
    total: dataset.rows.length,
    ...NO_ROWS,
    featureCount: shape?.featureCount ?? null,
    prep: shape?.prep ?? 'unknown',
    testFile: testFileOf(file, null),
  }
}

// ---------------------------------------------------------------------------------- 이미지

/**
 * 사진의 수. **계획 없이 센다** — 사진은 임베딩을 열이 있는 표로 바꿔 학습하는데, 그 표를 지으려면 백본이
 * 돌아야 해서 그림을 위해 부를 수 없다. 대신 같은 규칙을 사진 수에 적용한다: 분류는 범주가 있는 사진만 쓰고
 * (`ml/images.ts`), 표본 수가 남는 수보다 적을 때만 추출하고(`ml/sample.ts`), 테스트 몫은 `testCountFor`다.
 * 학습이 거절하는 모양이면(범주 하나, 사진 한 장) 계획이 안 선 것과 같아 행 수는 비어 있다.
 * `tests/flow-counts.spec.ts`가 학습이 낸 인덱스의 길이와 대조한다.
 */
function imageRows(
  file: ProjectFile,
): Pick<FlowCounts, keyof typeof NO_ROWS | 'total' | 'testFile'> {
  const total = readImages(file).length
  const { manifest, settings } = file.document
  const taskType = manifest.taskType
  const testPhotos = readImages(file, 'test').length
  // 유형을 모르면 어느 사진이 쓰이는지도 모른다 — 표의 `pending`과 같다.
  if (taskType === undefined) return { total, ...NO_ROWS, testFile: null }

  // 나누지 않는 유형(군집화)은 범주를 안 쓰고 테스트 몫이 없다.
  const clustering = !splitsData(taskType)
  const usable = clustering
    ? total
    : readImages(file).filter((entry) => entry.category !== IMAGE_UNLABELED).length
  const refused = clustering
    ? usable < 1
    : labeledCategoryCount(file) < MIN_CLASSIFICATION_CATEGORIES || usable < MIN_SPLIT_ROWS
  const provided = !clustering && splitTestFromFile(settings.split.method)
  const testFile = provided ? { total: testPhotos, usable: testPhotos } : null
  if (refused) return { total, ...NO_ROWS, testFile }

  const sampled =
    settings.nSamples === undefined || settings.nSamples >= usable ? usable : settings.nSamples
  // 나누는 방법: 군집화는 나누지 않고, 별도 테스트는 추출한 사진이 전부 훈련이며, 그 밖에는 holdout이다.
  const test = clustering
    ? 0
    : provided
      ? testPhotos
      : testCountFor(sampled, settings.split.testSize)
  return {
    total,
    usable,
    sampled,
    train: provided || clustering ? sampled : sampled - test,
    test,
    unusable: total - usable,
    notDrawn: usable - sampled,
    testFile,
  }
}

function imageCounts(file: ProjectFile): FlowCounts | null {
  if (readImages(file).length === 0) return null
  return {
    ...imageRows(file),
    featureCount: null,
    prep: 'backbone',
  }
}

/** 점검용. 사진도 계획을 세우지 않고 행 수 없이 윤곽으로 둔다 — 사진 수와 별도 테스트 사진 수만 안다. */
function imageLite(file: ProjectFile): FlowCounts | null {
  const total = readImages(file).length
  if (total === 0) return null
  const { manifest, settings } = file.document
  const provided = splitsData(manifest.taskType) && splitTestFromFile(settings.split.method)
  return {
    ...NO_ROWS,
    total,
    featureCount: null,
    prep: 'backbone',
    testFile: provided ? { total: readImages(file, 'test').length, usable: null } : null,
  }
}

// ---------------------------------------------------------------------------------- 입구

/** 종류마다의 수. `Record<DataType, …>`이라 종류를 더하면 칸을 채워야 한다. */
const COUNTS: Readonly<Record<DataType, (file: ProjectFile) => FlowCounts | null>> = {
  tabular: tabularCounts,
  image: imageCounts,
}

const LITE_COUNTS: Readonly<Record<DataType, (file: ProjectFile) => FlowCounts | null>> = {
  tabular: tabularLite,
  image: imageLite,
}

/**
 * 열 때 구하는 수. **데이터가 없으면 `null`이다.** 계획 캐시를 읽으므로 이미 선 계획이면 계획 코드가 다시
 * 돌지 않는다.
 */
export async function flowCountsOf(file: ProjectFile | null): Promise<FlowCounts | null> {
  return file === null ? null : COUNTS[file.document.manifest.dataType](file)
}

/**
 * 점검용 가벼운 입구. **계획·전처리기를 거치지 않고** 행 수 없이 구한다 — 점검은 학생의 파일을 읽기만
 * 하고 계획 캐시를 채우지 않는다. 파일 전체의 열 종류로 특성 수와 전처리 모양을 낸다.
 */
export function flowCountsLite(file: ProjectFile | null): FlowCounts | null {
  return file === null ? null : LITE_COUNTS[file.document.manifest.dataType](file)
}

/**
 * 수를 막대가 받는 모양으로 옮긴다. 행 수를 모르면 `null`이라 막대는 설정 비율의 윤곽이다.
 * 회색 몫은 사용할 수 없는 몫과 추출하지 않은 몫을 합친 것이고 막대 위에서 한 조각이다.
 */
export function barValuesOf(counts: FlowCounts | null): FlowBarValues | null {
  if (counts === null || counts.train === null || counts.test === null) return null
  const testFile = counts.testFile
  return {
    train: counts.train,
    test: counts.test,
    gray: (counts.unusable ?? 0) + (counts.notDrawn ?? 0),
    testFile:
      testFile === null || testFile.usable === null
        ? null
        : { usable: testFile.usable, gray: testFile.total - testFile.usable },
  }
}
