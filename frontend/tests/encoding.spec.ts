import { describe, expect, it } from 'vitest'

import { decodeDataset, detectEncoding } from '../src/data/encoding'

describe('detectEncoding', () => {
  it('BOM이 있으면 utf-8로 판정한다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')])
    expect(detectEncoding(bytes)).toBe('utf-8')
  })

  it('유효한 UTF-8이면 utf-8로 판정한다', () => {
    const bytes = new TextEncoder().encode('이름,나이\n가나다,10')
    expect(detectEncoding(bytes)).toBe('utf-8')
  })

  it('UTF-8로 해석되지 않으면 cp949로 판정한다', () => {
    // '이름,나이\n가나다,10'을 CP949로 인코딩한 바이트 (Python cp949 codec으로 생성해 검증)
    const bytes = new Uint8Array([
      192, 204, 184, 167, 44, 179, 170, 192, 204, 10, 176, 161, 179, 170, 180, 217, 44, 49, 48,
    ])
    expect(detectEncoding(bytes)).toBe('cp949')
  })
})

describe('decodeDataset', () => {
  it('utf-8 바이트를 원문으로 되돌린다', () => {
    const original = '이름,나이\n가나다,10'
    const bytes = new TextEncoder().encode(original)
    expect(decodeDataset(bytes, 'utf-8')).toBe(original)
  })

  it('utf-8 BOM을 제거한다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')])
    expect(decodeDataset(bytes, 'utf-8')).toBe('a,b')
  })

  it('cp949 바이트를 원문으로 되돌린다', () => {
    const bytes = new Uint8Array([
      192, 204, 184, 167, 44, 179, 170, 192, 204, 10, 176, 161, 179, 170, 180, 217, 44, 49, 48,
    ])
    expect(decodeDataset(bytes, 'cp949')).toBe('이름,나이\n가나다,10')
  })
})
