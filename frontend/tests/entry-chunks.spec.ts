/**
 * **첫 화면에 실리는 코드** — `main.ts`에서 정적 `import`로 닿는 모듈 전부
 * (`architecture.md` §7.4.1).
 *
 * 컴퓨터실 PC는 리셋을 전제하므로 **매 수업이 첫 방문이다.** 첫 화면 앞에 받는 것을 줄인 경위와
 * 잰 값은 `docs/cases/architecture.md`의 §7.4.1 아래 *"첫 화면만 정적 임포트로 바꾸고"*가 갖는다.
 *
 * **그 이득은 `import` 한 줄로 조용히 사라진다** — 상수 하나를 들이려고 무거운 모듈을 바로
 * 가져오면 빌드는 초록이고 화면도 같다. 실제로 그렇게 들어와 있던 길이 둘이었다: 스토어가 계획
 * 캐시를 비우려고(`ml/plan-cache-reset.ts`), 등록부가 확장자 상수 하나 때문에
 * (`data/table-accept.ts`). 그래서 **소스의 정적 그래프를 따라가** 무거운 것이 닿는지 본다.
 *
 * **import는 TypeScript AST로 읽는다.** 처음에는 정규식이었는데 감사가 놓치는 모양 둘을 찾았다
 * (2026-10-01): `export type X = …` 뒤의 `from`을 한 덩어리로 삼켰고, `import { type X }`를 타입
 * 전용으로 뺐다. 이 저장소는 `verbatimModuleSyntax`라 **중괄호 안이 전부 `type`이어도 그 모듈은
 * 남는다** — 빌드가 실제로 그 모듈을 실었다. 그래서 빼는 것은 `import type …`·`export type … from`
 * 둘뿐이다. 동적 `import()`는 문장이 아니라 안 센다 — 그것이 첫 화면 밖으로 미는 방법이다.
 *
 * **못 보는 것:** 빌드 도구가 실제로 나누는 조각과 글꼴. 여기는 소스다 — 정적 그래프에 없는 것이
 * 첫 조각에 들어갈 길은 없으므로, 이 검사가 초록이면 적어도 아래 목록은 첫 화면 밖이다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

/** 한 덩어리(파일 또는 SFC의 `<script>` 하나)의 정적 import 대상. */
function staticImports(code: string): string[] {
  const file = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const found: string[] = []
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue
      if (ts.isStringLiteral(statement.moduleSpecifier)) found.push(statement.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (statement.isTypeOnly) continue
      if (ts.isStringLiteral(statement.moduleSpecifier)) found.push(statement.moduleSpecifier.text)
    }
  }
  return found
}

/** SFC는 `<script>` 블록마다 따로 읽는다 — 이어 붙이면 한 블록의 끝이 다음 블록을 삼킨다. */
function blocksOf(path: string): string[] {
  const text = readFileSync(path, 'utf-8')
  if (!path.endsWith('.vue')) return [text]
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
}

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return `npm:${spec}`
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : join(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate) && /\.(ts|vue|json|css)$/.test(candidate)) return normalize(candidate)
  }
  return null
}

const shown = (path: string) =>
  path.startsWith('npm:') ? path : relative(SRC, path).split('\\').join('/')

/** 닿는 모듈과, 풀지 못한 지정자. **못 푼 것은 조용히 버리지 않는다.** */
function reachable(entry: string): { seen: Set<string>; unresolved: string[] } {
  const seen = new Set<string>()
  const unresolved: string[] = []
  const queue = [entry]
  while (queue.length > 0) {
    const path = queue.pop() as string
    if (seen.has(path)) continue
    seen.add(path)
    if (path.startsWith('npm:') || !/\.(ts|vue)$/.test(path)) continue
    for (const spec of blocksOf(path).flatMap(staticImports)) {
      const next = resolve(path, spec)
      if (next === null) unresolved.push(`${shown(path)} -> ${spec}`)
      else if (!seen.has(next)) queue.push(next)
    }
  }
  return { seen, unresolved }
}

const { seen, unresolved } = reachable(join(SRC, 'main.ts'))
const names = new Set([...seen].map(shown))

describe('첫 화면에 실리는 코드', () => {
  it('그래프를 실제로 따라간다', () => {
    // 몇 개 안 되면 읽는 쪽이 썩은 것이지 첫 화면이 가벼워진 것이 아니다.
    expect(names.size).toBeGreaterThan(50)
    expect(names.has('stores/project.ts')).toBe(true)
    expect(names.has('npm:vue')).toBe(true)
    expect(unresolved, 'a local import this spec could not resolve').toEqual([])
  })

  /** 타입 전용 줄만 빼고, 중괄호 안이 전부 `type`인 줄은 센다(`verbatimModuleSyntax`). */
  it('읽는 규칙 — 무엇을 세고 무엇을 빼는가', () => {
    expect(staticImports("import { type A } from './a'")).toEqual(['./a'])
    expect(staticImports("import type { A } from './a'")).toEqual([])
    expect(staticImports("export type T = string\nexport * from './b'")).toEqual(['./b'])
    expect(staticImports("export type { A } from './a'")).toEqual([])
    expect(staticImports("import './c.css'")).toEqual(['./c.css'])
    expect(staticImports("const m = () => import('./lazy')")).toEqual([])
  })

  /**
   * **첫 화면 조각은 앱 코드와 함께 받는다** (`router/index.ts`의 그 라우트 머리말). 지연
   * 로딩이면 앱 코드를 다 받은 뒤에 한 번 더 왕복한다.
   */
  it('첫 화면이 정적 그래프에 있다', () => {
    expect(names.has('views/WelcomeView.vue')).toBe(true)
  })

  /**
   * **첫 화면은 라우터 본체를 거꾸로 들이지 않는다** (`router/names.ts`의 머리말). 라우터가
   * 첫 화면을 정적으로 들이므로, 첫 화면 쪽에서 `@/router`에 닿으면 순환이 되고 평가 순서에 따라
   * `/` 라우트의 컴포넌트가 `undefined`가 된다(2026-10-01 감사 C-3).
   */
  it('첫 화면에서 라우터 본체로 돌아오는 길이 없다', () => {
    const fromWelcome = reachable(join(SRC, 'views', 'WelcomeView.vue')).seen
    expect([...fromWelcome].map(shown)).not.toContain('router/index.ts')
  })

  /** 첫 화면에서 안 쓰는데 무거운 것. 들어오면 그 `import`를 고친다. */
  it.each([
    ['npm:papaparse', 'CSV 파서'],
    ['data/csv.ts', 'CSV 읽기'],
    ['data/table.ts', '표 읽기'],
    ['project/dataset.ts', '정본 표'],
    ['ml/plan.ts', '학습 계획'],
    ['ml/plan-cache.ts', '학습 계획 캐시'],
  ])('%s(%s)가 첫 화면에 안 실린다', (name) => {
    expect(names.has(name), `${name} is statically reachable from main.ts`).toBe(false)
  })
})
