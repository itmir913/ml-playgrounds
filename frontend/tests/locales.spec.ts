/**
 * 로케일 파일 사이의 계약.
 *
 * 키 집합이 같아야 하고, 각 문장의 보간 변수도 같아야 한다.
 * 번역하다 {limitMb} 하나를 빠뜨리면 사용자는 숫자 없는 문장을 보게 된다.
 * CI 스크립트가 errors.py까지 포함해 같은 검사를 하지만, 개발 중에 즉시 잡히도록 여기도 둔다.
 */

import { describe, expect, it } from 'vitest'

import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { TRAINING_LOCATIONS, UNAVAILABLE_REASONS } from '../src/ml/backend'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      flat.set(path, value)
    } else {
      for (const [nested, nestedValue] of flatten(value, path)) {
        flat.set(nested, nestedValue)
      }
    }
  }
  return flat
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()
}

const english = flatten(en as Tree)
const korean = flatten(ko as Tree)

describe('로케일 파일', () => {
  it('키 집합이 완전히 같다', () => {
    expect([...korean.keys()].sort()).toEqual([...english.keys()].sort())
  })

  it('모든 값이 비어 있지 않다', () => {
    for (const [key, value] of [...english, ...korean]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('같은 키의 보간 변수가 같다', () => {
    for (const [key, message] of english) {
      expect(placeholders(korean.get(key) ?? ''), key).toEqual(placeholders(message))
    }
  })

  it('필요한 네임스페이스가 모두 있다', () => {
    for (const namespace of ['errors', 'stages', 'integrity', 'portfolio', 'language', 'client']) {
      expect([...english.keys()].some((key) => key.startsWith(`${namespace}.`))).toBe(true)
    }
  })
})

describe('프런트엔드 전용 코드', () => {
  it('선택 불가 이유마다 문장이 있다', () => {
    for (const reason of UNAVAILABLE_REASONS) {
      expect(english.has(`client.${reason}`), reason).toBe(true)
      expect(korean.has(`client.${reason}`), reason).toBe(true)
    }
  })

  it('client.* 에 쓰이지 않는 키가 없다', () => {
    const declared = new Set<string>(UNAVAILABLE_REASONS)
    const used = [...english.keys()]
      .filter((key) => key.startsWith('client.'))
      .map((key) => key.slice('client.'.length))
    expect(used.filter((key) => !declared.has(key))).toEqual([])
  })

  it('실행 위치마다 이름이 있다', () => {
    for (const location of TRAINING_LOCATIONS) {
      expect(english.has(`execution.${location}`), location).toBe(true)
      expect(korean.has(`execution.${location}`), location).toBe(true)
    }
  })
})
