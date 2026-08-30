// @vitest-environment jsdom
// 지원 언어 목록을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
/**
 * 앱 밖으로 나가는 주소와, 앱이 데리고 가는 규정 (`links.ts` · `legal.ts`).
 *
 * **두 파일이 정반대의 규칙을 갖는다.** `links.ts`는 원본이 하나뿐이라 절대 주소여야
 * 하고(상대로 걸면 도커로 띄운 학교에서 404다), `legal.ts`는 그 배포가 하는 약속이라
 * 전부 상대 경로여야 한다(절대로 박으면 자가호스팅이 남의 사이트의 방침을 가리킨다).
 *
 * **둘 다 무엇도 안 지키고 있었다** (R14-5·R14-3 감사 A-1). `links.ts`를 부르는 스펙이
 * 0건이었고, `legal.ts` 쪽은 `existsSync`에 우연히 걸리는 둘만 막혔다 —
 * `NOTICES_PATH`를 남의 사이트로 돌려도 `basename()`만 보므로 통과했다.
 *
 * 여기서 보는 것은 **값의 모양**이다. 무엇을 가리키는지는 `legal.spec.ts`가 본다.
 */

import { describe, expect, it } from 'vitest'

import * as legal from '../src/legal'
import * as links from '../src/links'
import { SUPPORTED_LOCALES } from '../src/i18n'

/** 그 모듈이 내보내는 문자열 상수들. 이름을 손으로 적지 않는다 - 늘면 함께 잡힌다. */
function stringExports(module: Record<string, unknown>): [string, string][] {
  return Object.entries(module).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
}

describe('앱 밖으로 나가는 주소는 절대 주소다', () => {
  it('내보내는 주소가 하나는 있다', () => {
    expect(stringExports(links).length).toBeGreaterThan(0)
  })

  it('전부 https로 시작한다 - 상대로 걸면 도커로 띄운 학교에서 404다', () => {
    for (const [name, value] of stringExports(links)) {
      expect(`${name} = ${value}`).toMatch(/= https:\/\//)
    }
  })
})

describe('규정은 상대 경로다', () => {
  it('내보내는 경로가 둘은 있다', () => {
    expect(stringExports(legal).length).toBeGreaterThan(1)
  })

  it("전부 './'로 시작한다 - 절대로 박으면 자가호스팅이 남의 사이트를 가리킨다", () => {
    for (const [name, value] of stringExports(legal)) {
      expect(`${name} = ${value}`).toMatch(/= \.\//)
    }
  })

  it('언어마다의 방침 경로도 마찬가지다', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(`${locale}: ${legal.privacyPath(locale)}`).toMatch(/: \.\//)
    }
  })
})

describe('검사기가 실제로 잡는다', () => {
  it('상대 경로가 links에 들어오면 잡는다', () => {
    expect('DEMO_DATASETS_URL = ./datasets/').not.toMatch(/= https:\/\//)
  })

  it('절대 주소가 legal에 들어오면 잡는다', () => {
    expect('NOTICES_PATH = https://evil.test/third-party-notices.txt').not.toMatch(/= \.\//)
  })

  it('앞의 점이 빠진 것도 잡는다 - Pages는 하위 경로에 산다', () => {
    expect('LEGAL_INDEX_PATH = /legal/').not.toMatch(/= \.\//)
  })
})
