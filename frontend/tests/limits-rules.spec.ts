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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles, withoutComments } from './fixtures/source'

import { BYTES_PER_MB } from '../src/limits'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

/** 상한이 사는 곳. 여기만 숫자를 직접 쓴다. */
const LIMITS = join(SRC, 'limits.ts')

/** 줄 나누기. 정규식 리터럴로 둔다 - 문자열로 적으면 이스케이프가 한 겹 더 든다. */
const NEWLINE = /\r?\n/

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

/** 공용 걷기에서 **`limits.ts` 자신만 뻐다** - 유일한 출처가 자기를 위반할 수는 없다. */
function scanned(directory: string): string[] {
  return sourceFiles(directory).filter((path) => path !== LIMITS)
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
    const files = scanned(SRC)
    expect(files.length).toBeGreaterThan(0)
    // limits.ts 자신은 빠져 있어야 한다. 거기는 숫자를 쓰는 유일한 곳이다.
    expect(files).not.toContain(LIMITS)
  })

  for (const rule of RULES) {
    it(rule.name, () => {
      const found: string[] = []
      for (const path of scanned(SRC)) {
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

/**
 * **`limits.ts`가 내보내는 이름은 전부 어딘가에서 읽힌다.**
 *
 * 아무도 안 읽는 상한은 거짓말이다. 값이 무엇이든 아무 일도 안 일어나므로 **고쳐도
 * 아무것도 안 울고**, 더 나쁜 것은 문서가 그것을 돌고 있는 장치로 인용하는 것이다 —
 * `PROJECT_FILE_WARN_BYTES`가 실제로 그랬다(V11 R5 B-3, `open-decisions.md` 세 곳).
 * R1이 `canonicalSize`에서 찾은 것과 같은 모양이고, **두 번 나왔으므로 검사로 만든다.**
 *
 * `locales.spec.ts`의 "아무 데서도 안 불리는 키가 없다"와 같은 방향이다.
 */
describe('상한은 전부 읽힌다', () => {
  /** `export const NAME` 의 이름들. 타입·함수는 대상이 아니다. */
  function exportedNames(source: string): string[] {
    return [...source.matchAll(/^export const (\w+)/gm)].map((match) => match[1] ?? '')
  }

  const NAMES = exportedNames(readFileSync(LIMITS, 'utf-8'))

  it('내보내는 상한을 실제로 찾는다', () => {
    // 0개면 정규식이 썩은 것이지 규칙이 지켜진 게 아니다.
    expect(NAMES.length).toBeGreaterThan(20)
  })

  it('아무도 안 읽는 상한이 없다', () => {
    // `limits.ts` 자신은 뺀다 - 상한이 상한을 부르는 것은 정상이다(MLJS_*_ROW_LIMIT).
    const readers = scanned(SRC).map((path) => readFileSync(path, 'utf-8'))
    const orphans = NAMES.filter(
      (name) => !readers.some((source) => new RegExp(`\\b${name}\\b`).test(source)),
    )
    expect(orphans, '아무 데서도 안 읽히는 상한').toEqual([])
  })
})

/**
 * **화면과 상한을 잇는 줄이 끊겨도 아무것도 안 울었다** (V11 R5 B-4).
 * `CLUSTER_SCATTER_POINT_LIMIT`에는 근거가 촘촘히 붙어 있다 — 개발 PC 실측, 감사자의
 * 독립 재측정, `animation: false`가 화면에 실제로 있어야 그 숫자가 화면의 숫자라는 못까지.
 * 그런데 `clusters.spec.ts`는 `scatterPoints`를 **인자로 받은 상한**으로 검사하므로,
 * 화면이 그 상수를 안 넘겨도 초록이다.
 *
 * **못 잡는 것을 밝혀 둔다** — 이 검사는 *줄이 이어져 있는가*만 본다. **상수의 값 자체가
 * 바뀌는 것은 어떤 검사도 못 잡는다.** 자기를 기준으로 쓴 검사는 값을 따라 커지기
 * 때문이다. 값을 못 박는 것은 `versions.spec.ts`가 포맷 버전에 하는 일인데, 실측으로
 * 고른 조율 상수에까지 그것을 하지는 않는다 — 근거는 그 상수의 주석이 갖는다.
 */
describe('산점도 상한이 화면까지 이어진다', () => {
  // 정의한 파일은 부르는 쪽이 아니다 - 상한을 인자로 받는 것이 그 함수의 계약이다.
  const CALLERS = scanned(SRC).filter((path) => {
    const source = readFileSync(path, 'utf-8')
    return source.includes('scatterPoints(') && !source.includes('export function scatterPoints')
  })

  it('부르는 화면을 실제로 찾는다', () => {
    // 0개면 이름이 바뀐 것이지 규칙이 지켜진 게 아니다.
    expect(CALLERS.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * **`import` 줄은 빼고 본다.** 안 빼면 상수를 들여오기만 하고 안 쓰는 파일이 통과한다 —
   * 실제로 이 검사를 처음 썼을 때 그렇게 조용히 초록이었다.
   */
  function bodyOf(path: string): string {
    return readFileSync(path, 'utf-8')
      .split(NEWLINE)
      .filter((line) => !line.trimStart().startsWith('import'))
      .join('\n')
  }

  it('상한을 손으로 안 적고 상수를 넘긴다', () => {
    const missing = CALLERS.filter(
      (path) => !bodyOf(path).includes('CLUSTER_SCATTER_POINT_LIMIT'),
    ).map((path) => path.slice(SRC.length + 1))
    expect(missing, 'scatterPoints를 부르면서 상수를 안 넘기는 자리').toEqual([])
  })
})

/**
 * **상한마다 "무엇이 붙잡고 있나"가 달려 있는가** (open-decisions.md "상한은 누가 정했느냐로
 * 갈리고, 우리 기기가 정한 것은 끌 수 있다", 2026-08-19).
 *
 * off 스위치가 끄는 것은 **우리 기기가 정한 줄 하나**다. 그 줄을 코드가 스스로 말하지
 * 않으면 다음에 상한을 더하는 사람이 어느 줄인지 안 밝히고, **스위치가 조용히 셋째
 * 줄까지 끈다** — 분할이 깨지고 윈도우에서 압축이 반만 풀린다.
 *
 * **분류는 값이 아니라 근거를 따라간다.** `PREDICT_PAGE_SIZE`는 페이지처럼 생겼지만
 * 자기 주석이 *"화면을 위한 것이 아니라 계산을 위한 것"*이라 기기 줄이고,
 * `CLUSTER_MEMBER_PAGE_SIZE`는 값이 스무 줄로 비슷해도 근거가 *"훑기 좋은가"*라
 * 상한이 아니다. **그래서 기계가 대신 골라 줄 수 없다** — 여기서는 "달려 있는가"만 본다.
 */
describe('MB는 십진이다', () => {
  /**
   * **되돌리면 알림이 있으나 마나가 된다.**
   *
   * 이 저장소가 밖에서 가져온 유일한 크기 기준이 십진이다 — LMS 첨부 100MB
   * (`open-decisions.md` "MB는 십진 백만이다"). 이진으로 두면 우리가 "100MB"라고 적은
   * 문턱이 실제로는 104.9MB가 되어 **LMS가 거절할 파일에 아무 말도 안 한다.**
   *
   * `1024 * 1024`는 눈으로 보면 옳아 보이고 타입도 안 운다. 그래서 여기서 문다.
   */
  it('BYTES_PER_MB가 백만이다', () => {
    expect(BYTES_PER_MB).toBe(1_000_000)
  })

  /**
   * **크기를 MB로 바꾸는 자리가 이 상수를 지나는가.**
   *
   * 새 화면이 `bytes / (1024 * 1024)`를 손으로 적으면 그 화면만 다른 단위로 말하고,
   * 같은 파일이 두 화면에서 다른 수로 읽힌다 — 실제로 문서와 화면 사이에서 그렇게
   * 갈려 있었다.
   */
  it('소스가 1024로 MB를 만들지 않는다', () => {
    const found: string[] = []
    for (const path of sourceFiles(SRC)) {
      withoutComments(readFileSync(path, 'utf8')).forEach((line, index) => {
        if (/1024\s*\*\s*1024/.test(line)) {
          found.push(`${path.slice(SRC.length + 1).replace(/\\/g, '/')}:${index + 1}`)
        }
      })
    }
    expect(found, '손으로 MB를 만드는 자리').toEqual([])
  })
})

describe('상한마다 분류가 달려 있다', () => {
  /** 결정문이 세운 여섯. **늘리려면 결정문을 먼저 고쳐라.** */
  const CLASSES = [
    '우리 기기가 정했다',
    '파일이 나간 뒤가 요구한다',
    '계산 자체가 요구한다',
    '교실을 보고 골랐다',
    // **아직 아무도 안 쓴다.** 100MB 경고가 첫 줄이 된다 — 자리를 먼저 세워 두지 않으면
    // 그 상수가 들어올 때 갈 칸이 없어 아무 칸에나 들어간다 (R6 감사 B-9).
    '알림이다',
    '상한이 아니다',
  ] as const

  /**
   * 줄 나누기. **위의 `NEWLINE`은 나누는 정규식이라 잇는 데 못 쓴다** — 그걸 `join`에
   * 넘기면 메시지에 `/\r?\n/`이라는 글자가 박히고, 검사는 그대로 초록이다.
   */
  const LINE_BREAK = String.fromCharCode(10)

  /**
   * 상수 **바로 앞에 붙은** 주석에 달린 분류. 없으면 `null`이다.
   *
   * **"바로 앞"을 글자로 확인한다.** 마지막 `/**`부터 잘라 오는 것만으로는 모자랐다 —
   * 상수에 주석이 **아예 없으면** 그 조각이 앞 상수의 주석이 되고, 거기 달린 분류가
   * 이 상수의 것으로 읽힌다 (R6 감사 B-4). `우리 기기가 정했다`가 스물넷으로 가장
   * 흔하므로 주석을 안 붙인 새 상한은 **off 스위치가 끄는 줄로 빨려 들어간다.**
   *
   * 그래서 잘라 온 조각이 `*∕`로 닫히고 그 뒤에 공백만 있는지 본다. 사이에 다른 코드
   * 줄이 있으면 그 주석은 이 상수의 것이 아니다.
   */
  function classOf(source: string, name: string): string | null {
    const at = source.search(new RegExp(`^export const ${name}\\b`, 'm'))
    if (at < 0) return null
    const before = source.slice(0, at)
    const opened = before.lastIndexOf('/**')
    if (opened < 0) return null
    const comment = before.slice(opened)
    if (!/\*\/\s*$/.test(comment)) return null
    const found = comment.match(/\*\*분류: (.+?)\.\*\*/)
    return found?.[1] ?? null
  }

  const SOURCE = readFileSync(LIMITS, 'utf-8')
  const NAMES = [...SOURCE.matchAll(/^export const (\w+)/gm)].map((match) => match[1] ?? '')

  it('훑을 상한을 실제로 찾는다', () => {
    // 0개면 정규식이 썩은 것이지 규칙이 지켜진 게 아니다.
    expect(NAMES.length).toBeGreaterThan(20)
  })

  it('분류가 없는 상한이 없다', () => {
    const missing = NAMES.filter((name) => classOf(SOURCE, name) === null)
    expect(
      missing,
      [
        '분류가 안 달린 상한이 있다. 주석에 `**분류: …**` 한 줄을 더해라.',
        `  고를 것: ${CLASSES.join(' · ')}`,
        '  뜻과 근거는 limits.ts 머리말과 open-decisions.md의 결정문에 있다.',
        '  **"우리 기기가 정했다"만 off 스위치가 끈다** - 잘못 달면 분할이 깨진다.',
      ].join(LINE_BREAK),
    ).toEqual([])
  })

  it('결정문에 없는 분류를 쓰지 않는다', () => {
    const unknown = NAMES.map((name) => classOf(SOURCE, name)).filter(
      (value) => value !== null && !CLASSES.includes(value as (typeof CLASSES)[number]),
    )
    expect(unknown, '결정문이 세운 여섯 밖의 분류').toEqual([])
  })

  /** **검사기를 먼저 검사한다.** 아무것도 안 잡으면서 초록인 것이 제일 나쁘다. */
  it('분류를 떼면 잡는다', () => {
    const fake = ['/**', ' * 무엇을 막는지.', ' */', 'export const MAX_FAKE = 1', ''].join(
      LINE_BREAK,
    )
    expect(classOf(fake, 'MAX_FAKE')).toBeNull()
  })

  /** **주석을 아예 안 붙인 상수가 앞 분류를 물려받지 않는다** (R6 감사 B-4). */
  it('주석이 없으면 앞 상수의 분류를 안 물려받는다', () => {
    const fake = [
      '/**',
      ' * 앞 상수.',
      ' *',
      ' * **분류: 계산 자체가 요구한다.**',
      ' */',
      'export const MAX_BEFORE = 1',
      '',
      'export const MAX_BARE = 2',
      '',
    ].join(LINE_BREAK)
    expect(classOf(fake, 'MAX_BEFORE')).toBe('계산 자체가 요구한다')
    expect(classOf(fake, 'MAX_BARE')).toBeNull()
  })

  it('남의 분류를 이 상수의 것으로 읽지 않는다', () => {
    const fake = [
      '/**',
      ' * 앞 상수.',
      ' *',
      ' * **분류: 계산 자체가 요구한다.**',
      ' */',
      'export const MAX_BEFORE = 1',
      '',
      '/** 주석은 있는데 분류가 없다. */',
      'export const MAX_AFTER = 2',
      '',
    ].join(LINE_BREAK)
    expect(classOf(fake, 'MAX_BEFORE')).toBe('계산 자체가 요구한다')
    expect(classOf(fake, 'MAX_AFTER')).toBeNull()
  })
})
