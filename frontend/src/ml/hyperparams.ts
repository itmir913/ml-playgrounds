/**
 * 하이퍼파라미터 **서술** - 이름·타입·범위·기본값.
 *
 * **여기 있는 것은 모양이고, 값은 엔진이 갖는다** (ml/engines/mljs-params.ts).
 * 기본값의 출처가 엔진 하나여야 한다는 규칙(mlpx-spec.md 3)이 범위로 넓어진 것뿐이다 -
 * 같은 숫자가 두 군데 살면 한쪽만 고쳤을 때 파일이 조용히 거짓말을 한다.
 *
 * **화면과 학습이 같은 서술을 본다.** 손잡이를 그리는 것도, 학습 전에 값을 확인하는
 * 것도 이 파일의 함수들이다. 두 곳이 각자 판정하면 화면은 멀쩡한데 학습이 거부하는
 * 상태가 생기고, 학생은 고칠 자리를 못 찾는다.
 *
 * **범위는 눈금이지 상한이 아니다**
 * (open-decisions.md "하이퍼파라미터는 눈금을 주되 막지 않는다").
 * 스테퍼는 min~max 안에서 움직이지만 학생은 숫자를 직접 칠 수 있고, 범위 밖 값은
 * 그대로 저장된다. 대신 화면이 그 자리에서 말하고 학습하면 **그 모델의 run 하나가**
 * HYPERPARAM_OUT_OF_RANGE로 실패한다 - 실험은 계속 돈다 (mlpx-spec.md 4.1).
 *
 * 자가호스팅 서버가 붙으면 같은 모양을 프로토콜로 받는다
 * (open-decisions.md "무엇을 학습할 수 있는지는 서버가 알려준다" 1번).
 */

import { ClientError } from '../errors'
import { MLJS_PARAMETERS } from './engines/mljs-params'

export interface HyperparameterSpec {
  /**
   * **엔진이 받는 키 그대로다.** 로케일 키가 아니다 - ml.js는 maxDepth, sklearn은
   * max_depth이고 그 차이가 등록부 키를 (알고리즘, 실행 방법)으로 만든 이유다.
   */
  readonly name: string
  /**
   * 정수만 받는가. **소수는 범위 밖 값이 아니라 값이 아니다** - 나무 2.5그루가 그렇다.
   * 그래서 거부하지 않고 반올림해 확정한다 (아래 resolveWith).
   */
  readonly integer: boolean
  readonly min: number
  readonly max: number
  /** 스테퍼가 한 번에 움직이는 폭. */
  readonly step: number
  readonly default: number
}

/**
 * 실행 방법마다의 서술. **키가 (알고리즘, 실행 방법)인 이유가 여기 있다** -
 * ml.js는 `maxDepth`, sklearn은 `max_depth`라 어휘 자체가 다르다 (mlpx-spec.md 3).
 *
 * 브라우저 엔진은 번들에 있으므로 여기 하드코딩이고, 서버가 붙으면 헬스 응답이 준
 * 서술과 **합집합**을 본다 (open-decisions.md "무엇을 학습할 수 있는지는 서버가
 * 알려준다"). 그때 바뀌는 것은 이 표가 아니라 아래 함수 하나다.
 */
const PARAMETERS_BY_RUNTIME: Readonly<
  Record<string, Readonly<Record<string, readonly HyperparameterSpec[]>>>
> = {
  mljs: MLJS_PARAMETERS,
}

/**
 * 이 실행 방법이 이 알고리즘에 받는 손잡이들.
 *
 * **모르면 빈 배열이다.** 화면은 그때 손잡이를 안 그리고, 학습은 판정할 것이 없으므로
 * 통과시킨다 - 우리가 범위를 모르는 값을 우리 기준으로 거부하지 않는다.
 */
export function parametersFor(runtimeId: string, algorithm: string): readonly HyperparameterSpec[] {
  return PARAMETERS_BY_RUNTIME[runtimeId]?.[algorithm] ?? []
}

/** 값이 범위를 벗어났다. 화면은 칸 아래에, 학습은 실패한 run에 남긴다. */
export interface HyperparameterViolation {
  readonly name: string
  readonly min: number
  readonly max: number
  readonly actual: number
}

/**
 * 서술에서 기본값 표를 만든다. **엔진이 이걸로 DEFAULTS를 대신한다.**
 *
 * 표를 손으로 하나 더 적으면 범위와 기본값이 어긋난 채 살 수 있다 - 기본값이
 * 범위 밖인 알고리즘은 학생이 아무것도 안 건드려도 학습이 실패한다.
 */
export function defaultsOf(specs: readonly HyperparameterSpec[]): Record<string, number> {
  return Object.fromEntries(specs.map((spec) => [spec.name, spec.default]))
}

/**
 * 엔진이 실제로 먹을 값을 확정한다. **학습보다 앞이다** (mlpx-spec.md 3).
 *
 * 규칙 셋은 그대로다 - 학생이 준 값이 이기고, 못 쓰는 값은 기본값으로 돌아가며,
 * 모르는 키는 손대지 않고 통과시킨다(엔진이 받고 무시한 것까지가 "먹인 것"의 사실이다).
 *
 * **여기에 반올림이 하나 더 있다.** 정수 자리에 소수가 오면 반올림한다. 범위는
 * 안 본다 - 범위 밖은 시끄럽게 실패해야 하는 것이지 조용히 당겨 넣을 것이 아니다.
 *
 * **멱등이다** - `resolveWith(s, resolveWith(s, x))`가 `resolveWith(s, x)`와 같다.
 * fit이 안에서 한 번 더 부르기 때문에 이 성질이 계약이다 (ml/engines/index.ts).
 */
export function resolveWith(
  specs: readonly HyperparameterSpec[],
  given: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...defaultsOf(specs), ...given }
  for (const spec of specs) {
    const value = resolved[spec.name]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      resolved[spec.name] = spec.default
    } else if (spec.integer) {
      resolved[spec.name] = Math.round(value)
    }
  }
  return resolved
}

/**
 * 범위를 벗어난 값들. 비어 있으면 그대로 학습해도 된다.
 *
 * **확정된 값을 넘겨라.** 확정 전 값을 보면 학생이 비워 둔 칸이 위반으로 잡힌다.
 * 서술에 없는 키는 판정하지 않는다 - 우리가 범위를 모르는 값이다.
 */
export function outOfRange(
  specs: readonly HyperparameterSpec[],
  values: Record<string, unknown>,
): HyperparameterViolation[] {
  const violations: HyperparameterViolation[] = []
  for (const spec of specs) {
    const value = values[spec.name]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value < spec.min || value > spec.max) {
      violations.push({ name: spec.name, min: spec.min, max: spec.max, actual: value })
    }
  }
  return violations
}

/**
 * 범위 밖이면 던진다. **학습 직전에 부른다.**
 *
 * params.name은 **엔진이 받는 키 그대로**다. 우리 어휘가 아니라 값이므로 그대로 남기고
 * (CLAUDE.md 3의 예외 3), 학생이 고칠 자리에서는 화면이 번역된 이름으로 따로 말한다.
 */
export function assertInRange(
  specs: readonly HyperparameterSpec[],
  values: Record<string, unknown>,
): void {
  const first = outOfRange(specs, values)[0]
  if (first) throw new ClientError('HYPERPARAM_OUT_OF_RANGE', { ...first })
}
