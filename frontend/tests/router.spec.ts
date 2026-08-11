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
})
