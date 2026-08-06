/**
 * 등록부 판정을 확인할 때 쓰는 가짜 알고리즘.
 *
 * **한동안 `svm`이 이 자리를 맡았다.** 순수 JS 구현이 없는 유일한 알고리즘이라
 * "sklearn 전용은 이렇게 잠긴다"의 표본이 됐는데, 순수 JS 솔버가 들어오면서 그 사실이
 * 사라졌다(open-decisions.md "순수 JS 서포트 벡터 머신을 넣는다").
 *
 * **판정 규칙은 그대로 살아 있어야 한다.** 서버 전용·엔진 전용 알고리즘은 앞으로도
 * 들어오고(V5의 이미지 모델), 그때 이 규칙이 처음 실물을 만나면 늦다. 그래서 표본을
 * 등록부에서 빌리지 않고 여기서 만든다 - **등록부의 사실이 바뀌어도 규칙의 테스트는
 * 안 흔들린다.**
 */

import type { Algorithm } from '../../src/ml/algorithms'

export const SKLEARN_ONLY_ALGORITHM: Algorithm = {
  id: 'sklearn_only',
  dataTypes: { tabular: true, image: false, audio: false, text: false },
  taskTypes: { classification: true, regression: false, clustering: false },
  runtimes: { mljs: false, 'pyodide-sklearn': true, 'server-sklearn': true },
}

/** 등록부에 그 알고리즘 하나가 더 있는 세상. */
export function withSklearnOnly(algorithms: readonly Algorithm[]): Algorithm[] {
  return [...algorithms, SKLEARN_ONLY_ALGORITHM]
}
