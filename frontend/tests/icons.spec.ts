/**
 * 아이콘 등록부 (`icons.ts`).
 *
 * **이 파일을 부르는 스펙이 하나도 없었다** (2026-08-31 사각 감사 A-3). 그 파일
 * 머리말이 세운 규칙("화면 코드가 `lucide-vue-next`를 직접 import 하지 않는다")도,
 * 등록부의 값도 무엇도 안 지켰다 — `moveUp`과 `moveDown`을 맞바꿔도 저장소 전체가
 * 초록이었다. 그러면 **포트폴리오의 [위로]가 아래를 가리킨다.**
 *
 * **여기서만 `lucide-vue-next`를 직접 들여온다.** 등록부 밖의 출처가 있어야
 * 대조가 자기 자신과의 대조가 아니게 된다 (공통 §5.6). 화면 코드에 대한 금지는
 * `ui-rules.spec.ts`가 따로 훑는다.
 */

import { ChevronDown, ChevronUp, Moon, Sun } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'

import { ACTION_ICONS, STEP_ICONS } from '../src/icons'
import { STEP_IDS } from '../src/router/steps'

describe('방향과 뜻이 그림에 실린 것들', () => {
  /**
   * **화살표는 자기가 가리키는 쪽을 그린다.** 이 짝이 뒤집히면 문항을 위로 옮기는
   * 단추가 아래를 가리키고, 학생은 화면을 못 믿는다.
   */
  it('위로는 위를, 아래로는 아래를 가리킨다', () => {
    expect(ACTION_ICONS.moveUp).toBe(ChevronUp)
    expect(ACTION_ICONS.moveDown).toBe(ChevronDown)
  })

  /**
   * **스위치는 바뀔 쪽을 그린다** — 지금 어두우면 해를 보여 준다(누르면 밝아진다는 뜻).
   * 소스 주석이 그렇게 적어 둔 자리다.
   */
  it('배색 스위치는 바뀔 쪽을 그린다', () => {
    expect(ACTION_ICONS.toLight).toBe(Sun)
    expect(ACTION_ICONS.toDark).toBe(Moon)
  })
})

describe('등록부가 빈칸 없이 선다', () => {
  it('단계마다 그림이 있고 서로 다르다', () => {
    const icons = STEP_IDS.map((step) => STEP_ICONS[step])
    expect(icons.filter(Boolean)).toHaveLength(STEP_IDS.length)
    // 같은 그림이 둘이면 레일에서 두 단계가 구분되지 않는다.
    expect(new Set(icons).size).toBe(STEP_IDS.length)
  })

  it('동작마다 그림이 있다', () => {
    const missing = Object.entries(ACTION_ICONS)
      .filter(([, icon]) => icon === undefined)
      .map(([name]) => name)
    expect(Object.keys(ACTION_ICONS).length).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })
})
