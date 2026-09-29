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

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { IMAGE_DATA_DIR, type ProjectFile } from '../src/project/format'
import { dataSettings } from '../src/project/schema'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { emptyProjectFile, manifest, projectFile } from './fixtures/project'

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
