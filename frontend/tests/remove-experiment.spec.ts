/**
 * 실험 하나를 통째로 지우기 (open-decisions.md 66, `project/attach.ts`의 `removeExperiment`).
 *
 * **고아 모델은 지운 직후의 값에서 센다.** `writeProject`는 가리키는 기록이 없는 모델을 쓰면서
 * 떨구므로, 왕복만 보면 지우기가 남긴 고아가 가려진다.
 */

import { describe, expect, it } from 'vitest'

import { carriedFilter, defaultFilter, predictableModels } from '../src/ml/predict'
import { runExperiment } from '../src/ml/experiment'
import { applyExperiment, removeExperiment } from '../src/project/attach'
import { readDataset } from '../src/project/dataset'
import { readProject, type ProjectFile } from '../src/project/format'
import { dataSnapshot, FORMAT_VERSION } from '../src/project/schema'
import { withRandomState, withSelectedAlgorithms } from '../src/project/settings'
import { irisProject } from './fixtures/trained'
import { writeProjectBytes } from './fixtures/write'

const NOW = '2026-10-02T00:00:00Z'
const LATER = '2026-10-02T01:00:00Z'

/** 지금 설정으로 한 번 더 학습해 앉힌다. 학습 화면과 같이 지금까지의 기록을 넘긴다. */
async function train(project: ProjectFile): Promise<ProjectFile> {
  const dataset = readDataset(project)
  if (!dataset) throw new Error('fixture has no dataset')
  const { settings } = project.document
  const result = await runExperiment(
    {
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
    },
    { history: project.document.runs, now: () => NOW },
  )
  return applyExperiment(project, result, NOW)
}

function reseeded(project: ProjectFile, seed: number): ProjectFile {
  return { ...project, document: withRandomState(project.document, seed, NOW) }
}

function withAlgorithms(project: ProjectFile, algorithms: readonly string[]): ProjectFile {
  const document = withSelectedAlgorithms(
    project.document,
    algorithms.map((algorithm) => ({ algorithm, runtime: 'mljs' })),
    NOW,
  )
  return { ...project, document }
}

/** 실험 셋 — 둘째는 씨앗을, 셋째는 씨앗을 되돌리고 알고리즘을 바꿨다. */
async function threeExperiments(): Promise<ProjectFile> {
  let project = await train(await irisProject(['decision_tree']))
  const seed = project.document.settings.split.randomState
  project = await train(reseeded(project, seed + 1))
  project = await train(withAlgorithms(reseeded(project, seed), ['decision_tree', 'knn']))
  return project
}

/** 기록이 가리키는 모델 경로 전부. */
function referenced(project: ProjectFile): Set<string> {
  const paths = new Set<string>()
  for (const experiment of project.document.runs.experiments) {
    if (experiment.preprocessor) paths.add(experiment.preprocessor.path)
    for (const run of experiment.runs) if (run.model) paths.add(run.model.path)
  }
  return paths
}

/** 기록이 가리키지 않는 모델 파일 (고아). */
function orphans(project: ProjectFile): string[] {
  const live = referenced(project)
  return [...project.models.keys()].filter((path) => !live.has(path))
}

function ids(project: ProjectFile): string[] {
  return project.document.runs.experiments.map((experiment) => experiment.id)
}

describe('실험 지우기', () => {
  it('세 실험의 처음·가운데·끝을 지우면 그 실험만 빠지고 고아 모델이 0개다', async () => {
    const project = await threeExperiments()
    const all = ids(project)
    expect(all).toHaveLength(3)
    expect(orphans(project)).toEqual([])

    for (const id of all) {
      const removed = project.document.runs.experiments.find((one) => one.id === id)
      if (!removed) throw new Error('missing experiment')
      const next = removeExperiment(project, id, LATER)

      expect(ids(next)).toEqual(all.filter((one) => one !== id))
      expect(orphans(next)).toEqual([])
      // 지운 실험의 전처리기·모델은 빠지고, 남은 실험의 것은 그대로 있다.
      const gone = [removed.preprocessor?.path, ...removed.runs.map((run) => run.model?.path)]
      for (const path of gone) if (path) expect(next.models.has(path)).toBe(false)
      for (const path of referenced(next))
        expect(next.models.get(path)).toBe(project.models.get(path))
      expect(next.document.manifest.updatedAt).toBe(LATER)
    }
  })

  it('모르는 id면 받은 값을 그대로 돌려준다', async () => {
    const project = await threeExperiments()
    expect(removeExperiment(project, 'experiment-99', LATER)).toBe(project)
  })

  it('첫 실험을 지우면 새 첫 실험의 changed가 빠진다', async () => {
    const project = await threeExperiments()
    const [first, second] = ids(project)
    expect(project.document.runs.experiments[1]?.changed).toBeDefined()

    const next = removeExperiment(project, first ?? '', LATER)
    const head = next.document.runs.experiments[0]
    expect(head?.id).toBe(second)
    expect(head && 'changed' in head).toBe(false)
  })

  it('가운데를 지우면 뒤 실험의 changed를 새 직전에 대해 다시 잰다', async () => {
    const project = await threeExperiments()
    const [, middle] = ids(project)
    // 셋째는 둘째에 견줘 씨앗과 알고리즘이 바뀌었다.
    expect(project.document.runs.experiments[2]?.changed).toEqual([
      'algorithms',
      'split.randomState',
    ])

    const next = removeExperiment(project, middle ?? '', LATER)
    // 첫째에 견주면 씨앗은 같고 알고리즘만 바뀌었다.
    expect(next.document.runs.experiments[1]?.changed).toEqual(['algorithms'])
  })

  it('마지막을 지우면 남은 실험의 changed는 그대로다', async () => {
    const project = await threeExperiments()
    const [, , last] = ids(project)
    const next = removeExperiment(project, last ?? '', LATER)
    expect(next.document.runs.experiments).toEqual(project.document.runs.experiments.slice(0, 2))
  })

  it('지우고 쓴 파일을 다시 열면 무결성이 통과하고 포맷 버전은 그대로다', async () => {
    const project = await threeExperiments()
    const [, middle] = ids(project)
    const next = removeExperiment(project, middle ?? '', LATER)

    const { bytes } = await writeProjectBytes(next, '')
    const { project: reopened, integrity } = await readProject(bytes)

    expect(integrity.status).toBe('UNCHANGED')
    expect(reopened.document.manifest.formatVersion).toBe(FORMAT_VERSION)
    expect(ids(reopened)).toEqual(ids(next))
    expect(orphans(reopened)).toEqual([])
    expect([...reopened.models.keys()].sort()).toEqual([...next.models.keys()].sort())
  })

  it('마지막 번호가 다시 쓰여도 옛 모델과 옛 필터 상태를 물려받지 않는다', async () => {
    const project = await threeExperiments()
    const [, , last] = ids(project)
    const removed = project.document.runs.experiments[2]
    const oldModels = new Map(
      (removed?.runs ?? []).flatMap((run) =>
        run.model ? [[run.model.path, project.models.get(run.model.path)] as const] : [],
      ),
    )

    const trimmed = removeExperiment(project, last ?? '', LATER)
    const retrained = await train(trimmed)
    const reused = retrained.document.runs.experiments[2]

    // 번호는 "있는 가장 큰 번호 + 1"이라 지운 번호가 다시 온다 (결정 66의 넷).
    expect(reused?.id).toBe(last)
    expect(orphans(retrained)).toEqual([])
    // 같은 경로라도 바이트는 새로 학습한 것이다 — 옛 것이 섞이지 않는다.
    for (const run of reused?.runs ?? []) {
      const path = run.model?.path
      if (!path) continue
      const before = oldModels.get(path)
      if (before) expect(retrained.models.get(path)).not.toBe(before)
    }

    // 예측 필터는 그 화면의 상태라 다시 뜨면 처음부터 세운다(`seen`이 없다) — 다시 쓰인 번호도 켜진다.
    const models = predictableModels(retrained.document, true)
    const fresh = carriedFilter(defaultFilter(models), null, models)
    expect(fresh.experimentIds.has(last ?? '')).toBe(true)
  })
})
