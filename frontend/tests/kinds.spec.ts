/**
 * 데이터 종류 등록부 (`data/kinds.ts`).
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
   * **트립와이어다.** 통과하는 것이 목적이 아니라, 두 번째 종류가 생기는 순간
   * 여기서 멈추게 하는 것이 목적이다.
   *
   * `PreprocessView`와 `TrainView`의 `StepHeader` `#context`가 **표를 전제한다** —
   * 각각 "열 수"와 "특성 n개"를 보여주는데, 이미지에는 열이 없고 특성을 학생이
   * 고르지도 않는다. 그 두 곳은 판 밖(화면)에 남아 있고 **타입이 못 잡는다**
   * (architecture.md §9.3.2 "화면이 등록부를 우회하는 것").
   *
   * 지금 판으로 옮기지 않은 이유는 **이미지 헤더가 무엇을 보여줘야 하는지 아무도
   * 모르기 때문**이다. 구현이 하나뿐인 계약을 미리 설계하면 §9.2.1이 경계한 것과
   * 같은 상태가 된다. 실물을 만드는 사람이 그때 정한다.
   */
  it('종류가 하나뿐이다 - 늘리는 사람은 헤더 문맥을 판으로 옮겨야 한다', () => {
    expect(
      SUPPORTED_DATA_TYPES,
      [
        '데이터 종류가 늘었다. 옮겨야 할 것이 둘 있다.',
        '  1. PreprocessView의 StepHeader #context — "열 수"가 표 전용이다',
        '  2. TrainView의 StepHeader #context — "특성 n개"가 표 전용이다',
        '둘을 data/kinds.ts의 판이 갖게 한 뒤 이 검사를 지워라.',
      ].join('\n'),
    ).toEqual(['tabular'])
  })
})
