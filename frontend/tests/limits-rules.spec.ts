/**
 * 상한은 `limits.ts` 하나에서만 나온다 (`CLAUDE.md` §1.5).
 *
 * **지금은 어긴 곳이 하나도 없다** (2026-08-12 확인). 이 검사가 있는 이유는 지키게
 * 하려는 것이 아니라 **다음에 누가 넣었을 때 알게 하려는 것**이다 — 상한이 코드에
 * 직접 박히면 `limits.ts`를 고쳐도 그 자리가 안 따라오고, 그건 아무도 눈치채지 못한다.
 * 화면 규칙(`ui-rules.spec.ts`)·i18n 규칙(`i18n-usage.spec.ts`)과 같은 계열이다.
 *
 * **검사기 자체를 먼저 검사한다.** 정규식이 틀렸을 때 아무것도 안 잡으면서 조용히
 * 초록색이 되는 것이 제일 나쁜 상태다.
 *
 * ---
 *
 * **이 검사가 못 보는 것을 밝혀 둔다.** 밝히지 않으면 다음 사람이 이 초록색을 실제보다
 * 넓게 믿는다.
 *
 * - **`0`·`1`·`2`와의 비교는 통과시킨다.** 그 자리는 개수 상한이 아니라 **구조를 묻는
 *   자리**다 — 비었는가, 하나뿐인가, 짝이 되는가. 실제로 `tally.length < 2`("견줄 것이
 *   둘은 있는가")와 `axes.length >= 2`("축을 고를 수 있는가")가 그렇다. 기계는 그 둘을
 *   `MIN_SPLIT_ROWS`(값이 2다)와 구분할 수 없다. **그래서 두 자리 이하의 상한을
 *   손으로 박으면 이 검사는 못 본다.**
 * - **상한처럼 안 생긴 이름은 못 본다.** 아래 첫 규칙은 이름으로 잡는다.
 * - **하이퍼파라미터 기본값은 대상이 아니다** (`maxDepth: 5`, `max_iter: 300`).
 *   그건 알고리즘 등록부가 갖는 값이지 자원 상한이 아니다 (`CLAUDE.md` §1.5는
 *   "크기·개수·시간 상한"을 말한다).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

/** 상한이 사는 곳. 여기만 숫자를 직접 쓴다. */
const LIMITS = join(SRC, 'limits.ts')

interface Rule {
  readonly name: string
  readonly why: string
  readonly pattern: RegExp
  readonly violations: readonly string[]
  readonly allowed: readonly string[]
  /**
   * 이 규칙만 건너뛰는 파일. **값이 사는 그 한 곳이다** — 상한은 `limits.ts`라 아예
   * 안 훑지만, 등록부처럼 자기 파일에 사는 값도 있다.
   */
  readonly source?: string
}

const RULES: readonly Rule[] = [
  {
    name: '상한 이름에 숫자를 직접 묶지 않는다',
    why: '`limits.ts`를 고쳐도 이 자리가 안 따라온다. 상한이 두 곳에 살면 어긋났을 때 판정할 근거가 없다.',
    // `MAX_*`/`MIN_*`/`*Limit`/`*Budget`/`maxRows`에 숫자 리터럴을 바로 붙이는 것.
    // 이름으로 잡으므로 하이퍼파라미터 기본값(maxDepth: 5)은 안 걸린다.
    pattern:
      /\b(?:MAX|MIN)_[A-Z0-9_]+\s*[=:]\s*\d|\b\w*(?:Limit|Budget)\b\s*[=:]\s*\d|\bmaxRows\s*[=:]\s*\d/,
    violations: [
      'const MAX_UPLOAD_ROWS = 5000',
      'export const modelBudget = 20 * MB',
      '    maxRows: 5000,',
      'const rowLimit = 3_000',
    ],
    allowed: [
      // 이름으로 가져다 쓰는 것이 정상이다.
      'const maxRows = MLJS_SVM_ROW_LIMIT',
      "    maxRows: { mljs: MLJS_KNN_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },",
      'if (rows.length > option.maxRows) return',
      // 하이퍼파라미터 기본값은 등록부의 것이지 자원 상한이 아니다.
      'const maxDepth = 5',
      '    hyperparameters: { maxDepth: 5, minNumSamples: 3 },',
    ],
  },
  {
    name: '길이·크기를 숫자와 견주지 않는다',
    why: '`rows.length > 5000` 한 줄이 등록부의 행 상한을 조용히 무시한다.',
    // 0·1·2는 개수가 아니라 구조를 묻는 자리라 통과시킨다 (머리말 참조).
    pattern: /\.(?:length|size|byteLength)\s*[<>]=?\s*(?![012]\b)\d+/,
    violations: [
      "if (rows.length > 5000) throw new ClientError('DATASET_TOO_MANY_ROWS')",
      'if (bytes.byteLength >= 5242880) return',
      'if (columns.size > 1000) return',
    ],
    allowed: [
      // 구조를 묻는 자리.
      'if (rows.length > 0) return rows',
      'if (labels.length > 1) return null',
      'if (tally.length < 2) return null',
      'if (props.axes.length >= 2) show()',
      // 이름으로 견주는 것이 정상이다.
      'if (rows.length > MAX_DATASET_ROWS) throw',
      'if (rows.length < MIN_SPLIT_ROWS) throw',
      // 두 자리 이상이어도 이름이면 안 걸린다.
      'if (found.length > PREVIEW_ROW_COUNT) found.length = PREVIEW_ROW_COUNT',
    ],
  },
  {
    name: '정본 MIME을 소스에 박지 않는다',
    why: '형식은 등록부가 갖는다 (`data/image/formats.ts`). 박아 두면 webp 프로젝트의 사진이 jpeg라고 말하는 Blob이 생기고, 객체 URL에서는 그 타입이 곧 그 자원의 MIME이다.',
    // 정본이 될 수 있는 이미지 MIME 문자열. 등록부 파일에서만 쓴다.
    pattern: /['"`]image\/(?:webp|jpeg|jpg|png)['"`]/,
    violations: [
      "const blob = new Blob([bytes], { type: 'image/jpeg' })",
      'await canvas.convertToBlob({ type: "image/webp", quality })',
    ],
    allowed: [
      'const blob = new Blob([bytes], { type: entry.format.mime })',
      'await canvas.convertToBlob({ type: format.mime, quality: format.quality })',
      // 파일 고르기의 accept는 형식을 고르는 것이 아니라 무엇을 받을지의 목록이다.
      "export const IMAGE_ACCEPT = 'image/*,.zip'",
    ],
    source: join(SRC, 'data', 'image', 'formats.ts'),
  },
  {
    name: '기다리는 시간을 숫자로 쓰지 않는다',
    why: '자동 저장 지연과 알림 수명이 `limits.ts`에 있다. 흩뿌려지면 교실 PC에서 무엇을 줄여야 하는지 못 찾는다.',
    // `setTimeout(fn, 0)`은 시간이 아니라 **다음 틱으로 넘기는 것**이라 통과시킨다.
    // 여러 줄로 쓴 콜백은 닫는 줄(`}, 800)`)에서 잡는다.
    pattern: /\bset(?:Timeout|Interval)\s*\([^,]*,\s*(?!0\s*\))\d+|^\s*\},\s*\d+\s*\)/,
    violations: [
      'setTimeout(() => close(), 6000)',
      'const timer = setInterval(tick, 1000)',
      '  }, 800)',
    ],
    allowed: [
      'pending = setTimeout(() => {',
      '  }, AUTOSAVE_DELAY_MS)',
      'setTimeout(resolve, AUTOSAVE_DELAY_MS)',
      // 0은 시간이 아니라 이벤트 루프에 자리를 내주는 것이다.
      'return new Promise((resolve) => setTimeout(resolve, 0))',
    ],
  },
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (path === LIMITS) return []
    return /\.(ts|vue)$/.test(entry) && !/\.spec\.ts$/.test(entry) ? [path] : []
  })
}

/**
 * 주석을 걷어낸 줄들. **막으려는 것은 코드이지 설명이 아니다** — `limits.ts`를 가리키는
 * 주석에는 숫자가 자주 나온다(`// 5000행 100그루가 약 7분이다`).
 */
function withoutComments(source: string): string[] {
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

describe('검사기가 실제로 잡는다', () => {
  for (const rule of RULES) {
    describe(rule.name, () => {
      for (const line of rule.violations) {
        it(`위반을 잡는다: ${line.trim()}`, () => {
          expect(rule.pattern.test(line)).toBe(true)
        })
      }
      for (const line of rule.allowed) {
        it(`정상을 안 잡는다: ${line.trim()}`, () => {
          expect(rule.pattern.test(line)).toBe(false)
        })
      }
    })
  }

  it('주석은 걷어낸다 - 상한을 설명하는 주석에는 숫자가 자주 나온다', () => {
    const source = ['// maxRows: 5000 이라고 적으면 안 된다', 'const ok = MAX_DATASET_ROWS'].join(
      '\n',
    )
    expect(withoutComments(source).join('\n').trim()).toBe('const ok = MAX_DATASET_ROWS')
  })
})

describe('지금 소스에 위반이 없다', () => {
  /**
   * **빈 목록에서 조용히 통과하지 않는다.** 경로가 틀리거나 확장자가 바뀌면 훑을 파일이
   * 0개가 되고, 그러면 아래 검사가 영원히 초록이 된다.
   */
  it('훑을 파일을 실제로 찾는다', () => {
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(0)
    // limits.ts 자신은 빠져 있어야 한다. 거기는 숫자를 쓰는 유일한 곳이다.
    expect(files).not.toContain(LIMITS)
  })

  for (const rule of RULES) {
    it(rule.name, () => {
      const found: string[] = []
      for (const path of sourceFiles(SRC)) {
        if (path === rule.source) continue
        withoutComments(readFileSync(path, 'utf-8')).forEach((line, index) => {
          if (rule.pattern.test(line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
      }
      expect(found).toEqual([])
    })
  }
})
