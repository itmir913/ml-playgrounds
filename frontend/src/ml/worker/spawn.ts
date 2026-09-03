/**
 * 진짜 워커를 만든다. **이 한 줄 때문에 파일이 따로 있다.**
 *
 * `new Worker(new URL(...), ...)`는 Vite가 빌드 시점에 알아보고 별도 청크로 만드는
 * 구문이다. 이걸 ml/worker/client.ts 안에 두면 그 모듈을 부르는 테스트마다 번들러가
 * 워커 청크를 만들려 들고, 테스트가 우리 로직 대신 빌드 설정을 검사하게 된다.
 *
 * 그래서 client.ts는 워커를 주입받고, 앱은 이 함수를 넣는다.
 */

import type { TrainWorker } from './client'

export function spawnTrainingWorker(): TrainWorker {
  return new Worker(new URL('./train.worker.ts', import.meta.url), { type: 'module' })
}

/**
 * 신경망 조각 계산 워커. **학습 워커 안에서 부른다** — 중첩 워커라 부모(학습 워커)가
 * terminate로 죽으면 함께 죽고, 그래서 취소 의미가 그대로 남는다 (ml/worker/neural-pool.ts).
 */
export function spawnNeuralComputeWorker(): Worker {
  return new Worker(new URL('./neural-compute.worker.ts', import.meta.url), { type: 'module' })
}
