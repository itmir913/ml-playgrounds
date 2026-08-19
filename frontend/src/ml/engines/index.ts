/**
 * 학습 엔진 등록부.
 *
 * **`if (runtime === 'mljs')` 를 만들지 마라.** 여기 배열에 한 줄 추가하면 실험 실행이
 * 따라온다 (ml/algorithms.ts, ml/metrics.ts와 같은 방식). scikit-learn(Pyodide)이
 * 붙는 자리가 정확히 여기이고, 그때 바뀌는 것은 이 배열 하나여야 한다.
 *
 * 등록부의 키는 **실행 방법 id**다 (ml/backend.ts의 RUNTIMES). 알고리즘 이름이 아니다 -
 * 같은 결정트리라도 ml.js는 `maxDepth`, sklearn은 `max_depth`를 받으므로 하이퍼파라미터
 * 어휘가 실행 방법마다 다르고, 그래서 짝이 (알고리즘, 실행 방법)이어야 한다
 * (open-decisions.md "실행 방법은 (위치 × 엔진)이 아니라 하나의 목록이다").
 *
 * **여기 있는 것은 브라우저에서 도는 엔진뿐이다.** 서버 학습은 같은 모양의 비동기
 * 메시지 인터페이스를 갖지만 구현이 다르다 (ml/server.ts, architecture.md 3.4).
 */

import type { HyperparameterSpec } from '../hyperparams'
import type { FitInput, FitResult } from './mljs'
import {
  MLJS_ALGORITHMS,
  MLJS_ENGINE,
  fit as mljsFit,
  parameters as mljsParameters,
  resolve as mljsResolve,
} from './mljs'
import {
  PYODIDE_SKLEARN_ALGORITHMS,
  PYODIDE_SKLEARN_ENGINE,
  fit as pyodideFit,
  parameters as pyodideParameters,
  resolve as pyodideResolve,
} from './pyodide-sklearn'

export type { FitInput, FitResult, Predict } from './mljs'

export interface TrainingEngine {
  /** ml/backend.ts의 RUNTIMES에 있는 id. 판정과 등록부가 같은 이름을 본다. */
  readonly runtimeId: string
  /** run.engine에 그대로 들어간다. 재실행 대조가 이 값으로 엔진을 가린다. */
  readonly engine: { readonly kind: string; readonly version: string }
  /** 이 엔진이 돌릴 수 있는 알고리즘. */
  readonly algorithms: readonly string[]
  /**
   * 이 알고리즘에 받는 손잡이들 - 이름·타입·범위·기본값 (ml/hyperparams.ts).
   *
   * **화면과 학습이 같은 것을 본다.** 전처리 화면이 이걸로 입력을 그리고, 학습 직전에
   * 같은 서술로 값을 확인한다. 두 곳이 각자 판정하면 화면은 멀쩡한데 학습이 거부하는
   * 상태가 생긴다. 서버가 자기 알고리즘을 알려주게 되면 이 자리에 프로토콜 응답이 온다
   * (open-decisions.md "무엇을 학습할 수 있는지는 서버가 알려준다" 1번).
   */
  parameters(algorithm: string): readonly HyperparameterSpec[]
  /**
   * 학생이 준 값에 기본값을 얹어 **이 엔진이 실제로 먹을 값**을 확정한다.
   *
   * **fit보다 먼저 부른다** (mlpx-spec.md 3). 확정을 fit 안에 두면 fit이 던졌을 때
   * 돌려줄 것이 없어 실패한 run에 아무 값도 안 남는다.
   *
   * 기본값의 출처는 엔진 하나뿐이다. 밖에 표를 하나 더 두면 같은 숫자가 두 군데 살고,
   * 한쪽만 고쳤을 때 파일이 조용히 거짓말을 한다.
   *
   * **반드시 멱등이어야 한다 - `resolve(a, resolve(a, x))`가 `resolve(a, x)`와 같아야 한다.**
   * `fit`이 안에서 한 번 더 부르기 때문이다(부르는 쪽이 거쳤는지에 기대지 않으려고 그렇게
   * 해 뒀다). 값을 누적하거나 배율을 먹이는 resolve를 쓰면 **두 번 적용되고, 그 원인은
   * fit 안에서 안 보인다.** 채우기와 변환까지가 여기서 할 수 있는 전부다.
   *
   * 엔진이 하나뿐인 지금은 안 터진다. 두 번째 엔진에서 터지는 종류라 계약으로 적어 둔다.
   */
  resolve(algorithm: string, given: Record<string, unknown>): Record<string, unknown>
  /**
   * 학습하고 예측 함수를 돌려준다. **우리 형식으로 담을 수 있으면 모델도 함께 준다.**
   *
   * 모델이 없는 것은 정상이다 - 그 엔진에 그 알고리즘의 직렬화기가 아직 없다는 뜻이고,
   * 파일에는 사유가 남는다 (mlpx-spec.md 4.2).
   */
  fit(algorithm: string, input: FitInput): FitResult
}

/**
 * V3 엔진. **순서가 기본값 우선순위다** — 앞에 있는 것부터 고른다 (ml/backend.ts).
 *
 * 순수 JS가 맨 앞인 이유는 gzip 25KB에 시동이 없기 때문이다. scikit-learn은 26.3MB에
 * 시동 15.4초라 기본값이 될 수 없다 (open-decisions.md "브라우저 학습 엔진은 둘 다 간다").
 *
 * **여기 항목을 추가하면 실험이 따라온다.** experiment.ts가 `engineFor(runtimeId)`로
 * 이 배열을 보고, runtimeOptions가 `engineFor`로 존재 여부를 확인한다.
 */
export const ENGINES: readonly TrainingEngine[] = [
  {
    runtimeId: 'mljs',
    engine: MLJS_ENGINE,
    algorithms: MLJS_ALGORITHMS,
    parameters: mljsParameters,
    resolve: mljsResolve,
    fit: mljsFit,
  },
  {
    runtimeId: 'pyodide-sklearn',
    engine: PYODIDE_SKLEARN_ENGINE,
    algorithms: PYODIDE_SKLEARN_ALGORITHMS,
    parameters: pyodideParameters,
    resolve: pyodideResolve,
    fit: pyodideFit,
  },
]

/** 실행 방법에 붙은 엔진. 브라우저에서 못 도는 실행 방법이면 없다. */
export function engineFor(runtimeId: string): TrainingEngine | undefined {
  return ENGINES.find((engine) => engine.runtimeId === runtimeId)
}
