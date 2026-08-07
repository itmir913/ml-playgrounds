/**
 * 결과 화면이 실험에서 읽어내는 것들 (architecture.md 8.13).
 *
 * **화면 밖에 두는 이유는 전부 테스트할 수 있어서다.** 어느 줄을 굵게 할지, 목록에
 * 무슨 숫자를 보일지는 눈으로 확인하기 어려운 판단이고 조용히 틀리기 쉽다 - 최고값을
 * 거꾸로 고르면 화면은 멀쩡해 보이고 숫자만 틀린다.
 *
 * **과제 유형은 실험에서 읽는다.** manifest의 현재 값이 아니다 - 학생이 유형을 바꾸면
 * 옛 실험의 지표가 새 유형의 표에 들어가 accuracy 칸에 r2가 뜬다 (schema.ts의 같은 경고).
 */

import { RUNTIMES } from './backend'
import type { Experiment, PerClass, Run } from '../project/schema'
import { parametersFor } from './hyperparams'
import { bestOf, metricsOf, type MetricDisplay } from './metrics'

/** 값 종류별 점수표에서 강조할 세 지표. */
const PER_CLASS_METRICS = ['precision', 'recall', 'f1'] as const

type PerClassMetric = (typeof PER_CLASS_METRICS)[number]

/** 목록 한 줄에 보일 숫자 하나. */
export interface Headline {
  readonly display: MetricDisplay
  readonly value: number
}

/** 점수가 나온 run들. 실패한 것은 지표가 없다 (schema.ts가 강제한다). */
export function doneRuns(experiment: Experiment): readonly Run[] {
  return experiment.runs.filter((run) => run.status === 'done')
}

export function failedRuns(experiment: Experiment): readonly Run[] {
  return experiment.runs.filter((run) => run.status === 'failed')
}

/**
 * "학습한 곳" 문구가 가리킬 로케일 키.
 *
 * **`execution.*`(브라우저/서버)만으로는 부족하다.** 브라우저 안에도 순수 JS와
 * scikit-learn(Pyodide) 둘이 있고(`ml/backend.ts`의 `RUNTIMES`), 둘 다 "내 컴퓨터에서
 * 학습"으로 뭉치면 학생이 지금 무엇으로 돌았는지 알 수 없다. `run.engine.kind`가 그
 * 실행 방법을 가리키므로 등록부에서 되짚어 `runtimes.*`(이미 있는, 더 구체적인 문구)를
 * 쓴다. `engineKind`가 등록부의 `id`와 항상 같지는 않다 - server-sklearn만 다르다
 * (`ml/backend.ts`의 `RUNTIMES` 참고).
 *
 * engine이 없는 run(옛 포맷 등 읽기 호환)은 위치만이라도 보여준다.
 */
export function whereTrainedKeyOf(run: Run): string {
  const engineKind = run.engine?.kind
  const runtime =
    engineKind !== undefined ? RUNTIMES.find((r) => r.engineKind === engineKind) : undefined
  return runtime ? `runtimes.${runtime.id}` : `execution.${run.computedBy}`
}

/** run 하나에 먹인 손잡이 하나. 화면은 이걸 줄 하나로 그린다. */
export interface HyperparameterDisplay {
  /** 엔진이 받는 키 그대로. 등록부가 모르는 값일 때 화면이 이걸 그대로 보인다. */
  readonly name: string
  /**
   * 이름의 로케일 키. **등록부에 없으면 null이다** - `describeChanges`가 모르는 경로를
   * 버리지 않는 것과 같은 판단이다(architecture.md §8.13). 서버 엔진이나 남의 파일에서
   * 우리가 모르는 키가 올 수 있고, 그때 값을 감추면 화면이 파일보다 적게 말한다.
   */
  readonly labelKey: string | null
  /**
   * 값의 표시 문자열.
   *
   * **Intl로 다듬지 않는다** - 이 자리의 값은 지표(0~1)가 아니라 **학생이 설정 화면에서
   * 친 그 숫자**이고, `ChangeList`가 같은 값을 이미 그대로 보이고 있다(`ml/changes.ts`의
   * `literal`). 한쪽만 자릿수를 넣으면 같은 화면에서 `10000`과 `10,000`이 나란히 선다.
   */
  readonly text: string
}

/**
 * 이 run에 **실제로 먹인** 하이퍼파라미터들 (architecture.md §8.13).
 *
 * **`run.hyperparameters`가 유일한 출처다.** `settings.hyperparameters`는 학생이 화면에서
 * 고른 값이라, 실행 방법이 자동으로 넘어갔으면 실제로 먹인 것과 다르다
 * (`ml/experiment.ts`의 "실행 방법이 정해진 뒤에 하이퍼파라미터를 읽는다"). run에 박힌
 * 값은 학습 직전에 기본값까지 채워 확정한 것이다 (mlpx-spec.md §3).
 *
 * **순서와 이름은 손잡이 등록부에서 온다.** 실행 방법은 `run.engine.kind`로 되짚는다 -
 * `whereTrainedKeyOf`와 같은 길이고, 어휘가 실행 방법마다 다르기 때문이다(ml.js `maxDepth`,
 * sklearn `max_depth`). **등록부에 없는 키는 뒤에 붙인다** - 순서를 잃을 뿐 값은 안 잃는다.
 */
export function hyperparametersOf(run: Run): HyperparameterDisplay[] {
  const engineKind = run.engine?.kind
  const runtime =
    engineKind !== undefined ? RUNTIMES.find((one) => one.engineKind === engineKind) : undefined
  const specs = runtime ? parametersFor(runtime.id, run.algorithm) : []

  const values = run.hyperparameters
  const known = specs
    .filter((spec) => values[spec.name] !== undefined)
    .map((spec) => ({
      name: spec.name,
      labelKey: `hyperparams.${spec.name}`,
      text: String(values[spec.name]),
    }))

  const seen = new Set(known.map((entry) => entry.name))
  const rest = Object.keys(values)
    .filter((name) => !seen.has(name))
    .map((name) => ({ name, labelKey: null, text: String(values[name]) }))

  return [...known, ...rest]
}

/**
 * 이 실험의 대표 점수 하나.
 *
 * **첫 지표의 최고값이다.** 등록부의 첫 줄이 그 과제 유형에서 가장 먼저 보는 지표이고
 * (분류는 정확도, 회귀는 결정계수), 목록은 훑는 자리라 숫자가 하나여야 한다. 여기에
 * 지표를 여럿 늘어놓으면 그 순간 순위표가 된다.
 *
 * 점수가 하나도 없으면 null이다 - 모델이 전부 실패한 실험이고, 그때 목록에 0을 보이면
 * **정확도 0%로 학습된 것처럼 읽힌다.**
 */
export function headlineOf(experiment: Experiment): Headline | null {
  const display = metricsOf(experiment.settings.taskType)[0]
  if (!display) return null

  const values = doneRuns(experiment)
    .map((run) => run.metrics?.[display.name])
    .filter((value): value is number => typeof value === 'number')

  const value = bestOf(values, display.better)
  return value === undefined ? null : { display, value }
}

/**
 * 값 종류별 점수표에서 지표마다 가장 약한 클래스. 강조할 칸을 여기서 정한다.
 *
 * **최고값이 아니라 최저값이다.** 결과 표(`bestByMetric`)는 모델끼리 겨루니 "이겼다"가
 * 의미가 있지만, 여기는 한 모델 안에서 클래스끼리 견주는 자리라 "이겼다"는 정보가 아니다.
 * 학생에게 필요한 것은 **이 모델이 어느 값 종류를 가장 못 맞히는가**이고, 그게 혼동
 * 행렬을 다시 보게 만드는 다리다 — recall이 낮은 줄은 혼동 행렬의 그 행에서 어디로
 * 새는지 보면 이유가 보인다. `support`(개수)는 성능 지표가 아니라 강조하지 않는다.
 *
 * **클래스가 하나뿐이면 아무것도 강조하지 않는다** (`bestByMetric`과 같은 이유 —
 * 견줄 것이 없는데 하나를 짚으면 비교가 아니라 장식이다).
 */
export function weakestPerClass(perClass: readonly PerClass[]): ReadonlySet<string> {
  const weakest = new Set<string>()
  if (perClass.length < 2) return weakest

  for (const metric of PER_CLASS_METRICS) {
    const loser = perClass.reduce((min, entry) => (entry[metric] < min[metric] ? entry : min))
    weakest.add(`${loser.label}:${metric}`)
  }
  return weakest
}

/** `weakestPerClass`가 낸 집합에서 이 칸을 강조할지 읽는다. */
export function isWeakestPerClass(
  weakest: ReadonlySet<string>,
  label: string,
  metric: PerClassMetric,
): boolean {
  return weakest.has(`${label}:${metric}`)
}

/**
 * 지표마다의 최고값. 표에서 굵게 할 칸을 여기서 정한다.
 *
 * **모델이 하나뿐이면 아무것도 굵어지지 않는다.** 견줄 것이 없는데 하나를 최고라고
 * 표시하면 비교가 아니라 장식이고, 학생은 그 굵음을 "좋은 점수"로 읽는다.
 */
export function bestByMetric(
  runs: readonly Run[],
  displays: readonly MetricDisplay[],
): ReadonlyMap<string, number> {
  const best = new Map<string, number>()
  if (runs.length < 2) return best

  for (const display of displays) {
    const values = runs
      .map((run) => run.metrics?.[display.name])
      .filter((value): value is number => typeof value === 'number')
    const winner = bestOf(values, display.better)
    if (winner !== undefined) best.set(display.name, winner)
  }
  return best
}
