/**
 * 경계를 넘는 오류의 처리.
 *
 * 두 함수 다 **밖에서 들어온 것**을 다룬다 - 남의 라이브러리가 던진 예외와, 워커나
 * 서버에서 문자열로 도착한 코드. 안쪽에서 만든 ClientError는 여기 대상이 아니다.
 */

import { describe, expect, it } from 'vitest'

import { CLIENT_ERROR_CODES, failureDetail, toClientErrorCode } from '../src/errors'
import { MAX_FAILURE_DETAIL_LENGTH } from '../src/limits'

describe('우리 어휘가 아닌 실패의 기술 정보', () => {
  it('예외 메시지를 담는다', () => {
    expect(failureDetail(new TypeError('input must not be empty'))).toEqual({
      detail: 'input must not be empty',
    })
  })

  it('스택은 담지 않는다 - 학생 파일에 우리 코드 구조를 흘리지 않는다', () => {
    const detail = failureDetail(new Error('boom'))
    expect(detail.detail).toBe('boom')
    expect(JSON.stringify(detail)).not.toContain('.ts')
  })

  it('길면 자른다', () => {
    const long = 'x'.repeat(MAX_FAILURE_DETAIL_LENGTH + 50)
    expect(failureDetail(new Error(long)).detail).toHaveLength(MAX_FAILURE_DETAIL_LENGTH)
  })

  it('건질 것이 없으면 빈 파라미터다 - 빈 문자열을 화면에 넘기지 않는다', () => {
    expect(failureDetail(new Error('   '))).toEqual({})
    expect(failureDetail(undefined)).toEqual({})
    expect(failureDetail({ nope: true })).toEqual({})
  })

  it('문자열로 던진 것도 받는다', () => {
    expect(failureDetail('그냥 문자열')).toEqual({ detail: '그냥 문자열' })
  })
})

describe('경계를 넘어온 코드', () => {
  it('아는 코드는 그대로 둔다', () => {
    for (const code of CLIENT_ERROR_CODES) {
      expect(toClientErrorCode(code), code).toBe(code)
    }
    expect(toClientErrorCode('JOB_CANCELLED')).toBe('JOB_CANCELLED')
  })

  it('모르는 것은 JOB_FAILED다 - 로케일에 없는 키를 화면에 흘리지 않는다', () => {
    expect(toClientErrorCode('NOPE')).toBe('JOB_FAILED')
    expect(toClientErrorCode('')).toBe('JOB_FAILED')
    expect(toClientErrorCode('client.SERVER_UNAVAILABLE')).toBe('JOB_FAILED')
  })
})
