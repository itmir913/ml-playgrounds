import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 소스를 **글자로 보는 검사**들이 함께 쓰는 것.
 *
 * 이런 검사가 여럿이다(`ui-rules`·`i18n-usage`·`secure-context-rules`·`limits-rules`·
 * `embed`·`migrate`). 공통으로 걸리는 함정이 하나 있는데, **주석 안의 글자에 속는 것**이다
 * — 막으려는 것은 코드이지 설명이 아닌데 정규식은 둘을 구분하지 않는다. 실제로
 * `embed.spec.ts`가 `clearRect(`를 주석으로 옮긴 돌연변이에 그대로 통과했다 (R6 감사 B-12).
 *
 * **구현이 하나여야 한다.** 한때 넷으로 갈라져 있었고 그중 `ui-rules`의 것만 정규식
 * 한 줄(`line.replace(/\/\/.*$/, '')`)이었다. 그것이 **문자열 안의 `//`까지 주석으로
 * 봐서**, `href="https://…"`가 든 줄에서는 그 파일의 화면 규칙 열둘이 통째로 꺼졌다
 * (R8 감사 A-1). 갈라 두면 셋이 고쳐질 때 하나가 안 고쳐진다.
 */

/**
 * 주석을 걷어낸 줄들. 줄 수는 그대로라 **줄 번호가 안 밀린다.**
 *
 * 문자열 리터럴 안은 건드리지 않는다 — 거기 든 `//`는 주석이 아니라 값이다.
 *
 * `.vue`에는 HTML 주석(`<!-- -->`)과 JS 주석이 함께 있다. **둘 다 여러 줄에 걸친다.**
 */
export function withoutComments(source: string): string[] {
  let inBlock = false
  let inHtml = false
  return source.split(/\r?\n/).map((line) => {
    let kept = ''
    let quote = ''
    for (let i = 0; i < line.length; i += 1) {
      const two = line.slice(i, i + 2)
      if (inHtml) {
        if (line.slice(i, i + 3) === '-->') {
          inHtml = false
          i += 2
        }
        continue
      }
      if (inBlock) {
        if (two === '*/') {
          inBlock = false
          i += 1
        }
        continue
      }
      const char = line[i] ?? ''
      if (quote) {
        kept += char
        if (char === '\\') {
          kept += line[i + 1] ?? ''
          i += 1
        } else if (char === quote) quote = ''
        continue
      }
      if (line.slice(i, i + 4) === '<!--') {
        inHtml = true
        i += 3
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char
        kept += char
      } else if (two === '//') return kept
      else if (two === '/*') {
        inBlock = true
        i += 1
      } else kept += char
    }
    return kept
  })
}

/**
 * `src/` 아래의 `.ts`·`.vue` 전부. **줄 단위로 소스를 훑는 검사들이 나눠 쓴다.**
 *
 * 한때 다섯 스펙이 각자 이 함수를 갖고 있었고, 그중 셋만 `.spec.ts`를 걸렀다.
 * 다섯 다 `src/`만 훑고 **`src/`에는 `.spec.ts`가 하나도 없어서** 그 차이는
 * 아무 일도 안 했다 — 갈라 둔 값이 없는 갈림이었다.
 *
 * **캐시하지 않는다.** 걷기 31ms + 읽기 52ms이고, 검사 시간의 대부분은 vitest의
 * 파일당 import·environment라 캐시가 못 건드린다 (R8 감사 C-2의 실측).
 */
export function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry) ? [path] : []
  })
}
