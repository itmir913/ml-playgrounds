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
  /**
   * **개발 서버를 같은 네트워크에 연다.**
   *
   * 기본값은 `localhost`뿐이라 **개발 PC 밖에서는 열 수 없다.** 그런데 이 도구는
   * 휴대폰이 기준 기기 중 하나이고(CLAUDE.md §0), 실기기에서만 드러나는 것들이 있다 —
   * iOS 주소창이 접히고 펴지는 것, 상단 탭으로 맨 위 가기, 키보드가 올라올 때 하단
   * 고정 바. 데스크톱 브라우저의 반응형 모드로는 셋 다 재현되지 않는다.
   *
   * 개발 서버에만 걸린다. 빌드 산출물은 정적 파일이라 이 설정과 무관하다.
   */
  server: { host: true },
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
    /**
     * **검사 시간의 90%가 검사가 아니었다.**
     *
     * 실측(2026-08-11): 스펙 52개의 실제 실행 시간을 다 더하면 14.6초인데 벽시계는
     * 146초였다. 나머지 131초는 전부 파일마다 되풀이되는 준비 비용 - 워커를 띄우고,
     * 소스를 변환하고, 환경을 세우는 값이다. **느린 검사를 찾아 고치는 문제가
     * 아니라 준비 비용을 52번 무는 구조의 문제였다.** 그래서 아래 둘을 바꾼다.
     *
     * 1. `pool` - vitest 기본값 `forks`는 파일마다 자식 **프로세스**를 만든다.
     *    윈도우에서 프로세스 생성은 스레드보다 훨씬 비싸고, 프로세스마다 힙을 따로
     *    잡아 **메모리도 같이 먹는다**(이 개발 PC는 7.7GB다 - CLAUDE.md §0의 기준
     *    기기). `threads`는 힙을 공유한다. 격리는 그대로다 - vitest는 두 pool 모두
     *    파일마다 새 모듈 그래프를 만든다(`isolate` 기본값 `true`). 그래서 이건
     *    **보장을 깎지 않고 얻는 시간이다.** 146초 → 53초.
     *
     * 2. `environment` - 전에는 `'jsdom'`이 전역이었다. 그런데 DOM이 실제로 필요한
     *    것은 컴포넌트를 mount하거나 `document`를 만지는 소수뿐이고, 나머지 마흔
     *    몇 개(포맷 파싱, 지표 계산, 파일 왕복, 소스를 읽는 규칙 검사)는 DOM을 세워
     *    놓고 쓰지 않았다. 기본을 `'node'`로 내리고 **필요한 파일이 스스로 밝히게**
     *    한다 - 파일 첫 줄의 `// @vitest-environment jsdom`이다.
     *
     * **빠뜨리면 대개 시끄럽게 실패한다** - `document is not defined`로 그 자리에서
     * 죽는다. 다만 **조용한 길이 하나 있었다**: 소스가 `typeof document === 'undefined'`로
     * DOM 부재를 분기하고 있으면 죽는 대신 대체 경로를 검사한다. 초록색인데 다른 것을
     * 보는 상태다. 그 길은 `tests/ui-rules.spec.ts`의 "DOM이 필요한 검사는 스스로
     * 밝힌다"가 막는다 - 가드가 있는 모듈에 닿는 스펙은 밝히지 않으면 거기서 걸린다.
     */
    pool: 'threads',
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
})
