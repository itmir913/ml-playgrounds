/**
 * 소스를 **글자로 보는 검사**들이 함께 쓰는 것.
 *
 * 이런 검사가 여럿이다(`limits-rules`·`ui-rules`·`embed`). 공통으로 걸리는 함정이 하나
 * 있는데, **주석 안의 글자에 속는 것**이다 — 막으려는 것은 코드이지 설명이 아닌데
 * 정규식은 둘을 구분하지 않는다. 실제로 `embed.spec.ts`가 `clearRect(`를 주석으로 옮긴
 * 돌연변이에 그대로 통과했다 (R6 감사 B-12).
 */

/**
 * 주석을 걷어낸 줄들. 줄 수는 그대로라 **줄 번호가 안 밀린다.**
 *
 * 문자열 리터럴 안은 건드리지 않는다 — 거기 든 `//`는 주석이 아니라 값이다.
 */
export function withoutComments(source: string): string[] {
  let inBlock = false
  return source.split(/\r?\n/).map((line) => {
    let kept = ''
    let quote = ''
    for (let i = 0; i < line.length; i += 1) {
      const two = line.slice(i, i + 2)
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
      if (char === "'" || char === '"' || char === '`') {
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
