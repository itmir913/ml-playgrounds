/**
 * 순수 JS 엔진이 받는 손잡이들. **이 엔진에서 이 값들의 유일한 출처다.**
 *
 * **엔진 본체와 파일이 갈라진 이유는 번들이다.** 전처리 화면이 손잡이를 그리려면 이
 * 표를 읽어야 하는데, `mljs.ts`에서 읽으면 `ml-cart`·`ml-random-forest`가 통째로 첫
 * 화면 번들에 딸려 온다. 학습을 워커 뒤로 미뤄 둔 것이 화면 하나 때문에 되돌아온다.
 * 여기에는 **의존성이 없다** — 그래서 화면도 엔진도 같은 표를 본다.
 *
 * **기본값은 실측한 값 그대로다** — 이 값에서 `mljs.ts` 머리말의 붓꽃 숫자가 나왔고
 * `tests/mljs.spec.ts`가 그것을 고정한다. 바꾸면 학생의 결과가 바뀐다.
 *
 * **min/max는 눈금이지 상한이 아니다**
 * (open-decisions.md "하이퍼파라미터는 눈금을 주되 막지 않는다"). 학생은 숫자를 직접
 * 쳐서 밖으로 나갈 수 있고 그때는 시끄럽게 실패한다. 그러므로 여기서 정하는 것은
 * "얼마까지 허용할까"가 아니라 **"보통 여기서 고른다"**이고, 실제로 값을 하는 자리는
 * 아래쪽 끝이다 — k가 0인 KNN이나 나무 0그루는 값이 아니라 고장이다.
 *
 * 여기 없는 생성자 인자가 둘 있다 — 결정트리의 `gainFunction`('gini')과 랜덤포레스트의
 * `useSampleBagging`(true). **구멍이 아니라 범위다.** 둘 다 진짜 손잡이지만(sklearn의
 * criterion, bootstrap) 수치가 아니라 어휘라서 이 표의 모양에 안 들어간다. 손잡이를
 * 늘릴 이유가 생기면 서술 타입부터 넓힌다.
 *
 * `randomState`도 없다. 출처가 `settings.split` 하나이고, 파일 두 곳에 같은 값이 있으면
 * 어긋났을 때 어느 쪽이 진짜인지 판정할 근거가 없다 (mlpx-spec.md §3).
 */

import type { HyperparameterSpec } from '../hyperparams'

export const MLJS_PARAMETERS: Readonly<Record<string, readonly HyperparameterSpec[]>> = {
  decision_tree: [
    // 기본값이 곧 위쪽 끝이다. 교실 데이터에서 깊이 100에 닿는 나무는 없으므로 이 값은
    // "제한 없음"에 가깝고, 학생이 움직이는 방향은 언제나 아래쪽이다.
    { name: 'maxDepth', integer: true, min: 1, max: 100, step: 1, default: 100 },
    { name: 'minNumSamples', integer: true, min: 1, max: 100, step: 1, default: 3 },
  ],
  // **오렌지3와 같은 10그루로 시작한다** (owrandomforest.py의 n_estimators=10).
  // sklearn 기본값 100을 따라가고 있었는데, 나무를 늘리면 시간이 행 수의 제곱으로 붙어
  // 1600행에서 39초, 5000행에서 약 7분이었다 (open-decisions.md #19). 교실에서 학생이
  // 설정을 바꿔가며 여러 번 돌리는 것이 이 도구의 핵심 활동인데 그 활동이 성립하지 않는다.
  //
  // 예전에는 나무를 줄이면 ml-random-forest가 터져서 줄일 수도 없었다. OOB 계산을
  // 끄면서(mljs.ts의 noOOB) 그 제약이 사라졌고, 그래서 이제 고를 수 있는 값이다.
  //
  // 막지는 않는다 - 45분이라는 제약은 교실의 것이지 도구의 것이 아니다. 위쪽 끝은 그대로다.
  random_forest: [{ name: 'nEstimators', integer: true, min: 1, max: 500, step: 1, default: 10 }],
  naive_bayes: [],
  knn: [{ name: 'k', integer: true, min: 1, max: 100, step: 1, default: 5 }],
  logistic_regression: [
    { name: 'numSteps', integer: true, min: 1, max: 10000, step: 1, default: 1000 },
    // 0을 넣으면 모델이 한 걸음도 안 움직인다. 에러 없이 아무것도 안 배운 모델이
    // 나오므로 아래쪽 끝이 특히 중요하다.
    { name: 'learningRate', integer: false, min: 0.0001, max: 1, step: 0.0001, default: 5e-3 },
  ],
  linear_regression: [],
}
