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
import { UNMEASURED } from '../../src/ml/backend'

/** 표본은 상한을 재지 않았다. 확인하는 것이 상한이 아니라 판정 규칙이다. */
const UNMEASURED_ROWS = { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED } as const

export const SKLEARN_ONLY_ALGORITHM: Algorithm = {
  id: 'sklearn_only',
  dataTypes: { tabular: true, image: false },
  taskTypes: { classification: true, regression: false, clustering: false },
  runtimes: { mljs: false, 'pyodide-sklearn': true, 'server-sklearn': true },
  maxRows: UNMEASURED_ROWS,
}

/**
 * **표 데이터에서는 안 서는 알고리즘.** 데이터 타입 사유를 확인할 때 쓴다.
 *
 * 예전에는 `dataType: 'image'`를 넘겨서 확인했다. **어휘에서 뺐다** - 안 만든 종류를
 * `DATA_TYPES`에 미리 넣어 두면 등록부가 거짓말을 한다(open-decisions.md "어휘에는 지금
 * 되는 것만 넣는다"). 그래서 표본을 여기서 만든다.
 *
 * **이미지가 들어온 날 그대로 됐다** (2026-08-12). 검사는 한 줄도 안 고쳤다 -
 * **확인하는 것이 어휘가 아니라 규칙이기 때문이다.**
 */
export const NOT_FOR_TABULAR_ALGORITHM: Algorithm = {
  id: 'not_for_tabular',
  dataTypes: { tabular: false, image: true },
  taskTypes: { classification: true, regression: false, clustering: false },
  runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
  maxRows: UNMEASURED_ROWS,
}

/** 등록부에 그 알고리즘 하나가 더 있는 세상. */
export function withSklearnOnly(algorithms: readonly Algorithm[]): Algorithm[] {
  return [...algorithms, SKLEARN_ONLY_ALGORITHM]
}
