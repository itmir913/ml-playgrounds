/**
 * 점검 화면을 **진짜 입구로** 띄운다.
 *
 * 명렬은 `<input type="file">`에서만 선다 — 컴포저블에 손을 넣어 항목을 앉히면 그 경로가
 * 검사에 안 지나가고, 이 저장소가 여러 번 밟은 자리가 그것이다
 * (`reachability-through-real-entry`).
 */

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import { i18n } from '../../src/i18n'
import InspectView from '../../src/views/InspectView.vue'
import { emptyProjectFile, projectFile } from './project'
import { writeProjectBytes } from './write'

/** 진짜로 열리는 제출물 하나. 이름표는 명렬에 그대로 선다. */
export async function submissionFile(name: string): Promise<File> {
  const { bytes } = await writeProjectBytes(emptyProjectFile(), '# 포트폴리오\n')
  return new File([bytes as BlobPart], name)
}

/** 실험이 하나 든 제출물. **대조 판과 실험 상세는 실험이 있어야 선다.** */
export async function submissionWithExperiment(name: string): Promise<File> {
  const { bytes } = await writeProjectBytes(projectFile(), '# 포트폴리오\n')
  return new File([bytes as BlobPart], name)
}

/** 열리지 않는 제출물. **명렬에서 빠지지 않고 사유와 함께 남는다.** */
export function brokenFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3]) as BlobPart], name)
}

/**
 * 파일 고르기를 지나 명렬을 세운다. **같은 화면에 다시 부르면 명렬을 갈아 끼운다** —
 * 교사가 다른 반 폴더를 고르는 그 동작이다.
 */
export async function pickFiles(wrapper: VueWrapper, files: File[]): Promise<void> {
  const input = wrapper.find('input[type="file"]').element as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new Event('change'))
  await flushPromises()
}

/** 점검 화면을 띄우고 명렬을 세운다. */
export async function mountInspect(files: File[]): Promise<VueWrapper> {
  const wrapper = mount(InspectView, { global: { plugins: [i18n] } })
  await pickFiles(wrapper, files)
  return wrapper
}
