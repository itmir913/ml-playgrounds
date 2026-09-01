/**
 * 학습 → `.mlpx` 저장 → 다시 열기 → **예측 화면의 경로로 다시 예측.**
 *
 * **다른 왕복 테스트들과 다른 것을 본다.** `format.spec.ts`는 픽스처 문서가 그대로
 * 돌아오는지 보고, `models.spec.ts`는 모델 객체가 같은 예측을 내는지 본다. 여기서 보는
 * 것은 **그 둘 사이에 있는 전부**다 — 학습이 만든 전처리기가 zip을 왕복하고, 예측 화면이
 * 그것을 파일에서 읽어 학생이 칸에 넣을 법한 **문자열**로 벡터를 다시 만든다.
 *
 * 그 경로가 조금이라도 어긋나면 **지표가 재현되지 않는다.** 그것이 이 파일의 판정
 * 기준이다 (CLAUDE.md §4의 "재실행 대조가 지표를 재현하는지").
 *
 * **왜 지표로 대조하나.** 예측 배열을 통째로 비교하는 것이 더 엄격해 보이지만, 학습
 * 시점의 예측 함수는 `runExperiment` 밖으로 나오지 않는다(나오게 만들면 이 테스트를 위해
 * 제품 코드의 모양이 바뀐다). 그리고 지표는 **그 예측에서 나온 값이 파일에 적힌 것**이라,
 * 한 행만 어긋나도 정확도가 움직인다. 상쇄로 가려지지 않게 소수점 없이 정확히 견준다.
 */

import { describe, expect, it } from 'vitest'

import { toCanonicalCsv } from '../src/data/serialize'
import { evaluate } from '../src/ml/metrics'
import { runExperiment as runExperimentRaw, type ExperimentInput } from '../src/ml/experiment'
import { inputVector, predictableModels, trainingRowsFor } from '../src/ml/predict'
import { interpreterFor, loadModel } from '../src/ml/models'
import { parsePreprocessor, targetValues, type Dataset } from '../src/ml/preprocess'
import { applyExperiment } from '../src/project/attach'
import { readProject, type ProjectFile } from '../src/project/format'
import { writeProjectBytes } from './fixtures/write'
import { readDataset } from '../src/project/dataset'
import {
  dataSnapshot,
  type Settings,
  type TabularSettings,
  type TaskType,
} from '../src/project/schema'
import { emptyProjectFile } from './fixtures/project'
import { irisDataset, IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN } from './fixtures/iris'

/**
 * 스냅샷은 **표에서는 설정에서 그대로 나온다** (open-decisions.md "이미지 학습은 표
 * 문제로 바꿔서 푼다"). 검사가 매번 손으로 적을 값이 아니라 여기서 한 번 채운다 —
 * 갈리는 것은 이미지뿐이고 그건 어댑터가 짓는다.
 */
function runExperiment(
  input: Omit<ExperimentInput, 'snapshot'>,
  options?: Parameters<typeof runExperimentRaw>[1],
): ReturnType<typeof runExperimentRaw> {
  return runExperimentRaw({ ...input, snapshot: dataSnapshot('tabular', input.settings) }, options)
}

/** 서버도 없고 무거운 엔진도 없다. **공식 배포(GitHub Pages)의 기본 상태다.** */
const OFFLINE = {
  limitsOff: false,
  serverStatus: 'unavailable' as const,
  rowCount: 30,
  dataType: 'tabular' as const,
}

/** 분류에 쓸 표와, 같은 표를 회귀로 쓸 때의 대상 열. */
const table = irisDataset()

function csvBytes(dataset: Dataset): Uint8Array {
  return toCanonicalCsv([[...dataset.columns], ...dataset.rows.map((row) => [...row])])
}

/**
 * **표의 설정은 `settings.data` 안이지만 여기서는 평평하게 받는다** (mlpx-spec.md §3).
 *
 * 검사가 실제로 넘기는 것은 아래에서 조립한 진짜 `Settings`다. 평평하게 받는 이유는
 * `Settings`가 looseObject라 **`Partial<Settings>`에 `features`를 얹어도 타입이 안
 * 울고 조용히 무시되기 때문이다** — 스키마를 가르던 날 실제로 그렇게 통과했다.
 * 여기서 갈라 넣으면 그 자리가 컴파일에 걸린다.
 */
type SettingsOverrides = Partial<Omit<Settings, 'data'>> & Partial<TabularSettings>

function splitOverrides(overrides: SettingsOverrides) {
  const { dataset, testDataset, predictDataset, features, target, preprocessing, ...common } =
    overrides
  const data = {
    ...(dataset === undefined ? {} : { dataset }),
    ...(testDataset === undefined ? {} : { testDataset }),
    ...(predictDataset === undefined ? {} : { predictDataset }),
    ...(features === undefined ? {} : { features }),
    ...('target' in overrides ? { target } : {}),
    ...(preprocessing === undefined ? {} : { preprocessing }),
  }
  return { data, common }
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

function settingsFor(overrides: SettingsOverrides = {}): Settings {
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [],
    hyperparameters: {},
    ...splitOverrides(overrides).common,
    data: { ...baseData, ...splitOverrides(overrides).data },
  }
}

/** 표를 담은 프로젝트 하나. 학습이 여기서 시작한다. */
function projectWith(dataset: Dataset, settings: Settings): ProjectFile {
  const base = emptyProjectFile()
  const bytes = csvBytes(dataset)
  return {
    document: {
      ...base.document,
      manifest: {
        ...base.document.manifest,
        taskType: settings.data.target ? 'classification' : undefined,
      },
      settings,
    },
    dataset: { bytes, hash: 'x'.repeat(64) },
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

/**
 * 학습하고 파일로 굽고 다시 연다. **여기까지가 학생이 하는 일이다.**
 */
async function trainAndReopen(
  dataset: Dataset,
  settings: Settings,
  taskType: TaskType,
): Promise<ProjectFile> {
  const result = runExperiment(
    { dataset, testDataset: null, taskType, dataType: 'tabular', settings, context: OFFLINE },
    { now: () => '2026-08-06T00:00:00.000Z' },
  )

  const project = projectWith(dataset, settings)
  const applied = applyExperiment(
    {
      ...project,
      document: { ...project.document, manifest: { ...project.document.manifest, taskType } },
    },
    result,
    '2026-08-06T00:00:00.000Z',
  )

  const { bytes } = await writeProjectBytes(applied, '# 정리\n')
  return (await readProject(bytes)).project
}

/**
 * 다시 연 파일로 예측 화면이 하는 일을 그대로 한다.
 *
 * **학생이 칸에 넣을 법한 문자열에서 시작한다** — 표의 셀을 그대로 넣는다. 학습 때 쓴
 * 행렬을 다시 쓰면 이 테스트가 볼 것이 없어진다.
 */
function reproduceMetrics(
  reopened: ProjectFile,
  /**
   * 행을 이만큼 밀어서 예측한다. **이 대조가 어긋남을 잡는지 확인할 때만 쓴다.**
   *
   * 0이 아니면 학생이 넣은 값과 정답이 한 줄씩 어긋난 상태이고, 그건 이 저장소가
   * 규정한 최악(조용히 틀린 결과)의 모양 그 자체다. 그때 지표가 그대로면 이 테스트가
   * 아무것도 안 보고 있다는 뜻이다.
   */
  shift = 0,
): {
  id: string
  algorithm: string
  stored: Record<string, number>
  again: Record<string, number>
}[] {
  const table = readDataset(reopened)
  if (!table) throw new Error('could not read the canonical table again')

  const found: ReturnType<typeof reproduceMetrics> = []

  for (const entry of predictableModels(reopened.document, true)) {
    expect(entry.reason, `${entry.run.id} came back unusable`).toBeUndefined()

    const { experiment, run } = entry
    const preprocessorBytes = reopened.models.get(experiment.preprocessor?.path ?? '')
    const modelBytes = reopened.models.get(run.model?.path ?? '')
    if (!preprocessorBytes || !modelBytes) throw new Error(`no entry for ${run.id}`)

    const preprocessor = parsePreprocessor(
      JSON.parse(new TextDecoder().decode(preprocessorBytes)) as unknown,
    )
    const interpreter = interpreterFor(run.model?.format ?? '')
    const context = interpreter?.needsTrainingRows
      ? { trainingRows: trainingRowsFor(experiment, preprocessor, table) }
      : {}

    const predict = loadModel(JSON.parse(new TextDecoder().decode(modelBytes)) as unknown, context)

    // **예측 화면의 경로다.** 표의 셀 -> 칸에 넣은 문자열 -> 특성 벡터.
    const rows = experiment.settings.testIndices.map((index) => {
      const from = (index + shift) % table.rows.length
      const values: Record<string, string> = {}
      table.columns.forEach((name, column) => {
        values[name] = table.rows[from]?.[column] ?? ''
      })
      return inputVector(experiment, preprocessor, values)
    })

    const truth = targetValues(
      table,
      experiment.settings.testIndices,
      dataSnapshot('tabular', experiment.settings).target ?? '',
    )
    const again = evaluate(experiment.settings.taskType, truth, predict(rows)).metrics

    found.push({ id: run.id, algorithm: run.algorithm, stored: run.metrics ?? {}, again })
  }

  return found
}

describe('학습한 파일을 다시 열어 예측한다', () => {
  it('분류 모델 다섯이 전부 지표를 재현한다', async () => {
    const settings = settingsFor({
      selectedAlgorithms: [
        { algorithm: 'decision_tree' },
        { algorithm: 'random_forest' },
        { algorithm: 'logistic_regression' },
        { algorithm: 'naive_bayes' },
        { algorithm: 'knn' },
        { algorithm: 'svm' },
      ],
    })

    const reopened = await trainAndReopen(table, settings, 'classification')
    const found = reproduceMetrics(reopened)

    // 모델 형식 다섯이 전부 여기 있다 - 나무·선형·나이브베이즈·참조형·SVM.
    expect(found.map((one) => one.algorithm)).toEqual([
      'decision_tree',
      'random_forest',
      'logistic_regression',
      'naive_bayes',
      'knn',
      'svm',
    ])

    for (const one of found) {
      // **소수점을 깎지 않고 견준다.** 한 행만 어긋나도 정확도가 움직이고,
      // 근사로 비교하면 그 한 행이 가려진다.
      expect(one.again, `metrics for ${one.algorithm} did not reproduce`).toEqual(one.stored)
    }
  })

  it('회귀도 재현한다 - 지표가 통째로 다른 집합이다', async () => {
    // 꽃잎 길이를 숫자로 맞힌다. 대상이 수치라 분류 모델은 여기 못 온다.
    const regression: Dataset = {
      columns: table.columns,
      rows: table.rows,
    }
    const settings = settingsFor({
      features: ['sepal_length', 'sepal_width', 'petal_width'],
      target: 'petal_length',
      // 층화는 값 종류를 세는 일이라 회귀에서는 성립하지 않는다. 조용히 꺼 주지 않으므로
      // (ml/split.ts) 여기서 꺼야 한다 - 그 규칙이 실제로 도는 것을 이 줄이 증언한다.
      split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
      selectedAlgorithms: [{ algorithm: 'linear_regression' }],
    })

    const reopened = await trainAndReopen(regression, settings, 'regression')
    const found = reproduceMetrics(reopened)

    expect(found).toHaveLength(1)
    expect(Object.keys(found[0]?.stored ?? {}).sort()).toEqual(['mae', 'r2', 'rmse'])
    expect(found[0]?.again).toEqual(found[0]?.stored)
  })

  it('전처리를 껐다 켜도 재현한다 - 좌표계가 바뀌는 자리다', async () => {
    for (const preprocessing of [
      { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
      { missing: 'median', scaling: 'minmax', categoricalEncoding: 'ordinal' },
      { missing: 'zero', scaling: 'robust', categoricalEncoding: 'onehot' },
    ] as const) {
      const settings = settingsFor({
        preprocessing,
        selectedAlgorithms: [{ algorithm: 'knn' }, { algorithm: 'logistic_regression' }],
      })
      const reopened = await trainAndReopen(table, settings, 'classification')

      // **바닥을 깐다.** 이 순회는 대조할 것이 하나도 없으면 0회 돌고 초록이다 -
      // 고른 알고리즘 둘이 그대로 돌아왔는지부터 본다.
      const found = reproduceMetrics(reopened)
      expect(found, `no model to compare under ${preprocessing.scaling}`).toHaveLength(2)

      for (const one of found) {
        expect(one.again, `${one.algorithm} diverged under ${preprocessing.scaling}`).toEqual(
          one.stored,
        )
      }
    }
  })

  // 여기 다섯은 전부 'holdout'이다. 'provided'(테스트 데이터가 파일로 옴)의 왕복 재현은
  // 아직 없다.
  //
  // **근거를 고쳐 적는다.** 오래도록 "format.ts가 아직 testDataset을 저장하지 않는다"고
  // 적혀 있었는데 **지금은 저장한다** - writeProject가 담고, readProject가 읽고,
  // hashableEntries가 무결성 대조에 넣고, projectFileWithTestDataset() 픽스처를
  // integrity.spec.ts가 쓴다 (R9 감사 B-2). 남은 것은 이 파일에 'provided' 왕복이
  // 없다는 사실 하나뿐이고, 틀린 조건("format.ts를 고치면 그때")이 붙어 있으면
  // 다음 사람이 안 오는 날을 기다린다.

  /**
   * **검사기 자체를 검사한다** (tests/ui-rules.spec.ts와 같은 이유다).
   *
   * 위의 대조들은 전부 "같다"를 확인한다. 그 대조가 아무것도 안 보고 있어도 초록색이
   * 되므로, **어긋났을 때 실제로 빨개지는지**를 여기서 못 박는다.
   */
  it('행이 밀리면 지표가 어긋난다 - 이 대조가 실제로 무언가를 본다', async () => {
    const settings = settingsFor({
      selectedAlgorithms: [{ algorithm: 'decision_tree' }, { algorithm: 'knn' }],
    })
    const reopened = await trainAndReopen(table, settings, 'classification')

    // **열 줄을 민다.** 픽스처가 품종마다 열 줄씩 붙어 있어서 한 줄만 밀면 대개 같은
    // 품종의 옆 줄로 가고, 그러면 답이 그대로라 어긋남이 안 보인다 (실제로 그랬다).
    // 열 줄이면 다음 품종으로 넘어간다 - 이 테스트가 무엇을 재는지 알고 미는 것이다.
    const shifted = reproduceMetrics(reopened, 10)
    expect(shifted.length).toBeGreaterThan(0)
    expect(shifted.every((one) => one.again['accuracy'] !== one.stored['accuracy'])).toBe(true)
  })

  it('데이터셋이 없으면 참조형만 꺼진다 - 나머지는 그대로 답한다', async () => {
    const settings = settingsFor({
      selectedAlgorithms: [{ algorithm: 'knn' }, { algorithm: 'decision_tree' }],
    })
    const reopened = await trainAndReopen(table, settings, 'classification')

    // 데이터가 없는 파일인 척한다. 학생이 남에게 받은 파일이 그럴 수 있다.
    const list = predictableModels(reopened.document, false)
    const byAlgorithm = new Map(list.map((entry) => [entry.run.algorithm, entry.reason]))

    expect(byAlgorithm.get('knn')).toBe('MODEL_NEEDS_DATASET')
    expect(byAlgorithm.get('decision_tree')).toBeUndefined()
  })
})
