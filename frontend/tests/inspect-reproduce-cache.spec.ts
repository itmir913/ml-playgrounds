// @vitest-environment jsdom
// 판을 실제로 띄워서 실험을 갈아 끼우며 본다.
/**
 * **판정은 실험에 붙는다** (2026-09-18, 사용자).
 *
 * 대조 판은 실험을 바꿔도 **같은 컴포넌트가 그대로 산다.** 판정을 칸 하나에 두면 3번째
 * 실험의 점수가 2번째 실험의 자리에 그대로 서고, 교사는 **남의 실험의 점수를 이 실험의
 * 것으로 읽는다** — 이 화면이 가장 하면 안 되는 일이다.
 *
 * **그렇다고 지우지도 않는다.** 3번을 대조하고 2번을 들렀다 3번으로 돌아오면 그 판정이
 * 다시 서야 한다 — 서른 명을 훑는 교사에게 같은 계산을 두 번 시키지 않는다.
 *
 * **워커는 가짜다.** 여기서 보는 것은 계산이 아니라 **판정이 어느 실험에 붙는가**이고,
 * 진짜 학습은 `inspect-walk.spec.ts`가 바이트에서 판정까지 한 줄로 지난다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { MLJS_ENGINE } from '../src/ml/engines/mljs'
import { i18n, setLocale } from '../src/i18n'
import type { Experiment } from '../src/project/schema'

/** 가짜 학습이 돌려줄 실험. **검사가 누르기 전에 여기 올려 둔다.** */
const worker = vi.hoisted(() => ({ fresh: null as unknown }))

/**
 * 가짜 학습. **돌려주는 실험을 검사가 정한다** — 파일의 실험을 그대로 돌려주면 판정이
 * `결과가 재현됨`으로 서고, 여기서 보려는 것은 계산이 아니라 **그 판정이 어느 실험에
 * 붙는가**이므로 그것으로 충분하다.
 */
vi.mock('../src/ml/worker/client', () => ({
  train: () => ({ result: Promise.resolve({ experiment: worker.fresh }), cancel: () => {} }),
  calibrateDevice: () => Promise.resolve(null),
}))

vi.mock('../src/ml/worker/spawn', () => ({ spawnTrainingWorker: () => ({}) }))

const { experiment, run } = await import('./fixtures/project')
const ReproducePanel = (await import('../src/views/inspect/ReproducePanel.vue')).default
const { irisDataset } = await import('./fixtures/iris')

/**
 * 실험 하나. run 하나가 성공해 있으면 대조할 주장이 하나다.
 *
 * **엔진을 지금 것으로 적는다** — 파일을 만든 엔진이 이 브라우저에 없으면 판이 잠기고
 * (`ENGINE_MISSING`), 그러면 이 검사가 보려는 자리까지 못 간다.
 */
function claim(id: string): Experiment {
  return experiment(id, [run(`${id}-run-1`, { engine: MLJS_ENGINE })])
}

function mountPanel(one: Experiment) {
  return mount(ReproducePanel, {
    props: {
      experiment: one,
      order: 1,
      dataType: 'tabular' as const,
      dataset: irisDataset(),
      testDataset: null,
    },
    global: { plugins: [i18n] },
  })
}

/**
 * 판정 줄들. **없으면 빈 배열이고, 그것이 "이 실험은 아직 안 돌렸다"의 모양이다.**
 *
 * 잠긴 사유도 `li`로 서므로 **판정 줄만 고른다** — 그 줄에는 `판정` 배지가 있다.
 */
function verdicts(panel: ReturnType<typeof mountPanel>): string[] {
  const verdict = i18n.global.t('inspect.verdict')
  return panel
    .findAll('li')
    .map((one) => one.text().replace(/\s+/g, ' '))
    .filter((text) => text.includes(verdict))
}

describe('대조 판정은 실험을 따라간다', () => {
  beforeEach(() => {
    setLocale('ko')
    // **스토어가 있어야 판이 뜬다** — 대조 판이 알림 스토어를 쓴다(엔진 판이 갈렸을 때).
    setActivePinia(createPinia())
  })

  it('실험을 바꾸면 앞 실험의 판정이 그 자리에 안 남는다', async () => {
    const third = claim('experiment-3')
    const panel = mountPanel(third)
    worker.fresh = third
    await panel.find('button').trigger('click')
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(1)

    await panel.setProps({ experiment: claim('experiment-2') })
    await flushPromises()
    expect(verdicts(panel)).toEqual([])
    panel.unmount()
  })

  it('돌아오면 그 판정이 다시 선다 - 같은 계산을 두 번 시키지 않는다', async () => {
    const third = claim('experiment-3')
    const panel = mountPanel(third)
    worker.fresh = third
    await panel.find('button').trigger('click')
    await flushPromises()
    const before = verdicts(panel)
    expect(before).toHaveLength(1)

    await panel.setProps({ experiment: claim('experiment-2') })
    await flushPromises()
    expect(verdicts(panel)).toEqual([])

    await panel.setProps({ experiment: third })
    await flushPromises()
    expect(verdicts(panel)).toEqual(before)
    panel.unmount()
  })

  it('둘을 각각 돌리면 각자의 판정이 각자의 자리에 선다', async () => {
    const third = claim('experiment-3')
    const second = claim('experiment-2')
    const panel = mountPanel(third)
    worker.fresh = third
    await panel.find('button').trigger('click')
    await flushPromises()

    await panel.setProps({ experiment: second })
    await flushPromises()
    worker.fresh = second
    await panel.find('button').trigger('click')
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(1)

    await panel.setProps({ experiment: third })
    await flushPromises()
    expect(verdicts(panel)).toHaveLength(1)
    panel.unmount()
  })
})
