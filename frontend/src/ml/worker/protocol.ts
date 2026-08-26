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
import type { Experiment, Run, RunsFile } from '../../project/schema'
import type { ExperimentInput, ExperimentPrelude } from '../experiment'
import type { ModelFile } from '../models'
import type { Preprocessor } from '../preprocess'

/** 메인 -> 워커. 실험 하나를 돌려 달라는 것. */
export interface TrainRequest {
  type: 'train'
  input: ExperimentInput
  /** 지금까지의 runs.json. id 일련번호와 changed가 여기서 나온다. */
  history?: RunsFile
}

/**
 * 워커 -> 메인.
 *
 * **진행은 모델 단위다** (mlpx-spec.md 0.3). 실험 전체 진행률은 받는 쪽이 센다 -
 * 여기서 백분율을 만들면 서버 학습과 계산이 두 벌이 되고 반드시 어긋난다.
 */
export type WorkerMessage =
  /**
   * 모델 하나를 시작했다 (mlpx-spec.md §0.3, 2026-08-07).
   *
   * **끝날 때만 보고하면 지금 도는 것이 무엇인지 아무도 모른다.** 모델 하나가 몇 분씩
   * 걸리는 조합이 있고, 그때 화면이 끝난 개수만 들고 있으면 학생은 어느 모델이 오래
   * 걸리는지 알아내려고 모델을 하나씩 빼 가며 다시 학습한다.
   *
   * **`index`는 `selectedAlgorithms`의 자리다.** 같은 알고리즘이 실행 방법만 다르게 두 번
   * 들어올 수 있어(schema.ts) 이름은 키가 못 된다.
   *
   * `runtime`을 싣는 이유는 **학생이 고른 것과 실제로 도는 것이 다를 수 있어서다** -
   * 자동으로 넘어간 경우(open-decisions.md "실행 방법은 (위치 × 엔진)이 아니라 하나의 목록이다") 지금 도는 것을
   * 말하는 자리에서 그걸 틀리게 말하면 안 된다.
   */
  | { type: 'started'; index: number; algorithm: string; runtime: string; total: number }
  /**
   * 모델 하나가 끝났다. **`index`는 `started`와 같은 자리를 가리킨다** - 받는 쪽이
   * "끝난 개수 - 1"로 되짚지 않게 하려고 싣는다. 그 되짚기는 **순차 실행일 때만 맞는
   * 추론**이고, 서버 학습이나 병렬 실행이 붙는 날 조용히 틀린다 (architecture.md §8.17).
   */
  | {
      type: 'progress'
      run: Run
      index: number
      completed: number
      total: number
      /**
       * 방금 담은 모델. **없는 것이 정상이다** — 실패한 run과 직렬화기가 없는 알고리즘은
       * 지표만 남는다 (mlpx-spec.md §4.2).
       *
       * **여기 실리지 않으면 취소가 아무것도 못 건진다.** 모델은 `done`에 몰려 가는데
       * terminate하면 워커와 함께 사라진다 (open-decisions.md "멈추기가 끝난 것을
       * 남긴다" §2). 총 전송량은 같고 시점만 앞당겨진다.
       */
      model?: ModelFile
    }
  /**
   * 모델 루프에 들어가기 전에 한 번. **취소가 부분 실험을 조립할 재료다**
   * (같은 결정문 §3). 성공 경로는 이것을 안 쓴다 — `done`이 완성품을 싣는다.
   */
  | { type: 'prelude'; prelude: ExperimentPrelude }
  // 모델은 Map으로 간다. 구조화 복제가 Map을 그대로 넘기므로 평평하게 펼 이유가 없다.
  | {
      type: 'done'
      experiment: Experiment
      preprocessor: Preprocessor
      models: Map<string, ModelFile>
    }
  | { type: 'failed'; code: string; params: ClientErrorParams }
