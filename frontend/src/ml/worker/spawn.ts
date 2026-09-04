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
 *
 * **쟀다** (2026-09-04, 크롬): 부모를 terminate하자 자식 넷의 심장 박동이 즉시 끊겼다.
 * 사람 확인이고 검사가 아니다 — jsdom에 `Worker`가 없어 관문으로는 못 밟는다.
 * 절차는 open-decisions.md "학습을 코어로 가른다"에 있다.
 */
export function spawnNeuralComputeWorker(): Worker {
  return new Worker(new URL('./neural-compute.worker.ts', import.meta.url), { type: 'module' })
}

/**
 * 랜덤포레스트 트리 학습 워커. **신경망과 청크를 나눠 갖는다** — 이쪽은 `ml-cart`를
 * 끌고 오고 저쪽은 안 그런다. 한 파일에 합치면 신경망만 쓰는 학생도 트리 코드를 받는다.
 */
export function spawnForestWorker(): Worker {
  return new Worker(new URL('./forest.worker.ts', import.meta.url), { type: 'module' })
}

/** KNN 예측 워커. 위와 같은 이유로 따로 있다 — 이쪽이 끌고 오는 것은 해석기뿐이다. */
export function spawnKnnWorker(): Worker {
  return new Worker(new URL('./knn.worker.ts', import.meta.url), { type: 'module' })
}
