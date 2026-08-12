// @vitest-environment jsdom
/**
 * 데이터 종류 등록부 (`data/kinds.ts`).
 *
 * **jsdom이 필요해진 것은 이미지 판이 등록되면서다** — 등록부가 판을 지연 로딩으로
 * 들고 있고 그 줄을 따라가면 임베딩 클라이언트에 닿는다. 거기에 DOM 부재 분기가 있어서
 * node 환경에서는 **죽는 대신 조용히 대체 경로를 검사하게** 된다.
 *
 * **열쇠형 등록부다** (architecture.md §9.2) — 종류 하나에 줄 하나다. 축을 선언하는
 * 등록부(알고리즘·지표 패널)와 달리 타입이 "줄이 빠졌다"를 못 잡는다. 그래서 검사가 본다.
 */

import { describe, expect, it } from 'vitest'

import { dataKindFor, SUPPORTED_DATA_TYPES } from '../src/data/kinds'
import { DATA_TYPES } from '../src/project/schema'

describe('데이터 종류 등록부', () => {
  it('열쇠가 겹치지 않는다', () => {
    // 겹치면 `dataKindFor`가 조용히 첫 줄만 쓴다. 뒷줄은 존재하지 않는 것이 된다.
    expect(new Set(SUPPORTED_DATA_TYPES).size).toBe(SUPPORTED_DATA_TYPES.length)
  })

  it('어휘에 있는데 판이 없는 종류는 화면이 "아직 못 다룬다"고 말한다', () => {
    // 어휘와 등록부는 따로 늘 수 있다 - 어휘를 먼저 늘리는 순간과 판이 생기는 순간
    // 사이가 있다. 그 사이가 던지는 상태가 되면 안 된다.
    for (const dataType of DATA_TYPES) {
      const kind = dataKindFor(dataType)
      if (kind === undefined) continue
      expect(kind.dataType, dataType).toBe(dataType)
      expect(kind.accept, dataType).not.toBe('')
    }
    expect(dataKindFor('그런 종류 없음')).toBeUndefined()
  })

  /**
   * **트립와이어가 여기 있었다.** "종류를 늘리는 사람은 `PreprocessView`와 `TrainView`의
   * 머리 문맥을 판으로 옮겨라"였고, 2026-08-12에 이미지를 등록하면서 실제로 옮겼다 —
   * 그 둘은 이제 `DataKind.prepContext`·`trainContext`가 갖는다. 할 일이 끝났으므로
   * 검사도 지웠다 (트립와이어는 통과가 목적이 아니라 멈추는 것이 목적이다).
   *
   * 대신 **판이 선언해야 할 칸을 빠뜨렸는지는 타입이 잡는다** — `DataKind`의 필드가
   * 전부 필수라 줄을 더하는 사람이 넷을 다 채워야 한다.
   */
  it('등록된 종류마다 화면 넷이 다 있다', () => {
    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      expect(kind?.panel, dataType).toBeDefined()
      expect(kind?.prepPanel, dataType).toBeDefined()
      expect(kind?.prepContext, dataType).toBeDefined()
      expect(kind?.trainContext, dataType).toBeDefined()
      // 문구가 빠지면 새 프로젝트 대화상자에 이름 없는 칸이 뜬다.
      expect(kind?.labelKey, dataType).toMatch(/^dataTypes\./)
    }
  })
})
