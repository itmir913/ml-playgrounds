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
import { errorMessageKey } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import { MLPX_MIME, projectFileName } from '../src/project/format'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { projectFile } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

const downloads = vi.hoisted(() => [] as { blob: Blob; fileName: string }[])

vi.mock('../src/project/download', () => ({
  downloadBlob: (blob: Blob, fileName: string) => {
    downloads.push({ blob, fileName })
  },
  readFileBytes: async (file: File) => new Uint8Array(await file.arrayBuffer()),
}))

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

/** v-model이 달린 맨 `<input>`. **값만 넣으면 안 되고 이벤트를 던져야 한다.** */
function type(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(async () => {
  downloads.length = 0
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  await setLocale('ko')
})

afterEach(async () => {
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await resetDatabase()
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

  /**
   * **적어 둔 학번·이름은 칸에 미리 선다.** 안 채우면 빈 칸이 그대로 내보내져 지난 차시에
   * 적은 인적사항을 지운다 — 교사에게 가는 파일이 이름 없이 나간다.
   */
  it('keeps the saved identity when exported without typing', async () => {
    const project = useProjectStore()
    const base = projectFile()
    await project.save({
      ...base,
      document: {
        ...base.document,
        manifest: { ...base.document.manifest, student: { studentId: '10203', name: '홍길동' } },
      },
    })
    vi.spyOn(project, 'exportFile').mockResolvedValue([])

    const wrapper = mount(ExportButton, { global: { plugins: [i18n] }, attachTo: document.body })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()

    const panel = document.querySelector('.popover-panel')
    const inputs = [...(panel?.querySelectorAll('input') ?? [])] as HTMLInputElement[]
    expect(inputs.map((one) => one.value)).toEqual(['10203', '홍길동'])

    panel?.querySelector('button')?.dispatchEvent(new Event('click', { bubbles: true }))
    await settle()

    expect(project.file?.document.manifest.student).toEqual({ studentId: '10203', name: '홍길동' })
  })
})

/**
 * **내보내기 길의 말 둘** (R42 감사 C-4). 둘 다 지워도 관문이 초록이었다.
 *
 * - 담지 못한 모델이 **하나**여도 경고한다 — 5MB를 넘는 랜덤 포레스트는 실재하고, 그때 학생에게 남는 말이
 *   이 한 줄이다. 조용히 빠지면 학생은 예측이 왜 안 되는지 모른다.
 * - 머리글은 **지금 화면의 언어**로 그리고 그 언어를 `manifest.locale`에 적는다(mlpx-spec.md §2).
 */
describe('R42 C-4: what the export path says', () => {
  async function exportOnce(): Promise<void> {
    const wrapper = mount(ExportButton, { global: { plugins: [i18n] }, attachTo: document.body })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    document
      .querySelector('.popover-panel button')
      ?.dispatchEvent(new Event('click', { bubbles: true }))
    await settle()
    wrapper.unmount()
  }

  it('담지 못한 모델이 하나여도 경고한다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    vi.spyOn(project, 'exportFile').mockResolvedValue([
      { path: 'model/run-1.json', sizeBytes: 1, reason: 'tooLarge' },
    ])

    await exportOnce()

    const dropped = useToastStore().items.find((one) => one.key === 'project.exportDropped')
    expect(dropped?.tone).toBe('caution')
    expect(dropped?.params).toEqual({ count: 1 })
  })

  it('머리글의 언어는 지금 화면의 언어다', async () => {
    await setLocale('en')
    const project = useProjectStore()
    await project.save(projectFile())
    const taken = vi.spyOn(project, 'exportFile').mockResolvedValue([])

    await exportOnce()

    expect(taken).toHaveBeenCalledTimes(1)
    expect(project.file?.document.manifest.locale).toBe('en')
  })
})

/**
 * **저장이 멈춰도 파일이 나가고, 성공은 파일이 나간 순간 말한다** (2026-09-28 감사 A B-1).
 *
 * 전에는 버튼이 IndexedDB 저장을 기다린 뒤에야 파일을 만들어서, 저장이 끝나지 않으면 버튼이
 * 돌기만 하고 파일은 한 번도 안 나갔다. 여유 공간 묻기가 안 끝나는 것으로 멈춘 저장을
 * 흉내낸다 — `saveProject`의 첫 `await`다.
 */
describe('B-1: a save that never settles', () => {
  it('저장이 멈춰도 파일이 한 번 나가고 성공을 알린다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: () => new Promise<never>(() => {}) },
    })

    const wrapper = mount(ExportButton, { global: { plugins: [i18n] }, attachTo: document.body })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    document
      .querySelector('.popover-panel button')
      ?.dispatchEvent(new Event('click', { bubbles: true }))
    await settle()

    expect(downloads).toHaveLength(1)
    expect(useToastStore().items.map((one) => one.key)).toContain('project.exportDone')
    // 팝오버가 닫혔다 — 버튼이 도는 채로 남지 않는다.
    expect(document.querySelector('.popover-panel')).toBeNull()
    wrapper.unmount()
  })
})

/**
 * **파일을 담다 던지면 알리고 끝난다** (2026-09-29 감사 H A-3).
 *
 * `zipToBlob`이 끝났다는 표시를 `new Blob`보다 먼저 세우던 때는, Blob 생성이 던지면(메모리)
 * 그 예외가 삼켜져 약속이 영영 안 풀렸다 — 버튼이 돌기만 하고 알림도 파일도 없었다. Blob을
 * 가짜로 던지게 해서 **진짜 입구(버튼)부터** 알림까지 잇는다.
 */
describe('A-3: a Blob that throws while the file is assembled', () => {
  it('파일을 담다 던지면 알리고 끝난다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())

    const wrapper = mount(ExportButton, { global: { plugins: [i18n] }, attachTo: document.body })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()

    const RealBlob = globalThis.Blob
    // 내보내기가 담는 형식의 Blob만 던진다 — 다른 자리의 Blob은 그대로 둔다.
    globalThis.Blob = class extends RealBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        if (options?.type === MLPX_MIME) throw new RangeError('Array buffer allocation failed')
        super(parts, options)
      }
    } as typeof Blob
    try {
      const exportNow = document.querySelector('.popover-panel button')
      exportNow?.dispatchEvent(new Event('click', { bubbles: true }))
      await settle()

      expect(downloads).toHaveLength(0)
      expect(useToastStore().items.map((one) => one.key)).toEqual([
        errorMessageKey('UNEXPECTED_ERROR'),
      ])
      // 버튼이 도는 채로 남지 않는다 — 다시 누를 수 있다.
      expect(exportNow?.getAttribute('aria-busy')).toBe('false')
      expect(exportNow?.hasAttribute('disabled')).toBe(false)
    } finally {
      globalThis.Blob = RealBlob
    }
    wrapper.unmount()
  })
})
