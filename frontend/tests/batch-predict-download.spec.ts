// @vitest-environment jsdom
/**
 * **일괄 예측이 진짜 모델로 계산해 내려받는가** (2026-09-23, R38 C-5).
 *
 * 이 판의 **예측기 적재 본체와 내려받기 전부가 어느 스펙에서도 실행되지 않았다.** 판을
 * 띄우는 스펙들은 `predictPage`를 가짜로 바꾸거나 가짜 모델(`{"tree":[]}`)을 줘서, 모델이
 * 실제로 답을 내는 길을 안 지났다. 그런데 내려받은 CSV는 **학생의 제출물이다** —
 * `TabularPredictPanel.vue`의 머리말이 *"오류도 알림도 없이 틀린 CSV가 나가고, 그 파일이
 * 제출물이다"*(R20 A-1)로 지키는 자리다.
 *
 * **판을 거치지 않은 다른 길과 견준다.** 저장된 전처리기와 모델을 **직접** 꺼내
 * (`experimentPreprocessor` → `transform` → `loadModel`) 같은 행을 예측한 것이 내려받은
 * CSV의 답 칸과 같아야 한다. 같은 함수로 두 번 계산해 견주면 한쪽이 틀려도 둘이 맞는다 —
 * 그래서 판의 `predictPage` 경로와 **다른 조립**으로 잰다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ bytes: null as Uint8Array | null, name: '' }))

vi.mock('../src/project/download', async (real) => {
  const actual = await real<typeof import('../src/project/download')>()
  return {
    ...actual,
    downloadBytes: (bytes: Uint8Array, name: string) => {
      captured.bytes = bytes
      captured.name = name
    },
  }
})

import { importTable, openTable } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import { runExperiment } from '../src/ml/experiment'
import { loadModel } from '../src/ml/models'
import { experimentPreprocessor, transform } from '../src/ml/preprocess'
import { applyExperiment } from '../src/project/attach'
import { applyDataset, applyPredictDataset, readDataset } from '../src/project/dataset'
import { dataSnapshot } from '../src/project/schema'
import {
  withFeatures,
  withSelectedAlgorithms,
  withTarget,
  withTaskType,
} from '../src/project/settings'
import { useProjectStore } from '../src/stores/project'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import TabularPredictPanel from '../src/views/predict/TabularPredictPanel.vue'
import { IRIS_FEATURE_COLUMNS, irisDataset } from './fixtures/iris'
import { irisProject, trainedIrisProject } from './fixtures/trained'

const NOW = '2026-09-23T00:00:00Z'
/** 예측할 행. 붓꽃에서 서로 다른 품종이 섞이게 고른다. */
const PICKED = [0, 1, 12, 13, 25, 26]

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 따옴표 없는 단순 CSV를 칸으로. 우리 정본 CSV는 BOM으로 시작할 수 있다. */
function parseCsv(bytes: Uint8Array): string[][] {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')
  return text
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => line.split(','))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  captured.bytes = null
  captured.name = ''
  await setLocale('ko')
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
})

describe('일괄 예측의 내려받기', () => {
  it('진짜 모델의 답이 행마다 CSV에 실리고, 직접 꺼낸 모델과 같다', async () => {
    // 학습한 프로젝트에 예측할 표를 **가져오기 경로 그대로** 붙인다.
    const trained = await trainedIrisProject(['decision_tree'])
    const iris = irisDataset()
    const featureIndex = IRIS_FEATURE_COLUMNS.map((name) => iris.columns.indexOf(name))
    const predictLines = [
      IRIS_FEATURE_COLUMNS.join(','),
      ...PICKED.map((row) => featureIndex.map((column) => iris.rows[row]?.[column]).join(',')),
    ]
    const imported = importTable(
      await openTable(new TextEncoder().encode(`${predictLines.join('\n')}\n`), 'new.csv'),
    )
    const { project: file } = applyPredictDataset(trained, imported, {
      fileName: 'new.csv',
      hasHeader: true,
      now: NOW,
      requiredColumns: [...IRIS_FEATURE_COLUMNS],
    })
    useProjectStore().update(file)

    const wrapper = mount(TabularPredictPanel, { global: { plugins: [i18n] } })
    await settle()
    // [파일로 예측]을 고른다. 라디오 둘 중 뒤엣것이다.
    await wrapper.findAll('input[name="predict-input-mode"]')[1]?.trigger('change')
    await settle()

    expect(wrapper.findComponent(BatchPredict).exists()).toBe(true)
    // **바의 [내려받기]를 누른다** (R38-V V-C1). 판의 `download()`를 직접 부르면 바의
    // `:action`을 끊어도 초록이었다(V10 조용).
    const download = wrapper
      .findAll('button')
      .find((one) => one.text() === i18n.global.t('predict.tabular.download'))
    expect(download, 'download button').toBeDefined()
    await download!.trigger('click')
    await settle()

    expect(captured.bytes, 'download produced no file').not.toBeNull()
    const grid = parseCsv(captured.bytes ?? new Uint8Array())
    // 머리글 한 줄 + 예측한 행 수.
    expect(grid).toHaveLength(PICKED.length + 1)

    // **판을 거치지 않은 길로 같은 행을 예측한다.**
    const experiment = file.document.runs.experiments[0]
    const run = experiment?.runs[0]
    expect(experiment && run?.model).toBeTruthy()
    if (!experiment || !run?.model) return
    const preprocessor = experimentPreprocessor(experiment, file.models)
    expect(preprocessor).not.toBeNull()
    if (!preprocessor) return
    // 대조는 **올린 표**(`PICKED`의 원본 행)로 다시 만든다 — 내려받은 CSV에서 읽으면
    // 판이 적은 것으로 판을 재는 셈이다 (R38-V V-C3).
    const vectors = transform(
      preprocessor,
      {
        columns: [...IRIS_FEATURE_COLUMNS],
        rows: PICKED.map((row) => featureIndex.map((c) => iris.rows[row]?.[c] ?? '')),
      },
      PICKED.map((_, index) => index),
      (experiment.settings.data as { preprocessing: { categoricalEncoding: 'onehot' | 'none' } })
        .preprocessing.categoricalEncoding,
    )
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(file.models.get(run.model.path) ?? new Uint8Array()),
    )
    const direct = loadModel(payload, {})(vectors).map(String)

    // CSV에서 이 모델의 답 칸. 머리글 중 특성·행 번호가 아닌 첫 칸이다.
    const header = grid[0] ?? []
    const answerColumn = header.findIndex(
      (name, index) =>
        index > 0 &&
        !(IRIS_FEATURE_COLUMNS as readonly string[]).includes(name) &&
        !name.includes('%'),
    )
    expect(answerColumn, `header: ${header.join('|')}`).toBeGreaterThan(-1)
    const inCsv = grid.slice(1).map((row) => row[answerColumn] ?? '')

    expect(inCsv).toEqual(direct)
    // 답이 한 가지뿐이면 이 대조가 우연으로 맞을 수 있다 — 고른 행이 두 품종 이상을 내야 한다.
    expect(new Set(inCsv).size).toBeGreaterThan(1)
  })

  /**
   * **회귀의 답은 원값으로 실린다** (2026-09-29 감사 F C-1). 전에는 화면의 꼴
   * (`format.prediction`)이 파일에 들어가 유효숫자 12자리에서 잘리고 천 단위 쉼표가 붙었다 —
   * 그 칸을 이 앱에 다시 올리면 범주 열이 된다. 화면 표시는 그대로다.
   *
   * **값을 천 배로 키운다.** 붓꽃의 꽃잎 길이는 한 자리라 쉼표가 안 붙는다 — 키워야
   * 자리 구분이 실제로 서는 크기가 된다.
   */
  it('회귀의 답은 원값으로 실린다', async () => {
    const base = await irisProject(['linear_regression'])
    const iris = irisDataset()
    const target = 'petal_length'
    const at = iris.columns.indexOf(target)
    const scaled = {
      columns: iris.columns,
      rows: iris.rows.map((row) =>
        row.map((cell, column) => (column === at ? String(Number(cell) * 1000) : cell)),
      ),
    }
    const lines = [scaled.columns.join(','), ...scaled.rows.map((row) => row.join(','))]
    const { project: withData } = applyDataset(
      base,
      importTable(await openTable(new TextEncoder().encode(`${lines.join('\n')}\n`), 'big.csv')),
      { fileName: 'big.csv', hasHeader: true, now: NOW },
    )
    const features = IRIS_FEATURE_COLUMNS.filter((name) => name !== target)
    let document = withTaskType(withData.document, 'regression', NOW)
    document = withTarget(document, target, NOW)
    document = withFeatures(document, [...features], NOW)
    document = withSelectedAlgorithms(
      document,
      [{ algorithm: 'linear_regression', runtime: 'mljs' }],
      NOW,
    )
    const project = { ...withData, document }
    const dataset = readDataset(project)
    if (!dataset) throw new Error('fixture has no dataset')
    const result = await runExperiment({
      dataset,
      testDataset: null,
      taskType: 'regression',
      dataType: 'tabular',
      settings: document.settings,
      context: {
        serverStatus: 'unavailable',
        limitsOff: false,
        rowCount: dataset.rows.length,
        dataType: 'tabular',
      },
      snapshot: dataSnapshot('tabular', document.settings),
    })
    const trained = applyExperiment(project, result, NOW)

    const featureIndex = features.map((name) => scaled.columns.indexOf(name))
    const predictLines = [
      features.join(','),
      ...PICKED.map((row) => featureIndex.map((column) => scaled.rows[row]?.[column]).join(',')),
    ]
    const { project: file } = applyPredictDataset(
      trained,
      importTable(
        await openTable(new TextEncoder().encode(`${predictLines.join('\n')}\n`), 'new.csv'),
      ),
      { fileName: 'new.csv', hasHeader: true, now: NOW, requiredColumns: [...features] },
    )
    useProjectStore().update(file)

    const wrapper = mount(TabularPredictPanel, { global: { plugins: [i18n] } })
    await settle()
    await wrapper.findAll('input[name="predict-input-mode"]')[1]?.trigger('change')
    await settle()
    const download = wrapper
      .findAll('button')
      .find((one) => one.text() === i18n.global.t('predict.tabular.download'))
    expect(download, 'download button').toBeDefined()
    await download!.trigger('click')
    await settle()
    expect(captured.bytes, 'download produced no file').not.toBeNull()

    // 판을 거치지 않은 길로 같은 행을 예측한다 — 위 검사와 같은 대조다.
    const experiment = file.document.runs.experiments[0]
    const run = experiment?.runs[0]
    if (!experiment || !run?.model) throw new Error('the regression run has no model')
    const preprocessor = experimentPreprocessor(experiment, file.models)
    if (!preprocessor) throw new Error('the regression run has no preprocessor')
    const vectors = transform(
      preprocessor,
      {
        columns: [...features],
        rows: PICKED.map((row) => featureIndex.map((c) => scaled.rows[row]?.[c] ?? '')),
      },
      PICKED.map((_, index) => index),
      'onehot',
    )
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(file.models.get(run.model.path) ?? new Uint8Array()),
    )
    const direct = loadModel(payload, {})(vectors).map(String)
    // 쉼표가 붙었으면 칸이 늘어난다 — 행마다 칸 수가 머리글과 같아야 한다.
    const grid = parseCsv(captured.bytes ?? new Uint8Array())
    const header = grid[0] ?? []
    for (const row of grid.slice(1)) {
      expect(row, 'a grouped number split the row').toHaveLength(header.length)
    }
    const answerColumn = header.length - 1
    expect(grid.slice(1).map((row) => row[answerColumn] ?? '')).toEqual(direct)
    // 쉼표가 실제로 붙을 크기인가 — 아니면 이 검사는 자리 구분을 못 잰다.
    expect(Math.max(...direct.map(Number))).toBeGreaterThan(1000)
    wrapper.unmount()
  })
})
