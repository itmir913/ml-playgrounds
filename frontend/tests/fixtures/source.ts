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

/**
 * `open` 자리의 `{`부터 **짝이 맞는 `}`까지**의 본문. 바깥 중괄호는 빼고 준다.
 *
 * **정규식으로 자르면 안 된다.** `\{([^}]*)\}`는 첫 `}`에서 끊기므로 **본문에 객체
 * 리터럴이 하나만 있어도 나머지를 잃는다.** 그러면 그 뒤를 보는 필터가 함수를 통째로
 * 놓치고, 검사는 "찾을 게 없었다"며 초록으로 남는다 (2026-09-01 R17 감사 B-1 —
 * 스위치를 안 거치는 리더를 심어도 88개가 전부 초록이었다).
 *
 * **문자열과 주석은 부르는 쪽이 미리 걷는다** (`withoutComments`). 여기서 다시 세면
 * 상태 기계가 두 벌이 된다.
 *
 * @param open 여는 `{`의 자리
 */
export function bodyAt(source: string, open: number): string {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  // 짝이 안 맞으면 끝까지. **빈 문자열을 주면 "본문에 아무것도 없다"가 되어 조용해진다.**
  return source.slice(open + 1)
}

/**
 * 창 하나가 덮는 줄 수.
 *
 * **prettier가 편 위반이 줄 하나씩 보는 훑기를 통과한다.** `printWidth`가 100이라
 * 긴 `t(...)`나 긴 `class="..."`를 이 저장소의 포매터가 스스로 여러 줄로 펴고, 그
 * 모양은 어느 한 줄에도 패턴이 통째로 안 남는다 (R13-5 감사 A-2 · R14-5 감사 A-1).
 *
 * **규칙을 "여러 줄에 걸리나"로 가르지 않는다.** 그 분류가 곧 낡는다 — 지금 한 줄인
 * 패턴도 다음 사람이 인자를 하나 더 넣으면 펴진다. 전부 창으로 본다.
 *
 * **창을 좁게 잡는다.** prettier가 한 구문을 펴는 폭이고, 넓히면 무관한 두 구문이
 * 붙어 거짓 빨강이 난다.
 */
export const WRAP_WINDOW = 6

/**
 * 한 파일에서 패턴이 걸린 자리들. 줄 단위로 보고, 못 보면 창으로 한 번 더 본다.
 *
 * **줄을 잇는 것만으로는 안 닫힌다.** `' '`로 이으면 **없던 공백이 생기고** `''`로
 * 이으면 **있던 공백이 사라져**, 어느 쪽으로 정해도 패턴 하나가 샌다. 그래서 막는
 * 쪽은 패턴이다 — `architecture.md` §9.3.1이 규약 둘을 갖는다:
 * **토큰 사이에 `\s*`를 두고, 자기검사 표본에 prettier가 실제로 펴는 모양을 넣는다.**
 */
export function windowedHits(
  matches: (text: string) => boolean,
  source: string,
  label: string,
): string[] {
  const lines = withoutComments(source)
  const found: string[] = []
  let reportedAt = -WRAP_WINDOW

  lines.forEach((line, index) => {
    if (matches(line)) {
      found.push(`${label}:${index + 1}  ${line.trim()}`)
      reportedAt = index
      return
    }
    // 이미 이 창 안에서 하나 적었으면 같은 위반을 두 번 세지 않는다.
    if (index - reportedAt < WRAP_WINDOW) return
    const joined = lines.slice(index, index + WRAP_WINDOW).join(' ')
    if (matches(joined)) {
      /**
       * **창을 좁혀 적는다** (2026-09-01 감사 C-6). 창의 **시작 줄**을 적던 때는 사람이
       * 그 줄을 열면 위반이 없었다 — 감사자가 76행에 심은 것을 71행이라 보고했다.
       * 앞뒤를 한 줄씩 잘라 보며 **여전히 걸리는 가장 좁은 범위**를 찾는다.
       */
      let from = index
      const last = Math.min(index + WRAP_WINDOW, lines.length)
      while (from + 1 < last && matches(lines.slice(from + 1, last).join(' '))) from += 1
      let to = last
      while (to - 1 > from && matches(lines.slice(from, to - 1).join(' '))) to -= 1
      const where = from + 1 === to ? `${from + 1}` : `${from + 1}-${to}`
      found.push(
        `${label}:${where}  (여러 줄) ${lines.slice(from, to).join(' ').trim().slice(0, 90)}`,
      )
      reportedAt = index
    }
  })
  return found
}
