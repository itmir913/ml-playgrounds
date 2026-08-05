/// <reference types="vite/client" />

/** package.json의 version. vite.config.ts의 define이 넣는다. */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
