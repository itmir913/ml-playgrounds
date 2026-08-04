/**
 * 메인 스레드와 학습 워커가 주고받는 것. **양쪽의 유일한 계약이다.**
 *
 * 여기 있는 것은 전부 **구조화 복제로 넘어갈 수 있는 값**이어야 한다. postMessage는
 * 함수도 클래스도 넘기지 못한다 - 그래서 요청에 콜백(onRun, now)이 없고, 실패는
 * ClientError가 아니라 `{ code, params }`로 간다. 받는 쪽이 다시 세운다
 * (ml/worker/client.ts).
 *
 * **모양을 서버 학습과 맞춰 둔다.** WebSocket도 진행 이벤트와 결과를 같은 순서로 주므로
 * (architecture.md 3.4), 화면은 어디서 도는지 몰라도 된다.
 */

import type { ClientErrorParams } from '../../errors'
import type { Batch, Run, RunsFile } from '../../project/schema'
import type { BatchInput } from '../batch'
import type { Preprocessor } from '../preprocess'

/** 메인 -> 워커. 묶음 하나를 돌려 달라는 것. */
export interface TrainRequest {
  type: 'train'
  input: BatchInput
  /** 지금까지의 runs.json. id 일련번호와 changed가 여기서 나온다. */
  history?: RunsFile
}

/**
 * 워커 -> 메인.
 *
 * **진행은 모델 단위다** (mlpx-spec.md 0.3). 묶음 전체 진행률은 받는 쪽이 센다 -
 * 여기서 백분율을 만들면 서버 학습과 계산이 두 벌이 되고 반드시 어긋난다.
 */
export type WorkerMessage =
  | { type: 'progress'; run: Run; completed: number; total: number }
  | { type: 'done'; batch: Batch; preprocessor: Preprocessor }
  | { type: 'failed'; code: string; params: ClientErrorParams }
