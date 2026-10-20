/**
 * **줄 번호로 가리키지 않는다** (`docs/workflow.md` §6, `CLAUDE.md` §4).
 *
 * `파일:줄`·`#L줄`은 그 파일을 고칠 때마다 썩는다. 이 검사를 세우던 날 전수 검사에서 규칙·안내 문서와 `src/`에는
 * 하나도 없었는데, 검사 주석 하나(`compute-pools.spec.ts`)가 가리키던 자리는 이미 열두 줄 밀려 있었다 — 막는 문장도
 * 검사도 없어서 아무도 몰랐다. 절 번호·제목·심볼 이름으로 가리킨다.
 *
 * **훑는 곳:** `CLAUDE.md`·`README.md`·`CONTRIBUTING.md`, `docs/`(판례 `docs/cases/`와 감사 기록 `docs/audit/`는 뺀다
 * — 그때의 기록이다), `frontend/`의 `src/`·`tests/`·`scripts/`·`tools/`(검사 픽스처는 뺀다).
 *
 * **못 보는 것:** "N행" 같은 한국어 표기 — 데이터의 행 수(`5000행`)와 글자로 갈리지 않는다. 확장자 없는 파일 이름.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const FRONTEND = process.cwd()
const ROOT = join(FRONTEND, '..')
const SELF = join('frontend', 'tests', 'line-refs.spec.ts')

/** 줄 번호가 붙은 파일 참조. 확장자가 있는 이름 + `:줄` 또는 `#L줄`. */
export const LINE_REF =
  /(?<![\w/])[\w.\-/]+\.(?:ts|vue|md|py|json|mjs|js|yml|yaml|css|sh|toml|html)(?::|#L)\d+(?:[-–]\d+)?(?!\w)/g

/**
 * 줄 번호가 아니라 **검사의 데이터**인 자리 — 오류 스택의 글자와 검사기가 내는 출력 형식이다. 파일과 글자를 함께 적는다.
 */
const DATA: readonly (readonly [string, string])[] = [
  ['frontend/tests/embed.spec.ts', 'embed.worker.js:12'],
  ['frontend/tests/ui-rules.spec.ts', 'x.vue:1'],
  ['frontend/tests/worker.spec.ts', '//localhost/train.worker.js:42'],
]

function walk(directory: string, keep: (path: string) => boolean): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) return []
    if (statSync(path).isDirectory()) return walk(path, keep)
    return keep(path) ? [path] : []
  })
}

const slash = (path: string): string => relative(ROOT, path).split(sep).join('/')

function scanned(): string[] {
  const docs = walk(join(ROOT, 'docs'), (path) => path.endsWith('.md')).filter(
    (path) => !/^docs\/(cases|audit)\//.test(slash(path)),
  )
  const top = ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md'].map((name) => join(ROOT, name))
  const code = ['src', 'tests', 'scripts', 'tools'].flatMap((dir) =>
    walk(join(FRONTEND, dir), (path) => /\.(ts|vue|mjs|js|md)$/.test(path)).filter(
      (path) => !slash(path).startsWith('frontend/tests/fixtures/'),
    ),
  )
  return [...top, ...docs, ...code].filter((path) => slash(path) !== SELF.split(sep).join('/'))
}

/** 파일 하나에서 데이터로 적힌 것을 뺀 줄 번호 참조. */
export function lineRefsIn(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) =>
    [...line.matchAll(LINE_REF)]
      .map((match) => match[0])
      .filter((ref) => !DATA.some(([path, data]) => path === file && data === ref))
      .map((ref) => `${file}:${index + 1}  ${ref}`),
  )
}

describe('줄 번호로 가리키지 않는다', () => {
  it('찾는 식이 줄 번호 참조를 잡고 절·이름은 안 잡는다', () => {
    expect(lineRefsIn('a.md', '`ml/preprocess.ts:122`의 규칙')).toHaveLength(1)
    expect(lineRefsIn('a.md', 'gate.yml#L104 참조')).toHaveLength(1)
    expect(lineRefsIn('a.md', '`docs/workflow.md` §6, `preprocess.ts`의 `transform`')).toEqual([])
    expect(lineRefsIn('a.md', '시각 12:30, 비율 3:1')).toEqual([])
  })

  it('훑을 파일을 실제로 찾는다', () => {
    const files = scanned().map(slash)
    expect(files).toContain('CLAUDE.md')
    expect(files).toContain('docs/workflow.md')
    expect(files.some((file) => file.startsWith('frontend/src/'))).toBe(true)
    expect(files.some((file) => file.startsWith('docs/cases/'))).toBe(false)
  })

  it('규칙·안내 문서와 frontend의 소스·검사에 줄 번호 참조가 없다', () => {
    const found = scanned().flatMap((path) => lineRefsIn(slash(path), readFileSync(path, 'utf-8')))
    expect(found, 'point at a section, a heading or a symbol name instead').toEqual([])
  })

  it('데이터 예외가 아직 그 파일에 있다 - 지워진 예외는 목록에서도 지운다', () => {
    for (const [path, data] of DATA) {
      expect(readFileSync(join(ROOT, path), 'utf-8'), `${path}: ${data}`).toContain(data)
    }
  })
})
