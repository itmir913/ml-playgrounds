// @vitest-environment jsdom
// 배색이 띠에 닿는지는 `document`가 있어야 보인다.
/**
 * 홈 화면에 얹는 앱으로 서기 위한 것들 (2026-09-22).
 *
 * **눈으로만 보이는 종류다** — 아이콘도 띠 색도 브라우저가 그리고, 잘못돼도 앱은 멀쩡히
 * 돈다. 그래서 여기가 무는 것은 **글자로 확인할 수 있는 약속** 셋이다: 경로가 전부
 * 상대인가, 매니페스트가 실제 파일을 가리키는가, 띠 색이 배색을 따라오는가.
 *
 * **서비스 워커는 없다.** 크롬의 설치 배너는 그것을 요구하지만 캐시 전략은 결정이 걸린
 * 일이라 안 넣었다 — 이 검사가 그 부재를 못 박아, 다음 사람이 *"왜 설치가 안 되지"*를
 * 여기서 읽는다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { setTheme } from '../src/theme'

const ROOT = process.cwd()
const PUBLIC = join(ROOT, 'public')

const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf-8')) as Record<
  string,
  unknown
> & { icons: { src: string; purpose: string }[] }

const html = readFileSync(join(ROOT, 'index.html'), 'utf-8')

describe('매니페스트', () => {
  /**
   * **경로가 전부 상대다.** `vite.config.ts`의 `base: './'`와 같은 이유 — 같은 `dist/`가
   * GitHub Pages(`/ml-playgrounds/`)와 도커(`/`)에 그대로 들어간다. `/`로 시작하면
   * Pages에서 도메인 뿌리를 가리켜 **앱이 아니라 404가 설치된다.**
   */
  it('시작 주소와 범위와 아이콘이 상대 경로다', () => {
    expect(manifest['start_url']).toBe('.')
    expect(manifest['scope']).toBe('.')
    for (const icon of manifest.icons) expect(icon.src.startsWith('./')).toBe(true)
  })

  it('가리키는 아이콘이 실제로 있다', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(join(PUBLIC, icon.src.replace('./', ''))), icon.src).toBe(true)
    }
  })

  /** **깎여도 도형이 안 상해야 한다** — 안드로이드가 아이콘을 원이나 둥근 네모로 자른다. */
  it('깎이는 자리를 위한 아이콘이 따로 있다', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('이름과 설명이 비어 있지 않다', () => {
    for (const key of ['name', 'short_name', 'description']) {
      expect(String(manifest[key] ?? '').length, key).toBeGreaterThan(0)
    }
  })
})

describe('머리말의 태그', () => {
  it('매니페스트와 아이콘을 상대 경로로 가리킨다', () => {
    expect(html).toContain('href="./manifest.webmanifest"')
    expect(html).toContain('href="./icon.svg"')
  })

  /**
   * **안전 영역이 열려 있어야 한다.** 상태 표시줄이 `pad-safe-bottom`으로 홈 인디케이터
   * 자리를 비우는데, `viewport-fit=cover`가 없으면 그 값이 언제나 0이라 **아이폰에서만
   * 단추가 인디케이터에 깔린다.**
   */
  it('안전 영역을 연다', () => {
    expect(html).toContain('viewport-fit=cover')
  })

  /** 스크립트가 돌기 전의 첫 그림용 두 줄. 그 뒤는 `theme.ts`가 고쳐 쓴다. */
  it('배색 둘에 띠 색이 하나씩 있다', () => {
    expect(html).toContain('media="(prefers-color-scheme: light)"')
    expect(html).toContain('media="(prefers-color-scheme: dark)"')
  })

  /**
   * **서비스 워커를 안 등록한다.** 넣는 날은 결정문이 먼저다 — 교실 PC가 차시마다
   * 리셋되는 전제 위에서 캐시 전략을 다시 따져야 한다.
   */
  it('서비스 워커를 등록하지 않는다', () => {
    expect(html).not.toContain('serviceWorker')
    expect(existsSync(join(PUBLIC, 'sw.js'))).toBe(false)
  })
})

/**
 * **`index.html`의 두 값이 배색 토큰의 사본이다.** 첫 그림은 스크립트 전에 서야 하므로
 * 사본을 피할 길이 없다 — 대신 **갈라지면 여기가 운다.** `theme.ts`가 CSS를 읽지 않는
 * 이유가 이것이다(*"배색 토큰을 읽는 자리는 컴포저블 하나뿐"*, `ui-rules.spec.ts`).
 */
describe('띠 색이 배색 토큰과 같다', () => {
  function surfaceOf(file: string): string {
    const css = readFileSync(join(ROOT, 'src', 'styles', file), 'utf-8')
    const found = /--color-surface:\s*([^;]+);/.exec(css)
    expect(found, file).not.toBeNull()
    return (found?.[1] ?? '').trim()
  }

  function chromeOf(scheme: string): string {
    const found = new RegExp(
      `<meta name="theme-color" media="\\(prefers-color-scheme: ${scheme}\\)" content="([^"]+)"`,
    ).exec(html)
    expect(found, scheme).not.toBeNull()
    return found?.[1] ?? ''
  }

  it('밝은 쪽', () => {
    expect(chromeOf('light')).toBe(surfaceOf('theme.css'))
  })

  it('어두운 쪽', () => {
    expect(chromeOf('dark')).toBe(surfaceOf('dark.css'))
  })
})

describe('띠 색이 배색을 따라온다', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1e293b">'
  })

  /**
   * **운영체제가 밝은 쪽이어도 어두운 색이 선다.** 학생이 앱 안에서 고른 것이 이기므로,
   * 두 태그 **모두**가 고른 배색의 색을 들어야 한다.
   */
  it('배색을 바꾸면 띠 색도 바뀐다', () => {
    setTheme('dark')
    const tags = [...document.head.querySelectorAll('meta[name="theme-color"]')]
    expect(tags.length).toBe(2)
    for (const tag of tags) expect(tag.getAttribute('content')).toBe('#1e293b')
  })

  it('다시 밝게 바꾸면 밝은 색으로 돌아온다', () => {
    setTheme('dark')
    setTheme('light')
    const tags = [...document.head.querySelectorAll('meta[name="theme-color"]')]
    for (const tag of tags) expect(tag.getAttribute('content')).toBe('#ffffff')
  })

  /**
   * **`media`를 걷어내야 한다.** 안 걷으면 운영체제 설정과 안 맞는 줄은 브라우저가
   * 무시하고, 학생이 고른 배색이 띠에 안 닿는다.
   */
  it('운영체제 설정에 매인 줄을 푼다', () => {
    setTheme('light')
    const tags = [...document.head.querySelectorAll('meta[name="theme-color"]')]
    for (const tag of tags) expect(tag.hasAttribute('media')).toBe(false)
  })
})
