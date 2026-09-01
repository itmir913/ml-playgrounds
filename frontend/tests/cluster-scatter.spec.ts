// @vitest-environment jsdom
// 배색 토큰을 실제로 읽는 부품이라 문서와 계산된 스타일이 있어야 한다.
/**
 * 군집 산점도가 배색을 따라가는 자리 (`components/ClusterScatter.vue`).
 *
 * **이 부품을 마운트하는 스펙이 하나도 없었다** (2026-08-31 사각 감사 A-2).
 * `ui-rules.spec.ts`의 `배색을 data-theme 속성에서 직접 읽지 않는다`가 바로 이 파일
 * 때문에 섰는데, 그 규칙은 **"속성을 읽지 마라"만 말하고 "`theme`을 따라가라"는
 * 안 말한다.** 그래서 `watch(theme, readTokens)`를 죽여도 저장소 전체가 조용했다.
 *
 * 그때 학생이 겪는 일이 2026-08-29 전 경로 감사가 잡은 것과 같다 — **배색을 바꾸면
 * 산점도만 이전 배색의 값을 들고 있고, 밝은 화면에 어두운 배색의 선이 검게 그려진다.**
 */

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **그림 자체는 여기서 볼 것이 아니다.** Chart.js는 캔버스를 요구하고 jsdom에는 없다 —
 * 그리게 두면 처리되지 않은 거절 여섯이 관문을 빨갛게 만든다. 재는 것은 **토큰을
 * 다시 읽는가**이고, 그 판단은 그리기 앞에 있다.
 */
vi.mock('vue-chartjs', () => ({ Scatter: { name: 'Scatter', render: () => null } }))

import ClusterScatter from '../src/components/ClusterScatter.vue'
import { i18n } from '../src/i18n'
import { theme } from '../src/theme'

/**
 * 토큰을 몇 번 읽었나. **색을 화면에서 볼 수는 없다** — Chart.js가 캔버스에 그리고
 * jsdom에는 캔버스가 없다. 여기서 재는 것은 **다시 읽었는가**이고, 그것이 이 감시자의
 * 전부다.
 */
let reads = 0

function pretendTokens(color: string): void {
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => {
      if (name.startsWith('--')) reads += 1
      return color
    },
  }))
}

function render() {
  return mount(ClusterScatter, {
    props: {
      axes: [
        { name: '키', index: 0, width: 1 },
        { name: '몸무게', index: 1, width: 1 },
      ],
      summaries: [
        { cluster: 0, size: 2, means: [0, 0], centroid: [0, 0] },
        { cluster: 1, size: 2, means: [1, 1], centroid: [1, 1] },
      ],
      scatter: {
        points: [
          { row: 0, cluster: 0, values: [0, 0] },
          { row: 1, cluster: 1, values: [1, 1] },
        ],
        drawn: 2,
        total: 2,
      },
      title: '군집 산점도',
      lead: '두 축으로 본다',
    } as never,
    attachTo: document.body,
    global: {
      plugins: [i18n],
    },
  })
}

beforeEach(() => {
  theme.value = 'light'
  reads = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('배색이 바뀌면 색을 다시 읽는다', () => {
  it('마운트할 때 토큰을 읽는다', () => {
    pretendTokens('#111111')
    render()
    expect(reads, 'the colour token must be read at least once').toBeGreaterThan(0)
  })

  it('배색을 바꾸면 다시 읽는다', async () => {
    pretendTokens('#111111')
    const view = render()
    const atMount = reads
    expect(atMount).toBeGreaterThan(0)

    // `applyTheme`이 `theme.value`와 `data-theme`을 한 번에 쓰고 감시자는 그 뒤에 돈다.
    theme.value = 'dark'
    await view.vm.$nextTick()

    expect(reads, 'this does not grow when the observer is dead').toBeGreaterThan(atMount)
  })

  it('배색이 그대로면 다시 안 읽는다 - 그리기는 비싸다', async () => {
    pretendTokens('#111111')
    const view = render()
    const atMount = reads

    theme.value = 'light'
    await view.vm.$nextTick()

    expect(reads).toBe(atMount)
  })
})
