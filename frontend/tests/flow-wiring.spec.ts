// @vitest-environment jsdom
/**
 * **프로젝트 흐름도를 어디에 어떻게 다는가** (`architecture.md` §8.22, `open-decisions.md` 120).
 *
 * 그림 자체는 `flow-diagram.spec.ts`가 본다. 여기서 보는 것은 **연결**이다 — 카드가 받은 폭에서 그림과
 * 열기 단추를 가르는가, 단추가 데이터가 없을 때 이유와 함께 잠기는가, 창이 앱에 하나인가, 그리고 **그림이
 * 첫 화면의 꾸러미에 계획 코드를 싣지 않는가**(소스를 읽는다 — 번들 크기는 빌드가 아니라 임포트가 정한다).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

  it('넉넉한 폭의 [크게 보기]도 같은 창을 열고 연 단추를 기억한다', async () => {
    receiving(FLOW_GEOMETRY.width)
    const file = projectFile()
    const wrapper = mount(FlowCard, {
      props: { file },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()
    const button = wrapper.find('button[aria-label="크게 보기"]')
    await button.trigger('click')
    const request = useFlowDialog().request.value
    expect(toRaw(request?.file)).toBe(toRaw(file))
    expect(request?.lite).toBe(false)
    expect(request?.opener).toBe(button.element)
    wrapper.unmount()
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

/**
 * 정적으로 들이는 모듈(`import type`과 동적 `import()`는 아니다). **재수출(`export … from`)과 부수효과 임포트
 * (`import '…'`)도 꾸러미에 싣는다** — 셋을 다 센다.
 */
function staticImports(source: string): string[] {
  const patterns = [
    /^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm,
    /^export\s+(?!type\b)(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+'([^']+)'/gm,
    /^import\s+'([^']+)'/gm,
  ]
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((hit) => hit[1] ?? ''))
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
    expect(staticImports("export { a } from '@/ml/plan'")).toEqual(['@/ml/plan'])
    expect(staticImports("export * from '@/ml/plan'")).toEqual(['@/ml/plan'])
    expect(staticImports("export type { A } from '@/ml/plan'")).toEqual([])
    expect(staticImports("import '@/ml/plan'")).toEqual(['@/ml/plan'])
    expect(staticImports("import {\n  a,\n  b,\n} from '@/ml/plan-cache'")).toEqual([
      '@/ml/plan-cache',
    ])
  })
})

/**
 * 정적 임포트를 소스 파일로 푼다 — `@/`와 상대 경로만. 바깥 꾸러미(`vue` 따위)는 `null`이다.
 */
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? join(dirname(from), spec)
      : null
  if (base === null) return null
  for (const candidate of [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

/** 뿌리에서 정적 임포트를 끝까지 따라가 닿는 파일 전부. 값은 그 파일을 들인 파일이다(길을 말하려고). */
function reachable(roots: readonly string[]): Map<string, string | null> {
  const seen = new Map<string, string | null>()
  const stack: [string, string | null][] = roots.map((root) => [root, null])
  while (stack.length > 0) {
    const [path, by] = stack.pop()!
    if (seen.has(path)) continue
    seen.set(path, by)
    for (const spec of staticImports(code(path))) {
      const next = resolveImport(path, spec)
      if (next !== null) stack.push([next, path])
    }
  }
  return seen
}

/** 닿은 파일까지의 길. 빨갛게 될 때 어디서 끌려왔는지 말한다. */
function chainOf(seen: Map<string, string | null>, path: string): string {
  const chain: string[] = []
  for (let at: string | null = path; at !== null; at = seen.get(at) ?? null)
    chain.push(at.slice(SRC.length + 1))
  return chain.join(' <- ')
}

/**
 * **바로 들이지 않아도 건너서 들이면 같다** — 대시보드·도구 막대에서 닿는 `ml/flow-*.ts`·`project/facts.ts`가
 * 계획 코드를 들이면 첫 화면이 그것을 싣는다. 그래서 정적 임포트를 끝까지 따라간다.
 *
 * 점검 화면(`InspectView.vue`)은 뿌리가 아니다 — 제 라우트 청크이고, 실험의 재현을 보이므로 계획 코드를 싣는
 * 것이 맞다. 그 파일이 흐름도 쪽으로 직접 들이는 것은 위의 검사가 본다.
 */
describe('첫 화면에서 건너서 닿는 코드에도 계획 코드가 없다', () => {
  const ROOTS = EAGER.filter((path) => !path.endsWith('InspectView.vue'))
  const HEAVY_FILES = [
    'plan.ts',
    'plan-cache.ts',
    'experiment.ts',
    'flow-counts.ts',
    'training-source.ts',
  ].map((name) => join(SRC, 'ml', name))
  const seen = reachable(ROOTS)

  it('따라간 길이 흐름도의 계산 모듈까지 닿는다', () => {
    for (const name of ['flow.ts', 'flow-layout.ts', 'flow-view.ts', 'flow-zoom.ts'])
      expect([...seen.keys()], name).toContain(join(SRC, 'ml', name))
    expect([...seen.keys()]).toContain(join(SRC, 'project', 'facts.ts'))
  })

  for (const heavy of HEAVY_FILES) {
    it(`${heavy.slice(SRC.length + 1)}에 닿지 않는다`, () => {
      expect(seen.has(heavy), seen.has(heavy) ? chainOf(seen, heavy) : '').toBe(false)
    })
  }

  it('검사기가 건너서 닿는 것을 잡는다', () => {
    const inspect = reachable([join(SRC, 'views', 'InspectView.vue')])
    expect(inspect.has(join(SRC, 'ml', 'plan.ts'))).toBe(true)
  })
})

describe('그림의 규칙', () => {
  const FILES = sourcesIn(FLOW_DIR)

  it('훑을 파일이 실제로 있다', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5)
  })

  /** 이름은 빨갛게 될 때 CI가 찍는 글자라 영어다. 순서대로 hex 색, `<style>`, 실행 중 색 읽기, 배색 속성, SVG 글자, 종류 견주기, 스토어. */
  const RULES: readonly [string, RegExp][] = [
    ['no hex colours', /#[0-9a-fA-F]{3,8}\b(?!\$)/],
    ['no <style> block', /<style\b/],
    ['no getComputedStyle', /getComputedStyle/],
    ['no data-theme branch', /data-theme/],
    ['no SVG <text>', /<text\b/],
    ['no kind comparison in the view', /\b(dataType|taskType)\s*[!=]==?/],
    ['no project store', /useProjectStore|stores\/project/],
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
