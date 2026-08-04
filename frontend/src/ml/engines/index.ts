/**
 * 학습 엔진 등록부.
 *
 * **`if (runtime === 'mljs')` 를 만들지 마라.** 여기 배열에 한 줄 추가하면 묶음 실행이
 * 따라온다 (ml/algorithms.ts, ml/metrics.ts와 같은 방식). scikit-learn(Pyodide)이
 * 붙는 자리가 정확히 여기이고, 그때 바뀌는 것은 이 배열 하나여야 한다.
 *
 * 등록부의 키는 **실행 방법 id**다 (ml/backend.ts의 RUNTIMES). 알고리즘 이름이 아니다 -
 * 같은 결정트리라도 ml.js는 `maxDepth`, sklearn은 `max_depth`를 받으므로 하이퍼파라미터
 * 어휘가 실행 방법마다 다르고, 그래서 짝이 (알고리즘, 실행 방법)이어야 한다
 * (open-decisions.md "실행 방법은 하나의 목록이다").
 *
 * **여기 있는 것은 브라우저에서 도는 엔진뿐이다.** 서버 학습은 같은 모양의 비동기
 * 메시지 인터페이스를 갖지만 구현이 다르다 (ml/server.ts, architecture.md 3.4).
 */

import type { FitInput, Predict } from './mljs'
import { MLJS_ALGORITHMS, MLJS_ENGINE, fit as mljsFit } from './mljs'

export type { FitInput, Predict } from './mljs'

export interface TrainingEngine {
  /** ml/backend.ts의 RUNTIMES에 있는 id. 판정과 등록부가 같은 이름을 본다. */
  readonly runtimeId: string
  /** run.engine에 그대로 들어간다. 재실행 대조가 이 값으로 엔진을 가린다. */
  readonly engine: { readonly kind: string; readonly version: string }
  /** 이 엔진이 돌릴 수 있는 알고리즘. */
  readonly algorithms: readonly string[]
  fit(algorithm: string, input: FitInput): Predict
}

export const ENGINES: readonly TrainingEngine[] = [
  {
    runtimeId: 'mljs',
    engine: MLJS_ENGINE,
    algorithms: MLJS_ALGORITHMS,
    fit: mljsFit,
  },
]

/** 실행 방법에 붙은 엔진. 브라우저에서 못 도는 실행 방법이면 없다. */
export function engineFor(runtimeId: string): TrainingEngine | undefined {
  return ENGINES.find((engine) => engine.runtimeId === runtimeId)
}
