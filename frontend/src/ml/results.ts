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

import type { Experiment, Run } from '../project/schema'
import { bestOf, metricsOf, type MetricDisplay } from './metrics'

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
