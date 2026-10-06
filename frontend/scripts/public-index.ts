/**
 * **개발 서버도 `public/`의 디렉터리 주소에 그 `index.html`을 준다** (`open-decisions.md`
 * "103. 개발 서버가 앱 밖의 경로에도 앱을 띄운다").
 *
 * 배포본(Pages)은 `/legal/`에 `public/legal/index.html`(규정 서랍)을 준다. Vite 개발 서버는
 * 디렉터리 index를 앱 루트(`frontend/`)에서만 찾고 `public/`에서는 안 찾는다 — 그래서 SPA
 * 대체 응답을 끈(`appType: 'mpa'`, `vite.config.ts`) 뒤에는 `/legal/`가 404가 된다. 이
 * 미들웨어가 그 한 칸을 메운다. 없는 경로의 404와 앱의 진입(`/`)은 Vite가 그대로 판정한다.
 *
 * **`vite preview`에는 걸지 않는다.** preview는 산출물(`dist/`) 하나에서 디렉터리 index를
 * 찾고, `public/`은 이미 그 안에 복사돼 있다. 둘 다 `tests/dev-routes.spec.ts`가 문다.
 *
 * **노드 전용이다.** `vite.config.ts`만 부르므로 번들에 안 들어간다.
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'

import type { Plugin } from 'vite'

const INDEX = 'index.html'

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
 * **개발 서버에 거는 플러그인.** Vite의 내부 미들웨어보다 앞에 서서(`configureServer`가
 * 함수를 돌려주지 않으면 앞이다) 주소만 바꾸고 넘긴다 — 파일은 Vite의 `public/` 서빙이 준다.
 */
export function publicDirectoryIndexes(): Plugin {
  return {
    name: 'ml-playgrounds:public-directory-index',
    apply: 'serve',
    configureServer(server) {
      const { publicDir } = server.config
      if (!publicDir) return
      const isPublicFile = fileUnder(publicDir)
      server.middlewares.use((req, _res, next) => {
        const rewritten = req.url ? publicDirectoryIndex(req.url, isPublicFile) : null
        if (rewritten) req.url = rewritten
        next()
      })
    },
  }
}
