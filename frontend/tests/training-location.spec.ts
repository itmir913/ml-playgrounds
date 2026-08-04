/**
 * 실행 위치 선택 규칙.
 *
 * 핵심 요구: 서버가 없어도 수업이 계속돼야 하고, 못 고르는 이유가 항상 있어야 한다.
 */

import { describe, expect, it } from 'vitest'

import { BROWSER_ROW_LIMIT } from '../src/limits'
import { type AlgorithmSpec, locationOptions, preferredLocation } from '../src/ml/backend'

const both: AlgorithmSpec = { id: 'decision_tree', locations: ['browser', 'server'] }
const serverOnly: AlgorithmSpec = { id: 'gradient_boosting', locations: ['server'] }

function optionFor(options: ReturnType<typeof locationOptions>, location: string) {
  return options.find((option) => option.location === location)
}

describe('locationOptions', () => {
  it('서버가 살아 있으면 둘 다 고를 수 있다', () => {
    const options = locationOptions(both, 'available', 100)
    expect(optionFor(options, 'browser')?.enabled).toBe(true)
    expect(optionFor(options, 'server')?.enabled).toBe(true)
  })

  it('서버가 없으면 서버 옵션만 잠기고 브라우저는 남는다', () => {
    const options = locationOptions(both, 'unavailable', 100)
    expect(optionFor(options, 'browser')?.enabled).toBe(true)
    expect(optionFor(options, 'server')).toEqual({
      location: 'server',
      enabled: false,
      reason: 'SERVER_UNAVAILABLE',
    })
  })

  it('아직 확인 전인 서버는 열어 주지 않는다', () => {
    const options = locationOptions(both, 'unknown', 100)
    expect(optionFor(options, 'server')?.enabled).toBe(false)
  })

  it('브라우저가 감당 못 할 크기면 브라우저를 잠근다', () => {
    const options = locationOptions(both, 'available', BROWSER_ROW_LIMIT + 1)
    expect(optionFor(options, 'browser')).toEqual({
      location: 'browser',
      enabled: false,
      reason: 'DATASET_TOO_LARGE_FOR_BROWSER',
    })
    expect(optionFor(options, 'server')?.enabled).toBe(true)
  })

  it('상한 자체는 허용한다', () => {
    const options = locationOptions(both, 'available', BROWSER_ROW_LIMIT)
    expect(optionFor(options, 'browser')?.enabled).toBe(true)
  })

  it('알고리즘이 지원하지 않는 위치는 이유와 함께 잠근다', () => {
    const options = locationOptions(serverOnly, 'available', 100)
    expect(optionFor(options, 'browser')).toEqual({
      location: 'browser',
      enabled: false,
      reason: 'ALGORITHM_NOT_AVAILABLE_HERE',
    })
  })

  it('잠긴 옵션에는 항상 이유가 있다', () => {
    const cases = [
      locationOptions(both, 'unavailable', BROWSER_ROW_LIMIT + 1),
      locationOptions(serverOnly, 'unavailable', 10),
      locationOptions(both, 'unknown', 999999),
    ]
    for (const options of cases) {
      for (const option of options) {
        if (!option.enabled) {
          expect(option.reason, JSON.stringify(option)).toBeDefined()
        }
      }
    }
  })
})

describe('preferredLocation', () => {
  it('가능하면 브라우저를 먼저 고른다', () => {
    expect(preferredLocation(locationOptions(both, 'available', 100))).toBe('browser')
  })

  it('브라우저가 안 되면 서버로 넘어간다', () => {
    expect(preferredLocation(locationOptions(both, 'available', 999999))).toBe('server')
  })

  it('둘 다 안 되면 null이다', () => {
    expect(preferredLocation(locationOptions(both, 'unavailable', 999999))).toBeNull()
  })
})
