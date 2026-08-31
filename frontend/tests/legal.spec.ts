// @vitest-environment jsdom
// 지원 언어 목록을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
// 밝히지 않으면 그 가드의 대체 경로를 검사하게 된다 (ui-rules.spec.ts).
/**
 * **바깥에 내놓는 규정이 살아 있는가.**
 *
 * `public/legal/`은 앱 번들 밖이다. `src/`를 훑는 검사도, 타입도, 린트도 여기까지
 * 안 온다 — 그래서 조가 사라져도, 링크가 빈 곳을 가리켜도, 언어를 늘리고 방침을
 * 안 채워도 **관문이 전부 초록이다.** 이 파일이 그 구멍을 막는다.
 *
 * 무엇을 지키는지는 넷이다.
 *
 * 1. **로케일마다 방침이 한 장 있다.** 언어를 늘리는 것은 `SUPPORTED_LOCALES` 한 줄인데
 *    서랍은 따라오지 않는다. 안 채우면 그 언어를 고른 학생이 404를 본다.
 * 2. **조 번호가 얼려 있다.** 학교가 제출한 필수기준 체크리스트의 증빙 칸은 조문이
 *    아니라 **번호**를 적는다. 번호를 다시 매기면 이미 나간 서류가 살아 있는 채로
 *    엉뚱한 곳을 가리킨다 — `docs/privacy.md` "조 번호는 얼려 둔다".
 * 3. **조문이 로케일 JSON으로 새지 않는다.** 법률 문서가 `t()` 키로 쪼개지면 CLAUDE.md
 *    §3의 "한 문장은 한 키"와 부딪히고, 조 하나를 고치는 데 앱 배포가 필요해진다.
 * 4. **앱이 거는 링크가 실재한다.** 고지 파일 이름은 빌드가 쥐고 있어 `legal.ts`와
 *    어긋날 수 있다.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES } from '@/i18n'
import { LEGAL_INDEX_PATH, NOTICES_PATH, privacyPath } from '@/legal'
import { NOTICES_FILE } from '../scripts/notices'

/** 산출물에 그대로 실리는 것들. vitest는 `frontend/`에서 돈다. */
const PUBLIC = join(process.cwd(), 'public')
const LEGAL = join(PUBLIC, 'legal')

/**
 * 조가 몇 개인가. **숫자를 여기 적는 것이 요점이다.**
 *
 * 이어져 있는지만 보면 가운데 조를 지우고 뒤를 당겨도 통과한다 — 그게 정확히 막으려는
 * 사고다. 조를 정말 늘리려면 이 숫자를 **의도적으로** 올리고, 그때 이미 제출된
 * 체크리스트가 무엇을 가리키는지 함께 생각하게 된다.
 */
const ARTICLE_COUNT = 11

/** 로케일 JSON의 `legal` 아래에 있어도 되는 것. **링크에 쓰는 낱말뿐이다.** */
const ALLOWED_LEGAL_KEYS = ['notices', 'privacy', 'source']

/** 조문이 로케일로 샌 흔적. `제3조`와 `Article 3`을 함께 잡는다. */
const ARTICLE_MARKER = /제\s*\d+\s*조|Article\s+\d+/

/** `public/` 안의 경로로 되돌린다. 앱이 쓰는 것은 `./`로 시작하는 상대 경로다. */
function inPublic(path: string): string {
  return join(PUBLIC, path.replace(/^\.\//, ''))
}

/** 문서에 박힌 조 번호들. 순서대로 나온다. */
function anchors(html: string): number[] {
  return [...html.matchAll(/id="article-(\d+)"/g)].map((match) => Number(match[1]))
}

/**
 * 그 조의 제목 줄. 번호가 제목 안에도 적혀 있는지 보려고 통째로 가져온다.
 *
 * **속성이 끼어도 잡는다.** 예전에는 `<h2 id="article-N">`를 글자 그대로 찾아서
 * `class` 하나만 붙어도 이 Map이 통째로 비었고, 그러면 **제목 검사가 0회 돌고
 * 초록**이었다 (2026-08-30 R12 감사 A-2). 조가 다 있다는 검사는 그때도 통과했다 -
 * `anchors`는 `id`만 보기 때문이다. 그래서 부르는 쪽에 **개수 바닥**을 함께 둔다.
 */
function headings(html: string): Map<number, string> {
  const found = new Map<number, string>()
  for (const match of html.matchAll(/<h2\b[^>]*\sid="article-(\d+)"[^>]*>([\s\S]*?)<\/h2>/g)) {
    found.set(Number(match[1]), match[2] ?? '')
  }
  return found
}

/** `href="..."`로 나가는 곳. 바깥 주소와 메일은 뺀다 - 여기서 볼 것은 지역 파일뿐이다. */
function localLinks(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)]
    .map((match) => match[1] ?? '')
    .filter((href) => !/^(https?:|mailto:|#)/.test(href))
}

/** 로케일 JSON을 평평하게 편다. 값만 필요하다. */
function flatten(value: unknown, prefix = ''): Map<string, string> {
  const found = new Map<string, string>()
  if (typeof value === 'string') {
    found.set(prefix, value)
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, leaf] of flatten(child, prefix === '' ? key : `${prefix}.${key}`)) {
        found.set(path, leaf)
      }
    }
  }
  return found
}

function readPolicy(locale: string): string {
  return readFileSync(inPublic(privacyPath(locale as (typeof SUPPORTED_LOCALES)[number])), 'utf8')
}

/** 서랍의 문구 표. 페이지가 읽는 것과 **같은 JSON을** 읽는다. */
function drawerMessages(): Record<string, Record<string, string>> {
  const html = readFileSync(join(LEGAL, 'index.html'), 'utf8')
  const block = /<script type="application\/json" id="messages">([\s\S]*?)<\/script>/.exec(html)
  expect(block).not.toBeNull()
  return JSON.parse(block?.[1] ?? '') as Record<string, Record<string, string>>
}

describe('규정 서랍이 서 있다', () => {
  it('서랍의 목차가 있다', () => {
    expect(existsSync(inPublic(LEGAL_INDEX_PATH))).toBe(true)
    expect(existsSync(join(LEGAL, 'index.html'))).toBe(true)
  })

  it('서랍의 언어가 앱의 언어와 같다', () => {
    // **방침 링크는 서랍이 고른 언어 한 장뿐이다.** 언어마다 한 줄씩 늘어놓으면 언어가
    // 열 개일 때 링크가 열 개가 된다. 그 대신 이 표가 앱과 어긋나면 안 된다 —
    // 표에 없는 언어를 고른 사람은 영어로 떨어지고, 자기 언어의 방침이 있는데도 못 본다.
    expect(Object.keys(drawerMessages()).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('서랍의 언어마다 같은 문구가 다 있다', () => {
    const messages = drawerMessages()
    const shape = Object.keys(messages[SUPPORTED_LOCALES[0]] ?? {}).sort()
    expect(shape.length).toBeGreaterThan(0)
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(messages[locale] ?? {}).sort()).toEqual(shape)
    }
  })

  it('서랍이 언어마다 자기 이름을 갖는다 - 토글이 그것으로 그려진다', () => {
    for (const [locale, dict] of Object.entries(drawerMessages())) {
      expect(`${locale}: ${dict.label ?? ''}`).not.toBe(`${locale}: `)
    }
  })

  it.each([...SUPPORTED_LOCALES])('%s 방침이 있다', (locale) => {
    expect(existsSync(inPublic(privacyPath(locale)))).toBe(true)
  })

  it('서랍에 남는 방침이 없다 - 지원하지 않는 언어의 문서가 굴러다니지 않는다', () => {
    const stray = readdirSync(LEGAL)
      .filter((entry) => /^privacy\./.test(entry))
      .map((entry) => entry.replace(/^privacy\.(.+)\.html$/, '$1'))
    expect([...stray].sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })
})

describe('조 번호가 얼려 있다', () => {
  it.each([...SUPPORTED_LOCALES])('%s 방침에 조가 빠짐없이 있다', (locale) => {
    const expected = Array.from({ length: ARTICLE_COUNT }, (_, index) => index + 1)
    expect(anchors(readPolicy(locale))).toEqual(expected)
  })

  it.each([...SUPPORTED_LOCALES])('%s 방침의 제목이 제 번호를 달고 있다', (locale) => {
    // **언어별 분기를 두지 않는다** - `제3조`든 `Article 3`이든 숫자는 숫자다.
    // 앵커만 보면 제목을 통째로 밀어 놓고 id만 남겨도 통과한다.
    const found = headings(readPolicy(locale))
    // **바닥.** 서식이 바뀌어 하나도 못 잡으면 아래 루프가 0회 돌고 조용히 통과한다.
    expect(found.size, '제목을 하나도 못 잡았다').toBe(ARTICLE_COUNT)
    for (const [number, heading] of found) {
      expect(heading).toMatch(new RegExp(`(?<!\\d)${number}(?!\\d)`))
    }
  })

  it('검사기가 속성이 낀 제목도 잡는다', () => {
    const decorated = headings('<h2 class="x" id="article-3" data-k="v">제3조 (가)</h2>')
    expect([...decorated.keys()]).toEqual([3])
  })

  it('검사기가 번호가 어긋난 제목을 잡는다', () => {
    const broken = headings('<h2 id="article-3">제4조 (엉뚱한 조)</h2>')
    expect(broken.get(3)).not.toMatch(/(?<!\d)3(?!\d)/)
  })

  it('검사기가 빠진 조를 잡는다', () => {
    expect(anchors('<h2 id="article-1">가</h2><h2 id="article-3">나</h2>')).toEqual([1, 3])
  })
})

describe('조문이 로케일로 새지 않는다', () => {
  it.each([...SUPPORTED_LOCALES])('%s의 legal 네임스페이스가 링크 낱말뿐이다', (locale) => {
    const messages: unknown = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'locales', `${locale}.json`), 'utf8'),
    )
    const legal = [...flatten(messages).keys()]
      .filter((key) => key.startsWith('legal.'))
      .map((key) => key.slice('legal.'.length))
    expect([...legal].sort()).toEqual([...ALLOWED_LEGAL_KEYS].sort())
  })

  it.each([...SUPPORTED_LOCALES])('%s의 어떤 문구도 조문이 아니다', (locale) => {
    const messages: unknown = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'locales', `${locale}.json`), 'utf8'),
    )
    const leaked = [...flatten(messages)].filter(([, value]) => ARTICLE_MARKER.test(value))
    expect(leaked).toEqual([])
  })

  it('검사기가 샌 조문을 잡는다', () => {
    expect(ARTICLE_MARKER.test('제1조 (처리하는 개인정보의 항목)')).toBe(true)
    expect(ARTICLE_MARKER.test('Article 7 (Automatic collection)')).toBe(true)
    expect(ARTICLE_MARKER.test('개인정보 처리방침')).toBe(false)
  })
})

describe('링크가 실재하는 것을 가리킨다', () => {
  it('고지 파일의 이름을 빌드와 앱이 같이 부른다', () => {
    // 이 파일만 `public/`에 없다 - 빌드가 모듈 그래프를 세어 굽는다(`scripts/notices.ts`).
    // 그래서 존재로는 못 보고 **이름으로** 본다.
    expect(basename(NOTICES_PATH)).toBe(NOTICES_FILE)
  })

  it.each(['index.html'])('서랍의 %s가 죽은 링크를 안 갖는다', (entry) => {
    const html = readFileSync(join(LEGAL, entry), 'utf8')
    for (const href of localLinks(html)) {
      // 앱으로 돌아가는 `../`와 서랍 자신인 `./`는 디렉터리라 파일로 안 센다.
      if (href === '../' || href === './') continue
      if (basename(href) === NOTICES_FILE) continue
      expect(existsSync(join(LEGAL, href))).toBe(true)
    }
  })

  it.each([...SUPPORTED_LOCALES])('%s 방침이 죽은 링크를 안 갖는다', (locale) => {
    for (const href of localLinks(readPolicy(locale))) {
      if (href === '../' || href === './') continue
      if (basename(href) === NOTICES_FILE) continue
      expect(existsSync(join(LEGAL, href))).toBe(true)
    }
  })

  it('검사기가 바깥 주소와 메일은 안 센다', () => {
    const html = '<a href="https://x.test">a</a><a href="mailto:hello@luminousky.com">b</a>'
    expect(localLinks(html)).toEqual([])
  })
})
