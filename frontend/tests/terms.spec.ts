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

describe('데이터 이름이 하나다', () => {
  const targets = [
    ...filesUnder(join(process.cwd(), 'src'), ['.ts', '.vue', '.json']),
    ...filesUnder(join(process.cwd(), 'tests'), ['.ts']),
    ...filesUnder(join(ROOT, 'docs'), ['.md']),
    join(ROOT, 'CLAUDE.md'),
  ].filter((path) => !EXEMPT.includes(relative(ROOT, path).replaceAll(sep, '/')))

  it('물러난 데이터 이름을 쓰는 자리가 없다', () => {
    const offenders: string[] = []
    for (const path of targets) {
      const where = relative(ROOT, path).replaceAll(sep, '/')
      for (const hit of retiredNamesIn(readFileSync(path, 'utf-8').split(/\r?\n/))) {
        offenders.push(`${where}:${hit.line} '${hit.name}'`)
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
})
