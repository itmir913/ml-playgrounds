// @vitest-environment jsdom
// 라우터를 실제로 태우므로 history와 document가 필요하다.
/**
 * 라우터 가드가 실제로 물려 돌아가는지.
 *
 * 판단 자체는 steps.spec.ts가 순수 함수로 덮는다. 여기서 보는 것은 **배선**이다 —
 * 가드가 스토어를 부를 수 있는가, 없는 프로젝트를 걸러내는가, 잠긴 단계를 요청하면
 * 실제로 다른 주소로 떨어지는가. 이 셋은 화면을 띄우지 않으면 확인할 수 없고,
 * 셋 다 틀리면 앱이 시작조차 못 한다.
 */

import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ROUTE_PROJECT_HOME, ROUTE_PROJECTS, router } from '../src/router'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { experiment, emptyProjectFile, manifest, projectFile, run } from './fixtures/project'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  // jsdom에는 scrollTo가 없어서 이동할 때마다 "Not implemented"를 찍는다.
  // 진짜 실패가 그 안에 묻힌다.
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

/**
 * **기본 타임아웃(5초)으로는 모자란다.** 이 검사들은 라우터를 실제로 태우므로 그때마다
 * 화면 청크를 **동적으로 import**한다 — 혼자 돌리면 1.4초인 줄이 전체 검사와 함께 돌면
 * 그 수 배가 된다(2026-08-11에 세 번 흔들렸다). 느려진 것이 아니라 **재는 자리가 원래
 * 그런 자리**라, 시간을 늘려 두고 진짜 멈춤은 20초가 잡게 한다.
 */
describe('라우터', { timeout: 20_000 }, () => {
  it('해시 모드다 - Pages에서 새로고침이 404가 되면 안 된다', async () => {
    await router.push({ name: ROUTE_PROJECTS })
    expect(window.location.hash).toBe('#/')
  })

  it('없는 주소는 목록으로 보낸다', async () => {
    await router.push('/그런거없음')
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
  })

  it('저장되지 않은 프로젝트를 열면 목록으로 돌아간다', async () => {
    await router.push('/project/does-not-exist/train')
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
  })

  it('프로젝트 주소를 열면 홈이 나온다', async () => {
    // 단계로 튕기지 않는다. 파일을 연 학생이 보고 싶은 것은 "어디까지 했더라"다.
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}`)
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECT_HOME)
  })

  it('표를 아직 안 올린 프로젝트는 어디를 눌러도 데이터로 온다', async () => {
    await saveProject(emptyProjectFile())
    await router.push(`/project/${manifest.projectId}/train`)
    expect(router.currentRoute.value.name).toBe('data')
  })

  it('갖춰진 프로젝트는 요청한 단계로 그대로 간다', async () => {
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}/predict`)
    expect(router.currentRoute.value.name).toBe('predict')
  })

  it('잠긴 단계를 요청하면 갈 수 있는 곳으로 떨어진다', async () => {
    // 학습은 했지만 모델이 예산에서 밀린 프로젝트. 결과는 볼 수 있고 예측은 못 한다.
    const base = projectFile()
    const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
    await saveProject({
      ...base,
      document: {
        ...base.document,
        runs: { experiments: [experiment('experiment-1', [omitted])] },
      },
    })

    await router.push(`/project/${manifest.projectId}/predict`)
    expect(router.currentRoute.value.name).toBe('results')
  })

  it('목록으로 나가면 열어 둔 프로젝트를 놓아준다', async () => {
    // 안 놓아주면 도구 막대에 남의 이름이 계속 보이고 데이터셋 바이트가 붙들려 있다.
    // **화면이 아니라 라우터가 한다** - 화면 생명주기에 맡기면 순서가 어긋난다.
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}/data`)

    const project = useProjectStore()
    expect(project.projectId).toBe(manifest.projectId)

    await router.push({ name: ROUTE_PROJECTS })

    expect(project.projectId).toBeNull()
    expect(project.file).toBeNull()
  })

  it('같은 프로젝트 안에서 단계를 옮길 때 다시 읽지 않는다', async () => {
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}/data`)

    const project = useProjectStore()
    const opened = project.file
    await router.push(`/project/${manifest.projectId}/results`)

    // 같은 객체여야 한다. 단계를 옮길 때마다 IndexedDB를 다시 읽으면
    // 50MB 데이터셋을 든 프로젝트에서 탭 하나 누를 때마다 화면이 멈춘다.
    expect(project.file).toBe(opened)
  })

  /**
   * 가드는 이동하기 전에 미뤄 둔 저장을 끝낸다. **그것이 실패했을 때가 문제였다** -
   * 던지면 vue-router가 이동을 취소하는데 router.onError도 전역 errorHandler도 없어서
   * 학생은 [다음]을 눌렀는데 화면이 안 바뀌는 것만 봤다. storage.ts 머리말이 "저장
   * 실패는 삼키지 않는다"고 적은 자리다.
   */
  it('저장이 실패해도 화면이 알고, 갇히지 않는다', async () => {
    await saveProject(projectFile())
    await router.push(`/project/${manifest.projectId}/data`)

    const project = useProjectStore()
    const toasts = useToastStore()
    const current = project.file
    expect(current).not.toBeNull()
    project.update({
      ...current!,
      document: {
        ...current!.document,
        manifest: { ...current!.document.manifest, name: '고친 이름' },
      },
    })

    // 이 시점부터 저장이 실패한다. 자동 저장 타이머는 아직 안 돌았고 dirty는 켜져 있다.
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: () => Promise.resolve({ quota: 1, usage: 1 }) },
    })

    await router.push(`/project/${manifest.projectId}/results`)

    // 이동은 됐고 - 못 나가게 붙들면 저장이 안 되는 학생이 갇힌다 -
    expect(router.currentRoute.value.name).toBe('results')
    // 학생은 왜 안 됐는지 듣는다.
    const shown = toasts.items.at(-1)
    expect(shown?.tone).toBe('danger')
    expect(shown?.key).toContain('STORAGE_QUOTA_EXCEEDED')
    // 그리고 값은 아직 메모리에 있다. 다음 저장이 다시 시도한다.
    expect(project.dirty).toBe(true)
  })

  /**
   * **저장 실패와 리다이렉트를 겹친 갈래가 없었다** (R14-5 감사 A-7).
   *
   * 위 검사는 리다이렉트가 없는 이동이고, `잠긴 단계를 요청하면…`은 저장이 성공하는
   * 이동이다. 둘을 겹치면 수위선이 두 번 잡히는지가 걸리는데 아무도 안 태웠다 —
   * 그래서 `if (toastWatermark === null)` 가드를 지워도 조용했다.
   *
   * 그때 학생이 겪는 일: [다음]을 눌렀고 화면은 다른 단계로 갔는데, **저장이
   * 실패했다는 말을 한 번도 못 본다.** `afterEach`의 `dismissUpTo`가 방금 민 알림을
   * 걷어 가기 때문이다. `storage.ts` 머리말의 *"저장 실패는 삼키지 않는다"*가
   * 리다이렉트 갈래에서만 조용히 깨진다.
   */
  it('리다이렉트로 떨어져도 저장 실패 알림이 남는다', async () => {
    // 모델이 예산에서 밀린 프로젝트 - 예측을 요청하면 결과로 떨어진다.
    const base = projectFile()
    const omitted = run('run-1', { model: undefined, modelOmitted: 'overBudget' })
    await saveProject({
      ...base,
      document: {
        ...base.document,
        runs: { experiments: [experiment('experiment-1', [omitted])] },
      },
    })
    await router.push(`/project/${manifest.projectId}/data`)

    const project = useProjectStore()
    const toasts = useToastStore()
    const current = project.file!
    project.update({
      ...current,
      document: {
        ...current.document,
        manifest: { ...current.document.manifest, name: '고친 이름' },
      },
    })

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: () => Promise.resolve({ quota: 1, usage: 1 }) },
    })

    await router.push(`/project/${manifest.projectId}/predict`)

    expect(router.currentRoute.value.name, 'a locked step falls through to the results').toBe(
      'results',
    )
    expect(toasts.items.map((one) => one.key)).toContain('client.STORAGE_QUOTA_EXCEEDED')
  })
})
