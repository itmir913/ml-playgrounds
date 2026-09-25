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
import { DATA_SCATTER_POINT_LIMIT, HISTOGRAM_BIN_LIMIT } from '../src/limits'
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
  // jsdom에는 없다. 시각화 창이 도구를 고르면 그림으로 데려간다(`ChartDialog`의 `pickTool`).
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
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

  /** 읽기만 한다 — 그림이 자기가 그린 수를 말하는 한 줄. */
  interface HistogramInternals {
    note: string
  }

  /**
   * **손잡이는 학생이 만지는 요소로 만진다** (2026-09-23 R38-V V-C1). 처음에는 `chart.draft = 5`
   * 처럼 안쪽 값을 넣고 `chart.apply()`를 불렀는데, 그러면 칸의 `v-model`이나 [적용]의
   * `@click`을 끊어도 초록이었다(V1~V5 조용). 이제 체크박스는 `setValue`, 칸은 `setValue`,
   * 단추는 `trigger('click')`다. 안쪽 값(`chart`)은 **읽기만** 한다.
   */
  async function histogramOf(name = 'a') {
    const wrapper = open(DATASET, COLUMNS, name)
    await drawn(wrapper)
    const chart = wrapper.findComponent(HistogramChart).vm as unknown as HistogramInternals
    const bar = () => wrapper.findComponent({ name: 'Bar' })
    const barCount = () => (bar().props('data') as { labels: unknown[] }).labels.length
    const checkbox = (key: string) => {
      const label = wrapper.findAll('label').find((one) => one.text() === i18n.global.t(key))
      expect(label, key).toBeDefined()
      return label!.find('input[type="checkbox"]')
    }
    const binInput = () => wrapper.find('input[type="number"]')
    const applyButton = () =>
      wrapper
        .findAll('button')
        .find((one) => one.text() === i18n.global.t('data.charts.histogram.binApply'))
    const logBox = () => checkbox('data.charts.histogram.logScale')
    const autoBox = () => checkbox('data.charts.histogram.binAuto')
    return { wrapper, chart, bar, barCount, binInput, applyButton, logBox, autoBox }
  }

  /** **체크박스가 옵션까지 간다** (H5 · V1). 옵션 함수만 물리고 이 이음매는 안 물렸다. */
  it('로그를 켜면 세는 축이 로그가 된다', async () => {
    const { bar, logBox } = await histogramOf()
    const yType = () =>
      (bar().props('options') as { scales: { y: { type?: string } } }).scales.y.type

    expect(yType()).not.toBe('logarithmic')
    await logBox().setValue(true)
    expect(yType()).toBe('logarithmic')
  })

  /** **자동인 동안 칸은 numpy가 고른 수를 비춘다** (H1). 학생이 파이썬에 옮겨 적을 값이다. */
  it('자동이면 칸이 그림의 막대 수와 같다', async () => {
    const { binInput, barCount, autoBox, applyButton } = await histogramOf()
    expect((autoBox().element as HTMLInputElement).checked).toBe(true)
    expect(Number((binInput().element as HTMLInputElement).value)).toBe(barCount())
    // 자동일 때는 단추 자체가 없다 (§8.9.1.1).
    expect(applyButton()).toBeUndefined()
  })

  /**
   * **[적용]을 눌러야 그림에 닿는다** (§8.9.1.1 · V2 · V3 · V4). 치는 동안은 그림이 그대로이고,
   * 누르면 그 수로 그리고, **그림이 자기가 그린 수를 말한다.**
   */
  it('수를 쳐도 [적용] 전에는 그림이 그대로이고, 적용하면 그 수로 그리고 말한다', async () => {
    const { chart, barCount, binInput, applyButton, autoBox } = await histogramOf()
    const before = barCount()

    await autoBox().setValue(false)
    await binInput().setValue('5')
    expect(barCount()).toBe(before)

    await applyButton()!.trigger('click')
    expect(barCount()).toBe(5)
    expect(chart.note).toBe(i18n.global.t('data.charts.histogram.bins', { count: 5 }))
  })

  /** **범위 밖이면 막고 말하고, 단추가 잠긴다** (H6 · V5) — 조용히 당기지 않는다. */
  it('범위 밖의 수는 막는 이유가 서고 [적용]이 잠긴다', async () => {
    const { wrapper, barCount, binInput, applyButton, autoBox } = await histogramOf()
    const before = barCount()
    await autoBox().setValue(false)
    await binInput().setValue('0')

    const reason = i18n.global.t('data.charts.histogram.binInvalid', {
      min: 1,
      max: HISTOGRAM_BIN_LIMIT,
    })
    expect(wrapper.text()).toContain(reason)
    expect(applyButton()!.attributes('disabled')).toBeDefined()
    await applyButton()!.trigger('click')
    expect(barCount()).toBe(before)
  })

  /** **자동을 다시 켜면 곧바로 돌아간다** — 돌아가는 길에는 물을 것이 없다(§8.9.1.1). */
  it('자동을 다시 켜면 [적용] 없이 자동 그림으로 돌아간다', async () => {
    const { chart, barCount, binInput, applyButton, autoBox } = await histogramOf()
    const automatic = barCount()
    await autoBox().setValue(false)
    await binInput().setValue('5')
    await applyButton()!.trigger('click')
    expect(barCount()).toBe(5)

    await autoBox().setValue(true)
    expect(barCount()).toBe(automatic)
    expect(chart.note).toBe('')
  })

  /**
   * **자동을 켠 것이 학생이 고른 수를 지우지 않는다** (`open-decisions.md` 55 표의 6, R38-D55
   * B-4, `architecture.md` §8.9.1.1). 칸은 자동인 동안 자동의 수를 비추는데, 전에는 그 비춤이
   * 학생의 수를 덮어써서 끄면 자동이 고른 수에서 시작했다.
   */
  it('자동을 켰다 끄면 학생이 고른 구간 수로 돌아온다', async () => {
    const { barCount, binInput, applyButton, autoBox } = await histogramOf()
    const automatic = barCount()
    expect(automatic, 'the chosen number must differ from auto').not.toBe(5)
    await autoBox().setValue(false)
    await binInput().setValue('5')
    await applyButton()!.trigger('click')

    await autoBox().setValue(true)
    expect(Number((binInput().element as HTMLInputElement).value)).toBe(automatic)

    await autoBox().setValue(false)
    expect(barCount()).toBe(5)
    expect(Number((binInput().element as HTMLInputElement).value)).toBe(5)
  })

  /** 고른 적이 없으면 끄는 것만으로는 그림이 안 바뀐다(결정문 45) — 위 판의 짝이다. */
  it('고른 적이 없으면 자동을 꺼도 그림과 칸이 자동의 수 그대로다', async () => {
    const { barCount, binInput, autoBox } = await histogramOf()
    const automatic = barCount()
    await autoBox().setValue(false)
    expect(barCount()).toBe(automatic)
    expect(Number((binInput().element as HTMLInputElement).value)).toBe(automatic)
  })

  /**
   * **로그 축은 열을 바꿔도 남는다** (B-3, `architecture.md` §8.9.1.1). 구간 수가 따라가는 것과
   * 같은 이유다 — 학생이 고른 설정이다. 창을 닫으면 잊는다(결정문 45).
   */
  it('창 안에서 열을 바꿔도 로그 축이 남는다', async () => {
    const { wrapper, bar, logBox } = await histogramOf('a')
    await logBox().setValue(true)

    await wrapper.setProps({ column: 'b' })
    await drawn(wrapper)
    const yType = (bar().props('options') as { scales: { y: { type?: string } } }).scales.y.type
    expect(yType).toBe('logarithmic')
  })
})

/**
 * **박스 플롯의 가르기는 열을 바꿔도 남는다** (2026-09-23 R38-V V-B1, `architecture.md`
 * §8.9.1.1). 전에는 열이 바뀔 때마다 풀었고, 그 줄을 지워도 **조용했다**(R38 B1).
 */
describe('박스 플롯의 가르기', () => {
  const DATASET = {
    columns: ['a', 'b', 'g'],
    rows: Array.from({ length: 60 }, (_, i) => [
      String(i),
      String(i * 3),
      i % 2 === 0 ? '남' : '여',
    ]),
  }
  const COLUMNS = [column('a', 'numeric'), column('b', 'numeric'), column('g', 'categorical')]

  it('창 안에서 열을 바꿔도 가르기가 남는다', async () => {
    const wrapper = open(DATASET, COLUMNS, 'a')
    await drawn(wrapper)
    await pickTool(wrapper, i18n.global.t('data.charts.box.name'))
    const boxes = () =>
      (wrapper.findComponent({ name: 'Bar' }).props('data') as { labels: unknown[] }).labels

    // 학생이 **선택기로** 가른다.
    const groupBy = wrapper
      .findAll('label')
      .find((one) => one.text().startsWith(i18n.global.t('data.charts.box.groupBy')))
      ?.find('select')
    expect(groupBy?.exists(), 'group-by select').toBe(true)
    await groupBy!.setValue('g')
    expect(boxes()).toEqual(['남', '여'])

    await wrapper.setProps({ column: 'b' })
    await drawn(wrapper)
    // 같은 가르기로 새 열을 그린다 — 선택기도 그 값을 들고 있다.
    expect(boxes()).toEqual(['남', '여'])
    expect((groupBy!.element as HTMLSelectElement).value).toBe('g')
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
