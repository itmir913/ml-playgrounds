// @vitest-environment jsdom
// 읽기를 검사가 쥔다 — **묶는 도중**이라는 순간이 있어야 보이는 자리다.
/**
 * **포트폴리오 묶음은 명렬을 다 읽었을 때만 내려간다** (architecture.md §8.21,
 * `InspectView.vue`의 `downloadPortfolios`).
 *
 * 묶는 동안 교사가 다른 반 폴더를 고르면 그 묶음은 이미 남의 것이다. 앞 줄 하나가 읽힌 뒤에
 * 갈아 끼우면 손에는 **절반짜리 묶음**이 들려 있다 — 그것을 내려받으면 교사는 반 전체의
 * 글로 읽는다. 명렬의 판정(`roster-queue.spec.ts`)은 따로 초록이어도, 화면이 그 판정을
 * 안 물으면 이 순간에만 새므로 여기서 화면 입구로 잰다.
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 아직 안 끝낸 읽기들. 검사가 하나씩 풀어 준다. */
const gates: (() => void)[] = []
const downloads = vi.hoisted(() => ({ count: 0 }))

vi.mock('../src/project/download', async (real) => {
  const actual = await real<typeof import('../src/project/download')>()
  return {
    ...actual,
    // **바이트는 진짜로 읽는다.** 여기서 늦추는 것은 언제 끝나느냐뿐이다.
    readFileBytes: async (file: File) => {
      const bytes = await actual.readFileBytes(file)
      await new Promise<void>((resolve) => gates.push(resolve))
      return bytes
    },
    downloadBlob: () => {
      downloads.count += 1
    },
  }
})

const { i18n, setLocale } = await import('../src/i18n')
const { mountInspect, pickFiles, submissionFile } = await import('./fixtures/inspect-screen')

const OTHER = '11111111-1111-4111-8111-111111111111'

/** 줄 선 읽기를 전부 끝낸다. 그 사이에 새로 시작되는 것까지 따라간다. */
async function finish(): Promise<void> {
  for (let guard = 0; guard < 20 && gates.length > 0; guard += 1) {
    gates.shift()?.()
    await flushPromises()
  }
}

describe('포트폴리오 묶음', () => {
  beforeEach(() => {
    setLocale('ko')
    gates.length = 0
    downloads.count = 0
  })

  function bundleButton(wrapper: Awaited<ReturnType<typeof mountInspect>>) {
    const found = wrapper
      .findAll('button')
      .find((one) => one.text().trim() === i18n.global.t('inspect.bundle'))
    expect(found, 'the bundle button stands once the roster is read').toBeTruthy()
    return found!
  }

  it('다 읽으면 내려간다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('hong.mlpx'),
      await submissionFile('kim.mlpx', OTHER),
    ])
    await finish()

    await bundleButton(wrapper).trigger('click')
    await flushPromises()
    await finish()

    expect(downloads.count).toBe(1)
    wrapper.unmount()
  })

  it('앞 줄이 읽힌 뒤 다른 폴더를 고르면 절반짜리 묶음을 안 내려받는다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('hong.mlpx'),
      await submissionFile('kim.mlpx', OTHER),
    ])
    await finish()

    await bundleButton(wrapper).trigger('click')
    await flushPromises()
    // 첫 줄만 끝낸다 — 그 글은 이미 묶음에 들었다.
    expect(gates.length, 'the bundle must be reading its first row').toBe(1)
    gates.shift()?.()
    await flushPromises()

    // 둘째 줄이 도는 동안 다른 반 폴더를 고른다.
    await pickFiles(wrapper, [await submissionFile('lee.mlpx')])
    await finish()

    expect(downloads.count, 'half a class must not be downloaded').toBe(0)
    wrapper.unmount()
  })
})
