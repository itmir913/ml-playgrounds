// @vitest-environment jsdom
/**
 * **본체 없는 폴더 참조를 떼고 열면 학생에게 말한다** (open-decisions.md "본체 없는 폴더
 * 참조는 기대는 실험이 없을 때만 떼고 연다").
 *
 * 떼는 판정은 `storage.spec.ts`의 *"본체 없는 폴더 참조"* 묶음이 문다. 여기가 보는 것은
 * 스토어의 `open()`이 그 사실을 **알림으로 올리는가**다 — 말없이 떼면 학생은 올렸던 사진
 * 자리가 왜 비었는지 모른다.
 */

import 'fake-indexeddb/auto'

import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { IMAGE_DATA_DIR, type ProjectFile } from '../src/project/format'
import { dataSettings } from '../src/project/schema'
import {
  closeStorage,
  DB_NAME,
  loadProject,
  markExported,
  readExportedAt,
  readLocalVersion,
  saveProject,
} from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { emptyProjectFile, manifest, projectFile } from './fixtures/project'
import { refuseWrites } from './fixtures/storage-refusal'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 사진이 한 장도 없는데 훈련 폴더를 가리키는 이미지 프로젝트. 실험은 없다. */
function emptyFolderProject(): ProjectFile {
  const base = emptyProjectFile()
  return {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, dataType: 'image' },
      settings: {
        ...base.document.settings,
        data: {
          dataset: { path: IMAGE_DATA_DIR, canonicalSize: 224, format: 'webp', quality: 0.65 },
          categories: ['개'],
          backboneId: DEFAULT_BACKBONE_ID,
        },
      },
    },
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
})

afterEach(async () => {
  useProjectStore().close()
  closeStorage()
  await deleteDatabase()
})

describe('본체 없는 폴더 참조를 떼고 열면', () => {
  it('열리고, 참조가 빠지고, 알린다', async () => {
    await saveProject(emptyFolderProject())
    const project = useProjectStore()

    await expect(project.open(manifest.projectId)).resolves.toBe('opened')

    expect(dataSettings('image', project.file!.document.settings).dataset).toBeUndefined()
    expect(useToastStore().items).toEqual([
      expect.objectContaining({ tone: 'caution', key: 'project.emptyPhotoFolderRemoved' }),
    ])
  })

  it('뗄 것이 없으면 아무 말도 안 한다', async () => {
    await saveProject(projectFile())
    const project = useProjectStore()

    await expect(project.open(manifest.projectId)).resolves.toBe('opened')

    expect(useToastStore().items).toEqual([])
  })
})

/**
 * **뗐으면 열자마자 한 번 쓴다** (open-decisions.md "본체 없는 폴더 참조는 기대는 실험이 없을 때만
 * 떼고 연다"의 코드 소유자 후속). 여는 것만으로 안 쓰던 때는 학생이 아무것도 안 고치고 나가면
 * 다음에 열 때 또 떼고 또 알렸다.
 */
describe('뗀 문서는 열자마자 쓴다', () => {
  /** 저장소의 레코드가 아직 빈 폴더 참조를 들고 있는가. 읽는 쪽이 떼면(`onDetached`) 들고 있다. */
  async function storedStillEmptyFolder(): Promise<boolean> {
    let detached = false
    await loadProject(manifest.projectId, () => {
      detached = true
    })
    return detached
  }

  it('한 번 쓰고, 다시 열면 떼지도 알리지도 않는다', async () => {
    await saveProject(emptyFolderProject())
    const project = useProjectStore()
    await expect(project.open(manifest.projectId)).resolves.toBe('opened')
    await project.flush()

    await vi.waitFor(async () => expect(await storedStillEmptyFolder()).toBe(false))

    project.close()
    useToastStore().items.splice(0)
    await expect(project.open(manifest.projectId)).resolves.toBe('opened')
    expect(useToastStore().items, 'the second open must be quiet').toEqual([])
  })

  it('쓴 레코드는 "파일로 안 나간 편집"이다 — 문서의 시각은 그대로다', async () => {
    // 가져온 판으로 앉힌다(`imported`) — 표지가 거짓에서 출발한다.
    await saveProject(emptyFolderProject(), { imported: true })
    const before = await readLocalVersion(manifest.projectId)
    expect(before?.unexportedEdits).toBe(false)

    const project = useProjectStore()
    await project.open(manifest.projectId)
    await project.flush()

    await vi.waitFor(async () =>
      expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(true),
    )
    expect((await readLocalVersion(manifest.projectId))?.updatedAt).toBe(before?.updatedAt)
    expect(project.dirty).toBe(false)
  })

  it('쓰기가 거절되면 열기는 그대로이고, 떠나기를 막지 않고, 다음에 다시 뗀다', async () => {
    await saveProject(emptyFolderProject())
    const refusal = refuseWrites()
    try {
      const project = useProjectStore()
      await expect(project.open(manifest.projectId)).resolves.toBe('opened')
      await project.flush()
      await flushPromises()

      // 알림은 뗐다는 말 하나뿐이다 — 거절을 따로 띄우지 않는다.
      expect(useToastStore().items).toEqual([
        expect.objectContaining({ tone: 'caution', key: 'project.emptyPhotoFolderRemoved' }),
      ])
      // 이 판은 학생의 편집이 아니다 — 저장 실패 표지를 세워 떠나기를 멈추면 안 된다(결정 74).
      expect(project.saveFailed).toBe(false)
      expect(project.stranded).toBe(false)
      expect(project.dirty).toBe(false)
    } finally {
      refusal.restore()
    }

    useProjectStore().close()
    useToastStore().items.splice(0)
    await expect(useProjectStore().open(manifest.projectId)).resolves.toBe('opened')
    expect(useToastStore().items).toEqual([
      expect.objectContaining({ tone: 'caution', key: 'project.emptyPhotoFolderRemoved' }),
    ])
  })

  it('뗀 적 없는 열기는 한 글자도 쓰지 않는다 — 시각과 표지가 그대로다', async () => {
    await saveProject(projectFile(), { imported: true })
    await markExported(manifest.projectId, '2026-01-02T00:00:00.000Z', manifest.updatedAt)
    const before = {
      version: await readLocalVersion(manifest.projectId),
      exportedAt: await readExportedAt(manifest.projectId),
    }
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      const project = useProjectStore()
      await expect(project.open(manifest.projectId)).resolves.toBe('opened')
      await project.flush()
      await flushPromises()
      expect(put, 'a plain open must not write').not.toHaveBeenCalled()
    } finally {
      put.mockRestore()
    }
    expect({
      version: await readLocalVersion(manifest.projectId),
      exportedAt: await readExportedAt(manifest.projectId),
    }).toEqual(before)
  })

  it('쓰기 차례가 오기 전에 학생이 고치면 그 편집이 쓰인다', async () => {
    await saveProject(emptyFolderProject())
    const project = useProjectStore()
    await project.open(manifest.projectId)
    project.update((live) => ({
      ...live,
      document: { ...live.document, manifest: { ...live.document.manifest, name: '고친 이름' } },
    }))
    await project.flush()

    const stored = await loadProject(manifest.projectId)
    expect(stored?.document.manifest.name).toBe('고친 이름')
    expect(await storedStillEmptyFolder()).toBe(false)
  })
})
