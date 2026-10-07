/**
 * `.mlpx`의 JSON 엔트리를 글자로 쓴다 (open-decisions.md 105).
 *
 * **`JSON.stringify(값, null, 2)`와 같고, 원소가 전부 수인 배열만 한 줄에 쓴다.** 들여쓰기는 학생이 압축을
 * 풀어 들여다보라고 두는 것인데, 실험마다 행 수만큼 있는 `trainIndices`·`testIndices`는 원소 하나에 한 줄을
 * 써서 `runs.json`을 세 배 가까이 부풀렸다(R42 감사 B-1) — 엔트리를 압축하지 않으므로 그대로 파일 크기다.
 *
 * **수 배열이 없는 값에서는 `JSON.stringify(값, null, 2)`와 바이트가 같다.** 그래서 이 함수가 바꾸는 것은
 * 수 배열의 모양 하나뿐이다. 무는 검사: `format.spec.ts`의 *"결정 105"* 묶음.
 */

const INDENT = '  '

/**
 * 원소가 하나 이상이고 전부 `number`인 배열인가. 빈 칸(`[, 1]`)은 `undefined`라 수가 아니다 — 그런 배열은
 * 아래 일반 경로가 `JSON.stringify`처럼 `null`로 쓴다.
 */
function isNumberArray(value: readonly unknown[]): boolean {
  if (value.length === 0) return false
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== 'number') return false
  }
  return true
}

/** `JSON.stringify`가 값으로 치지 않는 것 — 객체에서는 키째 빠지고 배열에서는 `null`이 된다. */
function isSkipped(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol'
}

/**
 * 한 값을 쓴다. 원시값 하나와 수 배열은 `JSON.stringify`에 맡기고, 그 위의 규칙(`toJSON`, 감싼 원시값,
 * 건너뛰는 값)은 여기서 같은 순서로 다시 한다 — 같은지는 `format.spec.ts`의 *"수 배열이 없으면
 * JSON.stringify(값, null, 2)와 글자가 같다"*가 표본으로 문다. 건너뛰는 값이면 `undefined`다.
 */
function write(value: unknown, key: string, indent: string): string | undefined {
  let current = value
  if (
    current !== null &&
    typeof current === 'object' &&
    typeof (current as { toJSON?: unknown }).toJSON === 'function'
  ) {
    current = (current as { toJSON: (key: string) => unknown }).toJSON(key)
  }
  if (current instanceof Number || current instanceof String || current instanceof Boolean) {
    current = current.valueOf()
  }
  if (isSkipped(current)) return undefined
  if (current === null || typeof current !== 'object') return JSON.stringify(current)

  const inner = indent + INDENT
  if (Array.isArray(current)) {
    if (current.length === 0) return '[]'
    if (isNumberArray(current)) return JSON.stringify(current)
    // `map`이 아니다 — `map`은 빈 칸을 건너뛰어 `join`이 그 자리를 빈 글자로 쓴다. `JSON.stringify`는 `null`이다.
    const items: string[] = []
    for (let index = 0; index < current.length; index += 1) {
      items.push(write(current[index], String(index), inner) ?? 'null')
    }
    return `[\n${inner}${items.join(`,\n${inner}`)}\n${indent}]`
  }
  const fields: string[] = []
  for (const [name, item] of Object.entries(current)) {
    const text = write(item, name, inner)
    if (text !== undefined) fields.push(`${JSON.stringify(name)}: ${text}`)
  }
  if (fields.length === 0) return '{}'
  return `{\n${inner}${fields.join(`,\n${inner}`)}\n${indent}}`
}

/** 값을 `.mlpx`에 쓰는 JSON 글자로. 최상위가 건너뛰는 값이면 `JSON.stringify`처럼 `undefined`다. */
export function jsonText(value: unknown): string | undefined {
  return write(value, '', '')
}
