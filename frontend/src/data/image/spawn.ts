/**
 * 진짜 워커를 만든다. **이 한 줄 때문에 파일이 따로 있다** (`ml/worker/spawn.ts`와 같은 사정).
 */

import type { CanonicalizeWorker } from './client'

export function spawnCanonicalizeWorker(): CanonicalizeWorker {
  return new Worker(new URL('./canonicalize.worker.ts', import.meta.url), { type: 'module' })
}
