import { fileURLToPath, URL } from 'node:url'
// vitest 설정을 같은 파일에 두기 위해 vite가 아니라 vitest/config에서 가져온다.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

import pkg from './package.json' with { type: 'json' }
import tailwindcss from '@tailwindcss/vite'

// Tailwind v4는 설정 파일이 없다. 테마는 src/style.css 안에서 정의한다.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // manifest.appVersion의 출처. package.json 하나만 고치면 파일에 적히는 값이 따라온다 -
  // 소스에 버전 문자열을 또 쓰면 반드시 어긋난다.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'src/**/*.spec.ts'],
  },
})
