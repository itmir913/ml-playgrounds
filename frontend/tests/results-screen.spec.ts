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
import type { ProjectFile } from '../src/project/format'
import type { Run } from '../src/project/schema'
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
