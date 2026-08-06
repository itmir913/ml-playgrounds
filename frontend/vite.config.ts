import { fileURLToPath, URL } from 'node:url'
// vitest 설정을 같은 파일에 두기 위해 vite가 아니라 vitest/config에서 가져온다.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

import pkg from './package.json' with { type: 'json' }
import tailwindcss from '@tailwindcss/vite'

// Tailwind v4는 설정 파일이 없다. 테마는 src/styles/theme.css 안에서 정의한다.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  /**
   * **배포 경로가 둘이라 base를 상대 경로로 고정한다.**
   *
   * GitHub Pages는 `luminousky.com/ml-playgrounds/` 하위 경로에서 서빙하고, 도커
   * 자가호스팅은 루트에서 서빙한다. `/ml-playgrounds/`처럼 절대 경로를 박아 넣으면
   * 두 경로의 base가 갈리고, 주소가 바뀔 때마다 다시 빌드해야 한다 — "같은 `dist/`가
   * 양쪽에 그대로 들어간다"(CLAUDE.md §2)와 부딪힌다. `'./'`면 어느 하위 경로에서도,
   * 루트에서도 같은 산출물이 그대로 돈다.
   *
   * 이게 되는 전제 셋: 라우터가 해시 모드라(`router/index.ts`) `404.html` SPA
   * 폴백이 필요 없고, 워커가 `import.meta.url` 기준으로 잡히며, 소스 어디서도
   * `import.meta.env.BASE_URL`을 읽지 않는다. 상세는 `docs/open-decisions.md` #10-1.
   */
  base: './',
  // manifest.appVersion의 출처. package.json 하나만 고치면 파일에 적히는 값이 따라온다 -
  // 소스에 버전 문자열을 또 쓰면 반드시 어긋난다.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    /**
     * **첫 화면이 받는 양과 청크 하나의 크기는 다른 문제다.**
     *
     * 기본값 500kB는 청크 하나를 본다. 우리에게는 일부러 큰 청크가 둘 있다 —
     * ExcelJS(930kB)와 SheetJS(492kB)다. 둘 다 `data/xlsx.ts`에서 `await import`로만
     * 닿으므로 **학생이 엑셀 파일을 열 때까지 내려오지 않는다.** SheetJS는 한 발 더
     * 뒤에 있다 — ExcelJS가 실패한 한셀 파일에서만 쓴다.
     *
     * 첫 화면이 실제로 받는 것은 index + vue-i18n + CSS + 글꼴 서브셋이고 gzip 약
     * 200kB다. 학교 PC와 휴대폰이 기준이라는 전제(CLAUDE.md §0)에 맞는 값이다.
     *
     * 그래서 기준을 엑셀 라이브러리 위로 올린다. **무시할 경고를 계속 띄우면 진짜
     * 경고도 같이 무시하게 된다.** 이 값을 넘는 청크가 새로 생기면 그때는 진짜로
     * 봐야 하는 것이고, 첫 화면에 무거운 것이 들어오면 index가 자라서 걸린다.
     */
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
})
