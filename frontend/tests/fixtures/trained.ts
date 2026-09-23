/**
 * **실제로 학습한 붓꽃 프로젝트** (2026-09-23, R38 C-5 · C-6).
 *
 * 예측 판을 띄우는 스펙들은 `projectFile()`의 **가짜 모델**(`{"tree":[]}`)과 전처리기 없는
 * 실험을 썼다. 그래서 판이 쓸 수 있는 모델이 **하나도 없었고**, 답을 내는 루프·예측기를
 * 적재하는 본체·내려받기가 **어느 스펙에서도 한 번도 안 돌았다** — R38이 센 무실행 줄의
 * 뿌리가 그것이었다.
 *
 * 여기서는 **학생이 만드는 경로 그대로** 세운다 — 붓꽃 30행을 CSV 바이트로 만들어
 * `openTable` → `importTable` → `applyDataset`으로 붙이고, 타깃·특성을 설정 문으로 고르고,
 * `runExperiment` → `applyExperiment`로 진짜 전처리기와 모델을 담는다. 매번 새로 만든다 —
 * 공유 참조를 주면 한 스펙이 바꾼 것이 다음 스펙에 샌다(「픽스처는 매번 새 복사본을 준다」).
 */

import { importTable, openTable } from '../../src/data/table'
import { runExperiment } from '../../src/ml/experiment'
import { applyExperiment } from '../../src/project/attach'
import { applyDataset, readDataset } from '../../src/project/dataset'
import type { ProjectFile } from '../../src/project/format'
import { dataSnapshot } from '../../src/project/schema'
import {
  withFeatures,
  withSelectedAlgorithms,
  withTarget,
  withTaskType,
} from '../../src/project/settings'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './iris'
import { projectFile } from './project'

const NOW = '2026-09-23T00:00:00Z'

function irisCsv(): Uint8Array {
  const { columns, rows } = irisDataset()
  const lines = [columns.join(','), ...rows.map((row) => row.join(','))]
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

/** 붓꽃 30행을 붙이고 타깃·특성까지 고른 프로젝트. **아직 학습 전이다.** */
export async function irisProject(algorithms: readonly string[]): Promise<ProjectFile> {
  const imported = importTable(await openTable(irisCsv(), 'iris.csv'))
  const { project } = applyDataset(projectFile(), imported, {
    fileName: 'iris.csv',
    hasHeader: true,
    now: NOW,
  })
  let document = withTaskType(project.document, 'classification', [], NOW)
  document = withTarget(document, IRIS_TARGET_COLUMN, NOW)
  document = withFeatures(document, [...IRIS_FEATURE_COLUMNS], NOW)
  document = withSelectedAlgorithms(
    document,
    algorithms.map((algorithm) => ({ algorithm, runtime: 'mljs' })),
    NOW,
  )
  return { ...project, document }
}

/** 붓꽃 프로젝트를 고른 알고리즘으로 **실제로 학습시켜** 돌려준다. */
export async function trainedIrisProject(
  algorithms: readonly string[] = ['decision_tree'],
): Promise<ProjectFile> {
  const project = await irisProject(algorithms)
  const dataset = readDataset(project)
  if (!dataset) throw new Error('fixture has no dataset')
  const { settings } = project.document

  const result = await runExperiment({
    dataset,
    testDataset: null,
    taskType: 'classification',
    dataType: 'tabular',
    settings,
    context: {
      serverStatus: 'unavailable',
      limitsOff: false,
      rowCount: dataset.rows.length,
      dataType: 'tabular',
    },
    snapshot: dataSnapshot('tabular', settings),
  })
  return applyExperiment(project, result, NOW)
}
