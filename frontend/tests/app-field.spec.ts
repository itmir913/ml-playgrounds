// @vitest-environment jsdom
/**
 * `AppField`가 슬롯으로 건넨 값이 **그냥 `<input>`에 붙었을 때 제 이름으로 서는가.**
 *
 * 이름을 하나씩 적어 건네던 때는 컴파일러가 `ariaDescribedby`로 바꿔 넘겨, 받은 칸에
 * `ariadescribedby`라는 뜻 없는 속성이 섰다 — 도움말이 칸과 안 이어졌는데 눈으로는 멀쩡했다.
 * 기본 부품(`AppInput`)은 건넬 때 이름을 되돌리지만, 그냥 `<input v-bind="field">`로 받는
 * 자리가 일곱이다.
 */
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, it } from 'vitest'

import AppField from '@/components/AppField.vue'

function fieldInput(props: {
  hint?: string
  error?: string
  reference?: string
}): HTMLInputElement {
  document.body.innerHTML = ''
  const wrapper = mount(AppField, {
    props: { label: 'name', ...props },
    slots: { default: (field: Record<string, unknown>) => h('input', field) },
    attachTo: document.body,
  })
  return wrapper.find('input').element
}

describe('AppField가 건넨 값', () => {
  it('도움말을 aria-describedby로 칸에 잇는다', () => {
    const input = fieldInput({ hint: 'note' })
    const noteId = input.getAttribute('aria-describedby')
    expect(noteId).not.toBeNull()
    expect(input.ownerDocument.getElementById(noteId ?? '')?.textContent?.trim()).toBe('note')
    // 뜻 없는 이름이 서지 않는다.
    expect([...input.attributes].map((one) => one.name)).not.toContain('ariadescribedby')
  })

  it('도움말이 없으면 잇지 않는다', () => {
    expect(fieldInput({}).hasAttribute('aria-describedby')).toBe(false)
  })

  it('참고값은 입력 아래에 서고, 도움말과 함께 칸에 잇는다', () => {
    const input = fieldInput({ hint: 'note', reference: 'range' })
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((id) => input.ownerDocument.getElementById(id)?.textContent?.trim())
    expect(texts).toEqual(['note', 'range'])
    const reference = input.ownerDocument.getElementById(ids[1] ?? '')
    expect(reference?.previousElementSibling).toBe(input)
  })

  it('오류가 서도 참고값은 남는다', () => {
    const input = fieldInput({ error: 'bad', reference: 'range' })
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ')
    const texts = ids.map((id) => input.ownerDocument.getElementById(id)?.textContent?.trim())
    expect(texts).toEqual(['bad', 'range'])
  })

  it('오류가 있으면 aria-invalid가 참이다', () => {
    expect(fieldInput({ error: 'bad' }).getAttribute('aria-invalid')).toBe('true')
    expect(fieldInput({ hint: 'note' }).getAttribute('aria-invalid')).toBe('false')
  })
})
