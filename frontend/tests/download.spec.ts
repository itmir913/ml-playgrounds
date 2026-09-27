// @vitest-environment jsdom
/**
 * **내려보낸 파일의 URL을 누른 자리에서 놓지 않는다** (open-decisions.md 68).
 *
 * 사파리는 내려받기를 `click()` 뒤에 비동기로 시작한다. 그 자리에서 놓으면 `.mlpx`가
 * 안 내려오고, 서버가 없어 그 파일이 학생의 유일한 반출 경로다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadBlob } from '../src/project/download'

describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubUrls(): { revoked: string[] } {
    let next = 0
    const revoked: string[] = []
    // jsdom에는 둘이 없어 `spyOn`을 못 건다. 이 파일의 환경은 파일마다 따로라 밖으로 안 샌다.
    URL.createObjectURL = vi.fn(() => `blob:test/${String((next += 1))}`)
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url)
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    // 앞 테스트가 쥔 URL을 놓고 시작한다 — 모듈 상태가 테스트를 건넌다.
    window.dispatchEvent(new Event('pagehide'))
    revoked.length = 0
    return { revoked }
  }

  it('누른 직후에는 놓지 않고, 다음 내려받기가 시작될 때 앞의 것을 놓는다', () => {
    const { revoked } = stubUrls()
    downloadBlob(new Blob(['a']), 'a.mlpx')
    expect(revoked).toEqual([])

    downloadBlob(new Blob(['b']), 'b.mlpx')
    expect(revoked).toEqual(['blob:test/1'])
  })

  it('페이지를 떠날 때 마지막 것을 놓는다', () => {
    const { revoked } = stubUrls()
    downloadBlob(new Blob(['a']), 'a.mlpx')
    window.dispatchEvent(new Event('pagehide'))
    expect(revoked).toEqual(['blob:test/1'])
  })

  it('앵커를 문서에 붙여 누르고 뗀다', () => {
    stubUrls()
    let attached = false
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      attached = this.isConnected
    })
    downloadBlob(new Blob(['a']), 'a.mlpx')
    expect(attached).toBe(true)
    expect(document.querySelectorAll('a')).toHaveLength(0)
  })
})
