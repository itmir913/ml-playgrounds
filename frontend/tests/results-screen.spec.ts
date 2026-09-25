// @vitest-environment jsdom
/**
 * **결과 화면** (2026-09-02 R24 B-5).
 *
 * **어느 스펙도 이 파일들을 안 띄웠다.** 순수 함수 쪽(`results.spec`·`changes.spec`)은
 * 있는데 화면이 그것을 **어느 짝으로 부르는지**가 무검사였고, 일곱 자리를 뭉개도
 * 관문이 전부 초록이었다. 틀린 것이 아니라 **틀려도 아무도 모르는** 자리다.
 *
 * 학생이 잃는 것으로 세면 이렇다 — 학습 직후 옛 결과가 보인다 · "직전 학습에서 바뀐
 * 것"이 엉뚱한 짝을 견준다 · 혼동 행렬의 칸을 거꾸로 읽는다 · 정밀도와 재현율이
 * 바뀐 채 "sklearn 순서"라는 머리말을 달고 선다 · 가장 좋은 값이 안 굵다 · 20%가
 * 80%로 보인다.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { Change } from '../src/ml/changes'
import type { PanelInput } from '../src/ml/metric-panels'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import { silhouetteSampleSize } from '../src/ml/metrics'
import { PREPROCESSOR_FORMAT, type Dataset, type Preprocessor } from '../src/ml/preprocess'
import type { ProjectFile } from '../src/project/format'
import { DATA_TYPES, type DataType, type Run } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'
import ResultsView from '../src/views/ResultsView.vue'
import ChangeList from '../src/views/results/ChangeList.vue'
import ExperimentDetail from '../src/views/results/ExperimentDetail.vue'
import ExperimentList from '../src/views/results/ExperimentList.vue'
import ConfusionMatrixPanel from '../src/views/results/panels/ConfusionMatrixPanel.vue'
import PerClassPanel from '../src/views/results/panels/PerClassPanel.vue'
import { experiment, projectFile, run } from './fixtures/project'

/** 실험 셋. **둘로는 모자란다** — 마지막의 직전이 첫째와 갈려야 짝을 잰다. */
function threeExperiments(): ProjectFile {
  const file = projectFile()
  return {
    ...file,
    document: {
      ...file.document,
      runs: {
        experiments: [
          experiment('experiment-1', [run('run-1')]),
          experiment('experiment-2', [run('run-2')]),
          experiment('experiment-3', [
            run('run-3', { metrics: { accuracy: 0.9 } }),
            run('run-4', { algorithm: 'svm', metrics: { accuracy: 0.8 } }),
          ]),
        ],
      },
    },
  }
}

function mountResults(file: ProjectFile) {
  useProjectStore().file = file
  return mount(ResultsView, { global: { plugins: [i18n] } })
}

/** 패널 하나가 보는 재료. 이 둘은 `run` 말고는 안 본다. */
function panelInput(one: Run): PanelInput {
  return {
    run: one,
    experiment: experiment('experiment-1', [one]),
    dataset: null,
    preprocessor: null,
    modelBytes: undefined,
    file: projectFile(),
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  // jsdom에는 스크롤이 없다. 없으면 실험을 고르는 길이 예외로 끝난다.
  Element.prototype.scrollIntoView = function noop(): void {}
  await setLocale('ko')
})

describe('R24 B-5: which experiment the screen opens', () => {
  it('the newest one — that is the one just trained', () => {
    const view = mountResults(threeExperiments())
    const detail = view.findComponent(ExperimentDetail)

    expect(detail.exists()).toBe(true)
    expect(detail.props('experiment').id).toBe('experiment-3')
  })

  /**
   * **직전은 파일 순서에서 나온다.** `experiment.changed`가 학습 시점에 견준 상대가
   * 바로 앞 실험이므로, 화면이 다른 짝을 고르면 경로와 값이 어긋난다.
   */
  it('the one right before it is the pair, not the first one', () => {
    const view = mountResults(threeExperiments())

    expect(view.findComponent(ExperimentDetail).props('previous')?.id).toBe('experiment-2')
  })

  it('the first experiment has nothing to compare with', async () => {
    const view = mountResults(threeExperiments())
    view.findComponent(ExperimentList).vm.$emit('pick', 'experiment-1')
    await view.vm.$nextTick()

    const detail = view.findComponent(ExperimentDetail)
    expect(detail.props('experiment').id).toBe('experiment-1')
    expect(detail.props('previous')).toBeUndefined()
  })
})

describe('R24 B-5: the best value is the bold one', () => {
  it('the higher accuracy is bold and the lower one is not', () => {
    const view = mountResults(threeExperiments())
    const cells = view.findAll('td').filter((cell) => cell.text().includes('%'))
    const best = cells.find((cell) => cell.text().startsWith('90'))
    const worse = cells.find((cell) => cell.text().startsWith('80'))

    expect(best?.classes()).toContain('font-bold')
    expect(worse?.classes()).not.toContain('font-bold')
  })
})

/**
 * **세로가 실제, 가로가 예측이다.** 머리에서 다시 조합해야 읽히는 표라 학생이 가장 자주
 * 막히는 자리이고, 그래서 칸을 누르면 그 칸이 무엇인지 말한다. 둘이 바뀌면 팝오버가
 * **바로 그 헷갈림을 굳힌다.**
 */
describe('R24 B-5: what a confusion-matrix cell says', () => {
  const MATRIX: Run = run('run-1', {
    confusionMatrix: {
      labels: ['개', '고양이'],
      matrix: [
        [7, 3],
        [1, 9],
      ],
    },
  })

  it('the row is the actual value and the column is the predicted one', async () => {
    const wrapper = mount(ConfusionMatrixPanel, {
      props: { input: panelInput(MATRIX) },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })

    const cells = wrapper.findAll('tbody td button')
    expect(cells.map((one) => one.text())).toEqual(['7', '3', '1', '9'])

    /**
     * 팝오버가 말하는 것을 **적힌 순서 그대로** 읽는다. 글자를 찾아 세면 `개`가
     * `개수`에 걸려 둘을 맞바꿔도 조용하다 — R24 재검증에서 실제로 그랬다.
     */
    const said = async (cell: number): Promise<string[]> => {
      await cells[cell]?.trigger('click')
      const values = [...(document.querySelectorAll('.popover-panel dd') ?? [])].map(
        (one) => one.textContent?.trim() ?? '',
      )
      await cells[cell]?.trigger('click')
      return values
    }

    // 어긋난 칸이라야 둘이 바뀐 것이 보인다. 대각선은 실제와 예측이 같다.
    // 첫 줄(실제 = 개)의 둘째 칸(예측 = 고양이).
    expect(await said(1)).toEqual(['개', '고양이', '3'])
    // 둘째 줄(실제 = 고양이)의 첫 칸(예측 = 개) — 반대쪽도 잰다.
    expect(await said(2)).toEqual(['고양이', '개', '1'])

    const labels = [...document.querySelectorAll('thead th')].map((one) => one.textContent?.trim())
    expect(labels[0]).toBe('실제 값')

    wrapper.unmount()
    document.body.innerHTML = ''
  })
})

/**
 * **"sklearn 순서"라는 머리말이 검사 없이 서 있었다** (`python-conventions-first`).
 * 열이 바뀌면 학생은 정밀도라고 적힌 칸에서 재현율을 읽는다.
 */
describe('R24 B-5: the per-class table keeps sklearn column order', () => {
  it('precision then recall, and the values follow the headers', () => {
    const wrapper = mount(PerClassPanel, {
      props: {
        input: panelInput(
          run('run-1', {
            perClass: [{ label: '개', precision: 0.25, recall: 0.75, f1: 0.375, support: 4 }],
          }),
        ),
      },
      global: { plugins: [i18n] },
    })

    const headers = wrapper.findAll('thead th').map((one) => one.text())
    expect(headers[1]).toContain('정밀도')
    expect(headers[2]).toContain('재현율')

    const cells = wrapper.findAll('tbody td').map((one) => one.text())
    expect(cells[0]).toBe('25%')
    expect(cells[1]).toBe('75%')
  })
})

/**
 * **비율은 0과 1 사이로 오고 화면이 백분율로 읽는다** (`ml/changes.ts`). 학생이 만진
 * 손잡이에는 `20%`라고 쓰여 있었다 — 결과 화면이 다른 말을 하면 그건 2026-08-29
 * 전 경로 감사에서 잡힌 것과 같은 결함이다.
 */
describe('R24 B-5: a ratio in the change list', () => {
  it('reads the number the student turned, not its complement', () => {
    const changes: readonly Change[] = [
      {
        path: 'split.testSize',
        labelKey: 'preprocess.testSize',
        from: { kind: 'ratio', value: 0.2 },
        to: { kind: 'ratio', value: 0.3 },
      },
    ]
    const wrapper = mount(ChangeList, { props: { changes }, global: { plugins: [i18n] } })

    expect(wrapper.text()).toContain('20%')
    expect(wrapper.text()).toContain('30%')
    expect(wrapper.text()).not.toContain('80%')
  })
})

/**
 * **실루엣 계수를 표본으로 냈으면 화면이 말한다** (`open-decisions.md` "실루엣 계수는
 * 표본으로 낸다"). 순수 함수가 아니라 **화면을 띄워** 본다 — 부르는 쪽이 판정을 부르는지,
 * 어느 수를 넘기는지가 여기서만 보인다. 판정 자체는 `metrics.spec.ts`의 *"실루엣 표본을
 * 화면에 밝힐 것인가"*가 잰다.
 */
describe('the results screen says the silhouette was sampled', () => {
  function clusteringExperiment(rows: number) {
    const base = experiment('experiment-1', [
      run('run-1', { algorithm: 'k_means', metrics: { silhouette: 0.5, inertia: 12 } }),
    ])
    return {
      ...base,
      settings: {
        ...base.settings,
        taskType: 'clustering' as const,
        trainIndices: Array.from({ length: rows }, (_, index) => index),
        testIndices: [],
      },
    }
  }

  /** 기본 백본의 임베딩 폭. 이 폭에서 아래 행 수는 표본이 켜진다 — 첫 판이 확인한다. */
  const WIDTH = backboneFor(DEFAULT_BACKBONE_ID)?.embeddingDim ?? 0
  const preprocessor: Preprocessor = {
    format: PREPROCESSOR_FORMAT,
    columns: [],
    featureNames: Array.from({ length: WIDTH }, (_, index) => `e${index}`),
    excludedColumns: [],
  }
  const SAMPLED_ROWS = 5000

  /** 데이터 종류 → 그 종류의 문장 키. 화면이 고르는 것과 같은 짝이어야 한다. */
  const KEY: Record<DataType, string> = {
    tabular: 'results.tabular.silhouetteSampled',
    image: 'results.image.silhouetteSampled',
  }

  /** 수를 뺀 문장 부분. 수가 무엇이든 이 문장이 보이면 표본이라고 말한 것이다. */
  function sentence(dataType: DataType): string {
    const whole = i18n.global.t(KEY[dataType], { used: 0, total: 0 }) as string
    return whole.slice(0, whole.lastIndexOf('('))
  }

  function mountDetail(
    rows: number,
    options: {
      dataType?: DataType
      preprocessor?: Preprocessor | null
      dataset?: Dataset | null
    } = {},
  ) {
    return mount(ExperimentDetail, {
      props: {
        experiment: clusteringExperiment(rows),
        order: 1,
        previous: undefined,
        dataType: options.dataType ?? 'tabular',
        dataset: options.dataset ?? null,
        preprocessor: options.preprocessor === undefined ? preprocessor : options.preprocessor,
        models: new Map<string, Uint8Array>(),
        file: projectFile(),
      },
      /**
       * **고른 run의 속(`RunDetail`)은 띄우지 않는다.** 이 판이 보는 것은 점수 표 아래 문장
       * 하나이고, 속의 군집 패널은 지연 로딩이라 판이 끝난 뒤에 모듈을 불러 vitest가
       * 처리되지 않은 오류로 끝난다(사람 확인 — 판은 초록인데 vitest 종료 코드가 1이었다).
       */
      global: { plugins: [i18n], stubs: { RunDetail: true } },
    })
  }

  for (const dataType of DATA_TYPES) {
    it(`says it in the ${dataType} sentence, with the counts from the metric's own judgment`, () => {
      const used = silhouetteSampleSize(SAMPLED_ROWS, WIDTH)
      expect(used).toBeLessThan(SAMPLED_ROWS)

      const text = mountDetail(SAMPLED_ROWS, { dataType }).text()
      expect(text).toContain(i18n.global.t(KEY[dataType], { used, total: SAMPLED_ROWS }) as string)
      // 다른 종류의 문장이 섞여 나오지 않는다 — 사진에 "행"이라 말하지 않는다.
      for (const other of DATA_TYPES.filter((one) => one !== dataType)) {
        expect(text).not.toContain(sentence(other))
      }
    })
  }

  /**
   * **전체 수는 실험이 학습에 쓴 행 수(`trainIndices`)다. 데이터셋의 행 수가 아니다.** 빈
   * 타깃·결측 제거·추출로 둘이 갈리고, 실루엣을 잰 행렬은 앞의 것에서 나온다
   * (사람 확인: `ml/experiment.ts`가 `split.trainIndices`로 `transform`한다).
   */
  it('counts the rows the experiment trained on, not the rows of the dataset', () => {
    const dataset: Dataset = {
      columns: ['a'],
      rows: Array.from({ length: SAMPLED_ROWS + 1000 }, (_, index) => [String(index)]),
    }
    const used = silhouetteSampleSize(SAMPLED_ROWS, WIDTH)
    const text = mountDetail(SAMPLED_ROWS, { dataset }).text()
    expect(text).toContain(i18n.global.t(KEY.tabular, { used, total: SAMPLED_ROWS }) as string)
  })

  it('says nothing when every row was used', () => {
    const text = mountDetail(300).text()
    expect(text).not.toContain(sentence('tabular'))
  })

  it('says nothing when the width is unknown — it does not make up the count', () => {
    const text = mountDetail(SAMPLED_ROWS, { preprocessor: null }).text()
    expect(text).not.toContain(sentence('tabular'))
  })
})
