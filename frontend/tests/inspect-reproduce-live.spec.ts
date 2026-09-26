// @vitest-environment jsdom
// 판을 띄우고 **도는 중에** 만진다 — 여기서 보는 것은 전부 끝나기 전의 상태다.
/**
 * **대조가 도는 동안** (2026-09-18 R28 A-1·B-2·B-5).
 *
 * 이웃 스펙(`inspect-reproduce-cache`)의 가짜 워커는 `Promise.resolve`라 **끼어들 틈이
 * 없다.** 그래서 도는 중에만 나는 결함 셋이 전부 초록이었다.
 *
 *   1. 판정이 **돌던 실험**이 아니라 지금 보고 있는 실험에 앉는가 (B-5)
 *   2. 진행 숫자가 `(0/N)`에 붙박여 있는가 — run 하나가 끝날 때마다 앉는가 (B-2)
 *   3. 떠날 때 워커가 끊기는가 (A-1)
 *
 * **여기 가짜 워커는 손잡이를 검사에 준다.** 언제 보고하고 언제 끝낼지를 검사가 정해야
 * "도는 중"이라는 상태가 생긴다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { ClientError } from '../src/errors'
import { MLJS_ENGINE } from '../src/ml/engines/mljs'
import { CALCULATION_RULE_CHANGES } from '../src/ml/reproduce'
import { useToastStore } from '../src/stores/toasts'
import { i18n, setLocale } from '../src/i18n'
import type { Experiment, Run } from '../src/project/schema'

/** run 하나가 끝났다는 보고. `ml/worker/client.ts`의 `onProgress`와 같은 모양이다. */
type Report = (run: Run, completed: number, total: number, index: number) => void

const worker = vi.hoisted(() => ({
  resolve: null as null | ((value: unknown) => void),
  reject: null as null | ((error: unknown) => void),
  report: null as null | Report,
  cancelled: 0,
  /** 뜬 대조의 수. */
  trains: 0,
}))

vi.mock('../src/ml/worker/client', () => ({
  train: (_request: unknown, options: { onProgress?: Report }) => {
    worker.trains += 1
    worker.report = options.onProgress ?? null
    return {
      result: new Promise((resolve, reject) => {
        worker.resolve = resolve
        worker.reject = reject
      }),
      // **끊긴 것만 센다.** 그 뒤에 무엇으로 끝나는지는 검사가 정한다 — 진짜 손잡이는
      // 도착한 run이 있으면 반쪽 실험으로 풀고, 없으면 `JOB_CANCELLED`로 던진다.
      cancel: () => {
        worker.cancelled += 1
      },
    }
  },
  calibrateDevice: () => Promise.resolve(null),
}))

vi.mock('../src/ml/worker/spawn', () => ({ spawnTrainingWorker: () => ({}) }))

const { experiment, run } = await import('./fixtures/project')
const ReproducePanel = (await import('../src/views/inspect/ReproducePanel.vue')).default
const { irisDataset } = await import('./fixtures/iris')

/**
 * 주장 하나. **엔진을 지금 것으로 적는다** — 파일을 만든 엔진이 없으면 판이 잠겨
 * (`ENGINE_MISSING`) 여기서 보려는 자리까지 못 간다.
 */
function claim(id: string, count = 1): Experiment {
  return experiment(
    id,
    Array.from({ length: count }, (_, index) =>
      run(`${id}-run-${index + 1}`, { engine: MLJS_ENGINE }),
    ),
  )
}

/** 배포판을 받아 오는 엔진으로 만든 실험. **그 문장이 참인 유일한 자리다** (R31 C-5). */
function pinned(id: string, version: string): Experiment {
  return experiment(id, [
    run(`${id}-run-1`, { engine: { kind: 'pyodide-sklearn', version } }),
  ]) as Experiment
}

/** 규칙이 마지막으로 바뀐 판. 이 판으로 만든 파일에는 바뀐 규칙이 하나도 안 걸린다. */
const LATEST_RULES = CALCULATION_RULE_CHANGES.at(-1)?.since ?? ''

function mountPanel(one: Experiment, appVersion = LATEST_RULES) {
  return mount(ReproducePanel, {
    props: {
      experiment: one,
      order: 1,
      dataType: 'tabular' as const,
      dataset: irisDataset(),
      testDataset: null,
      appVersion,
    },
    global: { plugins: [i18n] },
  })
}

type Panel = ReturnType<typeof mountPanel>

/** 판정 줄들. 잠긴 사유도 `li`로 서므로 `판정` 배지가 있는 줄만 고른다. */
function verdicts(panel: Panel): string[] {
  const verdict = i18n.global.t('inspect.verdict')
  return panel
    .findAll('li')
    .map((one) => one.text().replace(/\s+/g, ' '))
    .filter((text) => text.includes(verdict))
}

/** 그 글자가 적힌 단추. **교사가 누르는 것도 그 글자다.** */
function button(panel: Panel, label: string) {
  const found = panel.findAll('button').find((one) => one.text().trim() === label)
  expect(found, `button not found: ${label}`).toBeTruthy()
  return found!
}

const START = () => i18n.global.t('inspect.reproduceStart')
const STOP = () => i18n.global.t('train.stop')

describe('대조가 도는 동안', () => {
  beforeEach(() => {
    setLocale('ko')
    // **스토어가 있어야 판이 뜬다** — 대조 판이 알림 스토어를 쓴다(엔진 판이 갈렸을 때).
    setActivePinia(createPinia())
    worker.resolve = null
    worker.reject = null
    worker.report = null
    worker.cancelled = 0
    worker.trains = 0
  })

  /** 대조를 시작하고 **안 끝낸 채로** 둔다. */
  async function started(one: Experiment): Promise<Panel> {
    const panel = mountPanel(one)
    await button(panel, START()).trigger('click')
    await flushPromises()
    return panel
  }

  /**
   * **판정은 시작할 때 쥔 실험에 앉는다** (B-5). 도는 동안 교사가 다른 실험으로 옮기면
   * `props`는 그쪽을 가리키므로, 거기에 앉히면 **남의 실험의 점수**가 된다.
   */
  it('도는 중에 실험을 옮겨도 판정은 돌던 실험에 앉는다', async () => {
    const third = claim('experiment-3')
    // **주장이 다른 실험이다.** 3번의 결과를 2번의 주장과 견주면 `재현되지 않음`이 되므로,
    // 잘못 앉은 것과 제대로 앉은 것이 글자로 갈린다.
    const second = experiment('experiment-2', [
      run('experiment-2-run-1', { engine: MLJS_ENGINE, metrics: { accuracy: 0.5 } }),
    ])
    const panel = await started(third)
    expect(verdicts(panel)).toEqual([])

    await panel.setProps({ experiment: second })
    await flushPromises()
    worker.resolve?.({ experiment: third })
    await flushPromises()

    expect(verdicts(panel), 'experiment 2 must show nothing').toEqual([])

    await panel.setProps({ experiment: third })
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(1)
    expect(verdicts(panel)[0]).toContain(i18n.global.t('reproduction.REPRODUCED'))
    panel.unmount()
  })

  /**
   * **run 하나씩 오는 보고도 같은 규칙이다.** 통째로 오는 결과만 보면 이 자리가 비는데,
   * 실제로 위험한 쪽은 이쪽이다 — 보고는 **여러 번** 오므로 교사가 옮긴 뒤에도 계속 온다.
   */
  it('도는 중에 실험을 옮겨도 그 뒤에 온 run이 돌던 실험에 앉는다', async () => {
    const two = claim('experiment-3', 2)
    const panel = await started(two)
    worker.report?.(two.runs[0]!, 1, 2, 0)
    await flushPromises()

    await panel.setProps({ experiment: claim('experiment-2', 2) })
    await flushPromises()
    worker.report?.(two.runs[1]!, 2, 2, 1)
    await flushPromises()
    expect(verdicts(panel), 'experiment 2 must show nothing').toEqual([])

    await panel.setProps({ experiment: two })
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(2)
    panel.unmount()
  })

  it('진행 줄은 돌던 실험의 자리에서만 선다', async () => {
    const third = claim('experiment-3')
    const panel = await started(third)
    const line = i18n.global.t('inspect.reproducing', { done: 0, total: 1 })
    expect(panel.text()).toContain(line)

    await panel.setProps({ experiment: claim('experiment-2') })
    await flushPromises()
    expect(panel.text()).not.toContain(line)
    panel.unmount()
  })

  /**
   * **run 하나가 끝날 때마다 판정이 도착한다** (B-2). 통째로 기다렸다 한 번에 앉히면
   * 진행 숫자가 끝날 때까지 `(0/N)`이고, 판의 머리말은 그동안 반대로 적혀 있었다.
   */
  it('run 하나가 끝나면 그 판정이 먼저 서고 진행 숫자가 오른다', async () => {
    const two = claim('experiment-3', 2)
    const panel = await started(two)
    expect(panel.text()).toContain(i18n.global.t('inspect.reproducing', { done: 0, total: 2 }))

    worker.report?.(two.runs[0]!, 1, 2, 0)
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(1)
    expect(panel.text()).toContain(i18n.global.t('inspect.reproducing', { done: 1, total: 2 }))
    panel.unmount()
  })

  /**
   * **판정이 두 길로 오지만 두 번 서지는 않는다** (2026-09-18 R28-V). run마다 오는 보고와
   * 끝날 때 오는 완성품이 **둘 다 같은 자리에 앉는다** — 뒤엣것이 덮어쓰지 않고 덧붙이면
   * 판정이 두 배가 되고, 교사는 **넷짜리 실험에서 여덟 줄**을 본다.
   */
  it('run 보고를 받은 뒤에 끝나도 판정이 두 번 안 선다', async () => {
    const two = claim('experiment-3', 2)
    const panel = await started(two)
    worker.report?.(two.runs[0]!, 1, 2, 0)
    worker.report?.(two.runs[1]!, 2, 2, 1)
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(2)

    worker.resolve?.({ experiment: two })
    await flushPromises()
    expect(verdicts(panel), 'the finished experiment replaces, not appends').toHaveLength(2)
    panel.unmount()
  })

  /**
   * **파일이 말한 판으로 못 돌았으면 말한다** (2026-09-19, 결정문의 넷째 조항).
   *
   * 원본이 그 배포판을 더 안 서빙하면 지금 판으로 돌리는데, **그 사실을 안 말하면 교사가
   * 보는 차이가 학생의 것으로 읽힌다.** 여기서 재는 것은 *둘을 견주어 말하는가*이고,
   * 통로를 따로 안 만든 이유가 그것이다 — 파일의 run과 다시 돈 run이 각자 자기 엔진을
   * 적고 있다.
   */
  it('돈 판이 파일의 판과 다르면 알림이 뜬다', async () => {
    const toasts = useToastStore()
    const made = pinned('experiment-pinned', '300.1.2')
    const panel = await started(made)

    worker.resolve?.({ experiment: pinned('experiment-pinned', '314.0.7') })
    await flushPromises()

    expect(toasts.items.map((one) => one.key)).toEqual(['inspect.engineVersionFallback'])
    expect(toasts.items[0]?.params).toEqual({ stored: '300.1.2', used: '314.0.7' })
    panel.unmount()
  })

  /**
   * **순수 JS 줄에는 그 문장이 거짓이다** (2026-09-19 R31 C-5). 문구는 *"지금 배포판으로
   * 돌렸고, 그래서 판정하지 않고 숫자만 보입니다"*까지 말하는데, 순수 JS는 판이 갈리면
   * `compareRun`이 `unavailable()`을 내어 **숫자가 하나도 안 보인다.** 게다가 그 문장은
   * **scikit-learn을 이름으로 부른다** — mljs 줄에 뜨면 엔진 이름까지 틀린다.
   */
  it('순수 JS는 판이 갈려도 아무 말도 안 한다', async () => {
    const toasts = useToastStore()
    const made = claim('experiment-mljs')
    const panel = await started(made)

    worker.resolve?.({
      experiment: {
        ...made,
        runs: [{ ...made.runs[0]!, engine: { kind: MLJS_ENGINE.kind, version: '300.1.2' } }],
      },
    })
    await flushPromises()

    expect(toasts.items).toEqual([])
    panel.unmount()
  })

  it('같은 판으로 돌았으면 아무 말도 안 한다', async () => {
    const toasts = useToastStore()
    const made = claim('experiment-same')
    const panel = await started(made)

    worker.resolve?.({ experiment: made })
    await flushPromises()

    expect(toasts.items).toEqual([])
    panel.unmount()
  })

  /**
   * **실패한 주장에는 견줄 점수가 없다.** 학습 루프는 실패한 run에도 보고를 보내므로
   * (`ml/experiment.ts`), 여기서 거르지 않으면 **그 자리에 판정 줄이 하나 선다** —
   * 파일이 "실패했다"고 적어 둔 것을 화면이 대조 결과처럼 말하는 것이 된다.
   */
  it('파일이 실패라고 적은 run에는 판정 줄이 안 선다', async () => {
    const base = claim('experiment-3', 2)
    const failed: Experiment = {
      ...base,
      runs: [{ ...base.runs[0]!, status: 'failed', metrics: {} }, base.runs[1]!],
    }
    const panel = await started(failed)
    worker.report?.(failed.runs[0]!, 1, 2, 0)
    await flushPromises()
    expect(verdicts(panel), 'a failed claim has no score to compare').toEqual([])

    worker.report?.(failed.runs[1]!, 2, 2, 1)
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(1)
    panel.unmount()
  })

  /**
   * **멈추면 끝난 것이 남는다** (open-decisions.md "멈추기가 끝난 것을 남긴다").
   *
   * 멈추기는 도착한 run만으로 실험을 조립해 돌려주므로, 그것을 통째로 견주면 **안 돌린
   * run이 `엔진 없음`으로 선다** — 우리가 멈춘 일을 파일의 사정으로 말하는 것이 된다.
   */
  it('멈추면 그때까지 온 판정만 남고 안 돌린 run은 안 선다', async () => {
    const two = claim('experiment-3', 2)
    const panel = await started(two)
    worker.report?.(two.runs[0]!, 1, 2, 0)
    await flushPromises()

    await button(panel, STOP()).trigger('click')
    expect(worker.cancelled).toBe(1)
    // 진짜 손잡이가 하는 일: 도착한 run만으로 실험을 조립해 푼다.
    worker.resolve?.({ experiment: experiment('experiment-3', [two.runs[0]!]) })
    await flushPromises()

    expect(verdicts(panel)).toHaveLength(1)
    // **몇 중 몇에서 멈췄는지가 남는다** — 줄이 사라지면 `넷 중 셋`과 `셋 중 셋`이 같다.
    expect(panel.text()).toContain(i18n.global.t('inspect.reproduceStopped', { done: 1, total: 2 }))
    panel.unmount()
  })

  it('다른 실험으로 옮기면 멈춘 자국도 따라오지 않는다', async () => {
    const two = claim('experiment-3', 2)
    const panel = await started(two)
    worker.report?.(two.runs[0]!, 1, 2, 0)
    await flushPromises()
    await button(panel, STOP()).trigger('click')
    worker.resolve?.({ experiment: experiment('experiment-3', [two.runs[0]!]) })
    await flushPromises()

    await panel.setProps({ experiment: claim('experiment-2', 2) })
    await flushPromises()
    expect(panel.text()).not.toContain(
      i18n.global.t('inspect.reproduceStopped', { done: 1, total: 2 }),
    )
    panel.unmount()
  })

  /**
   * **끊은 것을 실패로 말하지 않는다** (`ui-rules.spec.ts`의 같은 규칙). 도착한 run이
   * 없으면 손잡이가 `JOB_CANCELLED`로 던지는데, 그것을 삼키지 않으면 판에 붉은 글씨로
   * **"학습을 멈췄습니다"**가 뜬다 — 교사가 스스로 누른 일이고 실패가 아니다.
   */
  it('아무것도 못 받고 멈춰도 실패 문구가 안 뜬다', async () => {
    const panel = await started(claim('experiment-3'))
    await button(panel, STOP()).trigger('click')
    worker.reject?.(new ClientError('JOB_CANCELLED'))
    await flushPromises()

    expect(panel.text()).not.toContain(i18n.global.t('errors.JOB_CANCELLED'))
    // 멈췄으니 자리는 다시 [대조 시작]이다.
    expect(button(panel, START()).exists()).toBe(true)
    panel.unmount()
  })

  /**
   * **실패 사유의 값까지 화면에 간다** (2026-09-21 델타 감사 B-2).
   *
   * 여기 오는 어휘 중에는 값을 끼워 넣는 것이 있다 — `FEATURE_NOT_NUMBER`는
   * *"({feature}: {value})"*로 끝난다. 판이 코드만 담고 파라미터를 버리면 그 문장이
   * **`(: )`로 끝나고**, 교사는 어느 열이 왜 문제인지 못 읽는다. 결정문
   * *"채점하는 행렬은 학습 전에 거절한다"*가 재실행 예외를 안 둔 근거가 바로
   * **"교사가 열 이름과 값을 읽는다"**이므로, 그 근거가 여기서 선다.
   */
  it('실패 사유에 끼워 넣는 값이 화면까지 간다', async () => {
    const panel = await started(claim('experiment-3'))
    worker.reject?.(new ClientError('FEATURE_NOT_NUMBER', { feature: '점수', value: '1,650' }))
    await flushPromises()

    const text = panel.text()
    expect(text).toContain('점수')
    expect(text).toContain('1,650')
    // **빈 괄호가 남으면 파라미터를 버린 것이다.**
    expect(text).not.toContain('(: )')
    panel.unmount()
  })

  /**
   * **떠나면 워커를 끊는다** (A-1). 안 끊으면 신경망 50,000행이 88초를 마저 돌고, 서른
   * 개를 넘기며 누르는 교사의 기기에 그만큼 쌓인다.
   */
  it('판이 사라지면 돌던 워커가 끊긴다', async () => {
    const panel = await started(claim('experiment-3'))
    expect(worker.cancelled).toBe(0)
    panel.unmount()
    expect(worker.cancelled).toBe(1)
  })

  /**
   * **다른 실험이 대조 중이면 단추가 이유를 말한다** (architecture.md §8.21, `reproduceBlockers`의
   * `COMPARING_OTHER`). 판 하나가 워커 하나를 쥐므로 둘째 대조는 안 뜬다 — 그 잠금이 이유
   * 목록 밖에 있으면 교사는 회색 단추만 본다.
   */
  it('다른 실험이 대조 중이면 잠그고 이유를 말하고, 둘째 대조를 안 띄운다', async () => {
    const third = claim('experiment-3')
    const panel = await started(third)
    expect(worker.trains).toBe(1)

    await panel.setProps({ experiment: claim('experiment-2') })
    await flushPromises()
    const start = button(panel, START())
    expect(start.attributes('disabled')).toBeDefined()
    expect(panel.text()).toContain(i18n.global.t('inspect.blocked.COMPARING_OTHER'))
    await start.trigger('click')
    await flushPromises()
    expect(worker.trains, 'a second check must not start').toBe(1)

    // 돌던 실험으로 돌아가면 [멈추기]가 있다. 이유는 그 실험 자신에게는 안 선다.
    await panel.setProps({ experiment: third })
    await flushPromises()
    button(panel, STOP())
    expect(panel.text()).not.toContain(i18n.global.t('inspect.blocked.COMPARING_OTHER'))

    worker.resolve?.({ experiment: third })
    await flushPromises()
    await panel.setProps({ experiment: claim('experiment-2') })
    await flushPromises()
    expect(button(panel, START()).attributes('disabled')).toBeUndefined()
    expect(panel.text()).not.toContain(i18n.global.t('inspect.blocked.COMPARING_OTHER'))
    panel.unmount()
  })

  /**
   * **옛 앱으로 만든 파일의 차이는 판정하지 않고 그 까닭을 말한다** (open-decisions.md 62,
   * `underRuleChanges`). 이 픽스처는 표준화를 켜고 학습했다 — 상수 열 척도 규칙이 걸린다.
   */
  describe('계산 규칙이 바뀐 뒤', () => {
    async function differing(appVersion: string): Promise<Panel> {
      const made = claim('experiment-old')
      const panel = mountPanel(made, appVersion)
      await button(panel, START()).trigger('click')
      await flushPromises()
      worker.report?.({ ...made.runs[0]!, metrics: { accuracy: 0.5 } }, 1, 1, 0)
      await flushPromises()
      return panel
    }

    it('그 파일의 앱 버전이 규칙보다 앞이면 판정하지 않고 사유와 버전을 보인다', async () => {
      const panel = await differing('0.27.0')
      const [line] = verdicts(panel)
      expect(line).toContain(i18n.global.t('reproduction.NOT_JUDGED'))
      expect(panel.text()).toContain(i18n.global.t('inspect.rulesChanged', { version: '0.27.0' }))
      panel.unmount()
    })

    it('규칙이 바뀐 뒤에 만든 파일은 그대로 재현되지 않았다고 말한다', async () => {
      const panel = await differing(LATEST_RULES)
      const [line] = verdicts(panel)
      expect(line).toContain(i18n.global.t('reproduction.NOT_REPRODUCED'))
      expect(panel.text()).not.toContain(
        i18n.global.t('inspect.rulesChanged', { version: LATEST_RULES }),
      )
      panel.unmount()
    })
  })
})
