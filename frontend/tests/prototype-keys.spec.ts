/**
 * **남이 준 이름을 열쇠로 쓰는 자리** (2026-09-23, R37 A-2·C-5).
 *
 * `record[key] ?? 기본값`은 열쇠가 `constructor`·`toString`·`valueOf`·`hasOwnProperty`·
 * `__proto__`일 때 **기본값으로 안 떨어지고 상속한 함수를 준다.** 그 뒤 `.trim()`·`.map()`이
 * 던진다. A-2가 포트폴리오에서 셋을 닫았고, 같은 병이 하이퍼파라미터 표 둘에 더 있었다.
 *
 * **여기가 하는 일이 둘이다.**
 *
 * 1. **실물로 잰다** — 적대적 이름 다섯을 실제 함수에 먹인다.
 * 2. **소스를 센다** — `own()` 없이 색인으로 읽는 자리가 새로 생기면 운다. 실물 판정은
 *    이미 있는 자리만 보므로, **다음 자리**를 막는 것은 이쪽이다.
 *
 * **못 보는 것: 쓰는 쪽.** `obj[key] = v`가 `__proto__`에서 own 속성을 안 만드는 병은
 * 모양이 달라서 `r37-fixes.spec.ts`가 따로 문다. 그리고 **`zod`의 `z.record` 파스**는
 * 라이브러리 안이라 우리가 못 막는다 — `open-decisions.md` 49.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parameters as mljsParameters } from '../src/ml/engines/mljs'
import { parameters as sklearnParameters } from '../src/ml/engines/pyodide-sklearn'
import { own } from '../src/records'

/** 스키마와 양식을 통과하는 열쇠들. 열아홉 벌 중 실제로 상속을 건드리는 다섯이다. */
const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']

describe('원시 연산', () => {
  it('직접 담긴 것만 준다', () => {
    expect(own({ a: 1 }, 'a')).toBe(1)
    for (const name of NAMES) expect(own({ a: 1 }, name), name).toBeUndefined()
  })

  /** `undefined`가 담겨 있는 것과 없는 것을 가르지 않는다 — 부르는 쪽이 `?? 기본값`을 쓴다. */
  it('없는 열쇠는 undefined다', () => {
    expect(own<number>({}, 'b')).toBeUndefined()
  })
})

describe('하이퍼파라미터 표를 남의 이름으로 묻는다', () => {
  /**
   * **손으로 고친 `.mlpx`가 이 문을 지난다.** `algorithm`이 스키마에서 `userString`이라
   * `constructor`가 통과하고, 화면은 그 목록을 `.map()`으로 그린다 — 함수가 오면 선다.
   */
  it.each(NAMES)('%s — 순수 JS 표가 빈 목록을 준다', (name) => {
    expect(mljsParameters(name)).toEqual([])
  })

  it.each(NAMES)('%s — sklearn 표가 빈 목록을 준다', (name) => {
    expect(sklearnParameters(name)).toEqual([])
  })

  /** 진짜 알고리즘은 그대로 읽힌다 — 고침이 정상 경로를 안 막았다. */
  it('아는 알고리즘은 목록을 준다', () => {
    expect(mljsParameters('decision_tree').length).toBeGreaterThan(0)
  })
})

/**
 * **`algorithm`을 열쇠로 쓰는 자리를 전수로 센다.**
 *
 * **모집단을 이 이름 하나로 좁힌 근거가 있다.** 상수 표를 식으로 읽는 자리를 전부 세니
 * 71곳인데(2026-09-23 실측), 열쇠가 `dataType`·`taskType`·`step`·`role`·`tone`처럼
 * **우리가 가진 닫힌 어휘**인 자리가 대부분이다 — 거기는 타입이 열쇠를 지킨다. 파일에서
 * 오는 열쇠는 **`algorithm` 하나다**: 스키마가 `userString`으로 받으므로(`mlpx-spec.md`
 * §5.2) 손으로 고친 `.mlpx`의 `constructor`가 그대로 통과한다.
 *
 * **그래서 이 판은 "나쁜 코드 찾기"가 아니라 "그 이름이 새로 쓰이면 알려 달라"다.**
 * `algorithm`으로 표를 읽는 자리가 늘면 여기가 운다.
 */
describe('algorithm을 열쇠로 쓰는 자리가 전부 own을 지난다', () => {
  const ROOT = join(process.cwd(), 'src')

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(ts|vue)$/.test(entry) && !entry.endsWith('.spec.ts') ? [path] : []
    })
  }

  it('색인으로 직접 읽는 자리가 없다', () => {
    /** `NAME[algorithm]` — 진위 검사도 `?? 기본값`도 상속한 함수를 막지 못한다. */
    const pattern = /\b([A-Za-z_$][\w$]*)\[\s*algorithm\s*\]/g
    const found: string[] = []
    for (const path of sources(ROOT)) {
      const relative = path.slice(ROOT.length + 1).replaceAll('\\', '/')
      const source = readFileSync(path, 'utf-8')
      for (const [whole, holder] of source.matchAll(pattern)) {
        // `own(TABLE, algorithm)`은 통로를 지난 것이다.
        if (whole.startsWith('own(')) continue
        found.push(`${relative}: ${holder ?? ''}[algorithm]`)
      }
    }
    expect(found).toEqual([])
  })
})
