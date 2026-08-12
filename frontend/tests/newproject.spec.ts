// @vitest-environment jsdom
// 라우터를 실제로 태우므로 history와 document가 필요하다.
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { newProjectDocument, newProjectSeed } from '../src/project/create'
import { DB_NAME, closeStorage, loadProject, saveProject } from '../src/project/storage'
import { ROUTE_PROJECT_HOME, ROUTE_PROJECTS, router } from '../src/router'
import { useProjectStore } from '../src/stores/project'

async function wipe(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  closeStorage()
  await wipe()
  await router.replace('/')
  await router.isReady()
})

describe('갓 만든 프로젝트를 연다', () => {
  it('저장하고 다시 읽을 수 있다', async () => {
    const document = newProjectDocument({ name: '새 프로젝트', locale: 'ko' }, newProjectSeed())
    await saveProject({ document, models: new Map(), images: new Map() })
    expect(await loadProject(document.manifest.projectId)).not.toBeNull()
  })

  it('데이터 단계로 이동하면 그 화면이 열린다', async () => {
    const document = newProjectDocument({ name: '새 프로젝트', locale: 'ko' }, newProjectSeed())
    await saveProject({ document, models: new Map(), images: new Map() })

    await router.push({ name: 'data', params: { projectId: document.manifest.projectId } })

    expect(router.currentRoute.value.name).toBe('data')
    expect(useProjectStore().projectId).toBe(document.manifest.projectId)
    expect(useProjectStore().facts.datasetReady).toBe(false)
  })

  it('프로젝트 주소를 열면 홈이 나온다 - 단계로 튕기지 않는다', async () => {
    // 학생이 파일을 열었을 때 보고 싶은 것은 "어디까지 했더라"이지 업로드 칸이 아니다.
    const document = newProjectDocument({ name: '새 프로젝트', locale: 'ko' }, newProjectSeed())
    await saveProject({ document, models: new Map(), images: new Map() })

    await router.push(`/project/${document.manifest.projectId}`)

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECT_HOME)
    expect(router.currentRoute.value.params.projectId).toBe(document.manifest.projectId)
  })

  it('목록으로 쫓겨나지 않는다', async () => {
    const document = newProjectDocument({ name: '새 프로젝트', locale: 'ko' }, newProjectSeed())
    await saveProject({ document, models: new Map(), images: new Map() })
    await router.push(`/project/${document.manifest.projectId}/data`)
    expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS)
  })
})
