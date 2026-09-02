// @vitest-environment jsdom
/**
 * **종류를 모르는 동안 화면이 종류별 문구를 안 부른다** (`data/kinds.ts`).
 *
 * `stepTextKey(undefined, ...)`는 `steps.{단계}.{자리}`를 주는데 **그 열쇠는 일부러
 * 로케일에 없다** — 종류마다 갈리는 문장을 공통 자리에 두면 표의 말이 이미지 화면에
 * 뜨기 때문이다(`KIND_SPECIFIC_STEP_TEXT`). 그러니 화면이 그것을 부르는 순간 학생은
 * **`steps.preprocess.emptyReason`이라는 글자 자체를** 본다. 2026-08-29에 실제로 그랬다.
 *
 * `kinds.spec.ts`가 "그 열쇠가 로케일에 없다"까지는 잠갔지만, 그 파일은
 * **"못 보는 것: 화면에서 잠금이 빠지는 것 — 그건 사람이 본다"**고 스스로 적어 두었다
 * (2026-09-02 R22 C-6). 미룬 확인은 오지 않으므로 여기서 띄워서 잰다.
 *
 * **종류를 모르는 상태는 꾸미지 않아도 된다** — 프로젝트가 안 열렸으면 `dataType`이
 * 빈 문자열이라 등록부가 아무것도 안 돌려준다. 그게 진짜 그 상태다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { stepTextKey } from '../src/data/kinds'
import { KIND_SPECIFIC_STEP_TEXT } from '../src/router/steps'
import PredictView from '../src/views/PredictView.vue'
import PreprocessView from '../src/views/PreprocessView.vue'

/** 종류를 모를 때 나오는 막다른 열쇠들. **화면에 이 글자가 뜨면 안 된다.** */
const DEAD_KEYS = KIND_SPECIFIC_STEP_TEXT.map(({ step, slot }) =>
  stepTextKey(undefined, step, slot),
)

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('프로젝트가 안 열려 종류를 모를 때', () => {
  it('막다른 열쇠가 하나 이상 있다 - 없으면 아래 검사가 아무것도 안 지킨다', () => {
    expect(DEAD_KEYS.length).toBeGreaterThan(0)
    for (const key of DEAD_KEYS) expect(key).toMatch(/^steps\./)
  })

  for (const [name, view] of [
    ['예측 화면', PredictView],
    ['전처리 화면', PreprocessView],
  ] as const) {
    it(`${name}이 종류별 문구를 안 부른다`, async () => {
      const wrapper = mount(view, { global: { plugins: [i18n] } })
      await flushPromises()

      const text = wrapper.text()
      for (const key of DEAD_KEYS) {
        expect(text, `${name}: ${key} leaked to the screen`).not.toContain(key)
      }
      // **아무 열쇠도 안 샌다.** 위 목록 밖의 것이 새도 여기서 선다.
      expect(text).not.toMatch(/steps\.[a-z]+\.[a-zA-Z]+/)

      // 빈 화면이라도 학생에게 할 말은 있어야 한다 — 아무 말도 없으면 고장으로 읽는다.
      expect(text.trim().length).toBeGreaterThan(0)

      wrapper.unmount()
    })
  }
})
