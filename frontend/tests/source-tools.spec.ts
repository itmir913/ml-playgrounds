/**
 * **소스를 글자로 보는 공용 도구 자체** (`tests/fixtures/source.ts`).
 *
 * 이 저장소의 검사 여럿이 소스를 정규식으로 훑는다. 그 훑기가 쓰는 도구가 틀리면
 * **규칙이 통째로 무음이 되는데 아무것도 안 빨개진다** — `ui-rules`의 한 줄짜리 주석
 * 제거기가 `https://`가 든 줄에서 화면 규칙 열둘을 껐던 일이 그것이다(R8 감사 A-1).
 *
 * **도구를 소비자로만 검사하면 안 된다** (2026-09-01 R18 감사 B-2). `bodyAt`은 R17이
 * 찾은 결함을 고치려고 세운 것인데 **저 자신은 무검사였다** — 옛 병(첫 `}`에서 끊기)으로
 * 되돌려도 `limits-switch.spec` 15개가 전부 초록이었다. 지금 소스의 리더들이 **우연히**
 * 잘린 본문에도 상수를 남겨서다. 그 상태에서 R17이 찾은 그 모양을 다시 심으면 아무도
 * 안 문다 — **고친 병이 소리 없이 재발할 수 있는 자리다.**
 *
 * 그래서 여기서는 소비자를 안 거치고 도구를 직접 부른다.
 *
 * **`withoutComments`와 `windowedHits`의 짝은 `ui-rules.spec.ts`에 있다** — 그쪽 규칙들이
 * 쓰는 자리라 자기검사가 거기서 자랐다. 옮기지 않는 이유는 그 짝들이 실제 규칙 표본과
 * 함께 서 있어서다.
 */

import { describe, expect, it } from 'vitest'

import { bodyAt } from './fixtures/source'

/** `text`에서 첫 `{`의 자리. 검사마다 손으로 세지 않으려고 둔다. */
function opening(text: string): number {
  return text.indexOf('{')
}

function body(text: string): string {
  return bodyAt(text, opening(text))
}

describe('bodyAt은 짝이 맞는 `}`까지 준다', () => {
  it('바깥 중괄호는 빼고 준다', () => {
    expect(body('f() { return 1 }')).toBe(' return 1 ')
  })

  /**
   * **이것이 R17 B-1의 그 모양이다.** `\{([^}]*)\}`로 자르면 여기서 끊겨 `RETURN_ME`가
   * 본문 밖으로 밀려나고, 그 뒤를 보는 필터가 함수를 통째로 놓친다.
   */
  it('본문에 객체 리터럴이 있어도 끝까지 준다', () => {
    const source = "f() { const shape = { kind: 'rows' }\n  return RETURN_ME }"
    expect(body(source)).toContain('RETURN_ME')
  })

  it('두 겹 중첩도 끝까지 준다', () => {
    const source = 'f() { a({ b: { c: 1 } })\n  return LAST }'
    expect(body(source)).toContain('LAST')
    // 마지막 `}` 하나는 바깥 것이므로 본문에 안 들어간다.
    expect(body(source).endsWith('}')).toBe(false)
  })

  it('빈 본문은 빈 문자열이다', () => {
    expect(body('f() {}')).toBe('')
  })

  /**
   * **짝이 안 맞으면 끝까지 준다. 빈 문자열이 아니다.**
   *
   * 빈 문자열을 주면 *"본문에 아무것도 없다"*가 되어 그 함수가 규칙에서 조용히 빠진다 —
   * 잘린 소스에서 규칙이 무음이 되는 것이 정확히 이 파일이 막으려는 것이다.
   */
  it('닫는 괄호가 없으면 끝까지 준다', () => {
    expect(body('f() { RETURN_ME')).toContain('RETURN_ME')
  })

  it('여는 자리 뒤만 본다 - 앞의 글자는 안 섞인다', () => {
    expect(body('BEFORE f() { inside }')).toBe(' inside ')
  })

  /**
   * **문자열 안의 홀 중괄호에는 속는다. 알고 두는 구멍이다** (2026-09-01 R18 감사 C-2).
   *
   * 이 함수의 주석이 한때 *"문자열과 주석은 부르는 쪽이 미리 걷는다"*고 적었는데
   * **절반이 거짓이었다** — `withoutComments`는 스스로 *"문자열 리터럴 안은 건드리지
   * 않는다"*고 적는다. 걷히는 것은 주석뿐이다.
   *
   * **여기서 안 고치는 이유**는 중괄호 세기에 문자열 상태 기계를 또 넣으면 그것이
   * `withoutComments`와 **두 벌**이 되기 때문이다. 대신 **이 검사가 구멍의 크기를
   * 못 박는다** — 다음 사람이 이 함수를 믿을 범위가 여기까지다.
   *
   * 지금 쓰는 자리(`src/limits-switch.ts`)에는 그런 문자열이 없다.
   */
  it('문자열 안의 홀 중괄호에는 속는다 - 구멍의 크기를 적어 둔다', () => {
    const source = "f() { const brace = '}'\n  return RETURN_ME }"
    expect(body(source)).not.toContain('RETURN_ME')
  })
})
