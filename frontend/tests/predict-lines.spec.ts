// @vitest-environment jsdom
/**
 * **띄우는 스펙은 있는데 그 줄을 안 지나던 넷** (2026-09-02 R24 B-6).
 *
 * 네 자리 다 뭉개도 관문이 초록이었다. 묶어 둔 이유는 실패 모양이 같아서다 — **화면은
 * 멀쩡하고 숫자만 조용히 틀린다.**
 *
 * - 깨진 모델이 "값을 채우고 [예측]을 누르면"으로 영영 남는다 (`TabularPredictPanel`).
 * - 학생이 친 `2.5`가 그대로 파일에 앉는다 (`ChosenModels`).
 * - 모델이 고른 답이 아닌 막대가 굵게 선다 (`AnswerList`).
 * - "비슷한 행"이 한 칸 밀린 엉뚱한 행이다 (`ClusterNeighbors`).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

/**
 * **산점도는 안 그린다.** 이 검사가 보는 것은 이웃 표이고, 캔버스는 jsdom에 없다.
 *
 * **부하에서만 터지던 자리다** — `ClusterNeighbors`가 차트를 `defineAsyncComponent`로
 * 부르므로 검사가 끝난 **뒤에** 붙고, 그때 wrapper는 이미 떠나 있어 `ownerDocument`를
 * 읽다 죽는다. 격리 실행에서는 안 나고 전체 실행에서만 났다 (R24 B-4와 같은 모양).
 */
vi.mock('@/components/ClusterScatter.vue', () => {
  // **`defineComponent`를 안 쓴다.** 한 파일에 둘이 되면 `vue/one-component-per-file`이
  // 운다 — 맨 객체도 Vue가 컴포넌트로 받는다.
  const stub = { name: 'ClusterScatter', render: () => null }
  // **`default`만 두면 안 된다.** Vue가 비동기 컴포넌트를 풀 때 모듈에서 내부 표식
  // (`__isTeleport` 등)을 읽고, 없으면 vitest가 그 자리에서 던진다.
  return { __esModule: true, default: stub }
})

import { i18n, setLocale } from '../src/i18n'
import { clusterMaterial, nearestMembers } from '../src/ml/clusters'
import { fitKMeans } from '../src/ml/engines/mljs-kmeans'
import { KMEANS_FORMAT, type KMeansModel } from '../src/ml/models/kmeans'
import type { PredictableModel } from '../src/ml/predict'
import { fitPreprocessor, transform, usableRows, type Dataset } from '../src/ml/preprocess'

import type { ProjectFile } from '../src/project/format'
import type { Answer } from '../src/ml/predict'
import type { Experiment, Preprocessing } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'
import AnswerList from '../src/views/predict/AnswerList.vue'
import ClusterNeighbors from '../src/views/predict/ClusterNeighbors.vue'
import TabularPredictPanel from '../src/views/predict/TabularPredictPanel.vue'
import ChosenModels from '../src/views/train/ChosenModels.vue'
import { hashBytes } from '../src/hash'
import { experiment, projectFile, run } from './fixtures/project'

beforeEach(async () => {
  setActivePinia(createPinia())
  Element.prototype.scrollIntoView = function noop(): void {}
  await setLocale('ko')
})

/* ------------------------------------------------------------------ B-6b */

describe('R24 B-6: an integer knob rounds where the student can see it', () => {
  it('typing 2.5 puts 3 in the file and 3 in the box', async () => {
    const chosen = [{ algorithm: 'decision_tree', runtime: 'mljs' }] as const
    const wrapper = mount(ChosenModels, {
      props: {
        chosen: chosen as unknown as never,
        values: { decision_tree: { mljs: { maxDepth: 5 } } },
        // `ModelStatus`는 문자열 넷이다 (`ml/training-status.ts`). 캐스트로 다른 모양을
        // 밀어 넣으면 판이 그 값을 표에서 못 찾아도 아무것도 안 운다.
        statuses: ['waiting'] as const,
        estimates: [{ kind: 'unknown' }] as unknown as never,
        running: false,
        startedAt: [null],
        now: 0,
      },
      global: { plugins: [i18n] },
    })

    const box = wrapper.findAll('input[type="number"]')[0]
    expect(box, 'the decision tree has an integer knob').toBeDefined()
    const element = box!.element as HTMLInputElement
    element.value = '2.5'
    await box!.trigger('change')

    const sent = wrapper.emitted('setParam')?.at(-1)
    expect(sent?.[3]).toBe(3)
    // **칸에도 3이 앉는다.** 안 앉으면 화면은 2.5인데 파일은 3이다.
    expect(element.value).toBe('3')
  })
})

/* ------------------------------------------------------------------ B-6c */

describe('R24 B-6: the bold bar is the answer the model gave', () => {
  it('bolds 고양이 when 고양이 is the answer, even though 개 is listed first', () => {
    const model = {
      experiment: experiment('experiment-1', [run('run-1')]),
      run: run('run-1'),
    } as unknown as PredictableModel
    const answers = new Map<string, Answer>([
      [
        'run-1',
        {
          value: '고양이',
          probabilities: { classes: ['개', '고양이'], values: Float64Array.from([0.3, 0.7]) },
        },
      ],
    ])

    const wrapper = mount(AnswerList, {
      props: {
        dataType: 'tabular',
        models: [model],
        answers,
        experimentNames: new Map([['experiment-1', '1번째 학습']]),
        waiting: '값을 채우고 [예측]을 누르면',
        ranks: null,
      },
      global: { plugins: [i18n] },
    })

    const names = wrapper.findAll('li span.truncate')
    const bold = names.filter((one) => one.classes().includes('font-bold')).map((one) => one.text())
    expect(bold).toEqual(['고양이'])
  })
})

/* ------------------------------------------------------------------ B-6d */

const DATASET: Dataset = {
  columns: ['이름', '키', '몸무게'],
  rows: [
    ['가', '150', '40'],
    ['나', '151', '41'],
    ['다', '152', '42'],
    ['라', '180', '80'],
    ['마', '181', '81'],
    ['바', '182', '82'],
  ],
}
const FEATURES = ['키', '몸무게']
const PREPROCESSING: Preprocessing = {
  missing: 'drop',
  scaling: 'none',
  categoricalEncoding: 'onehot',
}

/**
 * 실제로 맞물리는 군집 한 벌 — `fitPreprocessor` → `transform` → `fitKMeans`를 그대로
 * 지나간다. **손으로 조립한 행렬을 넣으면 방어선을 건너뛴다**
 * (`reachability-through-real-entry`).
 */
function clusterFixture() {
  const rows = usableRows(DATASET, FEATURES, undefined, PREPROCESSING.missing)
  const preprocessor = fitPreprocessor(DATASET, rows, FEATURES, PREPROCESSING)
  const matrix = transform(preprocessor, DATASET, rows, PREPROCESSING.categoricalEncoding)
  const fitted = fitKMeans(matrix, 2, 42)
  const kmeans: KMeansModel = {
    format: KMEANS_FORMAT,
    featureCount: preprocessor.featureNames.length,
    k: 2,
    centroids: fitted.centroids,
  }
  const settings = {
    taskType: 'clustering',
    data: { features: FEATURES, preprocessing: PREPROCESSING },
    trainIndices: rows,
    split: { method: 'holdout', testSize: 0.2, stratify: false, randomState: 42 },
  } as unknown as Experiment['settings']
  return { rows, preprocessor, matrix, kmeans, settings }
}

describe('R24 B-6: the neighbour table shows the rows it found', () => {
  it('the rows are the nearest ones, not the ones next to them', () => {
    const { preprocessor, kmeans, settings } = clusterFixture()
    const one = { ...experiment('experiment-1', []), settings }

    const model = {
      experiment: one,
      run: run('run-1', {
        algorithm: 'k_means',
        model: {
          format: KMEANS_FORMAT,
          path: 'model/run-1.json',
          includesPreprocessing: false,
          sizeBytes: 32,
        },
      }),
    } as unknown as PredictableModel

    // 학생이 넣은 한 줄. 첫 군집 한가운데다.
    const values = { 키: '151', 몸무게: '41' }
    const material = clusterMaterial(DATASET, preprocessor, kmeans, settings)
    const cluster = material.assignment.clusters[material.assignment.rows.indexOf(1)]!

    const wrapper = mount(ClusterNeighbors, {
      props: {
        models: [model],
        answers: new Map<string, Answer>([['run-1', { value: cluster }]]),
        dataset: DATASET,
        preprocessors: new Map([['experiment-1', preprocessor]]),
        modelFiles: new Map([
          ['model/run-1.json', new TextEncoder().encode(JSON.stringify(kmeans))],
        ]),
        values,
        experimentNames: new Map([['experiment-1', '1번째 학습']]),
      },
      global: { plugins: [i18n] },
    })

    const shown = wrapper.findAll('tbody tr').map((tr) => tr.findAll('td').map((td) => td.text()))
    expect(shown.length).toBeGreaterThan(0)

    // 화면이 그린 것과, 계산이 고른 행 번호가 가리키는 것이 같아야 한다.
    const wanted = nearestMembers(
      material,
      cluster,
      transform(
        preprocessor,
        { columns: DATASET.columns, rows: [['?', '151', '41']] },
        [0],
        'onehot',
      )[0]!,
      shown.length,
    ).map((index) => DATASET.rows[index])
    expect(shown).toEqual(wanted)
    // 그리고 학생이 넣은 값과 같은 줄이 맨 앞이다 — 밀리면 여기서 갈린다.
    expect(shown[0]).toEqual(['나', '151', '41'])
  })
})

/* ------------------------------------------------------------------ B-6a */

/** 이 판의 안쪽. 답이 어디에 앉는지는 띄우지 않으면 안 보인다. */
interface PredictInternals {
  answers: Map<string, Answer>
  values: Record<string, string>
  run: () => Promise<void>
}

/** `BatchPredict` 대신 세우는 가짜. 판이 읽는 것은 노출된 넷뿐이다. */
const FakeBatch = defineComponent({
  name: 'BatchPredict',
  setup(_props, { expose }) {
    expose({ busy: ref(false), computing: ref(false), opened: null, hasFile: false })
    return () => h('div')
  },
})

/** 표를 CSV 바이트로. 저장소가 들고 다니는 것은 바이트이고 화면이 그것을 읽는다. */
function csvBytes(): Uint8Array {
  const lines = [
    DATASET.columns.join(','),
    ...DATASET.rows.map((row: readonly string[]) => row.join(',')),
  ]
  return new TextEncoder().encode(`${lines.join('\n')}\n`)
}

/**
 * 군집 실행 둘 — **한쪽 바이트가 깨져 있다.** 파일이 자기 자신에 대해 거짓말하는
 * 상태이고, 옛 파일이나 남의 파일에서 실제로 오는 모양이다.
 */
function oneBrokenModel(): ProjectFile {
  const { preprocessor, kmeans, settings } = clusterFixture()
  const base = projectFile()
  const bytes = csvBytes()
  const good = run('run-1', {
    algorithm: 'k_means',
    model: {
      format: KMEANS_FORMAT,
      path: 'model/run-1.json',
      includesPreprocessing: false,
      sizeBytes: 32,
    },
  })
  const broken = run('run-2', {
    algorithm: 'k_means',
    model: {
      format: KMEANS_FORMAT,
      path: 'model/run-2.json',
      includesPreprocessing: false,
      sizeBytes: 32,
    },
  })
  return {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, taskType: 'clustering' },
      settings: {
        ...base.document.settings,
        data: {
          ...base.document.settings.data,
          dataset: {
            path: 'dataset/data.csv',
            originalFileName: 'data.csv',
            hasHeader: true,
            encoding: 'utf-8' as const,
          },
          features: FEATURES,
          preprocessing: PREPROCESSING,
        } as typeof base.document.settings.data,
      },
      runs: {
        experiments: [{ ...experiment('experiment-1', [good, broken]), settings }],
      },
    },
    dataset: { bytes, hash: hashBytes(bytes) },
    models: new Map([
      [
        'model/preprocessor-experiment-1.json',
        new TextEncoder().encode(JSON.stringify(preprocessor)),
      ],
      ['model/run-1.json', new TextEncoder().encode(JSON.stringify(kmeans))],
      ['model/run-2.json', new TextEncoder().encode('이건 JSON이 아니다')],
    ]),
  }
}

describe('R24 B-6: a model that cannot run says so', () => {
  it('the broken one gets a failure recorded, the good one gets an answer', async () => {
    useProjectStore().update(oneBrokenModel())
    const wrapper = mount(TabularPredictPanel, {
      global: { plugins: [i18n], stubs: { BatchPredict: FakeBatch } },
    })
    await flushPromises()

    const panel = wrapper.vm as unknown as PredictInternals
    panel.values = { 키: '151', 몸무게: '41' }
    await panel.run()
    await flushPromises()

    // **기록이 없으면 그 카드는 영영 "값을 채우고 [예측]을 누르면"으로 남는다.**
    expect(panel.answers.get('run-2')?.failure).toBeDefined()
    // 그리고 옆 모델은 멀쩡히 답한다 — 하나가 깨져도 나머지는 돈다.
    expect(panel.answers.get('run-1')?.value).toBeDefined()
    expect(panel.answers.get('run-1')?.failure).toBeUndefined()
  })
})
