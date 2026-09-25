/**
 * **파일 전체의 열 종류와 실행이 보는 열 종류가 갈리는 입력.**
 *
 * 전처리 판(`tabular-prep-kind.spec.ts`)과 학습 화면(`train-prep-kind.spec.ts`)이 **같은
 * 입력**을 태워야 두 화면이 같은 말을 하는지 견줄 수 있다. 그래서 여기 한 벌만 둔다.
 *
 * **진짜 입구로 짓는다** — CSV 바이트 → `openTable` → `importTable` → `applyDataset` → 설정 문.
 */

import { importTable, openTable } from '../../src/data/table'
import { applyDataset } from '../../src/project/dataset'
import type { ProjectFile } from '../../src/project/format'
import type { Preprocessing, TaskType } from '../../src/project/schema'
import {
  withFeatures,
  withPreprocessing,
  withTarget,
  withTaskType,
} from '../../src/project/settings'
import { projectFile } from './project'

const NOW = '2026-09-23T00:00:00Z'

/**
 * 40행 설문. `키`는 수치인데 **한 칸만** `모름`이다. `blankTarget`이면 그 행의 타깃(`성별`)이
 * 빈 칸이라 **그 행은 실행에서 빠진다** — 파일 전체로는 `키`가 범주, 실행으로는 수치다.
 */
export function surveyCsv(blankTarget: boolean): Uint8Array {
  const lines = ['키,몸무게,성별']
  for (let i = 0; i < 40; i += 1) {
    const height = i === 7 ? '모름' : String(150 + i)
    const sex = i === 7 && blankTarget ? '' : i % 2 === 0 ? '남' : '여'
    lines.push(`${height},${45 + i},${sex}`)
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

/** 40행 회귀. `점수`는 수치인데 **다섯 행만** `모름`이다. `heightBlank`면 그 행의 `키`가 빈다. */
export function scoreCsv(heightBlank: boolean): Uint8Array {
  const lines = ['키,몸무게,점수']
  for (let i = 0; i < 40; i += 1) {
    const unknown = i % 8 === 3
    const height = unknown && heightBlank ? '' : String(150 + i)
    const score = unknown ? '모름' : String(60 + ((i * 7) % 40))
    lines.push(`${height},${45 + i},${score}`)
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

/** CSV 하나로 유형·타깃·특성·전처리를 고른 프로젝트를 짓는다. */
export async function tabularProjectFrom(
  csv: Uint8Array,
  fileName: string,
  choice: {
    taskType: TaskType
    target: string
    features: readonly string[]
    preprocessing: Partial<Preprocessing>
  },
): Promise<ProjectFile> {
  const imported = importTable(await openTable(csv, fileName))
  const { project } = applyDataset(projectFile(), imported, { fileName, hasHeader: true, now: NOW })
  let document = withTaskType(project.document, choice.taskType, NOW)
  document = withTarget(document, choice.target, NOW)
  document = withFeatures(document, [...choice.features], NOW)
  document = withPreprocessing(document, choice.preprocessing, NOW)
  return { ...project, document }
}

/** `surveyCsv` 분류 — **인코딩을 끈다.** 그래야 범주로 읽힌 열이 학습에서 "빠진다". */
export function surveyProject(blankTarget: boolean): Promise<ProjectFile> {
  return tabularProjectFrom(surveyCsv(blankTarget), '설문.csv', {
    taskType: 'classification',
    target: '성별',
    features: ['키', '몸무게'],
    preprocessing: { categoricalEncoding: 'none' },
  })
}

/** `scoreCsv` 회귀. */
export function scoreProject(
  heightBlank: boolean,
  missing: 'drop' | 'mean',
  csv: Uint8Array = scoreCsv(heightBlank),
): Promise<ProjectFile> {
  return tabularProjectFrom(csv, '점수.csv', {
    taskType: 'regression',
    target: '점수',
    features: ['키', '몸무게'],
    preprocessing: { missing },
  })
}
