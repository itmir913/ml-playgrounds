// @vitest-environment jsdom
/**
 * **리다이렉트의 둘째 통과가 화면을 못 받아도 첫 통과가 연 프로젝트가 목록 화면에 안 남는다** (0.35.3 최종 감사 C-2).
 *
 * 잠긴 단계로 가면 첫 통과가 프로젝트를 열고 허락된 단계로 돌린다(결정 65). 둘째 통과가 그 화면의 청크를 못 받아 중단되면
 * 학생은 출발한 화면에 그대로 있다 — 목록에서 출발했으면 목록인데 스토어는 프로젝트와 탭 잠금을 쥐고 있었다. 고침 라운드 A-1
 * (`route-duplicate-race.spec.ts`)이 닫은 중복 이동의 형제 길이다.
 *
 * **진짜 입구로 잰다** — 실제 라우터, 청크 실패는 그 화면 모듈을 들이는 `import()`가 던지게 한다(`route-chunk-failure.spec.ts`와 같다).
 */
import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { experiment, manifest, projectFile, run } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

/** 배포 뒤 옛 탭이 부르는 없는 청크. 화면을 꺼내는 순간 브라우저와 같은 문장으로 던진다. */
function missingChunk(): { readonly default: never } {
  return {
    get default(): never {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/gone.js')
    },
  }
}

const blank = { default: { render: () => null } }

vi.mock('../src/views/PredictView.vue', () => blank)
vi.mock('../src/views/DataView.vue', () => blank)
vi.mock('../src/views/ResultsView.vue', () => missingChunk())

/** 모델이 예산에서 밀린 프로젝트 — 예측 단계가 잠겨, 주소로 가면 결과로 리다이렉트한다(결정 65). */
async function lockedPredictProject(): Promise<void> {
  const base = projectFile()
  const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
  await saveProject({
    ...base,
    document: { ...base.document, runs: { experiments: [experiment('experiment-1', [omitted])] } },
  })
}

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

describe('리다이렉트의 둘째 통과가 화면을 못 받는다', { timeout: 20_000 }, () => {
  it('목록에서 출발했으면 프로젝트가 안 남는다', async () => {
    await lockedPredictProject()
    const project = useProjectStore()

    await router.push(`/project/${manifest.projectId}/predict`).catch(() => undefined)

    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(project.projectId, 'the list must not hold an open project').toBeNull()
  })

  it('프로젝트 안에서 출발했으면 그 프로젝트는 열린 채다', async () => {
    await lockedPredictProject()
    await router.push(`/project/${manifest.projectId}/data`)
    const project = useProjectStore()
    expect(project.projectId).toBe(manifest.projectId)

    await router.push(`/project/${manifest.projectId}/predict`).catch(() => undefined)

    expect(router.currentRoute.value.name).toBe('data')
    expect(project.projectId, 'the screen the student stays on keeps its project').toBe(
      manifest.projectId,
    )
  })
})
