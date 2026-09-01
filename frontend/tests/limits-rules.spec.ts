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
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles, windowedHits, withoutComments } from './fixtures/source'

import { formatBytes } from '../src/composables/useFormat'
import {
  BYTES_PER_KB,
  BYTES_PER_MB,
  MAX_IMAGE_COUNT,
  MLJS_IMAGE_DECISION_TREE_ROW_LIMIT,
  MLJS_IMAGE_KMEANS_ROW_LIMIT,
  MLJS_IMAGE_KNN_ROW_LIMIT,
  MLJS_IMAGE_LOGISTIC_REGRESSION_ROW_LIMIT,
  MLJS_IMAGE_NAIVE_BAYES_ROW_LIMIT,
  MLJS_IMAGE_RANDOM_FOREST_ROW_LIMIT,
  MLJS_IMAGE_SVM_ROW_LIMIT,
  PROJECT_FILE_WARN_BYTES,
} from '../src/limits'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src not found: ${SRC}`)

/**
 * 상수 **바로 앞에 붙은** 주석에 달린 분류. 없으면 `null`이다.
 *
 * **"바로 앞"을 글자로 확인한다.** 마지막 `/**`부터 잘라 오는 것만으로는 모자랐다 —
 * 상수에 주석이 **아예 없으면** 그 조각이 앞 상수의 주석이 되고, 거기 달린 분류가
 * 이 상수의 것으로 읽힌다 (R6 감사 B-4). `우리 기기가 정했다`가 스물셋으로 가장
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
      'if (found.length > TABLE_PREVIEW_ROW_COUNT) found.length = TABLE_PREVIEW_ROW_COUNT',
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
  {
    name: '1024로 크기를 재지 않는다',
    why: '십진 MB를 쓰기로 했는데(open-decisions.md "MB는 십진 백만이다") 한 화면만 이진으로 재면 학생이 읽는 수가 상한과 다르다. 실제로 100MB 경고가 화면에서 `95.4MB`라고 말했다.',
    // **연산자를 안 본다.** 곱셈만 보던 때는 나눗셈으로 올라가던 화면을 놓쳤고(R13-4 A-1),
    // 연산자를 넣은 뒤에도 `const KIB = 1024`로 이름을 붙이면 빠져나갔다(R13-3 A-3).
    // 배수는 `limits.ts`의 `BYTES_PER_KB` 하나이고, 그 파일은 이 걷기에서 빠져 있다.
    pattern: /\b1_?024\b/,
    violations: [
      'const KIB = 1024',
      '  while (value >= 1024) {',
      '    value /= 1024',
      'const bytes = mb * 1024 * 1024',
      'const step = 1_024',
    ],
    allowed: [
      'while (value >= BYTES_PER_KB) {',
      'const bytes = megabytes * BYTES_PER_MB',
      // 자리 경계를 본다 - 다른 수 안에 든 1024는 이 규칙의 대상이 아니다.
      'const size = 10240',
      'const half = 512',
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
        found.push(
          ...windowedHits(
            (text) => rule.pattern.test(text),
            readFileSync(path, 'utf-8'),
            path.slice(SRC.length + 1),
          ),
        )
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
    expect(orphans, 'a limit nothing reads').toEqual([])
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

  /**
   * **스위치를 거친 이름도 같은 줄이다** (2026-09-01). 화면은 이제 상수를 직접 안 읽고
   * `clusterScatterPointLimit()`을 부른다 — 그 함수가 `limits-switch.ts`에서 이 상수를
   * 읽으므로 줄은 그대로 이어져 있고, **끊긴 것과 거쳐 간 것을 여기서 갈라야 한다.**
   * 상수 이름만 보던 이 검사는 그 이사에서 울었고, 그것이 이 검사가 하는 일이다.
   */
  it('상한을 손으로 안 적고 상수를 넘긴다', () => {
    const missing = CALLERS.filter(
      (path) =>
        !bodyOf(path).includes('CLUSTER_SCATTER_POINT_LIMIT') &&
        !bodyOf(path).includes('clusterScatterPointLimit('),
    ).map((path) => path.slice(SRC.length + 1))
    expect(missing, 'calls scatterPoints without passing the constant').toEqual([])
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
/**
 * **이미지 행 상한들의 순서.**
 *
 * `algorithms.spec.ts`의 `행 상한 칸에 제 이름의 상수가 온다`는 등록부의 칸에 **어느
 * 이름**이 오는지만 본다. 그래서 같은 맞바꿈을 `limits.ts`의 **값**에서 하면 학생이
 * 겪는 일이 글자 하나 안 다른데 저장소가 조용했다 (R13-5 감사 A-4).
 *
 * **값을 여기 옮겨 적지 않는다** — 그러면 상한이 두 곳에 살고, 이 파일이 스스로 금지한
 * 것이 그것이다. 대신 **순서**를 못 박는다. 순서는 실측이 정한 사실이고 값이 바뀌어도
 * 안 뒤집힌다 — 뒤집히면 그건 새 실측이라 이 줄을 함께 고칠 자리다.
 *
 * 근거는 각 상수의 주석에 있는 2026-08-14 실측이다. 랜덤포레스트가 500장 113초인데
 * 결정 트리는 1,000장 58.7초다 — **무거운 쪽이 더 낮아야 한다.**
 */
describe('이미지 행 상한은 무거운 순서다', () => {
  it('무거운 둘이 가벼운 것보다 낮다', () => {
    expect(MLJS_IMAGE_RANDOM_FOREST_ROW_LIMIT).toBeLessThan(MLJS_IMAGE_DECISION_TREE_ROW_LIMIT)
    expect(MLJS_IMAGE_DECISION_TREE_ROW_LIMIT).toBeLessThan(MLJS_IMAGE_SVM_ROW_LIMIT)
    expect(MLJS_IMAGE_SVM_ROW_LIMIT).toBeLessThan(MLJS_IMAGE_KNN_ROW_LIMIT)
  })

  /** 재 보니 상한을 둘 이유가 없던 넷. 사진 수 천장을 그대로 쓴다. */
  it('가벼운 넷은 사진 수 천장을 그대로 쓴다', () => {
    expect(MLJS_IMAGE_KNN_ROW_LIMIT).toBe(MAX_IMAGE_COUNT)
    expect(MLJS_IMAGE_NAIVE_BAYES_ROW_LIMIT).toBe(MAX_IMAGE_COUNT)
    expect(MLJS_IMAGE_LOGISTIC_REGRESSION_ROW_LIMIT).toBe(MAX_IMAGE_COUNT)
    expect(MLJS_IMAGE_KMEANS_ROW_LIMIT).toBe(MAX_IMAGE_COUNT)
  })
})

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
   * **글자를 훑는 것만으로는 못 잡는다.** 위 검사는 `1024`라는 글자를 찾을 뿐이라,
   * 다른 수로 같은 잘못을 하면 조용하다. 화면에 실제로 나가는 문자열을 본다.
   *
   * `PROJECT_FILE_WARN_BYTES`가 특히 중요하다 — 이 값이 그대로 경고 문장의 `{limit}`에
   * 들어가므로, 여기가 어긋나면 **학생이 "95.4MB보다 크면 못 낸다"를 읽는다.**
   */
  it('화면에 나가는 크기도 십진이다', () => {
    expect(formatBytes('en', BYTES_PER_MB)).toBe('1 MB')
    expect(formatBytes('en', PROJECT_FILE_WARN_BYTES)).toBe('100 MB')
    expect(formatBytes('en', BYTES_PER_KB)).toBe('1 kB')
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
    expect(unknown, 'a class outside the six the decision set').toEqual([])
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

  /**
   * **결정문의 전수 목록과 소스의 태그가 같은 수를 센다.**
   *
   * 위 `분류가 없는 상한이 없다`는 태그가 **달려 있는가**와 **여섯 중 하나인가**만 본다.
   * 어느 상수가 어느 칸인지는 결정문의 표에만 있고 **그 표는 손으로 센다** — 실제로
   * 한 번 낡았다(44개라 적혀 있는데 52개였다, R13-5 감사 C-6). 그 표가 낡으면 다음 사람이
   * off 스위치가 무엇을 끄는지를 틀린 목록에서 읽는다.
   *
   * **개수만 본다.** 결정문이 이름을 줄여 적기 때문이다(`MLJS_*_ROW_LIMIT` 여덟). 그래서
   * **못 보는 것: 두 상수가 칸을 맞바꾸는 것** — 그때는 개수가 그대로다. 그건 사람이 볼
   * 자리이고, 이 검사가 잡는 것은 **더 흔한 쪽**인 "상수를 더하거나 옮기고 표를 안 고쳤다"다.
   */
  describe('분류 목록이 결정문과 같은 수를 센다', () => {
    const DECISION = join(process.cwd(), '..', 'docs', 'open-decisions', '06-audit.md')

    /** 결정문 표의 `| **분류** (N) | …` 줄들. */
    function documented(): Map<string, number> {
      const text = readFileSync(DECISION, 'utf-8')
      const found = new Map<string, number>()
      for (const match of text.matchAll(/^\| \*\*(.+?)\*\*(?: \((\d+)\))? \|/gm)) {
        const count = match[2]
        if (count !== undefined) found.set(match[1] ?? '', Number(count))
      }
      return found
    }

    /** 소스의 태그별 개수. `분류가 없는 상한이 없다`와 같은 `classOf`를 쓴다. */
    function counted(): Map<string, number> {
      const found = new Map<string, number>()
      for (const name of NAMES) {
        const cls = classOf(SOURCE, name)
        if (cls !== null) found.set(cls, (found.get(cls) ?? 0) + 1)
      }
      return found
    }

    it('읽을 표를 실제로 찾는다', () => {
      // 문서가 옮겨 가거나 표 모양이 바뀌면 0개가 되고 아래 검사가 영원히 초록이 된다.
      expect(existsSync(DECISION)).toBe(true)
      expect(documented().size).toBe(CLASSES.length)
    })

    /**
     * **머리글의 총계도 센다** (2026-09-01 감사 C-1). 아래 검사는 칸마다의 수만 보므로,
     * 분류를 옮기면서 칸 둘을 고치고 총계 줄을 안 고치면 **조용히 낡는다** — 실제로
     * 그렇게 두 번 낡았다(44 → 52 → 73). 이 검사가 선 이유가 그 낡음이었는데 정작
     * 총계는 안 보고 있었다.
     */
    it('머리글의 총계가 칸의 합과 같다', () => {
      const text = readFileSync(DECISION, 'utf-8')
      const header = /[*][*]전수 분류 [(](\d+)개/.exec(text)
      expect(header, 'the full-list header moved or changed shape').not.toBeNull()
      const sum = [...documented().values()].reduce((total, count) => total + count, 0)
      expect(Number(header?.[1])).toBe(sum)
      // 소스가 출처다. 표가 세는 것이 실제로 `limits.ts`가 내보내는 상수 전부인가.
      expect(sum).toBe(NAMES.length)
    })

    it('분류마다 개수가 같다', () => {
      const doc = documented()
      const source = counted()
      const wrong = CLASSES.filter((cls) => (doc.get(cls) ?? 0) !== (source.get(cls) ?? 0)).map(
        (cls) => `${cls}: 결정문 ${doc.get(cls) ?? 0} · 소스 ${source.get(cls) ?? 0}`,
      )
      expect(
        wrong,
        'update the full list in the decision too (open-decisions/06-audit.md)',
      ).toEqual([])
    })
  })
})

/**
 * **끌 수 있는 상한은 스위치를 거쳐서만 읽는다** (`limits-switch.ts`,
 * `open-decisions.md` "상한은 누가 정했느냐" §2).
 *
 * **결정문이 걱정한 것은 파일이 둘인 것이 아니라 닿지 않는 자리가 생기는 것이다** —
 * *"태그가 없으면 다음에 상한을 더하는 사람이 어느 줄인지 안 밝히고, 그러면 스위치가
 * 조용히 셋째 줄까지 꺼진다."* 그 반대편이 이 검사다: **기기 줄의 상수를 `limits.ts`에서
 * 곧장 읽어 쓰면 그 자리만 스위치를 안 듣는다.** 화면은 카드가 열렸다고 하는데 그 한
 * 자리만 옛 상한으로 막는 상태이고, 아무 오류도 안 난다.
 *
 * **집이 셋인 이유.**
 * - `limits-switch.ts` — 값을 걸러 내보내는 곳. 여기가 읽는 것은 당연하다.
 * - `ml/algorithms.ts` — 등록부. 행 상한 열여섯은 **값이 화면에 그대로 나가므로**
 *   (`이 알고리즘은 3,000행까지`) `Infinity`로 바뀌면 안 된다. 끄는 일은 판정하는
 *   한 곳(`ml/backend.ts`의 `runtimeOptions`)이 한다.
 * - `ml/backend.ts` — 그 판정하는 곳. 못 잰 칸의 기본값(`BROWSER_ROW_LIMIT`)을 든다.
 */
describe('끌 수 있는 상한은 스위치를 거친다', () => {
  const SWITCH = join(SRC, 'limits-switch.ts')
  const HOMES = [
    'limits.ts',
    'limits-switch.ts',
    join('ml', 'algorithms.ts'),
    join('ml', 'backend.ts'),
  ]

  /** `우리 기기가 정했다`가 달린 상수들. 분류를 옮기면 이 목록이 저절로 따라온다. */
  const SWITCHABLE = (() => {
    const source = readFileSync(LIMITS, 'utf-8')
    // **판정을 다시 쓰지 않는다** (2026-09-01 감사 C-2). 손으로 옮겨 적었을 때는 위
    // `classOf`가 가진 R6 B-4 가드(주석이 `*/`로 닫혔는가)가 빠져, 주석이 아예 없는
    // 상수가 앞 상수의 분류를 물려받았다. 구현이 둘이면 그중 하나만 고쳐진다.
    return [...source.matchAll(/^export const (\w+)/gm)]
      .map((match) => match[1] ?? '')
      .filter((name) => classOf(source, name) === '우리 기기가 정했다')
  })()

  it('끌 수 있는 상한을 실제로 찾는다', () => {
    // 0개면 위 정규식이 썩은 것이지 규칙이 지켜진 게 아니다.
    expect(SWITCHABLE.length).toBeGreaterThan(20)
    expect(SWITCHABLE).toContain('MAX_DATASET_ROWS')
    // 옮겨 간 것은 여기 없어야 한다 (결정문 §1.3).
    expect(SWITCHABLE).not.toContain('SILHOUETTE_BUDGET_MS')
  })

  it('스위치가 제자리에 있다', () => {
    expect(existsSync(SWITCH)).toBe(true)
  })

  /**
   * **행 상한을 재는 자리가 둘이 되면 스위치는 그중 하나만 연다.**
   *
   * 등록부의 값은 `Infinity`가 되지 않으므로(위 참조) 끄는 일은 **판정하는 코드**가
   * 한다. 그 코드가 한 곳뿐이라는 것이 지금의 전제이고, 어딘가에 `rowCount > …`가
   * 하나 더 생기면 그 자리는 스위치를 안 듣는다 — 화면은 열렸다고 하는데 거기서만
   * 막히고, **아무 오류도 안 난다.**
   */
  it('행 수를 상한과 견주는 자리가 한 곳뿐이다', () => {
    const compared = sourceFiles(SRC)
      .filter((path) =>
        /\browCount\s*[<>]=?/.test(withoutComments(readFileSync(path, 'utf-8')).join('\n')),
      )
      .map((path) => path.slice(SRC.length + 1))
    expect(compared).toEqual([join('ml', 'backend.ts')])
  })

  /**
   * **이름 축과 등록부 축을 함께 둔다** (2026-09-01 감사 B-2).
   *
   * 위 규칙은 `rowCount`라는 **식별자**를 쓴 비교만 본다 — 순서를 뒤집거나(`max < rows`)
   * 변수에 담거나 헬퍼로 감싸면 빠져나간다. 감사자가 `ml/selection.ts`에 둘째 게이트를
   * 넣어 그것을 확인했다(안 울었다).
   *
   * 이쪽은 **값을 어디서 읽는가**를 본다. 끄는 일은 판정하는 코드가 하므로, 등록부의
   * 행 상한을 읽는 자리가 둘이 되면 그중 하나는 스위치를 안 듣는다. 두 규칙이 서로 다른
   * 회피를 막는다.
   */
  it('등록부의 행 상한을 읽는 자리가 한 곳뿐이다', () => {
    const readers = sourceFiles(SRC)
      .filter((path) =>
        /\.maxRows\s*\[/.test(withoutComments(readFileSync(path, 'utf-8')).join('\n')),
      )
      .map((path) => path.slice(SRC.length + 1))
    expect(readers).toEqual([join('ml', 'backend.ts')])
  })

  /**
   * **`Infinity`를 판 크기로 그대로 쓰면 첫 판이 통째로 빈다** (2026-09-01 감사 B-1).
   *
   * `0 * Infinity`가 `NaN`이고 `slice(NaN, NaN)`은 빈 배열이다 — **아무 오류도 안 난다.**
   * `pageSizeOf`의 머리말이 *"컴포넌트 밖에 있는 이유는 그것이 검사할 수 있는 유일한
   * 자리이기 때문"*이라고 적는데, 정작 **화면이 그것을 거치는지는 아무도 안 봤다.**
   *
   * 위 `산점도 상한이 화면까지 이어진다`와 같은 모양이다.
   */
  it('판 크기를 `pageSizeOf`로 감싼다', () => {
    const callers = sourceFiles(SRC).filter((path) =>
      /\b(?:predictPageSize|imagePredictPageSize)\s*\(/.test(
        withoutComments(readFileSync(path, 'utf-8')).join('\n'),
      ),
    )
    // 0개면 이름이 바뀐 것이지 규칙이 지켜진 게 아니다.
    expect(callers.length).toBeGreaterThanOrEqual(2)

    const unwrapped = callers
      .filter(
        (path) => !withoutComments(readFileSync(path, 'utf-8')).join('\n').includes('pageSizeOf('),
      )
      .map((path) => path.slice(SRC.length + 1))
    expect(unwrapped, 'wrap it with pageSizeOf - Infinity leaks into slice()').toEqual([])
  })

  it('값이 사는 곳과 집 셋 밖에서는 기기 줄 상수를 직접 안 읽는다', () => {
    const wrong: string[] = []
    for (const path of sourceFiles(SRC)) {
      const where = path.slice(SRC.length + 1)
      if (HOMES.some((home) => where === home)) continue
      const code = withoutComments(readFileSync(path, 'utf-8')).join('\n')
      for (const name of SWITCHABLE) {
        if (new RegExp(`\\b${name}\\b`).test(code)) wrong.push(`${where}: ${name}`)
      }
    }
    expect(wrong, 'read it through limits-switch.ts instead').toEqual([])
  })
})

/**
 * **스위치는 워커 번들에 안 들어간다** (2026-09-01 감사 B-6).
 *
 * `limits-switch.ts`는 `vue`와 `project/storage`(→ `idb`)를 문다. 워커 셋은 지금 그
 * 어느 것도 안 무는데(감사자가 임포트 그래프를 직접 훑어 확인했다), **그 사실을 지키는
 * 것이 아무것도 없었다** — 워커 쪽이 언젠가 `data/table.ts`의 파서 하나를 들여오는 날
 * 조용히 따라 들어간다. 전국 배포에 교실 PC는 캐시가 차시마다 지워지므로(`pages-traffic`
 * 판단) 워커가 무거워지는 것은 공짜가 아니다.
 *
 * **그래서 임포트를 따라간다.** `src/` 안의 상대·별칭 임포트를 한 겹씩 넓혀 가며 훑는다.
 */
describe('워커는 스위치를 안 문다', () => {
  const WORKERS = [
    'ml/worker/train.worker.ts',
    'ml/embed/embed.worker.ts',
    'data/image/canonicalize.worker.ts',
  ]

  /** 이 파일이 직접 들여오는 `src/` 안의 모듈들. 밖(라이브러리)은 이름 그대로 돌려준다. */
  function importsOf(path: string): string[] {
    const source = withoutComments(readFileSync(path, 'utf-8')).join(String.fromCharCode(10))
    return [...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
  }

  function resolve(specifier: string, from: string): string | null {
    const base = specifier.startsWith('@/')
      ? join(SRC, specifier.slice(2))
      : specifier.startsWith('.')
        ? join(dirname(from), specifier)
        : null
    if (base === null) return null
    for (const suffix of ['.ts', '/index.ts', '']) {
      const candidate = `${base}${suffix}`
      if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate
    }
    return null
  }

  it('훑을 워커를 실제로 찾는다', () => {
    for (const worker of WORKERS) expect(existsSync(join(SRC, worker))).toBe(true)
  })

  it('어느 워커도 `limits-switch`·`vue`·`idb`에 안 닿는다', () => {
    const reached: string[] = []
    for (const worker of WORKERS) {
      const seen = new Set<string>()
      const queue = [join(SRC, worker)]
      while (queue.length > 0) {
        const current = queue.pop()!
        if (seen.has(current)) continue
        seen.add(current)
        for (const specifier of importsOf(current)) {
          if (specifier === 'vue' || specifier === 'idb') {
            reached.push(`${worker} -> ${current.slice(SRC.length + 1)} -> ${specifier}`)
            continue
          }
          const next = resolve(specifier, current)
          if (next === null) continue
          if (next.endsWith('limits-switch.ts')) {
            reached.push(`${worker} -> ${current.slice(SRC.length + 1)} -> limits-switch`)
          }
          queue.push(next)
        }
      }
    }
    expect(reached, 'the switch pulls vue and idb into the worker bundle').toEqual([])
  })
})

/**
 * **저장된 선택을 앱이 뜰 때 되살리는가** (2026-09-01 감사 C-4).
 *
 * `main.ts`의 그 한 줄을 지우면 학생의 선택이 **새로 고칠 때마다 사라진다**(늘 "상한
 * 적용"으로 뜬다). 그런데 아무 검사도 안 울었다 — 옆의 `initLocale`·`initTheme`도 같은
 * 처지라 이번에 생긴 병은 아니지만, **셋 다 한 줄로 기능이 죽는 자리**다.
 */
describe('앱이 뜰 때 되살린다', () => {
  const MAIN = withoutComments(readFileSync(join(SRC, 'main.ts'), 'utf-8')).join(
    String.fromCharCode(10),
  )

  it('저장된 것을 읽는 셋을 전부 부른다', () => {
    for (const call of ['initLocale()', 'initTheme()', 'initLimitsOff()']) {
      expect(MAIN, `main.ts must call ${call}`).toContain(call)
    }
  })
})
