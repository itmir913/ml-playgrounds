/**
 * 소스를 글자로 보는 검사가 **주석을 파서로 걷는** 도우미 (결정문 65 "0.30.0 배포 승인 감사에서 더한 것", #30).
 *
 * 정규식 `<!--[\s\S]*?-->`·`/\*[\s\S]*?\*\/`·`\/\/.*`는 속성값 `'<!--'`·문자열 `'/*'`·`'https://'`에서 주석을
 * 열어, 그 사이의 글자를 통째로 지운다 — 막으려는 것이 거기 있으면 검사가 조용히 초록이 된다. 여기서는
 * **파서가 주석이라고 가른 자리만** 비운다. 템플릿은 SFC 문법 트리의 주석 노드, 스크립트는 TypeScript
 * 파서의 토큰 사이(트리비아)다. 스타일은 부르는 쪽이 `postcss`로 직접 읽는다.
 *
 * `fixtures/source.ts`와 나눈 이유: 이 파일은 `typescript`와 `vue/compiler-sfc`를 들이므로, 글자만 보는
 * 가벼운 검사들까지 그 무게를 지지 않게 한다.
 */

import ts from 'typescript'
import { parse as parseSfc, type SFCTemplateBlock } from 'vue/compiler-sfc'

/** 템플릿 문법 트리의 주석 노드 (`@vue/compiler-core`의 `NodeTypes.COMMENT`). */
const COMMENT_NODE = 3

/**
 * 템플릿 블록의 글자에서 **HTML 주석만** 걷는다. **주석은 정규식이 아니라 문법 트리의 주석 노드
 * 자리로 가른다** (0.30.0 배포 승인 감사 A-1) — `<!--[\s\S]*?-->`는 속성값 `'<!--'`에서 열려 뒤의
 * 속성값 `'-->'`까지 사이의 `:disabled`를 통째로 삼켰다. 트리가 없으면(다른 템플릿 언어) 걷지 않는다 —
 * 더 보는 쪽으로 틀린다. 트리에 주석 노드가 남으려면 가를 때 `templateParseOptions: { comments: true }`를
 * 줘야 한다(기본값은 빌드 모드에 따라 갈린다 — `templateOf`가 그렇게 가른다).
 *
 * `ui-rules.spec.ts`의 잠금 낱말 검사가 쓰던 것을 여기로 옮겼다 — 주석이 실제로 걷히는 것은 거기의
 * *"검사기가 안 잡는다: HTML comment in a template"*가, 속성값 안의 `<!--`가 주석이 아닌 것은
 * *"검사기가 잡는다: comment markers inside attribute values"*가 문다.
 */
export function templateContent(template: SFCTemplateBlock): string {
  const base = template.loc.start.offset
  const ranges: (readonly [number, number])[] = []
  const visit = (node: { type: number; loc: SFCTemplateBlock['loc'] }): void => {
    if (node.type === COMMENT_NODE) {
      ranges.push([node.loc.start.offset - base, node.loc.end.offset - base])
    }
    const children = (node as { children?: unknown }).children
    if (Array.isArray(children)) {
      for (const child of children as { type: number; loc: SFCTemplateBlock['loc'] }[]) {
        visit(child)
      }
    }
  }
  if (template.ast !== undefined) visit(template.ast)
  let text = template.content
  for (const [start, end] of ranges) {
    text = text.slice(0, start) + ' '.repeat(end - start) + text.slice(end)
  }
  return text
}

/**
 * `.vue`의 **템플릿 블록 글자**, 주석은 문법 트리가 가른 자리로 비운다. 스크립트·스타일 블록은 안 든다.
 * 템플릿이 없으면 빈 글자다. **파서가 오류를 내면 던진다** — 안 닫힌 블록은 빈 글자로 돌아와 그 안이 통째로
 * 안 보인 채 초록이 된다(0.30.0 최종 승인 감사 B-1, `ui-rules.spec.ts`의 `sfcOf`와 같은 이유).
 */
export function templateOf(path: string, source: string): string {
  const { descriptor, errors } = parseSfc(source, {
    filename: path,
    templateParseOptions: { comments: true },
  })
  if (errors.length > 0) {
    throw new Error(
      `${path}: the SFC parser reported ${errors.map((error) => error.message).join('; ')}`,
    )
  }
  return descriptor.template ? templateContent(descriptor.template) : ''
}

/**
 * 스크립트에서 **주석만** 비운다. 자리는 TypeScript 파서가 가른다 — 토큰과 토큰 사이(트리비아)에 든
 * 것만 주석이므로, 문자열·템플릿 리터럴·정규식 리터럴 안의 `//`·`/*`는 글자로 남는다. 비운 자리는
 * 공백이고 **줄바꿈은 남긴다** — 글자 수와 줄 번호가 안 밀린다.
 */
export function scriptWithoutComments(source: string): string {
  const file = ts.createSourceFile(
    'probe.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  // 코드 단위로 나눈다 — 파서의 자리는 UTF-16 자리라, 코드 포인트로 나누면 BMP 밖 글자 뒤가 밀린다.
  const out = source.split('')
  let cursor = 0
  const blank = (end: number): void => {
    for (let index = cursor; index < end; index += 1) {
      if (out[index] !== '\n' && out[index] !== '\r') out[index] = ' '
    }
  }
  const walk = (node: ts.Node): void => {
    // JSDoc은 트리에 자식으로 걸리지만 글자로는 트리비아다 — 건너뛰면 아래 `blank`가 그 자리를 비운다.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
      return
    const children = node.getChildren(file)
    if (children.length > 0) {
      for (const child of children) walk(child)
      return
    }
    const start = node.getStart(file)
    blank(start)
    cursor = Math.max(cursor, node.getEnd())
  }
  walk(file)
  blank(source.length)
  return out.join('')
}
