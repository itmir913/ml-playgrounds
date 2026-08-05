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

import type { DataType } from '@/project/schema'

export interface DataKind {
  readonly dataType: DataType
  /** `<input accept>`에 그대로 들어간다. */
  readonly accept: string
  /** 이 종류를 다루는 작업 공간. */
  readonly panel: Component
}

const KINDS: readonly DataKind[] = [
  {
    dataType: 'tabular',
    accept: '.csv,.xlsx',
    panel: defineAsyncComponent(() => import('@/views/data/TabularPanel.vue')),
  },
]

/** 이 종류를 다룰 수 있는가. 없으면 화면이 "아직 못 다룬다"고 말한다. */
export function dataKindFor(dataType: string): DataKind | undefined {
  return KINDS.find((kind) => kind.dataType === dataType)
}

/** 다룰 수 있는 종류들. 새 프로젝트 화면이 고르게 할 때 쓴다. */
export const SUPPORTED_DATA_TYPES: readonly DataType[] = KINDS.map((kind) => kind.dataType)
