/**
 * **돌연변이 카탈로그가 가리키는 자리가 아직 있는가** (`tools/mutants.json`).
 *
 * **R25 B-1이 세운 검사다.** 그 라운드가 잰 것 둘이 이 파일의 이유다.
 *
 * 1. **러너가 이 기기에서 vitest를 한 번도 못 띄우고 있었다.** `execFileSync('npx.cmd', …)`가
 *    셸 없이 `EINVAL`로 던지는데 `catch { return true }`가 그것을 *"울었다"*로 셌다. 서른셋이
 *    **1.5초**에 끝났다 — vitest 한 번이 5초가 넘는다. 러너는 고쳤지만(`tools/mutate.mjs`),
 *    **그 사이 카탈로그가 낡은 것을 아무도 못 봤다.**
 * 2. 실제로 `86058ad`가 유형 카드 잠금을 걷어내면서 앵커 **셋**이 죽었고, 러너는 넷째 항목의
 *    *"앵커가 0번 나온다"*에서 서 버려 그 뒤를 아예 안 봤다.
 *
 * **그래서 관문 안이다.** 러너 자체는 항목마다 스펙을 돌려 느리므로 밖에 두지만
 * (`open-decisions.md` #38), **"가리키는 자리가 아직 있는가"는 파일을 읽는 것뿐이라 1초가
 * 안 걸린다.** 코드를 지운 커밋이 카탈로그를 안 고치면 여기서 곧바로 빨개진다.
 *
 * **무는 돌연변이**: 아무 항목의 `find`에서 한 글자를 바꾼다.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

interface Mutant {
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly expect?: 'cries' | 'silent'
  readonly expectSpecs?: readonly string[]
  readonly loses?: string
}

const ROOT = process.cwd()
const CATALOGUE = join(ROOT, 'tools', 'mutants.json')
const { mutants } = JSON.parse(readFileSync(CATALOGUE, 'utf-8')) as { mutants: Mutant[] }

/** 러너와 **같은 규칙으로** 찾는다 — 파일이 CRLF면 앵커의 줄 끝도 바꿔서 센다. */
function occurrences(mutant: Mutant): number {
  const source = readFileSync(join(ROOT, mutant.file), 'utf-8')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  return source.split(mutant.find.split('\n').join(eol)).length - 1
}

describe('돌연변이 카탈로그', () => {
  it('비어 있지 않다 - 빈 목록은 이 파일 전체를 무의미하게 만든다', () => {
    expect(mutants.length).toBeGreaterThan(0)
  })

  it('가리키는 파일이 전부 있다', () => {
    for (const mutant of mutants) {
      expect(existsSync(join(ROOT, mutant.file)), mutant.file).toBe(true)
    }
  })

  /**
   * **정확히 한 번이어야 한다.** 0이면 그 자리가 사라진 것이고(러너가 거기서 선다),
   * 둘 이상이면 심을 때 **남의 자리까지 바뀐다.**
   */
  it('앵커가 그 파일에 정확히 한 번 나온다', () => {
    const wrong = mutants
      .map((mutant) => ({ mutant, count: occurrences(mutant) }))
      .filter((one) => one.count !== 1)
      .map((one) => `${one.mutant.file} x${one.count} :: ${one.mutant.find.slice(0, 60)}`)
    expect(wrong, 'tools/mutants.json anchors no longer match the sources').toEqual([])
  })

  /** 심은 뒤가 심기 전과 같으면 그 항목은 아무것도 안 재는 것이다. */
  it('바꾼 글자가 원래 글자와 다르다', () => {
    for (const mutant of mutants) {
      expect(mutant.replace, mutant.file).not.toBe(mutant.find)
    }
  })

  it('지목한 스펙 파일이 전부 있다', () => {
    for (const mutant of mutants) {
      for (const spec of mutant.expectSpecs ?? []) {
        expect(existsSync(join(ROOT, spec)), `${mutant.file} → ${spec}`).toBe(true)
      }
    }
  })

  /**
   * **`loses`가 이 목록의 값이다** (`tools/mutate.mjs`의 머리말). *"이게 틀리면 학생이
   * 무엇을 잃나"*가 없으면 StrykerJS가 기계로 뒤집는 것과 같아진다.
   */
  it('항목마다 무엇을 잃는지 적혀 있다', () => {
    for (const mutant of mutants) {
      expect(mutant.loses ?? '', mutant.file).not.toBe('')
    }
  })

  it('기대는 cries나 silent 둘 중 하나다', () => {
    for (const mutant of mutants) {
      expect(['cries', 'silent'], mutant.file).toContain(mutant.expect ?? 'silent')
    }
  })
})
