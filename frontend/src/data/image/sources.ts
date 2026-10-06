/**
 * 사진은 어디서 오나 — 입력 방식 등록부 (open-decisions.md 67).
 *
 * **선례는 포트폴리오의 [양식 가져오기]다** (`project/portfolio-sources.ts`). 출처는 달라도 하는
 * 일은 같다 — **파일 묶음(`File[]`) 하나를 돌려주는 것.** 그 뒤는 한 벌이다: 화면이 받은 것을
 * 끌어다 놓기·붙여넣기가 쓰는 그 함수(`readPicked`)에 넘기고, 장수·자리 확인과 굽기가 그대로
 * 걸린다. 입구가 늘었다고 길이 갈라지면 그 자리가 곧 구멍이다.
 *
 * **화면은 여기서 나온 줄을 그대로 그린다.** 방식마다 다른 단추를 만들지 않는다 — 줄이 하나
 * 붙으면 메뉴가 저절로 그것을 보여준다. **출처 하나가 줄 여럿을 낼 수도 있다** — 파일이 그렇다
 * (사진 선택·폴더 선택).
 *
 * **안 만든 경로를 비활성으로 미리 세워 두지 않는다** — 웹캠은 미정 둘(보안 컨텍스트·얼굴)이
 * 닫힌 뒤 출처 하나로 붙는다. 그 전에는 회색으로도 없다. 검사: `image-sources.spec.ts`.
 *
 * **DOM·프로젝트·굽기는 여기 없다.** 파일 창을 열고 그리기 창을 띄우는 것은 화면이고, 등록부는
 * 그 함수를 받는다. 검사: `image-sources.spec.ts` "등록부와 그리기가 화면·프로젝트·굽기를 안 들인다".
 */

import type { Translate } from '@/i18n'

/** 받은 파일 묶음. **`null`은 아무 일도 없었다는 뜻이다** — 창을 닫았을 때. */
export type PickedFiles = readonly File[] | null

export interface ImageSourceContext {
  readonly translate: Translate
  /**
   * 사진 파일을 고르게 한다. 고르지 않고 닫으면 `null`이다.
   *
   * **화면이 준다.** 등록부가 `<input type="file">`을 알기 시작하면 이 파일은 화면 없이 검사할
   * 수 없게 된다.
   */
  readonly pickFiles: () => Promise<PickedFiles>
  /** 폴더 하나를 고르게 한다. 닫으면 `null`이다. 화면이 준다. */
  readonly pickFolder: () => Promise<PickedFiles>
  /** 그리기 창을 연다. 그린 장들이 돌아오고, 닫으면 `null`이다. 화면이 준다. */
  readonly openSketch: () => Promise<PickedFiles>
}

/**
 * 메뉴에서 이 줄이 갖는 무게. **앞서는 줄은 하나뿐이다** — 둘이면 무게가 아니라 그냥 색이 된다.
 * 검사: `image-sources.spec.ts` "앞서는 줄은 하나뿐이다".
 */
export type ImageSourceWeight = 'lead' | 'normal'

export interface ImageSourceRow {
  /** 메뉴에서의 자리. */
  readonly key: string
  /** 이미 번역된 이름. */
  readonly label: string
  /** 메뉴에서의 무게. **화면이 아니라 여기가 정한다** — 화면이 줄마다 가르면 등록부가 깨진다. */
  readonly weight: ImageSourceWeight
  /**
   * 받은 것을 확인 판에 **덧붙이는가**, 아니면 지금 판을 갈아끼우는가.
   *
   * **디스크에 없는 것은 갈아끼우면 사라진다 — 붙여넣기와 같은 판단이다.** 파일과 폴더는 다시
   * 고르면 되지만, 그린 그림은 디스크에 없어서 다음 [그리기]가 앞 그림을 지우면 되살릴 길이 없다.
   */
  readonly appends: boolean
  /** 파일 묶음을 받아 온다. 닫았으면 `null`이다. */
  readonly load: () => Promise<PickedFiles>
}

/**
 * 받아 온 묶음을 판에 넘긴다. `appends`는 그 줄이 들고 온 것(`ImageSourceRow.appends`)이다.
 * **판이 준다** — 무엇을 어느 범주로 읽을지는 판이 안다.
 */
export type PickImages = (files: readonly File[], options: { readonly appends: boolean }) => void

export interface ImageSource {
  readonly id: string
  readonly rows: (context: ImageSourceContext) => Promise<ImageSourceRow[]>
}

/**
 * 파일에서. **가장 확실하다** — 사진을 받는 통로는 이것 하나로도 전부 된다. 그래서 [사진 선택]이
 * 앞서는 줄이다. 폴더는 범주별로 정리된 사진을 한 번에 받는 길이다.
 */
const files: ImageSource = {
  id: 'files',
  rows: ({ translate, pickFiles, pickFolder }) =>
    Promise.resolve([
      {
        key: 'files',
        label: translate('data.image.source.files'),
        weight: 'lead',
        appends: false,
        load: pickFiles,
      },
      {
        key: 'folder',
        label: translate('data.image.source.folder'),
        weight: 'normal',
        appends: false,
        load: pickFolder,
      },
    ]),
}

/** 그리기. 그린 장은 PNG 파일이 되어 같은 길로 들어간다(`sketch.ts`). */
const sketch: ImageSource = {
  id: 'sketch',
  rows: ({ translate, openSketch }) =>
    Promise.resolve([
      {
        key: 'sketch',
        label: translate('data.image.source.sketch'),
        weight: 'normal',
        appends: true,
        load: openSketch,
      },
    ]),
}

export const IMAGE_SOURCES: readonly ImageSource[] = [files, sketch]

/**
 * 메뉴에 세울 줄 전부.
 *
 * **한 출처가 실패해도 나머지는 선다** — 양식 출처(`templateRows`)와 같다. 실패는 삼키지 않고
 * 부르는 쪽에 넘긴다 — 누른 사람은 무슨 일이 있었는지 알아야 한다.
 *
 * **동기로 던져도 같다.** 출처마다 `async`로 감싸 부르므로, 줄을 짓다가 바로 던진 출처(번역 함수가
 * 던지는 등)도 거절된 약속 하나가 될 뿐 `map`을 깨뜨리지 않는다. 검사: `image-sources.spec.ts`
 * "한 출처가 던져도 나머지는 선다".
 */
export async function imageSourceRows(
  context: ImageSourceContext,
): Promise<{ rows: ImageSourceRow[]; failures: unknown[] }> {
  const settled = await Promise.allSettled(
    IMAGE_SOURCES.map(async (source) => await source.rows(context)),
  )
  return {
    rows: settled.flatMap((one) => (one.status === 'fulfilled' ? one.value : [])),
    failures: settled.flatMap((one) => (one.status === 'rejected' ? [one.reason] : [])),
  }
}
