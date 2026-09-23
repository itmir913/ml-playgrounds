// @vitest-environment jsdom
// 시각화 창과 그림 부품을 실제로 마운트한다.
/**
 * **시각화 창의 손잡이가 그림에 닿는가** (2026-09-23, R38 C-2 · C-3 · C-8 · B-3).
 *
 * R38이 이 판들에 돌연변이 열넷을 심었는데 **전부 조용했다.** 판정 함수(`chart-config.ts`·
 * `limits-switch.ts`·`stats.ts`)는 물리는데 **화면이 그 결과를 쓰는 자리**가 안 물렸다 —
 * 로그 체크박스를 `false`로 끊어도, 자동 `watch`를 뒤집어도, 산점도의 아래 한 줄 셋을 꺼도,
 * 상한을 숫자 리터럴로 박아도 초록이었다.
 *
 * **그려진 것은 못 본다**(jsdom에 캔버스가 없다). 대신 **무엇을 그리라고 넘겼는지**를
 * 본다 — `Bar`·`Scatter`를 프롭만 받는 가짜로 바꾸면 옵션과 데이터가 그대로 보인다.
 * `chart-dialog.spec.ts`와 같은 하니스다.
 */

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-chartjs', () => ({
  Bar: { name: 'Bar', props: ['data', 'options', 'plugins'], render: () => null },
  Scatter: { name: 'Scatter', props: ['data', 'options'], render: () => null },
}))

import { i18n } from '../src/i18n'
import { DATA_SCATTER_POINT_LIMIT } from '../src/limits'
import { applyLimitsOff } from '../src/limits-switch'
import ChartDialog from '../src/views/data/ChartDialog.vue'
import HistogramChart from '../src/views/data/charts/HistogramChart.vue'
import ScatterChart from '../src/views/data/charts/ScatterChart.vue'
import { stubDialogElement } from './fixtures/image-workers'

type Kind = 'numeric' | 'categorical'
type Column = { name: string; kind: Kind; missing: number; unique: number; samples: string[] }

const WAIT_MS = 10_000

function open(dataset: { columns: string[]; rows: string[][] }, columns: Column[], column: string) {
  return mount(ChartDialog, {
    props: { open: true, kind: 'tabular' as const, dataset, columns, column, randomState: 42 },
    global: { plugins: [i18n] },
  })
}

type Wrapper = ReturnType<typeof open>

async function drawn(wrapper: Wrapper): Promise<void> {
  await vi.waitFor(() => {
    if (
      !wrapper.findComponent({ name: 'Bar' }).exists() &&
      !wrapper.findComponent({ name: 'Scatter' }).exists()
    ) {
      throw new Error('chart not mounted yet')
    }
  }, WAIT_MS)
}

async function pickTool(wrapper: Wrapper, name: string): Promise<void> {
  const button = wrapper
    .find('.grid')
    .findAll('button')
    .find((one) => one.text().startsWith(name))
  expect(button, name).toBeDefined()
  await button?.trigger('click')
  await drawn(wrapper)
}

const column = (name: string, kind: Kind): Column => ({
  name,
  kind,
  missing: 0,
  unique: 0,
  samples: [],
})

beforeEach(() => {
  stubDialogElement()
  i18n.global.locale.value = 'ko'
  applyLimitsOff(false)
})

afterEach(() => {
  applyLimitsOff(false)
})

describe('히스토그램의 손잡이', () => {
  /** 두 열. `a`는 치우쳐 있고 `b`는 고르다 — 자동이 고르는 수가 서로 다르다. */
  const DATASET = {
    columns: ['a', 'b'],
    rows: Array.from({ length: 400 }, (_, i) => [String(i % 7 === 0 ? i * 10 : i % 5), String(i)]),
  }
  const COLUMNS = [column('a', 'numeric'), column('b', 'numeric')]

  interface HistogramInternals {
    auto: boolean
    draft: number
    logarithmic: boolean
    note: string
    blocked: string
    apply: () => void
  }

  async function histogramOf(name = 'a') {
    const wrapper = open(DATASET, COLUMNS, name)
    await drawn(wrapper)
    const chart = wrapper.findComponent(HistogramChart).vm as unknown as HistogramInternals
    const bar = () => wrapper.findComponent({ name: 'Bar' })
    const barCount = () => (bar().props('data') as { labels: unknown[] }).labels.length
    return { wrapper, chart, bar, barCount }
  }

  /** **체크박스가 옵션까지 간다** (H5). 옵션 함수만 물리고 이 이음매는 안 물렸다. */
  it('로그를 켜면 세는 축이 로그가 된다', async () => {
    const { wrapper, chart, bar } = await histogramOf()
    const yType = () =>
      (bar().props('options') as { scales: { y: { type?: string } } }).scales.y.type

    expect(yType()).not.toBe('logarithmic')
    chart.logarithmic = true
    await wrapper.vm.$nextTick()
    expect(yType()).toBe('logarithmic')
  })

  /** **자동인 동안 칸은 numpy가 고른 수를 비춘다** (H1). 학생이 파이썬에 옮겨 적을 값이다. */
  it('자동이면 칸이 그림의 막대 수와 같다', async () => {
    const { chart, barCount } = await histogramOf()
    expect(chart.auto).toBe(true)
    expect(chart.draft).toBe(barCount())
  })

  /**
   * **[적용]을 눌러야 그림에 닿는다** (§8.9.1.1). 치는 동안은 그림이 그대로이고, 누르면 그
   * 수로 그리고, **그림이 자기가 그린 수를 말한다.**
   */
  it('수를 쳐도 [적용] 전에는 그림이 그대로이고, 적용하면 그 수로 그리고 말한다', async () => {
    const { wrapper, chart, barCount } = await histogramOf()
    const before = barCount()

    chart.auto = false
    chart.draft = 5
    await wrapper.vm.$nextTick()
    expect(barCount()).toBe(before)

    chart.apply()
    await wrapper.vm.$nextTick()
    expect(barCount()).toBe(5)
    expect(chart.note).toBe(i18n.global.t('data.charts.histogram.bins', { count: 5 }))
  })

  /** **범위 밖이면 막고 말한다** (H6) — 조용히 당기지 않는다. */
  it('범위 밖의 수는 막는 이유가 선다', async () => {
    const { wrapper, chart } = await histogramOf()
    chart.auto = false
    chart.draft = 0
    await wrapper.vm.$nextTick()
    expect(chart.blocked).not.toBe('')
  })

  /** **자동을 다시 켜면 곧바로 돌아간다** — 돌아가는 길에는 물을 것이 없다(§8.9.1.1). */
  it('자동을 다시 켜면 [적용] 없이 자동 그림으로 돌아간다', async () => {
    const { wrapper, chart, barCount } = await histogramOf()
    const automatic = barCount()
    chart.auto = false
    chart.draft = 5
    chart.apply()
    await wrapper.vm.$nextTick()
    expect(barCount()).toBe(5)

    chart.auto = true
    await wrapper.vm.$nextTick()
    expect(barCount()).toBe(automatic)
    expect(chart.note).toBe('')
  })

  /**
   * **로그 축은 열을 바꿔도 남는다** (B-3, `architecture.md` §8.9.1.1). 구간 수가 따라가는 것과
   * 같은 이유다 — 학생이 고른 설정이다. 창을 닫으면 잊는다(결정문 45).
   */
  it('창 안에서 열을 바꿔도 로그 축이 남는다', async () => {
    const { wrapper, chart, bar } = await histogramOf('a')
    chart.logarithmic = true
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ column: 'b' })
    await drawn(wrapper)
    const yType = (bar().props('options') as { scales: { y: { type?: string } } }).scales.y.type
    expect(yType).toBe('logarithmic')
  })
})

describe('산점도의 아래 한 줄과 범례', () => {
  interface ScatterInternals {
    colorBy: string
    note: string
  }

  /** 상한보다 50행 많다. 스위치를 켜면 표본, 끄면 전부다. */
  function bigDataset(groups: number) {
    return {
      columns: ['x', 'y', 'g'],
      rows: Array.from({ length: DATA_SCATTER_POINT_LIMIT + 50 }, (_, i) => [
        String(i % 97),
        String((i * 7) % 89),
        `갈래${i % groups}`,
      ]),
    }
  }
  const COLUMNS = [column('x', 'numeric'), column('y', 'numeric'), column('g', 'categorical')]

  async function scatterOf(groups: number) {
    const wrapper = open(bigDataset(groups), COLUMNS, 'x')
    await drawn(wrapper)
    await pickTool(wrapper, i18n.global.t('data.charts.scatter.name'))
    const chart = wrapper.findComponent(ScatterChart).vm as unknown as ScatterInternals
    const points = () =>
      (
        wrapper.findComponent({ name: 'Scatter' }).props('data') as {
          datasets: { data: unknown[] }[]
        }
      ).datasets.reduce((sum, set) => sum + set.data.length, 0)
    return { wrapper, chart, points }
  }

  /**
   * **상한 스위치가 표본을 연다** (S4·C-8). 상한을 숫자 리터럴로 박으면 `limits-rules`는
   * 이름을 안 봐서 조용했다 — 여기서는 **스위치를 켜고 끈 결과**를 보므로 운다.
   */
  it('상한이 켜져 있으면 표본을 말하고, 풀면 전부 그리고 그렇게 말한다', async () => {
    const { wrapper, chart, points } = await scatterOf(2)
    const sampled = i18n.global.t('data.charts.scatter.sampled', {
      drawn: DATA_SCATTER_POINT_LIMIT,
      total: DATA_SCATTER_POINT_LIMIT + 50,
    })
    expect(points()).toBe(DATA_SCATTER_POINT_LIMIT)
    expect(chart.note).toContain(sampled)

    applyLimitsOff(true)
    await wrapper.vm.$nextTick()
    expect(points()).toBe(DATA_SCATTER_POINT_LIMIT + 50)
    expect(chart.note).toContain(
      i18n.global.t('data.charts.scatter.drawingAll', { count: DATA_SCATTER_POINT_LIMIT + 50 }),
    )
    expect(chart.note).not.toContain(sampled)
  })

  /**
   * **색이 겹치면 범례를 안 세우고 그렇게 말한다** (결정문 47 · S2·S3). 팔레트는 일곱이다.
   * 갈래가 둘이면 범례가 선다 — 두 쪽을 나란히 둬야 조건이 산다.
   */
  it('갈래가 팔레트보다 많으면 범례를 안 세우고 겹친다고 말한다', async () => {
    const legendOf = (wrapper: Wrapper) =>
      (
        wrapper.findComponent({ name: 'Scatter' }).props('options') as {
          plugins: { legend: { display: boolean } }
        }
      ).plugins.legend.display

    const few = await scatterOf(2)
    few.chart.colorBy = 'g'
    await few.wrapper.vm.$nextTick()
    expect(legendOf(few.wrapper)).toBe(true)
    expect(few.chart.note).not.toContain(
      i18n.global.t('data.charts.scatter.colorsRepeat', { count: 2 }),
    )

    const many = await scatterOf(12)
    many.chart.colorBy = 'g'
    await many.wrapper.vm.$nextTick()
    expect(legendOf(many.wrapper)).toBe(false)
    expect(many.chart.note).toContain(
      i18n.global.t('data.charts.scatter.colorsRepeat', { count: 12 }),
    )
  })
})

/**
 * **범주 축 툴팁의 화면 쪽** (R37 A-3이 남긴 조각 · C-3). 되돌리기는 `chart-config.ts`로
 * 옮겼지만 **셀을 글자로 바꾸는 `coordinate()`는 화면에 남았고 무실행이었다.** 그 함수가
 * `cell.name`을 잘못 읽는 날 툴팁이 `여` 대신 다른 것을 말한다.
 */
describe('범주 축 툴팁이 이름을 말한다', () => {
  it('흩뿌린 점을 가리키면 범주 이름이 나온다', async () => {
    const dataset = {
      columns: ['성별', '키'],
      rows: Array.from({ length: 20 }, (_, i) => [i % 2 === 0 ? '남' : '여', String(150 + i)]),
    }
    const wrapper = open(dataset, [column('성별', 'categorical'), column('키', 'numeric')], '성별')
    await drawn(wrapper)
    await pickTool(wrapper, i18n.global.t('data.charts.scatter.name'))

    const options = wrapper.findComponent({ name: 'Scatter' }).props('options') as {
      plugins: { tooltip: { callbacks: { label: (item: unknown) => string } } }
    }
    // `여`는 범주 목록의 1번 칸이다. 흩뿌려 1.2쯤에 선 점을 가리킨다.
    const label = options.plugins.tooltip.callbacks.label({
      dataset: { label: '데이터' },
      parsed: { x: 1.2, y: 170 },
    })
    expect(label).toContain('여')
    expect(label).not.toContain('1.2')
  })
})
