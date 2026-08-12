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

import { dataKindFor, stepTextKey, SUPPORTED_DATA_TYPES } from '../src/data/kinds'
import { DATA_TYPES } from '../src/project/schema'
import type { StepId } from '../src/router/steps'

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

  /**
   * **단계 문구 중 종류를 가리는 셋** (architecture.md §8.10). 표를 두고 쓴 문장이라
   * 이미지에서는 참이 아니다 — "어떤 열이 있는지", "표에 새 줄을 하나 넣으면",
   * "타깃과 특성을 먼저 정해 주세요".
   *
   * **`Partial`이라 타입이 못 잡는다.** 종류를 더하는 사람이 이 셋을 빠뜨리면 화면에
   * 표의 문장이 그대로 뜨고, 그건 컴파일도 다른 검사도 안 잡는다.
   */
  const KIND_SPECIFIC: readonly { step: StepId; slot: 'purpose' | 'locked' }[] = [
    { step: 'data', slot: 'purpose' },
    { step: 'predict', slot: 'purpose' },
    { step: 'train', slot: 'locked' },
  ]

  it('표가 아닌 종류는 종류를 가리는 단계 문구를 스스로 갖는다', () => {
    for (const dataType of SUPPORTED_DATA_TYPES) {
      // 표는 기본 문구가 곧 자기 문구다 — `steps.*`가 표를 두고 쓰인 문장이다.
      if (dataType === 'tabular') continue
      const kind = dataKindFor(dataType)
      for (const { step, slot } of KIND_SPECIFIC) {
        expect(
          stepTextKey(kind, step, slot),
          `${dataType}가 steps.${step}.${slot}을 표의 문장 그대로 쓴다`,
        ).not.toBe(`steps.${step}.${slot}`)
      }
    }
  })

  /** 나머지는 종류를 안 가린다. 덮어쓰면 공통 문장이 종류 수만큼 복제되기 시작한다. */
  it('가리지 않는 단계 문구는 덮어쓰지 않는다', () => {
    const specific = new Set(KIND_SPECIFIC.map(({ step, slot }) => `${step}.${slot}`))
    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      for (const [step, slots] of Object.entries(kind?.stepText ?? {})) {
        for (const slot of Object.keys(slots)) {
          expect(specific, `${dataType}의 ${step}.${slot}은 갈릴 이유가 없다`).toContain(
            `${step}.${slot}`,
          )
        }
      }
    }
  })
})
