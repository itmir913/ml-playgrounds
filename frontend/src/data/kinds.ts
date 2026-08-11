/**
 * 데이터 종류 등록부.
 *
 * **`if (dataType === 'image')`를 만들지 마라** (CLAUDE.md §2, architecture.md §6).
 * V1은 표뿐이지만 최종 목표는 학생이 이미지·음성·텍스트로도 포트폴리오를 만드는
 * 것이고, 그때 데이터 화면을 고치는 것이 아니라 **여기 줄 하나를 더한다.**
 *
 * 판(panel)을 지연 로딩하는 이유는 학생이 쓰지 않는 종류의 화면을 받게 할 이유가
 * 없어서다. 표만 쓰는 수업에서 이미지 판의 코드가 내려오면 안 된다.
 */

import { defineAsyncComponent, type Component } from 'vue'

import { TABULAR_ACCEPT } from '@/data/table'
import type { DataType } from '@/project/schema'

export interface DataKind {
  readonly dataType: DataType
  /** `<input accept>`에 그대로 들어간다. */
  readonly accept: string
  /** 데이터 화면에서 이 종류를 다루는 작업 공간. */
  readonly panel: Component
  /**
   * 전처리 화면에서 이 종류를 다루는 작업 공간.
   *
   * **판이 자기 레이아웃을 갖는다.** 표는 열이 수십 개라 넓은 칸이 필요하고 이미지는
   * 전혀 다른 모양이 된다 (architecture.md §8.9).
   *
   * **평가 데이터를 어디서 받나도 판의 몫이다** (§9.1.1) — 표는 파일 하나이고 이미지는
   * 폴더나 zip이 된다. 판이 `<slot>`으로 받는 것은 **얼마나 나눌 것인가**(비율·층화·
   * 씨앗)뿐이고, 그것만 `settings.split`이라 모든 종류에 공통이다.
   *
   * **화면 둘을 한 줄에 둔다.** 같은 열쇠(dataType)로 등록부를 둘 만들면 한쪽에만
   * 줄을 넣는 일이 생기고, 그건 타입이 못 잡는다 (§9.2 "등록부의 모양은 하나다").
   */
  readonly prepPanel: Component
}

const KINDS: readonly DataKind[] = [
  {
    dataType: 'tabular',
    accept: TABULAR_ACCEPT,
    panel: defineAsyncComponent(() => import('@/views/data/TabularPanel.vue')),
    prepPanel: defineAsyncComponent(() => import('@/views/preprocess/TabularPrepPanel.vue')),
  },
]

/** 이 종류를 다룰 수 있는가. 없으면 화면이 "아직 못 다룬다"고 말한다. */
export function dataKindFor(dataType: string): DataKind | undefined {
  return KINDS.find((kind) => kind.dataType === dataType)
}

/**
 * 다룰 수 있는 종류들. **새 프로젝트 화면이 고르게 할 때 쓴다** — 업로드한 파일로
 * 추론하지 않는다 (open-decisions.md "데이터 종류는 프로젝트를 만들 때 고르고, 그 뒤로
 * 안 바뀐다"). 지금은 하나뿐이라 묻지 않는다.
 */
export const SUPPORTED_DATA_TYPES: readonly DataType[] = KINDS.map((kind) => kind.dataType)
