// @vitest-environment jsdom
// 명렬의 칸은 화면이 조립하므로 띄워야 보인다.
/**
 * **점검 명렬의 실험 수는 결과 화면과 같은 단위로 센다** (2026-10-06, 코드 소유자).
 *
 * 그 칸이 `meta.countUnit`(그 밖의 개수)을 쓰고 있어서 ko는 `3개`, ja는 `3個`였다. 결과 화면은
 * 같은 수를 `results.experimentCount`로 센다 — ko `3번`, ja `3件`(`docs/copy.md` §7.1 조수사).
 * 옆 칸의 학습한 모델 수는 그 밖의 개수라 `meta.countUnit` 그대로다.
 */

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { i18n, setLocale, type Locale } from '../src/i18n'
import InspectView from '../src/views/InspectView.vue'
import { submissionWithExperiment } from './fixtures/inspect-screen'

/** jsdom에는 `scrollIntoView`가 없다 (`inspect-drop.spec.ts`와 같은 자리). */
function fillScrollIntoView(): void {
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
}

/** 끌어다 놓기 한 번. `dataTransfer`를 직접 심는 이유는 `inspect-drop.spec.ts`에 있다. */
async function dropFiles(wrapper: VueWrapper, files: File[]): Promise<void> {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files }, configurable: true })
  wrapper.find('div').element.dispatchEvent(event)
  for (let turn = 0; turn < 5; turn += 1) await flushPromises()
}

const EXPERIMENTS = 3

describe('점검 명렬의 실험 수', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fillScrollIntoView()
  })

  for (const locale of ['ko', 'ja'] as const satisfies readonly Locale[]) {
    it(`${locale}에서 결과 화면과 같은 단위로 센다`, async () => {
      await setLocale(locale)
      const wrapper = mount(InspectView, { global: { plugins: [i18n] } })

      await dropFiles(wrapper, [await submissionWithExperiment('가온.mlpx', EXPERIMENTS)])
      // **그 칸 하나를 본다.** 화면 전체 글자로 보면 실험 상세의 `3번째 실험`이 ko의 `3번`을
      // 대신 채워 준다 — 칸을 되돌려도 초록이었다.
      const headers = wrapper.findAll('thead th').map((cell) => cell.text())
      const column = headers.indexOf(i18n.global.t('inspect.experiments'))
      expect(column, 'the roster has an experiments column').toBeGreaterThanOrEqual(0)
      const cell = wrapper.findAll('tbody tr')[0]?.findAll('td')[column]
      // **문구를 여기에 다시 쓰지 않는다** — 로케일에서 읽어야 단위를 바꿨을 때 따라간다.
      expect(cell?.text()).toBe(i18n.global.t('results.experimentCount', EXPERIMENTS))
    })
  }
})
