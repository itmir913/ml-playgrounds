/**
 * 로케일 파일 사이의 계약.
 *
 * 키 집합이 같아야 하고, 각 문장의 보간 변수도 같아야 한다.
 * 번역하다 {limitMb} 하나를 빠뜨리면 사용자는 숫자 없는 문장을 보게 된다.
 * CI 스크립트가 errors.py까지 포함해 같은 검사를 하지만, 개발 중에 즉시 잡히도록 여기도 둔다.
 */

import { describe, expect, it } from 'vitest'

import {
  CLIENT_ERROR_CODES,
  ENTRY_HASH_STATUSES,
  FILE_HASH_STATUSES,
  REPRODUCTION_STATUSES,
  SHARED_ERROR_CODES,
  errorMessageKey,
} from '../src/errors'
import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { ENGINE_STATES, TRAINING_LOCATIONS, UNAVAILABLE_REASONS } from '../src/ml/backend'

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
    for (const namespace of [
      'errors',
      'stages',
      'fileHash',
      'entryHash',
      'reproduction',
      'engineState',
      'portfolio',
      'language',
      'client',
    ]) {
      expect([...english.keys()].some((key) => key.startsWith(`${namespace}.`))).toBe(true)
    }
  })
})

describe('프런트엔드 전용 코드', () => {
  it('코드마다 문장이 있다', () => {
    for (const code of CLIENT_ERROR_CODES) {
      expect(english.has(`client.${code}`), code).toBe(true)
      expect(korean.has(`client.${code}`), code).toBe(true)
    }
  })

  it('client.* 에 쓰이지 않는 키가 없다', () => {
    const declared = new Set<string>(CLIENT_ERROR_CODES)
    const used = [...english.keys()]
      .filter((key) => key.startsWith('client.'))
      .map((key) => key.slice('client.'.length))
    expect(used.filter((key) => !declared.has(key))).toEqual([])
  })

  it('선택 불가 이유가 전부 코드 목록 안에 있다', () => {
    // errors.ts가 클라이언트 코드의 단일 출처다. ml/backend.ts가 따로 늘어나면 안 된다.
    const declared = new Set<string>(CLIENT_ERROR_CODES)
    for (const reason of UNAVAILABLE_REASONS) {
      expect(declared.has(reason), reason).toBe(true)
    }
  })

  it('공유 코드는 errors.* 에서 찾는다', () => {
    // 백엔드가 정의한 코드다. client.* 에 복제하면 같은 문장이 두 곳에 생기고
    // 번역이 갈라진다. 단일 출처는 backend/app/errors.py다.
    for (const code of SHARED_ERROR_CODES) {
      expect(errorMessageKey(code), code).toBe(`errors.${code}`)
      expect(english.has(`errors.${code}`), code).toBe(true)
      expect(korean.has(`errors.${code}`), code).toBe(true)
      expect(english.has(`client.${code}`), code).toBe(false)
    }
  })

  it('클라이언트 전용 코드는 client.* 에서 찾는다', () => {
    for (const code of CLIENT_ERROR_CODES) {
      expect(errorMessageKey(code), code).toBe(`client.${code}`)
    }
  })

  it('무결성 어휘가 로케일과 양방향으로 일치한다', () => {
    // 확인이 전부 브라우저에서 끝나므로 백엔드 errors.py에 이 어휘가 없다.
    // check_locales.py가 못 보는 자리라 여기서 강제한다.
    const pairs = [
      ['fileHash', FILE_HASH_STATUSES],
      ['entryHash', ENTRY_HASH_STATUSES],
      ['reproduction', REPRODUCTION_STATUSES],
      ['engineState', ENGINE_STATES],
    ] as const

    for (const [namespace, codes] of pairs) {
      for (const code of codes) {
        expect(english.has(`${namespace}.${code}`), code).toBe(true)
        expect(korean.has(`${namespace}.${code}`), code).toBe(true)
      }
      const declared = new Set<string>(codes)
      const used = [...english.keys()]
        .filter((key) => key.startsWith(`${namespace}.`))
        .map((key) => key.slice(namespace.length + 1))
      expect(used.filter((key) => !declared.has(key))).toEqual([])
    }
  })

  it('무결성 문구에 보증으로 읽히는 낱말을 쓰지 않는다', () => {
    // mlpx-spec.md 7.3. 도구가 보증할 수 있는 것보다 강한 말을 쓰면
    // 교사가 허술한 탐지기를 신뢰하게 된다.
    const integrityKeys = [...english.keys()].filter(
      (key) => key.startsWith('fileHash.') || key.startsWith('entryHash.'),
    )
    for (const key of integrityKeys) {
      expect(english.get(key)?.toLowerCase(), key).not.toContain('verified')
    }
  })

  it('실행 위치마다 이름이 있다', () => {
    for (const location of TRAINING_LOCATIONS) {
      expect(english.has(`execution.${location}`), location).toBe(true)
      expect(korean.has(`execution.${location}`), location).toBe(true)
    }
  })
})
