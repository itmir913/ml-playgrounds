// @vitest-environment jsdom
/**
 * **[추가]가 gate의 판정대로 잠기는가.** 판정은 `ml/selection.ts`의 `modelAxes().blocked`이고
 * (`selection.spec.ts`), 여기서는 `ModelAxes`가 그 판정을 버튼에 거는지를 본다. 이미 담은 쌍을
 * 고른 채로 두면 [추가]가 잠기고 이유가 선다 — 풀려 있으면 같은 줄이 둘 담긴다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { algorithmOptions } from '../src/ml/algorithms'
import type { RuntimeContext } from '../src/ml/backend'
import ModelAxes from '../src/views/train/ModelAxes.vue'

const t = (key: string): string => i18n.global.t(key)

const CONTEXT: RuntimeContext = {
  serverStatus: 'unknown',
  rowCount: 150,
  dataType: 'tabular',
  limitsOff: false,
}

function axes(chosen: readonly { algorithm: string; runtime: string }[]) {
  const options = algorithmOptions({ dataType: 'tabular', taskType: 'classification' }, CONTEXT)
  return mount(ModelAxes, {
    props: {
      taskTypes: ['classification'] as const,
      taskType: 'classification' as const,
      options,
      chosen,
      preferredRuntime: 'mljs',
    },
    global: { plugins: [i18n] },
  })
}

function addButton(wrapper: ReturnType<typeof axes>) {
  const found = wrapper.findAll('button').find((one) => one.text() === t('train.addModel'))
  expect(found, 'add button').toBeDefined()
  return found!
}

describe('[추가]는 이미 담은 쌍에서 잠긴다', () => {
  beforeEach(async () => {
    await setLocale('ko')
  })

  it('아직 안 담았으면 열려 있고 누르면 그 쌍이 나간다', async () => {
    const wrapper = axes([])
    const button = addButton(wrapper)
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
    wrapper.unmount()
  })

  it('지금 고른 쌍을 이미 담았으면 잠기고 이유를 말한다', async () => {
    // 축이 처음 고르는 쌍을 먼저 읽는다 — 그 쌍을 이미 담은 채로 다시 띄운다.
    const first = axes([])
    await addButton(first).trigger('click')
    const [algorithm, runtime] = first.emitted('add')?.[0] as [string, string]
    first.unmount()

    const wrapper = axes([{ algorithm, runtime }])
    const button = addButton(wrapper)
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(t('train.alreadyAdded'))
    await button.trigger('click')
    expect(wrapper.emitted('add')).toBeUndefined()
    wrapper.unmount()
  })
})
