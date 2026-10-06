/**
 * [사진 추가] 메뉴에 넘겨줄 **판의 손** (open-decisions.md 67, 계획 2.6).
 *
 * 입력 방식 등록부(`data/image/sources.ts`)는 DOM을 모른다 — 파일 창을 열고 그리기 창을 띄우는
 * 것은 화면이다. 여기가 그 손을 **판 하나에 한 벌** 만든다: 숨은 `<input>` 둘(사진·폴더), 그리기
 * 창 하나, 그림 이름 발급기 하나. 그것으로 지은 `context`를 그 판의 **모든 메뉴**(툴바·빈 상태·범주
 * 칸마다)가 받는다. 메뉴마다 지으면 발급기가 메뉴마다 생겨 다른 칸에서 그린 두 장이 같은
 * `drawn-1.png`가 되고, 확인 판에서 한 범주로 합쳐진다(`sketch.ts`의 `createSketchNamer`).
 * 검사: `image-source-menu.spec.ts` "같은 판에서 두 번 그려도 이름이 안 겹친다".
 *
 * 쓰는 판은 숨은 `<input>` 둘의 `ref`를 넘기고, 두 input의 `@change`·`@cancel`에 `onPicked`를,
 * 그리기 창에 `sketchOpen`·`sketchMounted`·`nameSketch`·`onSketchDone`을 단다.
 */

import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { createSketchNamer } from '@/data/image/sketch'
import type { ImageSourceContext, PickedFiles } from '@/data/image/sources'

export interface ImageSourceHands {
  readonly context: ImageSourceContext
  /** 두 input의 `change`와 `cancel`. 창을 닫았으면(고른 것이 없으면) 아무 일도 없었던 것이다. */
  readonly onPicked: (event: Event) => void
  /** 그리기 창이 떠 있는가. */
  readonly sketchOpen: Ref<boolean>
  /**
   * 그리기 창을 한 번이라도 열었는가. **처음 열 때 붙인다** — 창은 지연 부품이라, 판에 들어오자마자
   * 그리면 그리지도 않을 학생이 그 청크를 받는다(architecture.md §9.2).
   */
  readonly sketchMounted: Ref<boolean>
  /** 그림 파일 이름 발급기. 판이 사는 동안 하나다. */
  readonly nameSketch: () => string
  /** 그리기 창의 `done`. */
  readonly onSketchDone: (files: readonly File[] | null) => void
}

/** 판의 숨은 `<input>` 둘. 판이 템플릿에 달고 넘긴다. */
export interface ImageSourceInputs {
  /** 사진 파일을 고르는 `<input multiple>`. */
  readonly fileInput: Ref<HTMLInputElement | null>
  /** 폴더를 고르는 `<input webkitdirectory>`. */
  readonly folderInput: Ref<HTMLInputElement | null>
}

export function useImageSources({ fileInput, folderInput }: ImageSourceInputs): ImageSourceHands {
  const { t } = useI18n()

  const sketchOpen = ref(false)
  const sketchMounted = ref(false)
  const nameSketch = createSketchNamer()

  /** 기다리는 고르기. 판에 input 창은 한 번에 하나만 뜬다. */
  let picking: ((files: PickedFiles) => void) | null = null
  /** 기다리는 그리기. */
  let sketching: ((files: PickedFiles) => void) | null = null

  /** 받은 묶음. **빈 묶음은 `null`이다** — 고른 것이 없으면 아무 일도 없었던 것이다. */
  const orNull = (files: readonly File[] | null): PickedFiles =>
    files === null || files.length === 0 ? null : files

  function pickFrom(input: HTMLInputElement | null): Promise<PickedFiles> {
    if (input === null) return Promise.resolve(null)
    // 같은 것을 다시 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 안 뜬다.
    input.value = ''
    // **앞의 약속은 `null`로 풀고 새로 건다** — `PortfolioView.vue`의 `pickFile`과 같다. `cancel`이
    // 안 오는 브라우저에서 앞 고르기를 닫고 다시 고르면, 덮어쓴 앞 약속이 영영 안 풀린다. 무는 검사:
    // `image-source-menu.spec.ts` "창을 닫아도 다음 고르기는 정상이다".
    picking?.(null)
    return new Promise((resolve) => {
      picking = resolve
      input.click()
    })
  }

  function onPicked(event: Event): void {
    const input = event.target as HTMLInputElement
    const files = [...(input.files ?? [])]
    input.value = ''
    picking?.(orNull(files))
    picking = null
  }

  function openSketch(): Promise<PickedFiles> {
    sketching?.(null)
    sketchMounted.value = true
    sketchOpen.value = true
    return new Promise((resolve) => {
      sketching = resolve
    })
  }

  function onSketchDone(files: readonly File[] | null): void {
    sketchOpen.value = false
    sketching?.(orNull(files))
    sketching = null
  }

  // **떠나면 기다리는 것을 풀어 준다.** 안 풀면 메뉴의 `await`가 판이 없어진 뒤에도 매달려 있다.
  onBeforeUnmount(() => {
    picking?.(null)
    sketching?.(null)
    picking = null
    sketching = null
  })

  const context: ImageSourceContext = {
    translate: (key: string) => t(key),
    pickFiles: () => pickFrom(fileInput.value),
    pickFolder: () => pickFrom(folderInput.value),
    openSketch,
  }

  return {
    context,
    onPicked,
    sketchOpen,
    sketchMounted,
    nameSketch,
    onSketchDone,
  }
}
