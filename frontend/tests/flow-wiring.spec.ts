// @vitest-environment jsdom
/**
 * **프로젝트 흐름도를 어디에 어떻게 다는가** (`architecture.md` §8.22, `open-decisions.md` 120).
 *
 * 그림 자체는 `flow-diagram.spec.ts`가 본다. 여기서 보는 것은 **연결**이다 — 카드가 받은 폭에서 그림과
 * 열기 단추를 가르는가, 단추가 데이터가 없을 때 이유와 함께 잠기는가, 창이 앱에 하나인가, 그리고 **그림이
 * 첫 화면의 꾸러미에 계획 코드를 싣지 않는가**(소스를 읽는다 — 번들 크기는 빌드가 아니라 임포트가 정한다).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toRaw } from 'vue'

import FlowCard from '../src/components/flow/FlowCard.vue'
import FlowOpenButton from '../src/components/flow/FlowOpenButton.vue'
import { useFlowDialog } from '../src/composables/useFlowDialog'
import { i18n, setLocale } from '../src/i18n'
import { FLOW_GEOMETRY } from '../src/ml/flow-layout'
import { emptyProjectFile, projectFile } from './fixtures/project'

// 수는 이 검사의 관심이 아니다 — 불렸는지만 본다. 진짜 계획을 돌리지 않는다.
vi.mock('@/ml/flow-counts', () => ({
  flowCountsOf: vi.fn(async () => null),
  flowCountsLite: vi.fn(() => null),
  barValuesOf: vi.fn(() => null),
}))

const SRC = join(process.cwd(), 'src')

beforeEach(async () => {
  await setLocale('ko')
  useFlowDialog().close()
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  vi.clearAllMocks()
})

/** 받은 폭을 정해 준다 — jsdom은 레이아웃을 안 한다. */
function receiving(width: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  })
}

describe('대시보드 카드는 받은 폭이 그림 폭에 닿을 때만 그림을 둔다', () => {
  it('넉넉하면 그림과 [크게 보기]를 둔다', async () => {
    receiving(FLOW_GEOMETRY.width)
    const wrapper = mount(FlowCard, { props: { file: projectFile() }, global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="크게 보기"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('프로젝트 흐름도 열기')
    wrapper.unmount()
  })

  it('한 칸이라도 모자라면 그림 대신 열기 단추 하나만 둔다 — 줄여 그리지 않는다', async () => {
    receiving(FLOW_GEOMETRY.width - 1)
    const wrapper = mount(FlowCard, { props: { file: projectFile() }, global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.find('.bg-surface-sunken').exists()).toBe(false)
    const open = wrapper.find('button[aria-label="프로젝트 흐름도 열기"]')
    expect(open.text()).toBe('열기')
    expect(wrapper.find('button[aria-label="크게 보기"]').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(1)
    // 가로 스크롤도 두지 않는다.
    expect(wrapper.html()).not.toMatch(/overflow-x-(auto|scroll)/)
  })

  it('좁은 폭의 한 줄은 제목이 왼쪽이고 열기 단추가 오른쪽 끝이다', async () => {
    receiving(FLOW_GEOMETRY.width - 1)
    const wrapper = mount(FlowCard, { props: { file: projectFile() }, global: { plugins: [i18n] } })
    await flushPromises()
    const row = wrapper.find('section > div')
    expect(row.classes()).toContain('justify-between')
    expect(row.text()).toContain('프로젝트 흐름도')
    expect(wrapper.find('h2').exists()).toBe(false)
  })

  it('두 단추 모두 같은 창을 열고, 연 단추를 기억한다', async () => {
    receiving(FLOW_GEOMETRY.width - 1)
    const file = projectFile()
    const wrapper = mount(FlowCard, {
      props: { file },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    const button = wrapper.find('button')
    await button.trigger('click')
    const request = useFlowDialog().request.value
    expect(toRaw(request?.file)).toBe(toRaw(file))
    expect(request?.lite).toBe(false)
    expect(request?.opener).toBe(button.element)
    wrapper.unmount()
  })

  it('그림이 보일 때만 수를 구한다', async () => {
    const counts = await import('@/ml/flow-counts')

    receiving(FLOW_GEOMETRY.width - 1)
    const narrow = mount(FlowCard, { props: { file: projectFile() }, global: { plugins: [i18n] } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(counts.flowCountsOf).not.toHaveBeenCalled()
    narrow.unmount()

    receiving(FLOW_GEOMETRY.width)
    const wide = mount(FlowCard, { props: { file: projectFile() }, global: { plugins: [i18n] } })
    await vi.waitFor(() => expect(counts.flowCountsOf).toHaveBeenCalledTimes(1))
    wide.unmount()
  })

  it('데이터가 없으면 카드가 서지 않는다', () => {
    receiving(FLOW_GEOMETRY.width)
    const wrapper = mount(FlowCard, {
      props: { file: emptyProjectFile() },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('section').exists()).toBe(false)
  })
})

describe('단추는 데이터가 없으면 이유와 함께 잠긴다', () => {
  it('데이터가 있으면 누르는 대로 창을 연다', async () => {
    const file = projectFile()
    const wrapper = mount(FlowOpenButton, {
      props: { file },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    expect(wrapper.text()).toContain('프로젝트 흐름도')
    expect(wrapper.find('button').attributes('aria-disabled')).toBeUndefined()
    await wrapper.find('button').trigger('click')
    expect(useFlowDialog().request.value).toMatchObject({ file, lite: false })
    wrapper.unmount()
  })

  it('점검이면 행 수 없이 그리라고 알린다', async () => {
    const wrapper = mount(FlowOpenButton, {
      props: { file: projectFile(), lite: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await wrapper.find('button').trigger('click')
    expect(useFlowDialog().request.value?.lite).toBe(true)
    wrapper.unmount()
  })

  it('데이터가 없으면 숨기지 않고 잠근다 — 눌러도 창이 안 열리고 이유가 선다', async () => {
    const wrapper = mount(FlowOpenButton, {
      props: { file: emptyProjectFile() },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-disabled')).toBe('true')
    await button.trigger('click')
    expect(useFlowDialog().request.value).toBeNull()
    expect(document.body.textContent).toContain('데이터를 먼저 불러와 주세요.')
    wrapper.unmount()
  })

  it('compact는 글자를 좁은 폭에서 숨기고 이름은 남긴다', () => {
    const wrapper = mount(FlowOpenButton, {
      props: { file: projectFile(), compact: true },
      global: { plugins: [i18n] },
    })
    expect(wrapper.find('button').attributes('aria-label')).toBe('프로젝트 흐름도')
    expect(wrapper.find('span').classes()).toContain('max-md:hidden')
  })
})

describe('창은 앱에 하나다', () => {
  it('열면 요청이 서고 닫으면 연 단추를 돌려준다', () => {
    const dialog = useFlowDialog()
    const opener = document.createElement('button')
    dialog.open(projectFile(), { opener })
    expect(dialog.request.value?.opener).toBe(opener)
    expect(dialog.close()).toBe(opener)
    expect(dialog.request.value).toBeNull()
  })

  it('요소가 아닌 것은 연 단추로 안 받는다', () => {
    const dialog = useFlowDialog()
    dialog.open(projectFile(), { opener: window })
    expect(dialog.request.value?.opener).toBeNull()
    dialog.close()
  })

  it('두 번 열면 하나가 남는다 — 요청이 둘이 되지 않는다', () => {
    const dialog = useFlowDialog()
    const first = projectFile()
    const second = projectFile()
    dialog.open(first)
    dialog.open(second, { lite: true })
    expect(dialog.request.value?.file).toBe(second)
    expect(dialog.request.value?.lite).toBe(true)
    dialog.close()
  })
})

// ------------------------------------------------------------------ 소스를 읽는 검사

function sourcesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name)
    if (entry.isDirectory()) return sourcesIn(full)
    return /\.(vue|ts)$/.test(entry.name) ? [full] : []
  })
}

/** 정적으로 들이는 모듈(`import type`과 동적 `import()`는 아니다). */
function staticImports(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(
    (hit) => hit[1] ?? '',
  )
}

/** 이 파일들의 코드에서 주석을 걷는다 — 규칙을 가리키는 주석은 옳은 일이다. */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FLOW_DIR = join(SRC, 'components', 'flow')

/** 흐름도 코드와 그것을 다는 자리들. 첫 화면의 꾸러미에 실리는 쪽이다. */
const EAGER = [
  ...sourcesIn(FLOW_DIR),
  join(SRC, 'components', 'FlowButton.vue'),
  join(SRC, 'components', 'FlowHost.vue'),
  join(SRC, 'components', 'AppToolbar.vue'),
  join(SRC, 'composables', 'useFlowCounts.ts'),
  join(SRC, 'composables', 'useFlowDialog.ts'),
  join(SRC, 'views', 'ProjectHomeView.vue'),
  join(SRC, 'views', 'InspectView.vue'),
  join(SRC, 'App.vue'),
].filter((path) => !path.endsWith('FlowDialog.vue') && !path.endsWith('FlowCanvas.vue'))

describe('첫 화면의 꾸러미에 계획 코드가 안 실린다', () => {
  const HEAVY = [
    '@/ml/flow-counts',
    '@/ml/plan',
    '@/ml/plan-cache',
    '@/ml/experiment',
    '@/ml/training-source',
  ]

  it('훑을 파일이 실제로 있다', () => {
    expect(EAGER.length).toBeGreaterThanOrEqual(10)
  })

  for (const path of EAGER) {
    it(`${path.slice(SRC.length + 1)}가 수 계산을 정적으로 들이지 않는다`, () => {
      const imported = staticImports(code(path))
      for (const heavy of HEAVY) expect(imported, heavy).not.toContain(heavy)
    })
  }

  it('수 계산은 지연 로딩 한 자리에서만 부른다', () => {
    expect(code(join(SRC, 'composables', 'useFlowCounts.ts'))).toContain(
      "import('@/ml/flow-counts')",
    )
  })

  it('창은 어디서도 정적으로 들이지 않는다 — 지연 로딩이다', () => {
    const offenders = sourcesIn(SRC).filter((path) =>
      staticImports(code(path)).some((module) => module.endsWith('flow/FlowDialog.vue')),
    )
    expect(offenders).toEqual([])
    expect(code(join(SRC, 'components', 'FlowHost.vue'))).toMatch(
      /defineAsyncComponent\(\(\) => import\('@\/components\/flow\/FlowDialog\.vue'\)\)/,
    )
  })

  it('검사기가 정적 임포트를 가른다', () => {
    expect(staticImports("import { a } from '@/ml/plan'")).toEqual(['@/ml/plan'])
    expect(staticImports("import type { A } from '@/ml/plan'")).toEqual([])
    expect(staticImports("const m = await import('@/ml/plan')")).toEqual([])
    expect(staticImports("import {\n  a,\n  b,\n} from '@/ml/plan-cache'")).toEqual([
      '@/ml/plan-cache',
    ])
  })
})

describe('그림의 규칙', () => {
  const FILES = sourcesIn(FLOW_DIR)

  it('훑을 파일이 실제로 있다', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5)
  })

  const RULES: readonly [string, RegExp][] = [
    ['색을 hex로 적지 않는다', /#[0-9a-fA-F]{3,8}\b(?!\$)/],
    ['<style>을 두지 않는다', /<style\b/],
    ['색을 실행 중에 읽지 않는다', /getComputedStyle/],
    ['배색을 속성에서 읽지 않는다', /data-theme/],
    ['SVG에 글자를 두지 않는다', /<text\b/],
    ['종류를 화면에서 견주지 않는다', /\b(dataType|taskType)\s*[!=]==?/],
    ['스토어를 읽지 않는다', /useProjectStore|stores\/project/],
  ]

  for (const path of FILES) {
    it(`${path.slice(SRC.length + 1)}가 규칙을 지킨다`, () => {
      const source = code(path)
      for (const [name, pattern] of RULES) expect(source, name).not.toMatch(pattern)
    })
  }

  it('검사기가 위반을 잡는다', () => {
    expect('fill="#ff0000"').toMatch(RULES[0]![1])
    expect('<style scoped>').toMatch(RULES[1]![1])
    expect("if (file.dataType === 'tabular')").toMatch(RULES[5]![1])
    expect('url(#${uid}-m-train)').not.toMatch(RULES[0]![1])
  })
})
