// @vitest-environment jsdom
// 읽기를 검사가 쥔다 — **읽는 도중**이라는 순간이 있어야 보이는 자리다.
/**
 * **읽은 것이 지금 연 줄의 것인가** (§8.21, 2026-09-18 R28 B-6).
 *
 * 교사가 A를 누르고 읽히는 동안 B를 누르면, **A의 읽기는 이미 큐에서 나와 돌고 있다.**
 * 그것이 끝나면 명렬의 `opened`에 A가 앉는데 화면의 머리줄은 B다 — 그때 상세를 그리면
 * **B의 이름 아래에 A의 요약·무결성이 선다.** 이 화면이 가장 하면 안 되는 일이다.
 *
 * 지키는 것은 `viewing`의 한 줄(`roster.opened.item.label !== opened.label`)이고, 그 줄을
 * 지워도 마운트 검사 넷이 전부 초록이었다 — **읽기가 즉시 끝나는 픽스처에는 이 순간이
 * 아예 없기 때문이다.**
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 아직 안 끝낸 읽기들. 검사가 하나씩 풀어 준다. */
const gates: (() => void)[] = []

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
  }
})

const { i18n, setLocale } = await import('../src/i18n')
const ProjectSummary = (await import('../src/components/ProjectSummary.vue')).default
const { mountInspect, submissionFile } = await import('./fixtures/inspect-screen')

/** 다른 프로젝트에서 나온 파일. 묶음 표시가 끼어들지 않게 아이디를 갈라 둔다. */
const OTHER = '11111111-1111-4111-8111-111111111111'
const THIRD = '22222222-2222-4222-8222-222222222222'

/**
 * 표 아래 **고른 것이 서는 자리**의 글자. 명렬의 표는 여기 안 든다 — 표에는 서른 줄이
 * 전부 적혀 있어서, 화면 전체를 훑으면 "누구의 것이 섰나"를 못 가른다.
 */
function detail(wrapper: { find: (selector: string) => { text: () => string } }): string {
  return wrapper.find('.scroll-below-shell').text()
}

/** 줄 선 읽기를 전부 끝낸다. 그 사이에 새로 시작되는 것까지 따라간다. */
async function finish(): Promise<void> {
  for (let guard = 0; guard < 20 && gates.length > 0; guard += 1) {
    gates.shift()?.()
    await flushPromises()
  }
}

describe('읽는 도중에 다음 줄을 누른다', () => {
  beforeEach(() => {
    setLocale('ko')
    gates.length = 0
  })

  it('앞 파일의 읽기가 늦게 끝나도 지금 연 줄의 자리에 안 앉는다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('hong.mlpx', undefined, { studentId: '10101', name: '홍길동' }),
      await submissionFile('kim.mlpx', OTHER, { studentId: '10102', name: '김하나' }),
    ])
    await finish()

    const rows = () => wrapper.findAll('tbody tr')
    await rows()[0]!.trigger('click')
    await flushPromises()
    // A의 읽기가 아직 안 끝난 채로 B를 누른다.
    await rows()[1]!.trigger('click')
    await flushPromises()

    // 이제 A의 읽기만 끝낸다. **B의 자리에 A가 앉으면 안 된다.**
    gates.shift()?.()
    await flushPromises()

    // **상세가 통째로 안 선다.** 가드를 지우면 여기에 hong의 요약과 무결성이 서는데,
    // 머리줄은 kim이라 교사는 그것을 kim의 것으로 읽는다.
    expect(
      wrapper.findComponent(ProjectSummary).exists(),
      'the previous file must not show under this name',
    ).toBe(false)
    expect(detail(wrapper)).toContain(i18n.global.t('inspect.reading'))

    await finish()
    expect(wrapper.findComponent(ProjectSummary).exists()).toBe(true)
    // 도착한 것이 지금 연 줄의 것이다.
    expect(detail(wrapper)).toContain('10102')
    expect(detail(wrapper)).not.toContain('10101')
    wrapper.unmount()
  })

  /**
   * **떠나면 큐도 멈춘다** (§8.21, 2026-09-18 R28-F C-2). 화면의 `retire`는 워커까지이고
   * **파일 읽기 루프에는 맡길 손잡이가 없다** — `roster.stop()`을 안 걸면 서른 개를
   * 훑다 나가도 큐가 끝까지 돈다.
   *
   * **화면이 그것을 거는지를 본다.** `roster-queue.spec.ts`는 `stop()`을 직접 불러
   * 그 동작만 재므로, 떠나는 자리에서 지워도 거기서는 안 보인다 — 옛 상태로 조용히
   * 돌아가는 모양이다.
   */
  it('화면을 떠나면 안 읽은 줄이 더 안 읽힌다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('01.mlpx'),
      await submissionFile('02.mlpx', OTHER),
      await submissionFile('03.mlpx', THIRD),
    ])
    // 첫 줄만 읽히게 두고 나머지는 큐에 남긴다.
    gates.shift()?.()
    await flushPromises()
    expect(gates.length, 'a read must be waiting to begin with').toBe(1)

    wrapper.unmount()
    // 돌고 있던 하나는 끝난다. **그 뒤의 줄은 시작되지 않는다.**
    gates.shift()?.()
    await flushPromises()
    expect(gates.length, 'leaving must not start the next read').toBe(0)
  })
})
