/**
 * **데이터 종류별 설정은 `settings.data`를 거쳐 읽는다** (mlpx-spec.md §3).
 *
 * 이 검사가 있는 이유는 **타입이 이 자리를 못 잡기 때문이다.** `Settings`는 looseObject라
 * 인덱스 시그니처(`[x: string]: unknown`)를 갖고, 그래서 `settings.target`은 컴파일
 * 오류가 아니라 **`unknown`**이다. `unknown !== undefined`는 그대로 통과하고, 런타임에는
 * 언제나 `undefined`다.
 *
 * **실제로 그렇게 새어 나갔다** (2026-08-12). 스키마를 가르면서 `settings.value?.target`
 * 두 자리가 안 고쳐졌는데, `vue-tsc`도 검사 1,349개도 아무 말을 안 했다. 화면에서는
 * **타깃을 골랐는데도 "타깃을 먼저 정해야 합니다"가 뜨면서 평가 데이터 업로드가 통째로
 * 막혔다** — 코드 소유자가 눈으로 잡았다.
 *
 * 이름 목록은 **등록부에서 나온다.** 이미지가 등록되면 그 종류의 필드도 자동으로 이
 * 검사의 대상이 된다.
 *
 * ---
 *
 * **못 보는 것을 밝혀 둔다.** 밝히지 않으면 다음 사람이 이 초록색을 실제보다 넓게 믿는다.
 *
 * - **이름이 `settings`가 아닌 변수는 못 본다.** `const s = document.settings` 뒤의
 *   `s.target`은 안 걸린다. 이 저장소가 그 값을 `settings`·`current`로 부르는 관용구를
 *   지키는 동안만 유효하다.
 * - **구조 분해는 못 본다.** `const { target } = settings`는 잡히지 않는다.
 *   다만 그 모양은 `settings.data`에서 꺼내는 것이 자연스러워 실수가 덜하다.
 * - **`settings.data`를 거친 뒤의 오타는 대상이 아니다.** 거기서부터는 타입이 잡는다.
 *
 * **주석도 대상이다. 일부러 그랬다.** 코드가 아니라 문구라 런타임에는 아무 일이 없지만,
 * 옛 경로를 가리키는 주석은 다음 사람을 그 자리로 데려간다 — 실제로 `schema.ts`의 주석
 * 하나가 이 검사에 처음 걸렸다. 역사를 이야기하느라 옛 이름을 꼭 써야 하는 자리가
 * 나오면 그때 문장을 다시 쓰면 된다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DATA_SCHEMAS, DATA_TYPES } from '../src/project/schema'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

/** 종류별 필드 이름 전부. 등록부가 출처다 (`project/schema.ts`의 `DATA_SCHEMAS`). */
const KIND_FIELDS = [
  ...new Set(
    DATA_TYPES.flatMap((dataType) => [
      ...Object.keys(DATA_SCHEMAS[dataType].settings.shape),
      ...Object.keys(DATA_SCHEMAS[dataType].snapshot.shape),
    ]),
  ),
]

/**
 * `settings.target` / `settings.value?.target` / `.settings?.features` 를 잡고
 * `settings.data.target`은 통과시킨다.
 *
 * `\b` 대신 뒤를 명시적으로 끊는 이유는 `settings.targetKind` 같은 긴 이름을 안 잡기
 * 위해서다.
 */
function leakPattern(field: string): RegExp {
  return new RegExp(`settings(\\.value)?\\??\\.${field}(?![\\w$])`)
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry) && !/\.spec\.ts$/.test(entry) ? [path] : []
  })
}

const NEWLINE = String.fromCharCode(10)

function leaks(source: string): string[] {
  return source
    .split(NEWLINE)
    .filter((line) => KIND_FIELDS.some((field) => leakPattern(field).test(line)))
    .map((line) => line.trim())
}

describe('종류별 설정은 settings.data를 거친다', () => {
  it('등록부에서 이름을 가져온다 - 비면 아래가 조용히 통과한다', () => {
    expect(KIND_FIELDS.length).toBeGreaterThan(0)
    expect(KIND_FIELDS).toContain('target')
  })

  /** **검사기 자체를 먼저 검사한다.** 정규식이 틀려 아무것도 안 잡는 것이 제일 나쁘다. */
  it('새어 나간 모양을 잡는다', () => {
    expect(
      leaks('const targetChosen = computed(() => settings.value?.target !== undefined)'),
    ).toHaveLength(1)
    expect(leaks('const target = settings.target')).toHaveLength(1)
    expect(leaks('if (document.settings.features.length === 0) return')).toHaveLength(1)
  })

  it('제대로 거친 것은 안 잡는다', () => {
    expect(leaks('const target = settings.value?.data.target')).toEqual([])
    expect(leaks('const { target } = document.settings.data')).toEqual([])
    // 공통 필드는 settings에서 바로 읽는 것이 맞다.
    expect(leaks('const seed = settings.value?.split.randomState')).toEqual([])
    // 긴 이름을 잘라 잡으면 안 된다.
    expect(leaks('const rule = settings.targetKind')).toEqual([])
  })

  it('소스에 새어 나간 자리가 없다', () => {
    const found = sourceFiles(SRC).flatMap((path) =>
      leaks(readFileSync(path, 'utf-8')).map((line) => `${path.slice(SRC.length + 1)}  ${line}`),
    )
    expect(found, '종류별 필드는 settings.data를 거쳐 읽어라').toEqual([])
  })
})
