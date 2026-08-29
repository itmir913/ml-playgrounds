/**
 * **데이터 이름이 저장소 안에서 갈리지 않는다.**
 *
 * `docs/terms.md` 머리말이 규칙을 갖는다 — *"데이터의 이름은 `훈련`/`테스트`, 그 데이터로
 * 하는 일은 `학습`이다."* 화면은 2026-08-11에 이미 그렇게 바뀌었는데
 * (`open-decisions.md` "훈련용과 테스트용 파일이 따로일 수 있다"의 국문 각주),
 * **주석·검사 이름·문서는 안 따라와서 네 갈래로 갈려 있었다** — `학습셋` 70개,
 * `평가셋` 44개, `평가 데이터` 60여 개, `학습 데이터` 30개 (2026-08-28에 셌다).
 *
 * **교육용 도구라 이 갈라짐이 그냥 지저분한 것으로 끝나지 않는다.** 학생이 만나는 낱말이
 * 하나여야 하고, 그 낱말을 다음 사람이 주석에서 배운다.
 *
 * **행위는 여기 없다.** `평가 중`·`학습과 평가`·`평가 지표`는 데이터 이름이 아니라
 * 하는 일이라 그대로다 (`terms.md`의 "훈련과 평가" 절).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 물러난 데이터 이름. **쓰이던 것만 담는다** — 후보를 미리 채우면 쓸 수 있는 말까지
 * 막고, 그러면 다음 사람이 목록을 안 믿는다 (`locales.spec.ts`의 조어 목록과 같은 규칙).
 *
 * **부분 문자열로 문다.** 한국어에는 낱말 경계가 없어서 `수행평가용`이라고 쓰는 날
 * `평가용`이 걸린다 (R10 감사 C-1). 근본 해결은 없으니, 그날 만나는 사람이 목록을
 * 불신하는 대신 **표현을 고치거나 여기에 예외를 적도록** 이 함정을 밝혀 둔다.
 */
const RETIRED = ['평가 데이터', '평가셋', '학습셋', '훈련셋', '학습 데이터', '평가용', '학습용']

/**
 * 옛 이름을 **인용하는** 줄. 역사이지 사용이 아니다.
 *
 * 지우면 "언제 무엇에서 무엇으로 바꿨는가"가 사라지고, 그러면 다음 사람이 같은 낱말을
 * 다시 만들어도 아무도 그게 되돌아온 것인 줄 모른다.
 */
const QUOTED = ['옛 이름', '에서 `테스트 데이터`로 바뀌었다']

/** 이 파일 자체와, 그 낱말이 왜 물러났는지를 적어 둔 문서. */
const EXEMPT = ['frontend/tests/terms.spec.ts', 'docs/copy.md']

const ROOT = join(process.cwd(), '..')

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...filesUnder(path, extensions))
    else if (extensions.some((extension) => name.endsWith(extension))) found.push(path)
  }
  return found
}

/** 물러난 이름을 쓰는 줄. 인용은 빼고 돌려준다. */
export function retiredNamesIn(lines: readonly string[]): { line: number; name: string }[] {
  const found: { line: number; name: string }[] = []
  lines.forEach((text, index) => {
    if (QUOTED.some((quote) => text.includes(quote))) return
    for (const name of RETIRED) {
      if (text.includes(name)) found.push({ line: index + 1, name })
    }
  })
  return found
}

/**
 * **줄바꿈으로 쪼개진 옛 이름.** `학습⏎데이터`처럼 두 줄에 걸친 것은 위의 줄 단위
 * 훑기가 원리적으로 못 본다.
 *
 * **이 구멍이 실제로 다섯을 놓쳤다** (R10 감사 A-2). 낱말을 옮긴 스크립트도 줄 단위였고
 * 검사도 줄 단위라 **둘이 같은 사각을 공유했다** — 치환이 못 본 자리를 검사도 못 봤고,
 * `rule-coverage.md`는 "전체에서 막는다"고 적고 있었다.
 *
 * **자리는 파일까지만 짚는다.** 공백을 접으면 줄 번호가 사라지는데, 되살리려고 원문에
 * 다시 맞추는 것은 이 검사가 잡는 것(다섯 줄)에 비해 비싸다.
 *
 * **인용 예외는 창으로 본다.** 접힌 글에는 줄이 없으므로 맞은 자리 앞뒤를 보고 그
 * 안에 인용 표기가 있으면 넘긴다. 줄 단위보다 무딘 근사이고, 그래서 이쪽은
 * **줄 단위가 이미 잡은 이름은 빼고** 보고한다.
 */
export function retiredNamesAcrossLines(text: string): string[] {
  // 공백을 하나로 접으면 `학습⏎데이터`도 `학습 데이터`가 되어 그냥 찾힌다.
  // 주석 기호(`*`)와 목록 기호(`-`)는 줄머리에서 낱말 사이로 들어오므로 함께 지운다.
  const collapsed = text.replace(/\s+[*\-#>]+\s+/g, ' ').replace(/\s+/g, ' ')
  const found: string[] = []
  for (const name of RETIRED) {
    let at = collapsed.indexOf(name)
    while (at !== -1) {
      const window = collapsed.slice(Math.max(0, at - 120), at + name.length + 120)
      if (!QUOTED.some((quote) => window.includes(quote))) {
        found.push(name)
        break
      }
      at = collapsed.indexOf(name, at + name.length)
    }
  }
  return found
}

describe('데이터 이름이 하나다', () => {
  const targets = [
    ...filesUnder(join(process.cwd(), 'src'), ['.ts', '.vue', '.json']),
    ...filesUnder(join(process.cwd(), 'tests'), ['.ts']),
    // **학생이 읽는 표면이 주석보다 뒤에 있으면 안 된다** (R10 감사 B-1). 내장 양식은
    // 번들 밖이라 `src/`를 훑는 검사가 안 오는데, 학생이 가장 확실히 읽는 글이다.
    ...filesUnder(join(process.cwd(), 'public', 'portfolio'), ['.md']),
    ...filesUnder(join(ROOT, 'docs'), ['.md']),
    // 픽스처 생성기의 주석도 다음 사람이 낱말을 배우는 자리다 (R10 감사 B-2).
    ...filesUnder(join(ROOT, 'scripts'), ['.py', '.ts']),
    join(ROOT, 'CLAUDE.md'),
  ].filter((path) => !EXEMPT.includes(relative(ROOT, path).replaceAll(sep, '/')))

  /**
   * **0건을 훑고 통과하는 것이 이 검사의 가장 나쁜 실패다.** 훑는 목록이 조용히 비면
   * 초록불이 "깨끗하다"가 아니라 "안 봤다"를 뜻하는데 둘이 화면에서 똑같이 생겼다.
   * `doc-refs.spec.ts`가 같은 가드를 두는 이유와 같다.
   *
   * **합계 하나로는 못 지킨다** (R11 감사 C-2). `src`와 `tests`만으로 295개라, 나중에
   * 넓힌 세 트리(`public/portfolio`·`docs`·`scripts`)가 **통째로 비어도 합계 문턱은 안
   * 운다** — 그런데 조용히 비기 쉬운 쪽이 바로 그 작은 트리들이다(확장자가 바뀌거나
   * 디렉터리 이름이 바뀌면 그만이다. 지우면 `readdirSync`가 시끄럽게 죽는다).
   */
  it('트리마다 훑는 파일이 실제로 있다', () => {
    const counted = (prefix: string): number =>
      targets.filter((path) => relative(ROOT, path).replaceAll(sep, '/').startsWith(prefix)).length

    expect(counted('frontend/src/')).toBeGreaterThan(100)
    expect(counted('frontend/tests/')).toBeGreaterThan(50)
    expect(counted('frontend/public/portfolio/')).toBeGreaterThan(0)
    expect(counted('docs/')).toBeGreaterThan(10)
    expect(counted('scripts/')).toBeGreaterThan(0)
  })

  it('물러난 데이터 이름을 쓰는 자리가 없다', () => {
    const offenders: string[] = []
    for (const path of targets) {
      const where = relative(ROOT, path).replaceAll(sep, '/')
      const text = readFileSync(path, 'utf-8')
      const byLine = retiredNamesIn(text.split(/\r?\n/))
      for (const hit of byLine) offenders.push(`${where}:${hit.line} '${hit.name}'`)

      // 줄바꿈에 쪼개진 것. 줄 단위가 이미 잡은 이름은 다시 안 센다.
      const seen = new Set(byLine.map((hit) => hit.name))
      for (const name of retiredNamesAcrossLines(text)) {
        if (!seen.has(name)) offenders.push(`${where} '${name}' (줄바꿈에 쪼개져 있다)`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('검사기가 물러난 이름을 잡는다', () => {
    expect(retiredNamesIn(['학습셋에서만 fit한다'])).toEqual([{ line: 1, name: '학습셋' }])
  })

  it('검사기가 인용한 줄은 안 잡는다', () => {
    expect(retiredNamesIn(['`평가 데이터`에서 `테스트 데이터`로 바뀌었다'])).toEqual([])
  })

  it('검사기가 행위를 가리키는 평가는 안 잡는다', () => {
    expect(retiredNamesIn(['평가 중', '학습과 평가에 들어갑니다', '평가 지표'])).toEqual([])
  })

  it('검사기가 줄바꿈에 쪼개진 이름을 잡는다', () => {
    expect(retiredNamesAcrossLines('세 번째 상태가 없으므로 학습\n데이터로 채점한다')).toEqual([
      '학습 데이터',
    ])
  })

  it('검사기가 주석 기호를 건너뛴다 - 줄머리의 *는 낱말 사이가 아니다', () => {
    expect(retiredNamesAcrossLines('   * 모델이 사실상 학습\n   * 데이터라')).toEqual([
      '학습 데이터',
    ])
  })

  it('쪼개진 것도 인용이면 안 잡는다', () => {
    expect(retiredNamesAcrossLines('국문이 `평가\n데이터`에서 `테스트 데이터`로 바뀌었다')).toEqual(
      [],
    )
  })
})
