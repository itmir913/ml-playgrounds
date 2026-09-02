// @vitest-environment jsdom
// 실제로 mount해서 그려진 것을 본다 - 여기 있는 결함은 눈으로만 보인다.
/**
 * 예측 화면의 필터 칸 (`views/predict/PredictFilters.vue`).
 *
 * **빈 카드가 실제로 떴다.** 학습이 한 번뿐이고 알고리즘도 하나뿐인 프로젝트에서,
 * 두 축이 다 안 그려졌는데 바깥 칸만 남아 아무것도 안 든 테두리가 화면에 섰다.
 * 학생에게 그것은 필터가 아니라 **무언가 안 뜬 고장**으로 보인다.
 *
 * **전체 버튼의 이름이 동작과 같은 판정을 보는지도 여기서 본다** — [전체 해제]라고
 * 적힌 버튼이 전부 켜면 학생은 화면을 못 믿는다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { i18n, setLocale } from '../src/i18n'
import type { PredictFilter } from '../src/ml/predict'
import type { ProjectFile } from '../src/project/format'
import { useProjectStore } from '../src/stores/project'
import PredictFilters, { type FilterAxis } from '../src/views/predict/PredictFilters.vue'
import TabularPredictPanel from '../src/views/predict/TabularPredictPanel.vue'
import { experiment, projectFileWithPredictDataset, run } from './fixtures/project'

const ONE = [{ id: 'a', label: '1번째 실험' }]
const TWO = [
  { id: 'a', label: '1번째 실험' },
  { id: 'b', label: '2번째 실험' },
]

function axesOf(experiments: typeof ONE, algorithms: typeof ONE): FilterAxis[] {
  return [
    { id: 'experiment', label: '실험(Experiment)', options: experiments },
    { id: 'algorithm', label: '모델', options: algorithms },
  ]
}

function render(experiments: typeof ONE, algorithms: typeof ONE, filter?: PredictFilter) {
  const axes = axesOf(experiments, algorithms)
  return mount(PredictFilters, {
    props: {
      axes,
      filter: filter ?? {
        experimentIds: new Set(experiments.map((option) => option.id)),
        algorithms: new Set(algorithms.map((option) => option.id)),
      },
      count: '모델 2개 중 2개',
      disabled: false,
    },
    global: { plugins: [i18n] },
  })
}

/** 켜고 끄는 칩만. 전체 버튼도 `<button>`이라 전부 세면 자리가 밀린다. */
function chipsOf(wrapper: ReturnType<typeof render>) {
  return wrapper.findAll('button[aria-pressed]')
}

beforeEach(async () => {
  await setLocale('ko')
})

describe('거를 것이 없으면 자리를 안 차지한다', () => {
  it('두 축이 다 하나뿐이면 아무것도 안 그린다', () => {
    expect(render(ONE, ONE).html()).toBe('<!--v-if-->')
  })

  it('한 축만 둘 이상이어도 칸은 선다', () => {
    const html = render(ONE, TWO).html()
    expect(html).toContain('모델')
    // 하나뿐인 축은 그 안에서도 안 그려진다.
    expect(html).not.toContain('실험(Experiment)')
  })
})

describe('고른 것을 표시한다', () => {
  it('켜진 칩은 aria-pressed가 참이다', () => {
    const chips = chipsOf(render(TWO, TWO))
    expect(chips.every((chip) => chip.attributes('aria-pressed') === 'true')).toBe(true)
  })

  it('누르면 어느 축의 무엇인지를 함께 올린다', async () => {
    const wrapper = render(TWO, TWO)
    await chipsOf(wrapper)[1]?.trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([['experiment', 'b']])
  })
})

describe('전체 버튼은 이름과 동작이 같은 판정을 본다', () => {
  it('전부 켜져 있으면 [전체 해제]라고 적힌다', () => {
    expect(render(TWO, TWO).html()).toContain('전체 해제')
  })

  it('하나라도 꺼져 있으면 [전체 선택]이 된다', () => {
    const html = render(TWO, TWO, {
      experimentIds: new Set(['a']),
      algorithms: new Set(['a', 'b']),
    }).html()

    expect(html).toContain('전체 선택')
  })

  it('누르면 그 축만 올린다', async () => {
    const wrapper = render(TWO, TWO)
    await wrapper.findAll('button:not([aria-pressed])')[0]?.trigger('click')
    expect(wrapper.emitted('toggleAll')).toEqual([['experiment']])
  })
})

/**
 * **두 축을 비대칭으로 준다.** 위의 `render`는 기본 필터를 두 축 모두 전부 켜진
 * 상태로 만들고, 비대칭을 주는 검사 하나는 결과를 `toContain`으로만 봤다 — 두 축의
 * 버튼이 같은 HTML 안에 있으므로 **한쪽만 맞아도 통과한다**(공통 §2.1).
 *
 * 그래서 축을 통째로 맞바꾸는 회귀가 전부 빠져나갔다 (R14-5 감사 A-4). 그 상태는
 * V11 R5 A-2와 같은 실패 모양이다 — **이름표와 동작이 갈린다.**
 */
describe('두 축은 각자의 상태를 본다', () => {
  const asymmetric = () =>
    render(TWO, TWO, { experimentIds: new Set(['a']), algorithms: new Set(['a', 'b']) })

  it('전체 버튼의 이름표가 축마다 다르다', () => {
    const labels = asymmetric()
      .findAll('button')
      .map((one) => one.text())
      .filter((text) => text === '전체 선택' || text === '전체 해제')
    // 실험 축은 하나만 켜져 있으니 [전체 선택], 모델 축은 다 켜져 있으니 [전체 해제].
    expect(labels).toEqual(['전체 선택', '전체 해제'])
  })

  it('칩의 눌림이 자기 축의 집합을 따라간다', () => {
    const pressed = chipsOf(asymmetric()).map((one) => one.attributes('aria-pressed'))
    expect(pressed).toEqual(['true', 'false', 'true', 'true'])
  })
})

/**
 * 잠금은 판이 조립한다 (`TabularPredictPanel`의 `calculating`). **여기서만 보인다** —
 * 필터 컴포넌트는 `disabled`를 받아 쓸 뿐이고, 어느 상태를 넣을지는 판이 정한다.
 *
 * **파일 모드가 갈려 있었다** (2026-09-02 R20 A-1). 값 모드만 `predicting`을 켜므로
 * 내려받는 중에 필터가 열려 있었고, 도중에 모델을 끄면 앞쪽 행은 옛 목록으로 계산된
 * 답인데 열 이름은 새 목록으로 서서 **틀린 CSV가 조용히 나갔다.** 그 파일이 제출물이다.
 *
 * 셋째 검사가 짝이다 — 판이 안 그려졌을 때까지 잠그면 **필터를 전부 끈 학생이 다시 못
 * 켠다.** `fileBusy`(바의 버튼용)를 그대로 쓰면 그렇게 된다.
 */
describe('계산이 도는 동안 필터가 잠긴다', () => {
  const batch = { busy: ref(false), computing: ref(false) }

  /** `BatchPredict` 대신 세우는 가짜. 판이 읽는 것은 노출된 넷뿐이다. */
  const FakeBatch = defineComponent({
    name: 'BatchPredict',
    setup(_props, { expose }) {
      expose({ busy: batch.busy, computing: batch.computing, opened: null, hasFile: false })
      return () => h('div')
    },
  })

  function twoModelProject(): ProjectFile {
    const base = projectFileWithPredictDataset()
    return {
      ...base,
      document: {
        ...base.document,
        runs: {
          experiments: [
            experiment('experiment-1', [
              run('run-1', { algorithm: 'decision_tree' }),
              run('run-2', { algorithm: 'logistic_regression' }),
            ]),
          ],
        },
      },
      models: new Map([
        ...base.models,
        ['model/run-2.json', new TextEncoder().encode('{"tree":[]}')],
      ]),
    }
  }

  async function panelInFileMode() {
    setActivePinia(createPinia())
    const project = useProjectStore()
    project.update(twoModelProject())

    const wrapper = mount(TabularPredictPanel, {
      global: { plugins: [i18n], stubs: { BatchPredict: FakeBatch } },
    })
    // [파일로 예측]을 고른다. 라디오 둘 중 뒤엣것이다.
    const radios = wrapper.findAll('input[name="predict-input-mode"]')
    await radios[1]?.trigger('change')
    return wrapper
  }

  function lockedChips(wrapper: Awaited<ReturnType<typeof panelInFileMode>>): boolean[] {
    const chips = wrapper.findAll('button[aria-pressed]')
    expect(chips.length).toBeGreaterThan(0)
    return chips.map((chip) => chip.attributes('disabled') !== undefined)
  }

  beforeEach(async () => {
    batch.busy.value = false
    batch.computing.value = false
    await setLocale('ko')
  })

  it('파일 모드에서 아무것도 안 도는 동안에는 열려 있다', async () => {
    const wrapper = await panelInFileMode()
    expect(lockedChips(wrapper)).not.toContain(true)
  })

  it('내려받기가 도는 동안 잠긴다', async () => {
    const wrapper = await panelInFileMode()
    batch.computing.value = true
    await wrapper.vm.$nextTick()
    expect(lockedChips(wrapper)).not.toContain(false)
  })

  it('파일을 읽는 동안에도 잠긴다', async () => {
    const wrapper = await panelInFileMode()
    batch.busy.value = true
    await wrapper.vm.$nextTick()
    expect(lockedChips(wrapper)).not.toContain(false)
  })

  /**
   * **파일 입구도 같은 신호로 잠긴다** (2026-09-02 R22 재감사 C-2의 짝).
   *
   * `fileBusy`가 바의 [파일 선택]·[삭제]·[사용]·[다운로드] 넷을 가리는데 **그것을 무는
   * 검사가 하나도 없었다.** 겹침 검사가 숨은 `<input>`에 `change`를 억지로 넣어 그
   * 아래 방어선을 재는 동안, **학생이 실제로 닿는 입구인 이 잠금은 아무도 안 봤다.**
   *
   * `!batch.value`까지 "바쁨"으로 치는 것은 일부러다 — 판이 안 그려졌으면 누를 대상이
   * 없다. 그 갈래는 위의 "판이 안 그려졌으면" 검사가 따로 본다.
   */
  function barButtons(wrapper: Awaited<ReturnType<typeof panelInFileMode>>): string[] {
    return wrapper
      .findAll('button')
      .filter((one) => one.attributes('disabled') === undefined)
      .map((one) => one.text())
  }

  it('파일을 읽는 동안 파일 입구가 잠긴다', async () => {
    const wrapper = await panelInFileMode()
    expect(barButtons(wrapper)).toContain('파일 선택')

    batch.busy.value = true
    await wrapper.vm.$nextTick()
    expect(barButtons(wrapper)).not.toContain('파일 선택')
  })

  it('내려받기가 도는 동안에도 파일 입구가 잠긴다', async () => {
    const wrapper = await panelInFileMode()
    expect(barButtons(wrapper)).toContain('파일 선택')

    batch.computing.value = true
    await wrapper.vm.$nextTick()
    expect(barButtons(wrapper)).not.toContain('파일 선택')
  })

  it('판이 안 그려졌으면 열려 있다 — 필터를 전부 끈 학생이 다시 켤 수 있어야 한다', async () => {
    const wrapper = await panelInFileMode()
    // [전체 해제]를 두 축 다 누르면 보이는 모델이 0이라 `BatchPredict`가 사라진다.
    for (const button of wrapper.findAll('button')) {
      if (button.text() === '전체 해제') await button.trigger('click')
    }
    expect(wrapper.findComponent(FakeBatch).exists()).toBe(false)
    expect(lockedChips(wrapper)).not.toContain(true)
  })
})
