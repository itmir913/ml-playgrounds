// @vitest-environment jsdom
// 지원 언어 목록을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
// 밝히지 않으면 그 가드의 대체 경로를 검사하게 된다 (ui-rules.spec.ts). 페이지를 가르는 `DOMParser`도 여기서 온다.
/**
 * **없는 주소에 뜨는 `public/404.html`이 앱을 찾아 옮기는가** (`open-decisions.md` "104. 서버 경로의 없는
 * 주소는 앱의 루트로 보낸다").
 *
 * `public/`은 앱 번들 밖이라 타입도 린트도 `src/`를 훑는 검사도 안 온다. 그래서 여기서 셋을 본다.
 *
 * 1. **찾기 스크립트를 그대로 돌린다.** 페이지의 `<script>` 글자를 가짜 `fetch`·`location`·`navigator`를 준
 *    격리된 맥락(`node:vm`)에서 실행한다 — 로직을 여기에 다시 쓰면 둘이 갈려도 초록이다. 가짜 사이트는
 *    저장소의 진짜 `index.html`과 규정 서랍을 준다. 그래서 표식이 앱에만 있다는 것도 함께 문다.
 * 2. **문구 표가 앱의 언어와 같고, 언어마다 그 언어의 글자다** — 규정 서랍(`legal.spec.ts`)과 같은 방법이다.
 * 3. **스크립트가 꺼진 화면은 영어 그대로다** — 마크업의 영어가 표의 영어와 같다.
 *
 * 개발 서버와 preview가 이 페이지를 상태 404로 주는 것은 `dev-routes.spec.ts`가 본다. 실제 브라우저의
 * 이동(`location.replace`)과 번쩍임은 사람 확인이다(`docs/acceptance.md` §1.1).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import { SUPPORTED_LOCALES } from '@/i18n'
import { LOCALE_SCRIPTS } from './fixtures/locales'
import { retiredIn } from './fixtures/retired-words'

/** vitest는 `frontend/`에서 돈다. */
const FRONTEND = process.cwd()
const PAGE = readFileSync(join(FRONTEND, 'public', '404.html'), 'utf8')
const APP = readFileSync(join(FRONTEND, 'index.html'), 'utf8')
const DRAWER = readFileSync(join(FRONTEND, 'public', 'legal', 'index.html'), 'utf8')

const ORIGIN = 'https://pages.test'

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** 찾기 스크립트. `type`이 없는 `<script>`가 하나뿐이어야 한다 — 문구 표는 `application/json`이다. */
function pageScript(): string {
  const scripts = [...parse(PAGE).querySelectorAll('script')].filter((script) => script.type === '')
  expect(scripts.length, 'the 404 page has exactly one runnable script').toBe(1)
  return scripts[0]?.textContent ?? ''
}

/** 페이지의 문구 표. 스크립트가 읽는 것과 같은 JSON이다. */
function pageMessages(): Record<string, Record<string, string>> {
  const block = parse(PAGE).getElementById('messages')
  expect(block?.getAttribute('type')).toBe('application/json')
  return JSON.parse(block?.textContent ?? '') as Record<string, Record<string, string>>
}

/** 앱의 표식 이름. 스크립트가 묻는 이름 그대로다. */
function markerName(): string {
  const name = /var MARKER = '([^']+)'/.exec(pageScript())?.[1]
  expect(name, 'the script names its marker').toBeDefined()
  return name ?? ''
}

/** 가짜 사이트의 한 경로. `offline`은 요청이 네트워크 오류로 끝난다. */
interface Served {
  ok: boolean
  body: string
}
type Answer = Served | 'offline'
const found = (body: string): Answer => ({ ok: true, body })
/** Pages가 없는 경로에 주는 것 — 이 페이지를 상태 404로. */
const MISSING: Served = { ok: false, body: PAGE }

interface Visit {
  /** 물은 주소들, 차례대로. */
  asked: string[]
  /** `location.replace`가 받은 주소. 안 옮겼으면 `null`. */
  movedTo: string | null
  /** 안내가 보이는가 (`.searching`이 벗겨졌는가). */
  shown: boolean
  page: Document
}

/**
 * `href`에서 이 페이지가 떴을 때를 끝까지 돌린다. `site`에 없는 경로는 Pages처럼 404다.
 * 옮기거나 안내를 보인 뒤에도 한 틱을 더 기다린다 — 그 뒤에 또 묻는 일이 없는지 보려고.
 */
async function visit(
  href: string,
  site: Record<string, Answer>,
  languages: readonly string[] = ['en-US'],
): Promise<Visit> {
  const url = new URL(href)
  const page = parse(PAGE)
  const notice = page.getElementById('notice')
  expect(notice?.classList.contains('searching'), 'the notice starts hidden').toBe(true)
  const asked: string[] = []
  let movedTo: string | null = null

  const location = {
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace: (to: string): void => {
      movedTo = to
    },
  }
  const fetch = (target: string): Promise<{ ok: boolean; text: () => Promise<string> }> => {
    asked.push(target)
    const answer = new URL(target).origin === ORIGIN ? site[new URL(target).pathname] : undefined
    if (answer === 'offline') return Promise.reject(new TypeError('Failed to fetch'))
    const { ok, body } = answer ?? MISSING
    return Promise.resolve({ ok, text: () => Promise.resolve(body) })
  }

  runInNewContext(pageScript(), {
    document: page,
    location,
    navigator: { languages },
    fetch,
    DOMParser,
    URLSearchParams,
  })

  const shown = (): boolean => notice?.classList.contains('searching') === false
  await vi.waitFor(() => {
    if (movedTo === null && !shown()) throw new Error('the page is still searching')
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  return { asked, movedTo, shown: shown(), page }
}

describe('404.html이 상위 경로를 올라가며 앱을 찾는다', () => {
  it('깊은 경로에서 부모부터 루트까지 차례로 한 번씩 묻는다 — 못 찾으면 안내를 보이고 옮기지 않는다', async () => {
    const result = await visit(`${ORIGIN}/ml-playgrounds/a/b/c`, {})
    expect(result.asked).toEqual([
      `${ORIGIN}/ml-playgrounds/a/b/`,
      `${ORIGIN}/ml-playgrounds/a/`,
      `${ORIGIN}/ml-playgrounds/`,
      `${ORIGIN}/`,
    ])
    expect(result.movedTo).toBeNull()
    expect(result.shown).toBe(true)
  })

  it('끝이 /인 경로도 자신은 묻지 않는다', async () => {
    const result = await visit(`${ORIGIN}/a/b/`, {})
    expect(result.asked).toEqual([`${ORIGIN}/a/`, `${ORIGIN}/`])
  })

  it('표식이 있는 첫 후보로 옮기고 거기서 멈춘다', async () => {
    const result = await visit(`${ORIGIN}/ml-playgrounds/nowhere/deep/`, {
      '/ml-playgrounds/': found(APP),
      '/': found(APP),
    })
    expect(result.asked).toEqual([`${ORIGIN}/ml-playgrounds/nowhere/`, `${ORIGIN}/ml-playgrounds/`])
    expect(result.movedTo).toBe(`${ORIGIN}/ml-playgrounds/`)
    expect(result.shown).toBe(false)
  })

  it('규정 서랍은 표식이 없어 지나친다', async () => {
    const result = await visit(`${ORIGIN}/ml-playgrounds/legal/nope.html`, {
      '/ml-playgrounds/legal/': found(DRAWER),
      '/ml-playgrounds/': found(APP),
    })
    expect(result.asked).toEqual([`${ORIGIN}/ml-playgrounds/legal/`, `${ORIGIN}/ml-playgrounds/`])
    expect(result.movedTo).toBe(`${ORIGIN}/ml-playgrounds/`)
  })

  it('사이트 루트의 다른 페이지도 앱이 아니다 — 안내를 보인다', async () => {
    const result = await visit(`${ORIGIN}/ml-playgrounds-typo/`, { '/': found(DRAWER) })
    expect(result.asked).toEqual([`${ORIGIN}/`])
    expect(result.movedTo).toBeNull()
    expect(result.shown).toBe(true)
  })

  it('루트에 선 앱(자가호스팅)도 찾는다', async () => {
    const result = await visit(`${ORIGIN}/nowhere/`, { '/': found(APP) })
    expect(result.movedTo).toBe(`${ORIGIN}/`)
  })

  it('해시는 들고 가고 쿼리는 버린다', async () => {
    const result = await visit(`${ORIGIN}/ml-playgrounds/nowhere/?lang=ja&x=1#/project/abc/train`, {
      '/ml-playgrounds/': found(APP),
    })
    expect(result.movedTo).toBe(`${ORIGIN}/ml-playgrounds/#/project/abc/train`)
  })

  it('표식은 요소여야 한다 — 이 페이지를 상태 200으로 받아도 앱으로 안 본다', async () => {
    const result = await visit(`${ORIGIN}/a/b/`, { '/a/': found(PAGE), '/': found(PAGE) })
    expect(result.movedTo).toBeNull()
    expect(result.shown).toBe(true)
  })

  it('상태가 실패면 본문에 표식이 있어도 앱이 아니다', async () => {
    const result = await visit(`${ORIGIN}/a/b/`, { '/a/': { ok: false, body: APP } })
    expect(result.movedTo).toBeNull()
  })

  it('묻다가 네트워크가 끊긴 후보는 건너뛰고 다음을 묻는다', async () => {
    const result = await visit(`${ORIGIN}/ml-playgrounds/a/b`, {
      '/ml-playgrounds/a/': 'offline',
      '/ml-playgrounds/': found(APP),
    })
    expect(result.asked).toEqual([`${ORIGIN}/ml-playgrounds/a/`, `${ORIGIN}/ml-playgrounds/`])
    expect(result.movedTo).toBe(`${ORIGIN}/ml-playgrounds/`)
  })

  it('겹친 /는 하나로 접는다 — 같은 출처 안에서만 묻고, 같은 후보를 두 번 묻지 않는다', async () => {
    const result = await visit(`${ORIGIN}//evil.test//x///y`, { '/': found(APP) })
    expect(result.asked).toEqual([`${ORIGIN}/evil.test/x/`, `${ORIGIN}/evil.test/`, `${ORIGIN}/`])
    expect(result.movedTo).toBe(`${ORIGIN}/`)
  })

  it('루트 자신이 404면 물을 곳이 없다 — 묻지 않고 안내를 보인다', async () => {
    const result = await visit(`${ORIGIN}/`, { '/': found(APP) })
    expect(result.asked).toEqual([])
    expect(result.movedTo).toBeNull()
    expect(result.shown).toBe(true)
  })
})

describe('못 찾았을 때의 안내', () => {
  const messages = pageMessages()

  it('언어는 ?lang= > 브라우저 선호 > 영어로 고른다', async () => {
    const cases: [string, readonly string[], string][] = [
      ['?lang=ja', ['ko-KR'], 'ja'],
      ['', ['ko-KR', 'en'], 'ko'],
      ['', ['fr-FR', 'ja'], 'ja'],
      ['?lang=xx', ['fr-FR'], 'en'],
    ]
    for (const [search, languages, locale] of cases) {
      const { page } = await visit(`${ORIGIN}/nowhere/${search}`, {}, languages)
      const dict = messages[locale] ?? {}
      expect(page.documentElement.lang, `${search} ${languages.join(',')}`).toBe(locale)
      expect(page.getElementById('title')?.textContent).toBe(dict.title)
      expect(page.getElementById('body')?.textContent).toBe(dict.body)
      expect(page.getElementById('home')?.textContent).toBe(dict.home)
    }
  })

  it('사이트 루트로 가는 링크가 있다', () => {
    expect(parse(PAGE).getElementById('home')?.getAttribute('href')).toBe('/')
  })

  it('스크립트가 꺼지면 안내가 처음부터 보이고, 그 글자는 표의 영어다', () => {
    const page = parse(PAGE)
    expect(page.getElementById('notice')?.classList.contains('searching')).toBe(true)
    // 스크립트를 끈 파서는 `<noscript>` 안을 요소로 읽는다. 여기서는 글자로 본다.
    const noscript = page.querySelector('head noscript')?.textContent ?? ''
    expect(noscript).toMatch(/\.searching\s*\{\s*visibility:\s*visible;?\s*\}/)
    const en = messages.en ?? {}
    expect(page.getElementById('title')?.textContent).toBe(en.title)
    expect(page.getElementById('body')?.textContent).toBe(en.body)
    expect(page.getElementById('home')?.textContent).toBe(en.home)
    expect(page.documentElement.lang).toBe('en')
  })

  it('문구 표의 언어가 앱의 언어와 같다', () => {
    expect(Object.keys(messages).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('언어마다 같은 문구가 다 있다', () => {
    const shape = Object.keys(messages.en ?? {}).sort()
    expect(shape.length).toBeGreaterThan(0)
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(messages[locale] ?? {}).sort(), locale).toEqual(shape)
    }
  })

  it('언어마다 그 언어의 글자로 쓰고 다른 언어의 글자가 없다', () => {
    const wrong: string[] = []
    for (const [locale, dict] of Object.entries(messages)) {
      const own = LOCALE_SCRIPTS[locale]
      expect(own, `${locale} declares its script in fixtures/locales.ts`).toBeDefined()
      const foreign = Object.entries(LOCALE_SCRIPTS).flatMap(([other, script]) =>
        other !== locale && script !== null && script !== own ? [script] : [],
      )
      for (const [key, value] of Object.entries(dict)) {
        if (own && !own.test(value)) wrong.push(`${locale}.${key} lacks its own script`)
        if (foreign.some((script) => script.test(value)))
          wrong.push(`${locale}.${key} has a foreign script`)
        if (/[!！]/.test(value)) wrong.push(`${locale}.${key} has an exclamation mark`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('한국어 문구에 물러난 순우리말이 없다', () => {
    const hits = Object.values(messages.ko ?? {}).flatMap((value) => retiredIn(value))
    expect(hits).toEqual([])
  })
})

describe('앱의 표식', () => {
  const selector = (): string => `meta[name="${markerName()}"]`

  it('앱의 index.html에 있다', () => {
    expect(parse(APP).querySelector(selector())).not.toBeNull()
  })

  it('규정 서랍과 이 페이지에는 없다 — 거기로 옮기지 않는다', () => {
    expect(parse(DRAWER).querySelector(selector())).toBeNull()
    expect(parse(PAGE).querySelector(selector())).toBeNull()
  })
})
