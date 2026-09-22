/**
 * 점검 화면을 **진짜 입구로** 띄운다.
 *
 * 명렬은 `<input type="file">`에서만 선다 — 컴포저블에 손을 넣어 항목을 앉히면 그 경로가
 * 검사에 안 지나가고, 이 저장소가 여러 번 밟은 자리가 그것이다
 * (`reachability-through-real-entry`).
 */

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'

import { i18n } from '../../src/i18n'
import InspectView from '../../src/views/InspectView.vue'
import { emptyProjectFile, experiment, projectFile, run } from './project'
import { writeProjectBytes } from './write'

/**
 * 진짜로 열리는 제출물 하나. 이름표는 명렬에 그대로 선다.
 *
 * **프로젝트 아이디를 갈아 끼울 수 있다** (§8.21). 안 주면 픽스처의 것을 그대로 쓰므로
 * **여러 개를 만들면 전부 한 프로젝트에서 나온 것**이 된다 — 교사가 시작 파일을 나눠 준
 * 그 상태이고, 거기서 명렬이 아무 표시도 안 하는 것이 맞다.
 */
export async function submissionFile(
  name: string,
  projectId?: string,
  student?: { studentId?: string; name?: string },
): Promise<File> {
  const base = emptyProjectFile()
  const manifest = {
    ...base.document.manifest,
    ...(projectId === undefined ? {} : { projectId }),
    ...(student === undefined ? {} : { student }),
  }
  const document =
    projectId === undefined && student === undefined
      ? base.document
      : { ...base.document, manifest }
  const { bytes } = await writeProjectBytes({ ...base, document }, '# 포트폴리오\n')
  return new File([bytes as BlobPart], name)
}

/**
 * 실험이 든 제출물. **대조 판과 실험 상세는 실험이 있어야 선다.**
 *
 * `count`를 주면 그만큼 쌓는다 — **여럿일 때 어느 것이 먼저 열리는가**가 실물 파일로
 * 재다 잡힌 자리다 (§8.21, 2026-09-18).
 */
export async function submissionWithExperiment(name: string, count = 1): Promise<File> {
  const base = projectFile()
  const experiments = Array.from({ length: count }, (_, index) =>
    index === 0
      ? base.document.runs.experiments[0]!
      : experiment(`experiment-${index + 1}`, [run(`run-${index + 1}`)]),
  )
  const { bytes } = await writeProjectBytes(
    { ...base, document: { ...base.document, runs: { experiments } } },
    '# 포트폴리오\n',
  )
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

/**
 * **jsdom에는 `scrollIntoView`가 없다.** 화면은 줄을 고를 때 그것을 부르므로(§8.21의
 * "누른 것이 보이는 자리로 데려간다"), 안 채워 두면 마운트 검사마다 처리 안 된 오류가
 * 쌓인다 — 검사는 통과하는데 관문이 빨개지는 그 모양이다.
 *
 * **화면 코드를 검사에 맞추지 않는다.** 없는 것은 브라우저가 아니라 jsdom이다.
 */
function fillScrollIntoView(): void {
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {}
  }
}

/**
 * 점검 화면을 띄우고 명렬을 세운다.
 *
 * **스토어가 없으면 세운다.** 화면이 알림 스토어를 쓰므로(하나도 못 받았을 때 말한다,
 * 결정문 48) 없으면 C:/Program Files/Git on / type ntfs (binary,noacl,auto)
C:/Program Files/Git/usr/bin on /bin type ntfs (binary,noacl,auto)
C:/Users/user/AppData/Local/Temp on /tmp type ntfs (binary,noacl,posix=0,usertemp)
C: on /c type ntfs (binary,noacl,posix=0,user,noumount,auto)
D: on /d type cryptofs (binary,noacl,posix=0,user,noumount,auto)가 setup에서 선다. **스스로 세우지 않은 것은 안 건드린다** —
 * 부르는 쪽이 이미 세워 둔 것을 덮으면 그 스펙이 심어 둔 상태가 사라진다.
 */
export async function mountInspect(files: File[]): Promise<VueWrapper> {
  if (getActivePinia() === undefined) setActivePinia(createPinia())
  fillScrollIntoView()
  const wrapper = mount(InspectView, { global: { plugins: [i18n] } })
  await pickFiles(wrapper, files)
  return wrapper
}
