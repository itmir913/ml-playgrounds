// @vitest-environment jsdom
/**
 * **프로젝트 흐름도의 그림이 화면에 서는가** (`components/flow/FlowDiagram.vue`, `architecture.md` §8.22).
 *
 * 순수 판단(`flow-view.spec.ts`, `flow-hover.spec.ts`)은 따로 있다. 여기서 보는 것은 그 판단이 **DOM에 닿는
 * 모양**이다 — SVG 층이 보조 기술에서 빠지는가, 눌러서 닿는 것이 HTML 단추인가, 탭 순서가 파랑 다음 회색인가,
 * 누르면 고정되고 다시 누르면 풀리는가, 마우스가 지나갈 때 깜빡이지 않는가.
 *
 * 레이아웃은 jsdom이 안 해서 크기는 못 잰다 — 누르는 자리의 크기는 스타일로 준 값을 읽는다.
 */

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FlowDiagram from '../src/components/flow/FlowDiagram.vue'
import { i18n, setLocale } from '../src/i18n'
import type { FlowCounts } from '../src/ml/flow-counts'
import { flowModelOf } from '../src/ml/flow'
import { highlightOf } from '../src/ml/flow-highlight'
import { FLOW_GEOMETRY, layoutOf } from '../src/ml/flow-layout'
import { targetOf } from '../src/ml/flow-view'
import { factsOf } from '../src/project/facts'
import { FLOW_HOVER_LINGER_MS, FLOW_HOVER_RELEASE_MS } from '../src/limits'
import { FLOW_CASES, withRuns, withTask } from './fixtures/flow-cases'
import { projectFile } from './fixtures/project'

const COUNTS: FlowCounts = {
  total: 150,
  usable: 126,
  sampled: 120,
  train: 96,
  test: 24,
  unusable: 24,
  notDrawn: 6,
  featureCount: 4,
  prep: 'preprocess',
  testFile: null,
}

const BARS = { train: 96, test: 24, gray: 30, testFile: null }

function mountDiagram(props: Record<string, unknown> = {}) {
  const wrapper = mount(FlowDiagram, {
    props: {
      file: projectFile(),
      counts: COUNTS,
      bars: BARS,
      pinned: null,
      'onUpdate:pinned': (value: string | null) => wrapper.setProps({ pinned: value }),
      ...props,
    },
    global: { plugins: [i18n] },
  })
  return wrapper
}

beforeEach(async () => {
  await setLocale('ko')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SVG 층과 HTML 층', () => {
  it('SVG는 보조 기술에서 빠지고 글자를 담지 않는다', () => {
    const svg = mountDiagram().find('svg')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.findAll('text')).toEqual([])
    // 눌러서 닿는 것은 SVG 안에 없다 — 잠금 낱말이 SVG 노드의 초점 이동을 막는다.
    expect(svg.findAll('button')).toEqual([])
  })

  it('눌러서 닿는 것은 전부 HTML 단추이고 이름이 있다', () => {
    const buttons = mountDiagram().findAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(10)
    for (const [at, button] of buttons.entries()) {
      const name = button.attributes('aria-label') ?? button.text()
      expect(name.trim(), `button #${at}`).not.toBe('')
    }
  })

  it('번역된 글자가 보인다 — 분할 줄은 한 키다', () => {
    const text = mountDiagram().text()
    for (const [at, word] of [
      '전체 데이터',
      '훈련 데이터',
      '새 데이터',
      '데이터 전처리',
      '학습',
      '결과',
      '예측',
    ].entries()) {
      expect(text, `translated label #${at}`).toContain(word)
    }
    expect(text).toContain('분할')
    expect(text).toContain('분할 80 : 20')
    expect(text).toContain('훈련 데이터 기준')
    // 문자열을 HTML로 넣지 않는다.
    expect(text).not.toContain('<b>')
  })

  it('수를 모르면 칩이 수 없는 낱말로 남는다', () => {
    const wrapper = mountDiagram({ counts: null, bars: null })
    expect(wrapper.text()).not.toContain('특성 4개')
    expect(wrapper.text()).toContain('특성')
  })

  it('특성을 안 골랐으면 새 데이터 카드의 칩도 전체 데이터 카드처럼 수 없이 비운다', () => {
    const wrapper = mountDiagram({ counts: { ...COUNTS, featureCount: 0 } })
    expect(wrapper.text()).not.toContain('특성 0개')
    expect(wrapper.text()).not.toContain('특성 4개')
    // 두 카드의 칩이 모두 점선 빈 칩이다.
    expect(wrapper.findAll('.flow-chip-pending').length).toBeGreaterThanOrEqual(2)
  })

  it('수를 알면 특성 수와 행 수가 선다', () => {
    const text = mountDiagram().text()
    expect(text).toContain('특성 4개')
    expect(text).toContain('150행')
  })

  it('영어와 일본어에서도 키가 그대로 뜨지 않는다', async () => {
    for (const tag of ['en', 'ja']) {
      await setLocale(tag as 'en' | 'ja')
      const text = mountDiagram().text()
      expect(text, tag).not.toMatch(/\bflow\./)
      expect(text, tag).not.toMatch(/\b(steps|preprocess|results|meta)\./)
    }
  })
})

describe('아직 안 한 일의 윤곽은 한 문법이다', () => {
  it('상자·원·칩·카드·막대·점선 간선이 같은 굵기와 같은 점선을 쓴다', () => {
    // 수를 모르고 학습 전인 프로젝트 — 윤곽이 가장 많이 서는 상태다.
    const wrapper = mountDiagram({
      file: withRuns(withTask(projectFile(), undefined), []),
      counts: { ...COUNTS, featureCount: 0 },
      bars: null,
    })
    const dash = `${FLOW_GEOMETRY.pendingDashOn} ${FLOW_GEOMETRY.pendingDashOff}`
    // HTML 안에 겹친 윤곽: 선을 두 배로 긋고 바깥 절반을 잘라 남는 안쪽이 pendingStroke다.
    const overlays = wrapper.findAll('rect.flow-outline')
    expect(overlays.length).toBeGreaterThanOrEqual(3)
    for (const [at, rect] of overlays.entries()) {
      expect(rect.attributes('stroke-width'), `outline #${at}`).toBe(
        String(FLOW_GEOMETRY.pendingStroke * 2),
      )
      expect(rect.attributes('stroke-dasharray')).toBe(dash)
    }
    // SVG 층의 윤곽: 점선 카드와 윤곽 막대, 그리고 점선 간선.
    const layered = wrapper.findAll('svg .flow-card-pending, svg .flow-bar-outline')
    expect(layered.length).toBeGreaterThanOrEqual(2)
    for (const shape of layered) {
      expect(shape.attributes('stroke-width')).toBe(String(FLOW_GEOMETRY.pendingStroke))
      expect(shape.attributes('stroke-dasharray')).toBe(dash)
    }
    const dashedLines = wrapper.findAll('svg path[stroke-dasharray]:not([stroke-opacity])')
    expect(dashedLines.length).toBeGreaterThan(0)
    for (const line of dashedLines) expect(line.attributes('stroke-dasharray')).toBe(dash)
    // 어디에도 HTML의 점선 테두리가 남지 않는다.
    expect(wrapper.html()).not.toMatch(/border-dashed/)
  })
})

describe('경로 강조는 꺼진 것을 모두 흐리고 켜진 것은 안 흐린다', () => {
  // 모든 경우 × 모든 강조 대상: highlight가 꺼진 것으로 낸 노드와 카드는 DOM에서 흐림 클래스를 갖고, 켜진 것은 갖지 않는다.
  for (const one of FLOW_CASES) {
    const file = one.build()
    const model = flowModelOf(file, factsOf(file), 'preprocess')
    if (model === null) continue
    it(`경우 ${one.no} ${one.title}`, async () => {
      const wrapper = mountDiagram({ file, counts: { ...COUNTS, featureCount: 4 }, bars: null })
      const targets = [...model.nodes.map((node) => node.id as string), 'file:gray']
      const cards = model.cards
      const rects = wrapper.findAll('svg rect.flow-card, svg rect.flow-card-pending')
      const heads = wrapper.findAll('div.flow-fade.h-6.flex')
      const chipRows = wrapper.findAll('div.grid.flow-fade')
      expect(rects.length).toBe(cards.length)
      expect(heads.length).toBe(cards.length)
      expect(chipRows.length).toBe(cards.length)
      for (const target of targets) {
        await wrapper.setProps({ pinned: target })
        const lit = highlightOf(model, targetOf(target))
        cards.forEach((card, at) => {
          const expectedDim = lit.segments === null ? !lit.nodes.has(card.node) : true
          for (const [part, element] of [
            ['outline', rects[at]!],
            ['head', heads[at]!],
            ['chips', chipRows[at]!],
          ] as const) {
            expect(
              element.classes().includes('flow-dim'),
              `case ${one.no} highlight ${target}: ${card.id} card ${part}`,
            ).toBe(expectedDim)
          }
        })
      }
    })
  }

  /**
   * **선은 지나간 선만 켠다**(결정 120) — 순수 함수(`flow-highlight.spec.ts`)만 보면 선의 `g`가 그 판단에 묶였는지
   * 모른다. 선 묶음 가운데 흐려지지 않은 것의 수가 강조가 켠 선(배치의 선 가운데 그 키가 켜진 것)의 수와 같아야 한다.
   */
  for (const one of FLOW_CASES) {
    const file = one.build()
    const model = flowModelOf(file, factsOf(file), 'preprocess')
    if (model === null) continue
    it(`경우 ${one.no}: 흐려지지 않은 선이 켜진 간선과 같은 수다`, async () => {
      const wrapper = mountDiagram({ file, counts: { ...COUNTS, featureCount: 4 }, bars: null })
      const lines = () =>
        wrapper
          .findAll('svg g.flow-fade')
          .filter((group) => !group.classes().some((name) => name.startsWith('flow-tint')))
          .filter((group) => group.find(':scope > path.flow-stroke').exists())
      const drawn = layoutOf(model, {
        bars: null,
        testSize: file.document.settings.split.testSize,
        chipWrap: false,
      }).lines
      expect(lines().length, `case ${one.no}: line groups`).toBe(drawn.length)
      for (const target of [...model.nodes.map((node) => node.id as string), 'file:gray']) {
        await wrapper.setProps({ pinned: target })
        const lit = highlightOf(model, targetOf(target))
        const expected = drawn.filter((line) => lit.edges.has(line.key))
        const undimmed = lines().filter((group) => !group.classes().includes('flow-dim'))
        expect(undimmed.length, `case ${one.no} highlight ${target}: lit lines`).toBe(
          expected.length,
        )
      }
    })
  }

  it('겹친 점선 윤곽은 모두 흐려지는 조상(상자·원·칩 줄) 안에 선다', async () => {
    const wrapper = mountDiagram({
      file: withRuns(withTask(projectFile(), undefined), []),
      counts: { ...COUNTS, featureCount: 0 },
      bars: null,
    })
    expect(wrapper.findAll('rect.flow-outline').length).toBeGreaterThan(0)
    for (const [at, outline] of wrapper.findAll('rect.flow-outline').entries()) {
      expect(outline.element.closest('.flow-fade'), `outline #${at}`).not.toBeNull()
    }
  })
})

describe('탭 순서와 누르는 자리', () => {
  it('파일 막대에서 파란 조각 다음에 회색 조각이 온다', () => {
    const names = mountDiagram()
      .findAll('button')
      .map((button) => button.attributes('aria-label'))
    const used = names.indexOf('사용하는 데이터')
    const gray = names.indexOf('사용하지 않는 데이터')
    expect(used).toBeGreaterThanOrEqual(0)
    expect(gray).toBeGreaterThan(used)
  })

  it('막대 조각의 누르는 자리는 한 변이 최소 크기 이상이다', () => {
    const hits = mountDiagram()
      .findAll('button')
      .filter((button) =>
        ['사용하는 데이터', '사용하지 않는 데이터', '훈련 데이터', '테스트 데이터'].includes(
          button.attributes('aria-label') ?? '',
        ),
      )
    expect(hits.length).toBeGreaterThanOrEqual(4)
    for (const [at, hit] of hits.entries()) {
      const element = hit.element as HTMLElement
      expect(parseFloat(element.style.width), `hit #${at} width`).toBeGreaterThanOrEqual(
        FLOW_GEOMETRY.hitMin,
      )
      expect(parseFloat(element.style.height), `hit #${at} height`).toBeGreaterThanOrEqual(
        FLOW_GEOMETRY.hitMin,
      )
    }
  })
})

describe('누르면 고정하고 다시 누르면 푼다', () => {
  it('노드를 누르면 고정되고 같은 노드를 다시 누르면 풀린다', async () => {
    const wrapper = mountDiagram()
    const learn = wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!
    expect(learn.attributes('aria-pressed')).toBe('false')

    await learn.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    expect(learn.attributes('aria-pressed')).toBe('true')

    await learn.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual([null])
    expect(learn.attributes('aria-pressed')).toBe('false')
  })

  it('다른 노드를 누르면 고정이 그쪽으로 옮겨 간다', async () => {
    const wrapper = mountDiagram()
    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text().startsWith('학습'))!.trigger('click')
    await buttons.find((button) => button.text() === '결과')!.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['eval'])
  })

  it('빈 곳을 누르면 풀린다', async () => {
    const wrapper = mountDiagram()
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('학습'))!
      .trigger('click')
    await wrapper.find('div').trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual([null])
  })

  it('담은 쪽이 고정을 풀면(Esc) 안의 상태도 풀린다', async () => {
    const wrapper = mountDiagram()
    const learn = wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!
    await learn.trigger('click')
    expect(wrapper.findAll('.flow-dim').length).toBeGreaterThan(0)
    await wrapper.setProps({ pinned: null })
    // 마우스가 노드 밖이므로 풀림은 곧장이다.
    expect(learn.attributes('aria-pressed')).toBe('false')
    expect(wrapper.findAll('.flow-dim')).toEqual([])
  })

  it('고정해 둔 동안은 가리킴이 대상을 못 바꾼다', async () => {
    const wrapper = mountDiagram()
    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text().startsWith('학습'))!.trigger('click')
    const before = wrapper.findAll('.flow-dim').length
    await buttons.find((button) => button.text() === '결과')!.trigger('pointerenter')
    expect(wrapper.findAll('.flow-dim').length).toBe(before)
  })
})

/**
 * **키보드로 닿아도 마우스를 올린 것과 같다** — 상자·원·새 데이터 카드·막대 조각 네 갈래가 모두 `focus`에 강조를
 * 켜고 `blur` 뒤에 푼다. 마우스 검사(`pointerenter`)만으로는 이 길을 지우거나 엇걸어도 모른다.
 */
describe('초점이 오면 강조하고 떠나면 푼다', () => {
  it('누르는 자리마다 focus에 흐림이 생기고 blur 뒤에 사라진다', async () => {
    vi.useFakeTimers()
    const wrapper = mountDiagram()
    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(5)
    for (const [at, button] of buttons.entries()) {
      await button.trigger('focus')
      expect(wrapper.findAll('.flow-dim').length, `button #${at} focus`).toBeGreaterThan(0)
      await button.trigger('blur')
      await vi.runAllTimersAsync()
      expect(wrapper.findAll('.flow-dim'), `button #${at} blur`).toEqual([])
    }
    vi.useRealTimers()
  })
})

describe('마우스를 올리면 강조만 하고 풀림은 늦춘다', () => {
  it('올리면 흐려지는 것이 생기고, 내려도 곧장은 안 풀린다', async () => {
    vi.useFakeTimers()
    const wrapper = mountDiagram()
    const learn = wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!
    expect(wrapper.findAll('.flow-dim')).toEqual([])

    await learn.trigger('pointerenter')
    expect(wrapper.findAll('.flow-dim').length).toBeGreaterThan(0)

    await wrapper.trigger('pointerleave')
    expect(wrapper.findAll('.flow-dim').length).toBeGreaterThan(0)

    vi.advanceTimersByTime(FLOW_HOVER_RELEASE_MS + 1)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.flow-dim')).toEqual([])
  })

  it('노드에서 그림 안의 빈 곳으로 나가 머물면 조금 뒤에 풀린다 — 짧은 순간에는 유지된다', async () => {
    vi.useFakeTimers()
    const wrapper = mountDiagram()
    const learn = wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!
    await learn.trigger('pointerenter')
    await learn.trigger('pointerleave')
    vi.advanceTimersByTime(FLOW_HOVER_RELEASE_MS + 1)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.flow-dim').length).toBeGreaterThan(0)
    vi.advanceTimersByTime(FLOW_HOVER_LINGER_MS)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.flow-dim')).toEqual([])
  })

  it('그림 밖으로 나가면 짧은 지연 뒤에 풀린다', async () => {
    vi.useFakeTimers()
    const wrapper = mountDiagram()
    const learn = wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!
    await learn.trigger('pointerenter')
    await learn.trigger('pointerleave')
    await wrapper.trigger('pointerleave')
    vi.advanceTimersByTime(FLOW_HOVER_RELEASE_MS + 1)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.flow-dim')).toEqual([])
  })

  it('틈을 지나 다음 노드에 들어서면 풀림이 취소된다', async () => {
    vi.useFakeTimers()
    const wrapper = mountDiagram()
    const buttons = wrapper.findAll('button')
    const learn = buttons.find((button) => button.text().startsWith('학습'))!
    const result = buttons.find((button) => button.text() === '결과')!

    await learn.trigger('pointerenter')
    await wrapper.trigger('pointerleave')
    vi.advanceTimersByTime(FLOW_HOVER_RELEASE_MS - 20)
    await result.trigger('pointerenter')
    vi.advanceTimersByTime(FLOW_HOVER_RELEASE_MS * 2)
    await wrapper.vm.$nextTick()
    // 낡은 시간이 새 강조를 지우지 않았다.
    expect(wrapper.findAll('.flow-dim').length).toBeGreaterThan(0)
  })

  it('전환은 불투명도뿐이다 — 흐려지는 요소가 같은 전환 클래스를 갖는다', async () => {
    const wrapper = mountDiagram()
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('학습'))!
      .trigger('pointerenter')
    for (const [at, dimmed] of wrapper.findAll('.flow-dim').entries()) {
      expect(dimmed.classes(), `dimmed #${at}`).toContain('flow-fade')
    }
  })
})
