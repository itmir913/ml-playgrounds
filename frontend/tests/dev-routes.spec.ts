/**
 * **개발 서버와 `vite preview`가 배포본(Pages)처럼 경로를 준다** (`open-decisions.md`
 * "103. 개발 서버가 앱 밖의 경로에도 앱을 띄운다").
 *
 * 개발 서버로 하는 인수 테스트(LAN의 휴대폰 포함)에서 [규정 문서] 링크가 서랍 대신 앱을 띄우면
 * 배포본과 다른 화면을 보고 판정하게 된다. 배포본의 규칙은 셋이다.
 *
 * 1. `public/`의 디렉터리 주소는 그 `index.html`이다 (쿼리가 붙어도).
 * 2. 앱의 진입(`/`)은 앱이다.
 * 3. 없는 경로는 404다 — 라우터가 해시 모드라 SPA 대체 응답이 필요 없다.
 *
 * **판단 함수만 보면 설정을 빼도 초록이다.** `appType: 'mpa'`가 빠지면 없는 경로가 다시 앱이
 * 되고, 플러그인이 빠지면 `/legal/`가 404가 된다 — 그래서 저장소의 `vite.config.ts`로 실제
 * 서버를 세워 HTTP로 묻는다. 의존성 사전 번들링은 끄고 캐시는 임시 디렉터리에 둔다 — 옆에서
 * 도는 개발 서버(5173)의 캐시를 건드리면 그쪽이 다시 읽는다.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createServer, preview, type PreviewServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fileUnder, publicDirectoryIndex } from '../scripts/public-index'

/** vitest는 `frontend/`에서 돈다. */
const FRONTEND = process.cwd()
const PUBLIC = join(FRONTEND, 'public')
const CONFIG = join(FRONTEND, 'vite.config.ts')

function titleOf(html: string): string | null {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null
}

const APP_TITLE = titleOf(readFileSync(join(FRONTEND, 'index.html'), 'utf8'))
const DRAWER_TITLE = titleOf(readFileSync(join(PUBLIC, 'legal', 'index.html'), 'utf8'))
const PRIVACY_JA_TITLE = titleOf(readFileSync(join(PUBLIC, 'legal', 'privacy.ja.html'), 'utf8'))

/** 탈출 표본. `fetch`는 점 구간을 접어 버리므로 그대로 보내는 `http.request`로 묻는다. */
const ESCAPES = ['/../package.json', '/%2e%2e/package.json', '/legal/%2e%2e/%2e%2e/package.json']

interface Answer {
  status: number
  title: string | null
}

/** 브라우저가 문서를 열 때처럼 묻는다. 경로를 정규화하지 않는다. */
function get(port: number, path: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, headers: { accept: 'text/html' } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, title: titleOf(body) }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('publicDirectoryIndex — 요청 주소를 public/의 디렉터리 index로 바꾼다', () => {
  const isPublicFile = fileUnder(PUBLIC)
  /** 무엇이든 있다고 답한다. 거부가 파일 유무가 아니라 주소 모양에서 나오는지 본다. */
  const everything = (): boolean => true

  it('디렉터리 주소는 그 index.html이다', () => {
    expect(publicDirectoryIndex('/legal/', isPublicFile)).toBe('/legal/index.html')
  })

  it('쿼리는 그대로 붙는다 — 서랍은 ?lang=으로 언어를 고른다', () => {
    expect(publicDirectoryIndex('/legal/?lang=ja', isPublicFile)).toBe('/legal/index.html?lang=ja')
  })

  it('파일 주소는 바꾸지 않는다 — Vite가 그 파일을 준다', () => {
    expect(publicDirectoryIndex('/legal/index.html', isPublicFile)).toBeNull()
    expect(publicDirectoryIndex('/legal/privacy.ja.html', isPublicFile)).toBeNull()
  })

  it('루트는 앱의 것이다 — public/index.html이 있어도 가로채지 않는다', () => {
    expect(publicDirectoryIndex('/', everything)).toBeNull()
    expect(publicDirectoryIndex('/?lang=ja', everything)).toBeNull()
  })

  it('index.html이 없는 디렉터리와 없는 경로는 바꾸지 않는다 — Vite가 404를 준다', () => {
    expect(publicDirectoryIndex('/portfolio/', isPublicFile)).toBeNull()
    expect(publicDirectoryIndex('/nowhere/', isPublicFile)).toBeNull()
    expect(publicDirectoryIndex('/legal', isPublicFile)).toBeNull()
  })

  it('경로 탈출은 파일을 묻기 전에 거부한다', () => {
    const asked: string[] = []
    const spy = (path: string): boolean => {
      asked.push(path)
      return true
    }
    for (const url of [
      '/../',
      '/legal/../',
      '/legal/%2e%2e/%2e%2e/',
      '/legal/./',
      '/legal//',
      '/legal%5c..%5c/',
      '/legal%00/',
      '/%E0%A4%A/',
      '//legal/',
      'legal/',
    ]) {
      expect(publicDirectoryIndex(url, spy), url).toBeNull()
    }
    expect(asked, 'no escaped path may reach the file check').toEqual([])
  })

  it('정상 주소는 같은 검사를 지나 파일을 묻는다 — 위 거부가 전부 거부하는 함수의 것이 아니다', () => {
    expect(publicDirectoryIndex('/a/b/', everything)).toBe('/a/b/index.html')
    expect(publicDirectoryIndex('/%ED%95%9C/', everything)).toBe('/%ED%95%9C/index.html')
  })
})

describe('개발 서버 — 저장소의 vite.config.ts로 세운다', () => {
  let vite: ViteDevServer
  let http: Server
  let port: number
  let cacheDir: string

  beforeAll(async () => {
    cacheDir = mkdtempSync(join(tmpdir(), 'mlp-dev-routes-'))
    vite = await createServer({
      configFile: CONFIG,
      root: FRONTEND,
      cacheDir,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    })
    http = createHttpServer(vite.middlewares)
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    port = (http.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()))
    await vite.close()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('규정 서랍의 주소는 서랍이다 — 쿼리가 붙어도', async () => {
    for (const path of ['/legal/', '/legal/?lang=ja', '/legal/index.html']) {
      expect(await get(port, path), path).toEqual({ status: 200, title: DRAWER_TITLE })
    }
  })

  it('서랍 안의 파일은 그 파일이다', async () => {
    expect(await get(port, '/legal/privacy.ja.html')).toEqual({
      status: 200,
      title: PRIVACY_JA_TITLE,
    })
  })

  it('앱의 진입은 앱이다', async () => {
    for (const path of ['/', '/index.html', '/?lang=ja']) {
      expect(await get(port, path), path).toEqual({ status: 200, title: APP_TITLE })
    }
  })

  it('없는 경로는 404다 — 앱을 대신 주지 않는다', async () => {
    for (const path of ['/nowhere/', '/nowhere', '/portfolio/', ...ESCAPES]) {
      expect((await get(port, path)).status, path).toBe(404)
    }
  })
})

describe('vite preview — 산출물 하나에서 같은 규칙이다', () => {
  let server: PreviewServer
  let port: number
  let outDir: string

  beforeAll(async () => {
    // 빌드를 돌리지 않는다. preview가 보는 것은 디렉터리 모양뿐이다.
    outDir = mkdtempSync(join(tmpdir(), 'mlp-preview-routes-'))
    mkdirSync(join(outDir, 'legal'))
    mkdirSync(join(outDir, 'portfolio'))
    writeFileSync(join(outDir, 'index.html'), '<title>app</title>')
    writeFileSync(join(outDir, 'legal', 'index.html'), '<title>drawer</title>')
    writeFileSync(join(outDir, 'portfolio', 'index.json'), '{}')
    server = await preview({
      configFile: CONFIG,
      root: FRONTEND,
      logLevel: 'silent',
      build: { outDir },
      preview: { port: 0, host: '127.0.0.1', open: false },
    })
    port = (server.httpServer.address() as AddressInfo).port
  })

  afterAll(async () => {
    await server.close()
    rmSync(outDir, { recursive: true, force: true })
  })

  it('디렉터리 주소는 그 index.html이다 — 쿼리가 붙어도', async () => {
    for (const path of ['/legal/', '/legal/?lang=ja', '/legal/index.html']) {
      expect(await get(port, path), path).toEqual({ status: 200, title: 'drawer' })
    }
  })

  it('앱의 진입은 앱이다', async () => {
    expect(await get(port, '/')).toEqual({ status: 200, title: 'app' })
  })

  it('없는 경로는 404다', async () => {
    for (const path of ['/nowhere/', '/nowhere', '/portfolio/', ...ESCAPES]) {
      expect((await get(port, path)).status, path).toBe(404)
    }
  })
})
