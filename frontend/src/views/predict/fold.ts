/**
 * 사진 예측의 모델 카드가 펼쳐져 있는가 (architecture.md §8.13.4).
 *
 * **전체 스위치 하나와 사진별 예외다.** 스위치는 이 기기에 남고(`prefs.ts`), 사진 한 장을
 * 손으로 여닫은 것은 이번 세션의 예외라 남지 않는다 — 예측 사진은 다시 올리면 그만인
 * 입력이다.
 *
 * **템플릿에서 조립하지 않는다** (§10.1). `overrides.get(hash) ?? all`이 화면에 흩어지면
 * 단추의 `aria-expanded`·화살표와 카드의 `v-show`가 서로 다른 판정을 하게 된다.
 */

import { readFlag, writeFlag } from '@/prefs'

/** 스위치 하나와 사진별 예외. 화면은 이것 하나를 들고, 바꾸는 것은 아래 함수들이다. */
export interface CardFold {
  readonly all: boolean
  readonly overrides: ReadonlyMap<string, boolean>
}

/** 화면을 열 때. **스위치는 이 기기에 남은 값**이고, 예외는 없다 — 세션의 것이다. */
export function savedCardFold(): CardFold {
  return { all: readFlag('predictCardsOpen', true), overrides: new Map() }
}

/**
 * 스위치를 바꿨다. **예외를 비운다** — 스위치를 바꾸는 것은 "전부 이렇게"라는 뜻이라, 손으로
 * 여닫은 사진이 따라오지 않으면 고장으로 읽힌다. 바꾼 값은 이 기기에 남긴다.
 * 무는 검사: `image-predict-fold.spec.ts`의 *"스위치를 바꾸면 예외가 비워진다"* (코드 감사 C-4).
 */
export function switchCards(open: boolean): CardFold {
  writeFlag('predictCardsOpen', open)
  return { all: open, overrides: new Map() }
}

/** 사진 한 장의 카드를 뒤집는다. 스위치와 같아지면 예외가 지워진다(`overrideCards`). */
export function togglePhotoCards(fold: CardFold, hash: string): CardFold {
  const open = !photoCardsOpen(fold.all, fold.overrides, hash)
  return { all: fold.all, overrides: overrideCards(fold.all, fold.overrides, hash, open) }
}

export function photoCardsOpen(
  all: boolean,
  overrides: ReadonlyMap<string, boolean>,
  hash: string,
): boolean {
  return overrides.get(hash) ?? all
}

/**
 * 사진 한 장을 손으로 여닫았다. **스위치와 같아지면 예외가 아니다** — 지운다. 남겨 두면
 * 스위치를 바꿔도 그 사진만 따라오지 않는 것처럼 보일 이유가 하나 는다.
 */
export function overrideCards(
  all: boolean,
  overrides: ReadonlyMap<string, boolean>,
  hash: string,
  open: boolean,
): Map<string, boolean> {
  const next = new Map(overrides)
  if (open === all) next.delete(hash)
  else next.set(hash, open)
  return next
}
