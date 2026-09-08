/**
 * **실측 하니스를 파일 하나로 굽는다.**
 *
 * `npm run bench:standalone` → `bench-standalone.html` (git이 안 따라간다).
 *
 * **왜 있는가.** 기준표와 상한은 브라우저에서 몇 시간을 태워야 나오는데
 * (`roadmap.md`의 `재야 할 것`), 그 시간을 **개발 PC에서만** 태울 이유가 없다. 다른
 * 기계에 저장소·node·npm을 세우게 하는 대신 **HTML 하나를 건넨다** — 더블클릭하면
 * 열리고, 인터넷도 서버도 필요 없다.
 *
 * **`dist/`가 아니다.** 이 산출물은 배포본과 아무 관계가 없고, 하니스가 배포본에 안
 * 들어간다는 규칙(`tests/bench-rules.spec.ts`)은 그대로다 — 그 검사가 보는 것은
 * `vite.config.ts`의 빌드 입력이고, 여기서는 설정을 따로 세운다(`configFile: false`).
 *
 * **file:// 로 열린다.** 그래서 셋을 지킨다.
 *
 * 1. **워커가 인라인이다** (`tools/bench.ts`의 `?worker&inline`). 별도 파일이면
 *    `file://`에서 워커를 못 띄운다.
 * 2. **자산도 인라인이다** (`assetsInlineLimit: Infinity`).
 * 3. **동적 import가 없다** (`inlineDynamicImports`). 나뉘면 `file://`에서 못 읽는다.
 *
 * **그리고 마지막에 `<script src>`를 본문으로 바꿔 넣는다** — vite는 파일 둘까지만
 * 줄여 주고 하나로 합치지는 않는다.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { build } from 'vite'

import pkg from '../package.json' with { type: 'json' }

const root = fileURLToPath(new URL('..', import.meta.url))
const staging = join(root, 'node_modules', '.bench-standalone')
const out = join(root, 'bench-standalone.html')

await build({
  configFile: false,
  root,
  // `file://`에는 서버 루트가 없다. 상대 경로여야 한다 — 어차피 다 인라인이라 참조는
  // 안 남지만, 절대 경로가 하나라도 새면 그 파일은 다른 기계에서 조용히 빈 화면이 된다.
  base: './',
  logLevel: 'warn',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@': join(root, 'src') } },
  build: {
    outDir: staging,
    emptyOutDir: true,
    // 파일 하나로 굽는 것이 목적이라 크기 경고는 뜻이 없다.
    chunkSizeWarningLimit: Number.POSITIVE_INFINITY,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    // 상한 사다리는 **깨지는 지점**을 찾는다. 압축이 그 지점을 옮기지는 않지만,
    // 죽었을 때 콘솔에 남는 이름이 읽히는 편이 낫다.
    minify: false,
    rollupOptions: {
      input: join(root, 'tools', 'bench.html'),
      output: { codeSplitting: false },
    },
  },
})

const html = readFileSync(join(staging, 'tools', 'bench.html'), 'utf-8')
const tag = /<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/
// **미리 읽기 링크는 걷어낸다.** 인라인한 뒤에는 가리킬 파일이 없고, 남으면 브라우저가
// 없는 주소를 한 번 두드린다.
const preload = /<link[^>]*\brel="modulepreload"[^>]*>\s*/g

const found = tag.exec(html)
if (found === null) throw new Error('the built page has no script tag to inline')

const asset = join(staging, 'tools', found[1])
const code = readFileSync(asset, 'utf-8')
// **닫는 태그를 쪼갠다.** 번들 안의 문자열에 `</script>`가 들어 있으면 파서가 거기서
// 스크립트를 끊고, 나머지가 본문으로 새어 나온다.
const safe = code.replaceAll('</script>', '<\\/script>')

/**
 * **함수로 바꿔 넣는다.** 치환 **문자열**로 주면 번들 안의 `$&`·`` $` ``·`$1`을
 * `replace`가 패턴으로 읽어 엉뚱한 조각을 도로 끼워 넣는다 — 2026-09-09에 실제로
 * 그랬고, 지운 줄이 페이지에 두 번 살아 돌아왔다. 아래 `leftovers`가 그것을 잡았다.
 */
const single = html
  .replace(preload, '')
  .replace(tag, () => `<script type="module">\n${safe}\n</script>`)
writeFileSync(out, single, { encoding: 'utf-8' })
rmSync(staging, { recursive: true, force: true })

const leftovers = [...single.matchAll(/\b(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => !value.startsWith('data:'))
if (leftovers.length > 0) {
  throw new Error(`the page still points outside itself: ${leftovers.join(', ')}`)
}

console.log(`bench-standalone.html  ${(single.length / 1024 / 1024).toFixed(1)} MB`)
