/**
 * **제출할 수 있는 크기인가** (`src/project/file-size.ts`).
 *
 * 이 상수는 한 번 죽어 있었다 — `PROJECT_FILE_WARN_BYTES = 50 * MB`가 있는데 **읽는
 * 코드가 하나도 없었고**, 그보다 나쁜 것은 문서가 그것을 돌고 있는 장치로 세 곳에서
 * 인용한 것이었다 (V11 R5 감사 B-3). 그래서 여기서 보는 것은 값 자체가 아니라
 * **경계에서 무엇을 하느냐**다.
 */

import { describe, expect, it } from 'vitest'

import { BYTES_PER_MB, PROJECT_FILE_WARN_BYTES } from '../src/limits'
import { needsSizeWarning } from '../src/project/file-size'

describe('파일 크기 알림', () => {
  it('넘으면 알린다', () => {
    expect(needsSizeWarning(PROJECT_FILE_WARN_BYTES + 1)).toBe(true)
  })

  it('딱 맞으면 조용하다 - 뜨는 경고가 잦으면 정작 필요할 때 안 읽힌다', () => {
    expect(needsSizeWarning(PROJECT_FILE_WARN_BYTES)).toBe(false)
  })

  it('빈 프로젝트에는 아무 말도 안 한다', () => {
    expect(needsSizeWarning(0)).toBe(false)
  })

  it('문턱이 십진 100MB다 - 이진이면 104.9MB가 되어 LMS가 거절할 파일에 침묵한다', () => {
    // **값을 여기 적는 유일한 자리다.** 근거가 우리 기기가 아니라 밖(LMS 첨부 상한)이라
    // 조용히 움직이면 안 된다 - open-decisions.md #32와 "MB는 십진 백만이다".
    expect(PROJECT_FILE_WARN_BYTES).toBe(100 * BYTES_PER_MB)
    expect(BYTES_PER_MB).toBe(1_000_000)
  })

  it('사진 상한을 채운 webp 프로젝트에는 안 뜬다 - 50MB를 안 쓴 이유가 이것이다', () => {
    // 결정문이 잰 값은 약 81MB다. 정상적으로 제출되는 파일에 경고가 뜨면 안 된다.
    expect(needsSizeWarning(81 * BYTES_PER_MB)).toBe(false)
  })
})
