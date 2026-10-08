// @vitest-environment jsdom
/**
 * **알림 수위선** (`router/index.ts`의 `toastWatermark`) — 이동이 끝나면 떠나는 화면의 알림을 걷되, 이동 중에 민 알림은
 * 남긴다. R43-2 감사가 순서를 강제해 셋을 잡았다: 겹친 이동이 잠긴 단계 알림을 걷는 것(C-1), 수위선 가드를 무는 검사가
 * 다른 이유로 울고 있던 것(C-2), 떠나는 화면의 알림 걷기를 아무 검사도 안 문 것(C-5).
 *
 * **진짜 입구로 잰다** — 실제 라우터를 태우고, 느린 청크는 그 화면 모듈의 `import()`가 손잡이를 기다리게 한다
 * (`route-chunk-race.spec.ts`와 같은 방식). 손잡이는 한 번만 쓰이므로 이 파일에 따로 둔다.
 */
import 'fake-indexeddb/auto'

import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useToastStore } from '../src/stores/toasts'
import { experiment, manifest, projectFile, run } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

const gates = vi.hoisted(() => {
  function gate(): { arrived: Promise<void>; open: () => void; requested: boolean } {
    let open: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      open = resolve
    })
    return { arrived, open: () => open(), requested: false }
  }
  return { inspect: gate(), predict: gate(), preprocess: gate() }
})

const blank = { default: { render: () => null } }

vi.mock('../src/views/InspectView.vue', async () => {
  gates.inspect.requested = true
  await gates.inspect.arrived
  return blank
})
vi.mock('../src/views/PredictView.vue', async () => {
  gates.predict.requested = true
  await gates.predict.arrived
  return blank
})
// 청크를 못 받는 화면 — 배포 뒤 옛 탭이나 끊긴 연결. 그 이동은 중단(ABORTED)으로 끝난다.
vi.mock('../src/views/PortfolioView.vue', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/Gone-1a2b3c.js')
})
vi.mock('../src/views/PreprocessView.vue', async () => {
  gates.preprocess.requested = true
  await gates.preprocess.arrived
  return blank
})
vi.mock('../src/views/ResultsView.vue', () => blank)
vi.mock('../src/views/DataView.vue', () => blank)

/** 모델이 예산에서 밀린 프로젝트 — 예측 단계가 잠겨, 주소로 가면 결과로 떨어지며 이유를 알린다(결정 65). */
async function lockedPredictProject(): Promise<void> {
  const base = projectFile()
  const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
  await saveProject({
    ...base,
    document: { ...base.document, runs: { experiments: [experiment('experiment-1', [omitted])] } },
  })
}

const cautions = (): string[] =>
  useToastStore()
    .items.filter((one) => one.tone === 'caution')
    .map((one) => one.key)

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  await router.replace('/')
  closeStorage()
  await resetDatabase()
})

describe('알림 수위선', { timeout: 20_000 }, () => {
  /**
   * **C-1 — 겹친 이동에서 잠긴 단계 알림이 남는다.** 앞 이동(점검)이 수위선을 잡고 청크를 기다리는 사이 뒤 이동(잠긴 예측)이
   * 시작하고, 앞 이동이 취소로 접히며 `afterEach`가 수위선을 지우면, 뒤 이동은 리다이렉트의 두 번째 통과에서 **자기가 민 알림을
   * 포함한** 수위선을 새로 잡고 끝에서 그것을 걷었다 — 화면은 결과인데 왜 옮겨졌는지 말이 없었다.
   */
  it('겹친 이동에서 잠긴 단계 알림이 남는다', async () => {
    await lockedPredictProject()

    const first = router.push('/inspect').catch(() => undefined)
    await vi.waitFor(() => expect(gates.inspect.requested).toBe(true))
    const second = router.push(`/project/${manifest.projectId}/predict`).catch(() => undefined)
    await vi.waitFor(() => expect(gates.predict.requested).toBe(true))

    gates.inspect.open()
    await first
    await flushPromises()
    gates.predict.open()
    await second
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('results')
    expect(cautions(), 'the overlapped move dropped the reason').toEqual(['steps.predict.locked'])
  })

  /**
   * **C-2 — 결과가 아닌 단계에서 잠긴 예측으로 가도 이유가 남는다.** 리다이렉트로 가드가 두 번 돌 때 수위선을 다시 잡으면
   * 첫 통과가 민 잠긴 단계 알림이 수위선 아래로 들어가 걷힌다(`router/index.ts`의 `if (toastWatermark === null)`). 결과 화면에서
   * 출발하면 리다이렉트 목적지가 같은 주소라 두 번째 통과가 없어 이것을 못 본다.
   */
  it('데이터 단계에서 잠긴 예측으로 가도 이유가 남는다', async () => {
    await lockedPredictProject()
    gates.predict.open()
    await router.push(`/project/${manifest.projectId}/data`)
    expect(cautions()).toEqual([])

    await router.push(`/project/${manifest.projectId}/predict`)
    expect(router.currentRoute.value.name).toBe('results')
    expect(cautions(), 'the second guard pass swallowed the reason').toEqual([
      'steps.predict.locked',
    ])
  })

  /**
   * **C-5 — 떠나는 화면의 오류 알림은 걷힌다.** 오류 알림은 스스로 안 사라지고, 자기 화면을 벗어나서까지 남아 다음 단계의 첫
   * 선택지를 덮었다(`router/index.ts`의 `afterEach` 머리말). 걷는 줄을 바꿔도 전에는 아무 검사도 안 울었다.
   */
  it('떠나는 화면의 오류 알림은 이동이 끝나면 걷힌다', async () => {
    await saveProject(projectFile())
    gates.predict.open()
    await router.push(`/project/${manifest.projectId}/data`)
    useToastStore().push('danger', 'client.DATASET_PARSE_FAILED')
    expect(useToastStore().items).toHaveLength(1)

    await router.push(`/project/${manifest.projectId}/predict`)
    expect(router.currentRoute.value.name).toBe('predict')
    expect(useToastStore().items).toEqual([])
  })

  /**
   * **중단된 이동 뒤에도 수위선이 낡지 않는다** (0.34.2 diff 감사 C-2). 취소된 이동만 수위선을 남겨 두는데, 거르기를 "모든 실패"로
   * 넓혀도 아무 검사도 안 울었다. 그러면 청크를 못 받아 중단된 이동이 남긴 수위선이 다음 이동까지 남아, 떠나는 화면의 실패 알림과
   * 오류를 걷지 못하고 새 화면에 남긴다.
   */
  it('청크를 못 받아 중단된 이동 뒤에도 떠나는 화면의 알림은 걷힌다', async () => {
    await saveProject(projectFile())
    gates.predict.open()
    await router.push(`/project/${manifest.projectId}/data`)

    await router.push(`/project/${manifest.projectId}/portfolio`)
    expect(router.currentRoute.value.name).toBe('data')
    expect(useToastStore().items.map((one) => one.key)).toHaveLength(1)
    useToastStore().push('danger', 'client.DATASET_PARSE_FAILED')

    await router.push(`/project/${manifest.projectId}/predict`)
    expect(router.currentRoute.value.name).toBe('predict')
    expect(useToastStore().items.map((one) => one.key)).toEqual([])
  })

  /**
   * **수위선은 청크를 받기 전에 잡는다** (0.35.2 경계 감사 A C-1). 받는 사이(학교 회선에서 몇 초)에 라우터 밖에서 뜬 알림 —
   * 자동 저장 실패가 진짜 입구다 — 은 방금 일어난 일이라 새 화면에서 읽혀야 한다. 포착을 받은 뒤로 옮겨도 전에는 아무 검사도
   * 안 울었다.
   */
  it('화면을 받는 사이에 뜬 알림은 이동이 끝나도 남는다', async () => {
    await saveProject(projectFile())
    gates.predict.open()
    await router.push(`/project/${manifest.projectId}/data`)

    const move = router.push(`/project/${manifest.projectId}/preprocess`)
    await vi.waitFor(() => expect(gates.preprocess.requested).toBe(true))
    useToastStore().push('danger', 'client.STORAGE_QUOTA_EXCEEDED')
    gates.preprocess.open()
    await move

    expect(router.currentRoute.value.name).toBe('preprocess')
    expect(useToastStore().items.map((one) => one.key)).toEqual(['client.STORAGE_QUOTA_EXCEEDED'])
  })
})
