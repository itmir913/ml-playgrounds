/**
 * 진짜 워커를 만든다. **이 한 줄 때문에 파일이 따로 있다.**
 *
 * `new Worker(new URL(...), ...)`는 Vite가 빌드 시점에 알아보고 별도 청크로 만드는
 * 구문이다. client.ts 안에 두면 그 모듈을 부르는 테스트마다 번들러가 워커 청크를
 * 만들려 들고, 테스트가 우리 로직 대신 빌드 설정을 검사하게 된다
 * (ml/worker/spawn.ts와 같은 사정).
 */

import type { EmbedWorker } from './client'

export function spawnEmbedWorker(): EmbedWorker {
  return new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' })
}
