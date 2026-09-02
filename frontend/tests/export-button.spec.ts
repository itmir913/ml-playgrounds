// @vitest-environment jsdom
/**
 * **내보내기 사슬의 마지막 두 줄.**
 *
 * **아무도 이 부품을 안 띄웠다** (2026-09-02 R24 B-3). 인적사항을 문서에 넣는 줄과
 * 마크다운을 넘기는 줄을 각각 뭉개도 관문이 초록이었고, `docs/rule-coverage.md`가
 * "내보내기 사슬의 최종 배선이 무도달 컴포넌트 안"이라고 적어 둔 자리가 여기다.
 *
 * **나가긴 하는데 누구 것인지와 무엇을 썼는지가 안 나간다** — 서른 명 제출물에서
 * 파일 이름이 전부 같고, 교사가 압축을 풀면 `portfolio/document.md`가 비어 있다.
 * 메모리 `export-must-not-fail`의 옆자리다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExportButton from '../src/components/ExportButton.vue'
import { i18n, setLocale } from '../src/i18n'
import { projectFileName } from '../src/project/format'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { projectFile } from './fixtures/project'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** v-model이 달린 맨 `<input>`. **값만 넣으면 안 되고 이벤트를 던져야 한다.** */
function type(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  await setLocale('ko')
})

afterEach(async () => {
  document.body.innerHTML = ''
  closeStorage()
  await deleteDatabase()
})

describe('R24 B-3: the last two lines of the export chain', () => {
  it('carries the identity into the document and the portfolio into the file', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    // 진짜 내려받기는 안 한다 — 재는 것은 **무엇이 넘어가는가**다.
    const taken = vi.spyOn(project, 'exportFile').mockResolvedValue([])

    const wrapper = mount(ExportButton, { global: { plugins: [i18n] }, attachTo: document.body })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()

    const panel = document.querySelector('.popover-panel')
    expect(panel).not.toBeNull()
    const inputs = panel?.querySelectorAll('input') ?? []
    expect(inputs).toHaveLength(2)
    type(inputs[0] as HTMLInputElement, '10203')
    type(inputs[1] as HTMLInputElement, '홍길동')
    await flushPromises()

    panel?.querySelector('button')?.dispatchEvent(new Event('click', { bubbles: true }))
    await settle()

    // 문서에 앉았는가 — 파일 이름이 여기서 나온다.
    const manifest = project.file?.document.manifest
    expect(manifest?.student).toEqual({ studentId: '10203', name: '홍길동' })
    expect(manifest && projectFileName(manifest)).toMatch(/^10203_홍길동_/)

    // 글이 파일에 담겼는가 — 교사가 압축을 풀어 읽는 것이 이 문자열이다.
    expect(taken).toHaveBeenCalledTimes(1)
    const markdown = taken.mock.calls[0]?.[0] ?? ''
    expect(markdown).toContain('꽃이 좋아서')

    expect(useToastStore().items.map((one) => one.key)).toContain('project.exportDone')
  })
})
