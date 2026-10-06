/**
 * **개발 서버와 `vite preview`가 배포본(Pages)처럼 경로를 준다.** 둘을 메운다.
 *
 * 1. **`public/`의 디렉터리 주소에 그 `index.html`을 준다** (`open-decisions.md` "103. 개발 서버가 앱 밖의
 *    경로에도 앱을 띄운다"). 배포본은 `/legal/`에 `public/legal/index.html`(규정 서랍)을 준다. Vite 개발 서버는
 *    디렉터리 index를 앱 루트(`frontend/`)에서만 찾고 `public/`에서는 안 찾는다 — 그래서 SPA 대체 응답을 끈
 *    (`appType: 'mpa'`, `vite.config.ts`) 뒤에는 `/legal/`가 404가 된다. preview는 산출물(`dist/`) 하나에서
 *    디렉터리 index를 찾고 `public/`은 이미 그 안에 복사돼 있어서 이 칸은 개발 서버에만 건다.
 * 2. **없는 경로에 `404.html`을 상태 404로 준다** (`open-decisions.md` "104. 서버 경로의 없는 주소는 앱의
 *    루트로 보낸다"). Pages가 그렇게 준다. Vite 8은 개발 서버도 preview도 없는 경로에 **빈 몸의 404**를 준다
 *    (`notFoundMiddleware`) — 그 페이지가 앱을 찾아 옮기는 일을 개발 서버로 하는 인수 테스트에서 못 본다.
 *    개발 서버는 `public/404.html`을, preview는 산출물의 `404.html`을 준다.
 *
 * 앱의 진입(`/`)과 실제 파일은 Vite가 그대로 판정한다. 둘 다 `tests/dev-routes.spec.ts`가 문다.
 *
 * **노드 전용이다.** `vite.config.ts`만 부르므로 번들에 안 들어간다. `apply: 'serve'`라 빌드에는 안 걸린다.
 */

import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { Connect, Plugin } from 'vite'

const INDEX = 'index.html'
const NOT_FOUND = '404.html'

/**
 * **요청 주소를 `public/`의 디렉터리 index로 바꾼 주소.** 바꿀 것이 없으면 `null`이고, 그때는
 * Vite가 판정한다(파일이면 주고, 없으면 404).
 *
 * - 쿼리는 그대로 붙인다 — 서랍은 `?lang=ja`로 언어를 고른다.
 * - **빈 구간·`.`·`..`·역슬래시·NUL이 든 경로는 바꾸지 않는다.** `isPublicFile`에 닿기 전에
 *   막아, `public/` 밖의 파일을 묻는 일 자체가 없다.
 * - **루트(`/`)는 빈 구간이라 여기서 걸린다 — 앱의 것이다.** `public/index.html`이 생겨도 앱의
 *   진입을 가로채지 않는다.
 */
export function publicDirectoryIndex(
  url: string,
  isPublicFile: (path: string) => boolean,
): string | null {
  const cut = url.search(/[?#]/)
  const rawPath = cut === -1 ? url : url.slice(0, cut)
  const rest = cut === -1 ? '' : url.slice(cut)
  if (!rawPath.startsWith('/') || !rawPath.endsWith('/')) return null

  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (/[\\\0]/.test(path)) return null
  const segments = path.slice(1, -1).split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null
  }

  return isPublicFile(path + INDEX) ? rawPath + INDEX + rest : null
}

/** `dir` 아래의 정규 파일인가. `path`는 `/`로 시작하는 주소 경로다. */
export function fileUnder(dir: string): (path: string) => boolean {
  return (path) => statSync(join(dir, path), { throwIfNoEntry: false })?.isFile() ?? false
}

/**
 * **이 요청을 Vite의 HTML 응답이 아직 받을 수 있는가.** 아래 404 미들웨어는 Vite의 HTML 대체 응답 뒤,
 * HTML 응답(`indexHtmlMiddleware`) 앞에 선다 — 플러그인 훅이 끼어들 수 있는 마지막 자리다. 그 뒤에는 HTML
 * 응답과 빈 404뿐이고, HTML 응답은 `.html`로 끝나는 주소의 실재하는 파일만 준다(대체 응답이 `/`를
 * `/index.html`로 이미 바꿔 둔다). 그러니 이것이 아니면 Vite의 답은 404다.
 *
 * 경로를 못 푸는 주소는 `true`다 — 모르면 Vite에 맡긴다. 그쪽도 결국 404다.
 */
export function mayServeHtml(url: string, isFile: (path: string) => boolean): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? ''
  if (!path.endsWith('.html')) return false
  try {
    return isFile(decodeURIComponent(path))
  } catch {
    return true
  }
}

/**
 * `dir`의 `404.html`을 상태 404로 주는 미들웨어. 파일이 없으면(빌드 전의 preview) Vite의 빈 404에 맡긴다.
 * 파일은 요청마다 읽는다 — 개발 중에 고친 것이 서버를 다시 띄우지 않고 보인다.
 */
function notFoundPage(dir: string, isFile: (path: string) => boolean): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (mayServeHtml(req.url ?? '', isFile)) return next()
    let html: Buffer
    try {
      html = readFileSync(join(dir, NOT_FOUND))
    } catch {
      return next()
    }
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(req.method === 'HEAD' ? undefined : html)
  }
}

/**
 * **개발 서버와 preview에 거는 플러그인.**
 *
 * - 디렉터리 index는 Vite의 내부 미들웨어보다 앞에 서서(`configureServer`가 바로 거는 것은 앞이다) 주소만
 *   바꾸고 넘긴다 — 파일은 Vite의 `public/` 서빙이 준다.
 * - 404 페이지는 훅이 돌려주는 함수로 건다 — Vite의 내부 미들웨어 뒤, 빈 404 앞이다(`mayServeHtml`).
 */
export function publicRoutes(): Plugin {
  return {
    name: 'ml-playgrounds:public-routes',
    apply: 'serve',
    configureServer(server) {
      const { publicDir, root } = server.config
      if (!publicDir) return
      const isPublicFile = fileUnder(publicDir)
      server.middlewares.use((req, _res, next) => {
        const rewritten = req.url ? publicDirectoryIndex(req.url, isPublicFile) : null
        if (rewritten) req.url = rewritten
        next()
      })
      return () => {
        server.middlewares.use(notFoundPage(publicDir, fileUnder(root)))
      }
    },
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir)
      return () => {
        server.middlewares.use(notFoundPage(outDir, fileUnder(outDir)))
      }
    },
  }
}
