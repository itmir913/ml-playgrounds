/**
 * **노드 환경 스펙에서 저장소를 지워도 콘솔이 조용하다** (`fixtures/database.ts`의 `closeProjectStores`).
 *
 * 도우미가 노드 환경에서도 pinia에 활성 인스턴스를 물으면 pinia 4의 개발 빌드가 서버 렌더링으로 보고
 * `PINIA_R1004`를 찍는다 — 저장소를 지우는 검사마다 한 번씩이라 CI 로그에 수백 줄이 쌓였다. 로컬 vitest는
 * 통과한 검사의 콘솔을 숨겨 개발 PC에서는 안 보였다. 이 파일은 일부러 jsdom을 밝히지 않는다.
 */

import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetDatabase } from './fixtures/database'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('노드 환경의 저장소 지우기', () => {
  it('DOM이 없는 환경이다 - 아니면 아래가 다른 길을 잰다', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })

  it('지워도 콘솔에 아무것도 안 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await resetDatabase()
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
