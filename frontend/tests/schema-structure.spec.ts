/**
 * **`.mlpx` 문서의 구조가 버전마다 정본으로 박제돼 있는지, 그리고 그 구조를 바꾼 것이
 * 읽기 호환을 깨는 변경인지 본다** (코드 소유자 결정, 2026-09-18. `mlpx-spec.md` §9.2).
 *
 * **왜 다섯째 검사가 필요했나.** 버전을 지키던 넷은 **어휘와 숫자만** 잠근다 —
 * `schema-version.spec.ts`는 `z.enum`의 값 목록을, `versions.spec.ts`는 `FORMAT_VERSION`
 * 자체를, `migrate.spec.ts`는 체인을 본다. 그래서 **필수 필드를 하나 더하거나, 속성을
 * 지우거나, 타입을 바꾸는 변경은 어휘를 안 건드리므로 관문이 전부 초록이었다.** 그 변경이
 * 나가면 신버전 앱이 학생의 구버전 파일을 열면서 `PROJECT_FILE_INVALID`를 띄운다 —
 * **파일은 멀쩡한데.** 그 순간 학생과 교사가 내리는 결론은 "제출물이 깨졌다"이다.
 *
 * **정본은 파일이지 해시가 아니다.** 해시는 *"바뀌었다"*만 말하고 무엇이 바뀌었는지 못
 * 말한다. 파일로 있어야 지난 버전과 **대조**할 수 있고, 그 대조가 곧 *"버전을 올려야 하는
 * 변경인가"*의 판정이 된다. `VOCABULARY_BY_VERSION`이 어휘를 버전마다 쌓는 것과 같은 모양이다.
 *
 * ## 정본 둘이 한 벌이다
 *
 * | 파일 | 무엇인가 |
 * |---|---|
 * | `fixtures/schema/vN.json` | **지금 vN이 받아들이는 구조.** 호환 변경이면 이것만 갱신한다 |
 * | `fixtures/schema/vN.released.json` | **vN이 처음 배포된 날의 구조. 역사다 — 고치지 마라** |
 *
 * 둘을 가른 이유가 이 파일의 핵심이다. 정본이 하나뿐이면 사람이 그것을 갱신했을 때
 * **대조할 상대가 없다.** `vN.released.json`이 있어야 "이 갱신이 옛 파일을 못 열게 만드는가"를
 * 물을 수 있다.
 *
 * ## 검사 넷이 하는 일
 *
 * | | 무엇을 보나 | 실패하면 |
 * |---|---|---|
 * | A 서명 | 지금 스키마 == `vN.json` | 구조가 움직였다. 의도면 정본을 다시 뜬다 |
 * | B 올린 이유 | `vN-1.json` → `vN.json`에 깨는 변경이 하나는 있다 | 올릴 이유가 없었다 |
 * | C **호환 판정** | `vN.released.json` → `vN.json`에 깨는 변경이 **없다** | **`FORMAT_VERSION`을 올려야 하는 변경이다** |
 * | D 역사 | 2..N의 정본이 둘씩 다 있다 | 버전을 올리면서 정본을 안 남겼다 |
 *
 * **막는 것은 C다.** A는 서명이고(움직인 것을 알린다), B는 올린 뒤의 사후 확인이며,
 * **C가 "구조만 바꾸는 변경"을 죽인다.**
 *
 * ## 깨는 변경 넷 (`breakingChanges`)
 *
 * 1. **필수 경로가 늘었다** — `required`에 새 이름. 옛 파일에 그 필드가 없다.
 * 2. **속성이 사라졌다** — `properties`에서 이름이 빠짐.
 * 3. **타입이 바뀌었다** — `type`이 다름, `enum`/`const`가 사라짐, `const` 값이 바뀜,
 *    `anyOf`/`oneOf`의 가지 수가 다름. **어휘(`enum`)에서 값이 빠지는 것도 여기 넣는다** —
 *    `schema-version.spec.ts`와 일부러 겹친다. 겹침을 없애려고 정본에서 `enum`을 벗기면
 *    정본이 구조를 덜 담게 된다.
 * 4. **제약이 좁아졌다** — `minimum`·`exclusiveMinimum`·`minLength`·`minItems` 상승,
 *    `maximum`·`exclusiveMaximum`·`maxLength`·`maxItems` 하락(없다가 생긴 것도 좁아진 것이다),
 *    `pattern`이 바뀌거나 새로 생김.
 *
 * **깨지 않는 것**: 선택 속성 추가, 필수 → 선택, 제약 완화·제거, `description` 변경.
 *
 * **`anyOf`의 가지는 수가 같을 때만 자리끼리 본다.** 수가 다르면 3번으로 친다. 수가 같은데
 * 순서가 바뀌면 자리마다 차이가 잡혀 **깨는 것으로 과하게 보고된다** — 그쪽이 안전하다.
 * 과보고의 대가는 버전을 한 번 올리는 것이고, 누락의 대가는 학생의 파일이 안 열리는 것이다.
 *
 * ## 이 검사가 **못** 보는 것
 *
 * - **`superRefine`/`refine` 규칙.** 성공한 run에 지표가 없으면 거부하는 것 같은 교차 검증은
 *   JSON Schema에 안 떨어진다. `schema.spec.ts`가 맡는다.
 * - **`.default()`의 값 변경.** `io: 'input'`으로 뜨므로 기본값이 안 보인다. 기본값 변경은
 *   포맷 변경이 아니다.
 * - **알고리즘 이름·모델 형식.** 등록부 축이지 포맷이 아니다 (`mlpx-spec.md` 6.2).
 *   `versions.spec.ts`가 형식 이름을 잠근다.
 *
 * ## 갱신하는 법
 *
 * `MLPX_WRITE_SCHEMA_CANON=1 npx vitest run tests/schema-structure.spec.ts`
 *
 * `vN.json`만 다시 뜨고 **일부러 빨갛게 선다** — 환경 변수를 켠 채로 초록이 나오면 그 실행은
 * 아무것도 안 잰 것이기 때문이다. 끄고 다시 돌려서 A와 C를 받아라. `vN.released.json`은
 * 이 경로가 건드리지 않는다.
 *
 * **v1 정본은 없고, 만들지도 않는다.** v1을 뜨던 코드는 지워졌으므로 손으로 적으면 그것은
 * 지어낸 역사다. 검사 D는 1을 건너뛴다.
 *
 * ## 돌연변이 (2026-09-18)
 *
 * `schema.ts`에 하나씩 심고 이 스펙만 돌렸다. **"갱신 뒤"는 A가 운 다음 정본을 다시 뜨고
 * C를 받은 것이다** — 사람이 "의도한 변경이다" 하고 정본을 갱신했을 때를 흉내 낸 것이다.
 *
 * | # | 심은 것 | A | 갱신 뒤 C | 판정 |
 * |---|---|---|---|---|
 * | M1 | `manifestSchema`에 `z.string()` 필수 필드 추가 | 욺 | **욺** | 필수 경로가 늘었다 |
 * | M2 | `studentSchema`에서 `name` 삭제 | 욺 | **욺** | 속성이 사라졌다 |
 * | M3 | `splitSchema.testSize`를 `z.string()`으로 | 욺 | **욺** | 타입이 바뀌었다 |
 * | M4 | `MAX_STUDENT_NAME_LENGTH`를 절반으로 | **조용** | 조용 | 아래 참고 |
 * | M5 | `studentSchema`에 `z.string().optional()` 추가 | 욺 | **조용** | 선택 속성 추가 |
 * | M6 | `MAX_STUDENT_NAME_LENGTH`를 두 배로 | **조용** | 조용 | 아래 참고 |
 * | M4′ | `MAX_FAILURE_DETAIL_LENGTH`를 절반으로 | 욺 | **욺** | 제약이 좁아졌다 |
 * | M6′ | `MAX_FAILURE_DETAIL_LENGTH`를 두 배로 | 욺 | **조용** | 제약이 완화됐다 |
 *
 * **M4·M6이 조용한 것이 맞다.** `MAX_STUDENT_NAME_LENGTH`는 `studentNameInputSchema`에만
 * 걸리고 **문서 스키마에는 안 들어온다** — *"파일 파싱은 관대하게, 폼 입력은 엄격하게"*
 * (`mlpx-spec.md` §10). 상한을 넘는 이름이 든 남의 파일도 열려야 하므로 `studentSchema.name`은
 * 맨 `z.string()`이다. 그래서 그 상수는 포맷의 일부가 아니고, 움직여도 정본이 안 움직이는
 * 것이 **의도한 동작이다.** 제약 축을 실제로 재는 것은 M4′·M6′이고, 정본에 실제로 새는
 * 상한은 `MAX_FAILURE_DETAIL_LENGTH`(`maxLength: 200`)와 `MIN_SPLIT_ROWS`(`minimum: 2`)다.
 *
 * **M5가 갱신 뒤 조용한 것까지 확인해야** C가 *"모든 변경에 운다"*가 아니라 *"깨는 변경에
 * 운다"*임이 선다. 아래 "판정기를 판정한다"가 그 여덟 갈래를 검사로 굳혀 둔 것이다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { FORMAT_VERSION, projectDocumentSchema } from '../src/project/schema'

const CANON_DIR = join(process.cwd(), 'tests', 'fixtures', 'schema')

/** 환경 변수로만 켜지는 갱신 경로. 켜지면 정본을 다시 뜨고 **일부러 선다.** */
const WRITE_CANON = process.env.MLPX_WRITE_SCHEMA_CANON === '1'

/**
 * **정본을 뜨는 유일한 함수.** `src/`에는 아무것도 안 더한다 — 정본은 검사의 물건이지
 * 앱이 쓰는 물건이 아니다.
 *
 * `io: 'input'`은 파일에서 **읽어 들이는** 모양이다(`.default()`가 채워지기 전).
 * `.mlpx`를 여는 쪽이 보는 것이 그것이므로 읽기 호환을 재려면 이쪽이어야 한다.
 */
function snapshot(): unknown {
  return z.toJSONSchema(projectDocumentSchema, { io: 'input', unrepresentable: 'any' })
}

/** zod가 낸 그대로. **정렬하지 마라** — 정렬 함수가 또 하나의 정본이 된다. */
function serialise(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}

function canonPath(name: string): string {
  return join(CANON_DIR, `${name}.json`)
}

function hasCanon(name: string): boolean {
  return existsSync(canonPath(name))
}

function readCanon(name: string): unknown {
  return JSON.parse(readFileSync(canonPath(name), 'utf-8'))
}

// ------------------------------------------------------------ 호환 판정

/** 상승하면 좁아지는 것. */
const RAISED_NARROWS = ['minimum', 'exclusiveMinimum', 'minLength', 'minItems'] as const
/** 하락하면 좁아지는 것. */
const LOWERED_NARROWS = ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems'] as const

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function show(value: unknown): string {
  return value === undefined ? 'none' : JSON.stringify(value)
}

/**
 * `before`를 만족하던 문서가 `after`로도 읽히는가. **읽히지 않게 만드는 자리만** 돌려준다.
 *
 * 돌려주는 글자는 실패 메시지에 그대로 실린다 — 영어다 (`ci-language.spec.ts`).
 */
function breakingChanges(before: unknown, after: unknown, path = ''): string[] {
  const at = path === '' ? '(root)' : path
  if (!isObject(before) || !isObject(after)) {
    return same(before, after) ? [] : [`${at}: node shape changed`]
  }

  const found: string[] = []

  // 1. 필수 경로가 늘었다
  const wasRequired = new Set((Array.isArray(before.required) ? before.required : []).map(String))
  for (const name of Array.isArray(after.required) ? after.required : []) {
    if (!wasRequired.has(String(name))) found.push(`${at}: new required property "${String(name)}"`)
  }

  // 3. 타입이 바뀌었다
  if (!same(before.type, after.type)) {
    found.push(`${at}: type ${show(before.type)} -> ${show(after.type)}`)
  }
  for (const key of ['enum', 'const'] as const) {
    if (key in before && !(key in after)) found.push(`${at}: "${key}" removed`)
  }
  if ('const' in before && 'const' in after && !same(before.const, after.const)) {
    found.push(`${at}: const ${show(before.const)} -> ${show(after.const)}`)
  }
  if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
    const kept = new Set(after.enum.map((value) => JSON.stringify(value)))
    for (const value of before.enum) {
      if (!kept.has(JSON.stringify(value))) found.push(`${at}: enum value ${show(value)} removed`)
    }
  }

  // 4. 제약이 좁아졌다 - 없다가 생긴 것도 좁아진 것이다
  for (const key of RAISED_NARROWS) {
    const next = after[key]
    const prior = before[key]
    if (typeof next === 'number' && (typeof prior !== 'number' || next > prior)) {
      found.push(`${at}: "${key}" narrowed ${show(prior)} -> ${show(next)}`)
    }
  }
  for (const key of LOWERED_NARROWS) {
    const next = after[key]
    const prior = before[key]
    if (typeof next === 'number' && (typeof prior !== 'number' || next < prior)) {
      found.push(`${at}: "${key}" narrowed ${show(prior)} -> ${show(next)}`)
    }
  }
  // 없어지는 것은 완화라 통과시킨다. 생기거나 바뀌는 것만 본다.
  if (after.pattern !== undefined && !same(before.pattern, after.pattern)) {
    found.push(`${at}: "pattern" changed ${show(before.pattern)} -> ${show(after.pattern)}`)
  }

  // 2. 속성이 사라졌다 - 남은 것은 내려가며 본다
  const beforeProps = isObject(before.properties) ? before.properties : {}
  const afterProps = isObject(after.properties) ? after.properties : {}
  for (const [name, sub] of Object.entries(beforeProps)) {
    if (!(name in afterProps)) {
      found.push(`${at}: property "${name}" removed`)
      continue
    }
    found.push(...breakingChanges(sub, afterProps[name], `${path}/${name}`))
  }

  // 재귀 - 배열의 원소와 모르는 필드의 자리
  for (const key of ['items', 'additionalProperties'] as const) {
    const prior = before[key]
    const next = after[key]
    if (prior === undefined && next === undefined) continue
    if (isObject(prior) && isObject(next)) {
      found.push(...breakingChanges(prior, next, `${path}/${key}`))
      continue
    }
    if (!same(prior, next)) found.push(`${at}: "${key}" changed ${show(prior)} -> ${show(next)}`)
  }

  // 유니온 - 가지 수가 다르면 타입이 바뀐 것이다
  for (const key of ['anyOf', 'oneOf'] as const) {
    const prior = before[key]
    const next = after[key]
    if (prior === undefined && next === undefined) continue
    if (!Array.isArray(prior) || !Array.isArray(next) || prior.length !== next.length) {
      const count = (value: unknown): string =>
        Array.isArray(value) ? String(value.length) : 'none'
      found.push(`${at}: "${key}" branch count ${count(prior)} -> ${count(next)}`)
      continue
    }
    prior.forEach((branch, index) => {
      found.push(...breakingChanges(branch, next[index], `${path}/${key}/${index}`))
    })
  }

  return found
}

// ------------------------------------------------------------ 검사

const CURRENT = `v${FORMAT_VERSION}`
const RELEASED = `v${FORMAT_VERSION}.released`
const PREVIOUS = `v${FORMAT_VERSION - 1}`

describe('스키마 구조 정본', () => {
  it('A. 지금 스키마가 이 버전의 정본과 같다', () => {
    if (WRITE_CANON) {
      writeFileSync(canonPath(CURRENT), serialise(snapshot()), 'utf-8')
      throw new Error(
        `rewrote tests/fixtures/schema/${CURRENT}.json. Re-run without MLPX_WRITE_SCHEMA_CANON=1 to check it.`,
      )
    }

    expect(
      snapshot(),
      [
        'the .mlpx document structure no longer matches its canonical snapshot.',
        '1. intended change? regenerate with MLPX_WRITE_SCHEMA_CANON=1 npx vitest run tests/schema-structure.spec.ts',
        '2. not intended? revert the schema change instead of the snapshot',
        '3. after regenerating, the read-compatibility check below may demand a FORMAT_VERSION bump',
      ].join('\n'),
    ).toEqual(readCanon(CURRENT))
  })

  it('C. 정본이 배포 시점 구조와 읽기 호환이다', () => {
    expect(
      breakingChanges(readCanon(RELEASED), readCanon(CURRENT)),
      [
        `these changes stop a released v${FORMAT_VERSION} .mlpx from being read.`,
        `raise FORMAT_VERSION, add v${FORMAT_VERSION + 1}.json and v${FORMAT_VERSION + 1}.released.json,`,
        'add the migration, the vocabulary fingerprint and the versions.spec.ts expectation.',
        `do not edit v${FORMAT_VERSION}.released.json - it is history.`,
      ].join('\n'),
    ).toEqual([])
  })

  /**
   * **정본이 둘 이상일 때만 뜻이 있다.** 지금은 `v1.json`이 없어 건너뛴다 — v1을 뜨던 코드가
   * 지워졌고, 손으로 적으면 지어낸 역사다. `FORMAT_VERSION`이 3이 되는 날 이 검사가 깨어난다.
   */
  it.skipIf(!hasCanon(PREVIOUS))('B. 직전 정본과의 사이에 깨는 변경이 하나는 있다', () => {
    const breaks = breakingChanges(readCanon(PREVIOUS), readCanon(CURRENT))
    expect(
      breaks.length,
      [
        `${PREVIOUS} and ${CURRENT} are read-compatible, so the version had no structural reason to rise.`,
        'a version may still rise for a reason JSON Schema cannot show (v2 was a backbone id revision).',
        'if that is the case, say so here and relax this check deliberately.',
      ].join('\n'),
    ).toBeGreaterThan(0)
  })

  it('D. 2부터 지금 버전까지 정본이 둘씩 있다', () => {
    const missing: string[] = []
    let checked = 0
    // v1은 건너뛴다 - 뜰 방법이 없다.
    for (let version = 2; version <= FORMAT_VERSION; version += 1) {
      checked += 1
      for (const name of [`v${version}`, `v${version}.released`]) {
        if (!hasCanon(name)) missing.push(`${name}.json`)
      }
    }
    expect(checked, 'the loop covered no version. FORMAT_VERSION is below 2.').toBeGreaterThan(0)
    expect(missing, 'a raised FORMAT_VERSION needs both canonical files.').toEqual([])
  })
})

/**
 * **판정기를 판정한다.**
 *
 * 검사 C는 `breakingChanges`가 빈 배열을 내면 통과한다 — **아무것도 안 잡는 판정기를 두면
 * C가 영원히 초록이고, 그 초록은 거짓이다.** 이 저장소가 여러 번 밟은 병이다
 * (R26: *"가짜가 진짜보다 관대했다"*).
 *
 * 그래서 **실제 정본을 고쳐서** 여덟 갈래를 판정시킨다. 손으로 조립한 작은 객체가 아니라
 * 진짜 문서 스키마여야 한다 — 축소판은 `anyOf`도 중첩도 없어서 재귀를 안 지나간다.
 * 위 돌연변이 표의 M1~M6′이 이 여덟 줄과 짝이다.
 */
describe('판정기를 판정한다', () => {
  const canon = readCanon(CURRENT)

  /** 정본을 깊은 사본으로 떠서 한 자리만 고친다. 원본은 안 건드린다. */
  function patched(change: (schema: JsonObject) => void): JsonObject {
    const copy = JSON.parse(JSON.stringify(canon)) as JsonObject
    change(copy)
    return copy
  }

  function manifest(schema: JsonObject): JsonObject {
    return (schema.properties as JsonObject).manifest as JsonObject
  }

  function student(schema: JsonObject): JsonObject {
    return (manifest(schema).properties as JsonObject).student as JsonObject
  }

  function testSize(schema: JsonObject): JsonObject {
    const settings = (schema.properties as JsonObject).settings as JsonObject
    const split = (settings.properties as JsonObject).split as JsonObject
    return (split.properties as JsonObject).testSize as JsonObject
  }

  /** `maxLength: 200`이 사는 자리 - `MAX_FAILURE_DETAIL_LENGTH`가 새어 나온 곳이다. */
  function modelOmittedDetail(schema: JsonObject): JsonObject {
    const runs = (schema.properties as JsonObject).runs as JsonObject
    const experiments = (runs.properties as JsonObject).experiments as JsonObject
    const experiment = experiments.items as JsonObject
    const inner = (experiment.properties as JsonObject).runs as JsonObject
    const run = inner.items as JsonObject
    return (run.properties as JsonObject).modelOmittedDetail as JsonObject
  }

  it('자기 자신과는 깨는 변경이 없다', () => {
    expect(breakingChanges(canon, canon)).toEqual([])
  })

  it('픽스처 헬퍼가 실제 자리를 가리킨다 - 아니면 아래가 전부 헛돈다', () => {
    expect(student(canon as JsonObject).type).toBe('object')
    expect(testSize(canon as JsonObject).type).toBe('number')
    expect(modelOmittedDetail(canon as JsonObject).maxLength).toBe(200)
  })

  it('M1. 필수 속성이 늘면 깬다', () => {
    const after = patched((schema) => {
      const node = manifest(schema)
      ;(node.properties as JsonObject).teacherNote = { type: 'string' }
      ;(node.required as string[]).push('teacherNote')
    })
    expect(breakingChanges(canon, after).join('\n')).toContain(
      'new required property "teacherNote"',
    )
  })

  it('M2. 속성이 사라지면 깬다', () => {
    const after = patched((schema) => {
      delete (student(schema).properties as JsonObject).name
    })
    expect(breakingChanges(canon, after).join('\n')).toContain('property "name" removed')
  })

  it('M3. 타입이 바뀌면 깬다', () => {
    const after = patched((schema) => {
      testSize(schema).type = 'string'
    })
    expect(breakingChanges(canon, after).join('\n')).toContain('type "number" -> "string"')
  })

  it("M4'. 상한이 내려가면 깬다", () => {
    const after = patched((schema) => {
      modelOmittedDetail(schema).maxLength = 100
    })
    expect(breakingChanges(canon, after).join('\n')).toContain('"maxLength" narrowed 200 -> 100')
  })

  it('M5. 선택 속성이 늘어도 안 깬다', () => {
    const after = patched((schema) => {
      ;(student(schema).properties as JsonObject).nickname = { type: 'string' }
    })
    expect(breakingChanges(canon, after)).toEqual([])
  })

  it("M6'. 상한이 올라가도 안 깬다", () => {
    const after = patched((schema) => {
      modelOmittedDetail(schema).maxLength = 400
    })
    expect(breakingChanges(canon, after)).toEqual([])
  })

  it('필수가 선택으로 내려가도 안 깬다', () => {
    const after = patched((schema) => {
      const node = manifest(schema)
      node.required = (node.required as string[]).filter((name) => name !== 'locale')
    })
    expect(breakingChanges(canon, after)).toEqual([])
  })

  it('어휘에서 값이 빠지면 깬다 - schema-version.spec.ts와 일부러 겹친다', () => {
    const after = patched((schema) => {
      const dataType = (manifest(schema).properties as JsonObject).dataType as JsonObject
      dataType.enum = (dataType.enum as string[]).filter((value) => value !== 'image')
    })
    expect(breakingChanges(canon, after).join('\n')).toContain('enum value "image" removed')
  })

  it('유니온의 가지 수가 달라지면 깬다', () => {
    const after = patched((schema) => {
      const settings = (schema.properties as JsonObject).settings as JsonObject
      const data = (settings.properties as JsonObject).data as JsonObject
      data.anyOf = (data.anyOf as unknown[]).slice(0, 1)
    })
    expect(breakingChanges(canon, after).join('\n')).toContain('"anyOf" branch count 2 -> 1')
  })

  it('모르는 필드를 닫으면 깬다 - looseObject가 죽는 자리다', () => {
    const after = patched((schema) => {
      student(schema).additionalProperties = false
    })
    expect(breakingChanges(canon, after).join('\n')).toContain('"additionalProperties" changed')
  })
})
