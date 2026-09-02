<script setup lang="ts">
/**
 * **이미지 데이터**의 전처리 작업 공간. 표의 `TabularPrepPanel.vue`에 해당한다.
 *
 * **여기가 표보다 훨씬 짧은 것이 정상이다.** 표가 갖는 것 대부분(타깃·특성 고르기,
 * 결측치, 인코딩, 스케일링)이 이미지에는 **하나도 해당하지 않는다** — 라벨은 데이터
 * 화면에서 폴더로 붙었고, 특성은 백본이 만든다.
 *
 * **비율·씨앗은 슬롯으로 온다** (architecture.md §9.1.1) — `settings.split`이라 모든
 * 종류에 공통이다. 층화만 여기 있는 이유는 **잠기는지와 왜 잠기는지가 이 종류의 라벨
 * 분포에 달려 있어서**다 (§9.1.2). 표는 타깃 열에서, 여기는 범주에서 라벨을 뽑아
 * **같은 함수**에 넘긴다.
 */

import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import { canonicalizeImages } from '@/data/image/client'
import { spawnCanonicalizeWorker } from '@/data/image/spawn'
import { scoresWithTestImages, testSetBlockFor, testZipBlockFor } from '@/data/image/test-set'
import {
  IMAGE_ACCEPT,
  readImageFiles,
  readImageZip,
  type UploadItem,
  ZIP_EXTENSION,
} from '@/data/image/upload'
import { ClientError, isClientError } from '@/errors'
import { FALLBACK_LOCALE, isSupportedLocale } from '@/i18n'
import { backboneFor } from '@/ml/backbones'
import { useRadioGroupGuard } from '@/composables/useRadioGroupGuard'
import { useWork } from '@/composables/useWork'
import { splitsData, stratifyBlockFor, stratifyLocked } from '@/ml/selection'
import { IMAGE_UNLABELED } from '@/project/format'
import { dataSettings } from '@/project/schema'
import { imageRoomShortfall } from '@/data/image/room'
import {
  applyTestImages,
  clearTestImages,
  imageCategories,
  imageOverflow,
  readImages,
} from '@/project/images'
import { withSplit } from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

const { t, locale } = useI18n()

/** 압축 파일 이름을 되살릴 때 쓰는 언어 (`data/zip-names.ts`). */
const uiLocale = computed(() => (isSupportedLocale(locale.value) ? locale.value : FALLBACK_LOCALE))
const project = useProjectStore()
const toasts = useToastStore()

const settings = computed(() => project.file?.document.settings ?? null)

/**
 * 층화 판정에 넘길 라벨.
 *
 * **라벨 없는 사진은 안 센다.** 분류에서 그 사진들은 학습에 안 들어가고, 그건 표에서
 * 타깃이 빈 행이 `usableRows`에서 빠지는 것과 같다 (open-decisions.md "이미지
 * 프로젝트의 데이터 화면"). 함께 세면 화면은 멀쩡한데 [학습하기]가 거부한다.
 */
const labels = computed(() =>
  readImages(project.file)
    .map((entry) => entry.category)
    .filter((category) => category !== IMAGE_UNLABELED),
)

/** **판정은 화면 밖에 있다** — 표와 같은 함수다 (`ml/selection.ts`). */
const stratifyBlockNow = computed(() =>
  stratifyBlockFor(project.taskType, labels.value, settings.value?.nSamples),
)

const stratifyReason = computed(() => {
  const block = stratifyBlockNow.value
  return block === null ? null : t(`client.${block.code}`, block.params ?? {})
})

/** 잠금 규칙도 화면 밖에 있다 (`ml/selection.ts`의 `stratifyLocked`). */
const stratifyDisabled = computed(() =>
  stratifyLocked(stratifyBlockNow.value, settings.value?.split.stratify ?? false),
)

/**
 * 이 프로젝트의 범주. 올라온 사진을 대조할 목록이다.
 *
 * **`imageCategories`가 유일한 출처다.** 범주는 폴더가 갖고 목록과 순서는 `settings`가
 * 갖는데, 둘이 갈리면 폴더가 이긴다 (`open-decisions.md` "범주는 폴더가 갖고, 목록과
 * 순서는 settings가 갖는다"). 그 병합이 `imageCategories`다.
 *
 * **여기서 `settings`만 보면 있는 범주를 "모르는 범주"라 부른다.** 학생이 그 말대로
 * 그 범주를 빼면 통과하는데, 그러면 **그 범주가 하나도 없는 테스트셋으로 채점한다** -
 * 이 자리의 잠금이 막으려던 바로 그 상태다. 게다가 데이터 화면에서 그 이름을 새로
 * 만들려 하면 이미 있다고 막혀서 빠져나갈 길이 없다 (2026-08-30 R12 감사 A-2).
 */
const categories = computed(() => imageCategories(project.file))

/** 이미 올라온 테스트용 사진. 있으면 올리는 자리 대신 지우는 자리가 선다. */
const testPhotos = computed(() => readImages(project.file, 'test').length)

/**
 * 테스트 데이터를 올린 사진이 대고 있는가. **표와 같은 갈림이다** —
 * `TabularPrepPanel`은 `testChoice === 'holdout'`일 때만 비율과 층화를 보여준다.
 *
 * 사진이 있으면 **나눌 것이 없어서 그 둘이 아무 일도 안 한다.** 남겨 두면 학생은
 * 돌려 놓은 비율이 채점에 쓰인다고 읽는다.
 */
const usingProvidedTest = computed(() => testPhotos.value > 0)

/**
 * 올린 사진이 실제로 채점에 쓰이는가. **판정은 화면 밖이다** (`data/image/test-set.ts`) —
 * 화면에서 과제 유형을 직접 비교하지 않는다 (architecture.md §8.10).
 */
const scored = computed(() => scoresWithTestImages(project.taskType))

/**
 * 비율로 나누는 일이 **실제로 일어나는가.** 손잡이(비율·층화)를 보일지가 이 하나로 갈린다.
 *
 * 갈래가 둘인데 이유는 하나다 — 사진을 따로 올렸으면 그걸로 채점하고, 군집화면 아예
 * 안 나눈다(`architecture.md` §3.6). 둘 다 **나눌 것이 없어서 비율과 층화가 아무 일도
 * 안 한다.** 조건에 앞엣것만 있어서 군집화에서는 손잡이가 켜진 채 거짓말을 하고 있었다.
 */
const splitsByRatio = computed(() => splitsData(project.taskType) && testChoice.value === 'holdout')

/**
 * 화면이 지금 보여주는 선택. **커밋 전 임시 선택이 실제 값을 덮는다** —
 * `TabularPrepPanel`이 쓰는 그 방식이다.
 *
 * "②를 골랐지만 아직 안 올림"은 파일에 없는 상태다. 그건 사진을 실제로 구워 앉혀야
 * 생긴다. 그 사이를 이 값이 메운다.
 *
 * **한때 이 판은 라디오를 안 뒀다.** 사진을 올리는 것이 곧 선택이라는 이유였는데,
 * 그러면 **같은 질문을 표와 이미지가 다른 문법으로 묻는다** (2026-08-29, 코드 소유자).
 * 걱정했던 "중간 상태"는 표가 이미 이 방식으로 풀어 두었다.
 */
const manualTestChoice = ref<'holdout' | 'provided' | null>(null)
const testChoice = computed<'holdout' | 'provided'>(
  () => manualTestChoice.value ?? (usingProvidedTest.value ? 'provided' : 'holdout'),
)

/** "①"/"②" 라디오 그룹의 되돌리기 (`architecture.md` §8.15). */
const testChoiceRadios = useRadioGroupGuard<'holdout' | 'provided'>()

/** 지울 실험 수. 되돌릴 때 무엇이 사라지는지 학생에게 말해야 한다. */
const experimentCount = computed(() => project.file?.document.runs.experiments.length ?? 0)

/** 확인 모달이 떠 있는가. */
const testRemoving = ref(false)
const testAttaching = ref(false)

/**
 * 물어보는 동안 들고 있는 사진들. **확인을 받으면 이것을 굽는다.**
 *
 * 굽기 전에 묻는 이유는 `takeTest`의 머리말과 같다 — 굽고 나서 거절당하면 학생은
 * 기다린 시간을 통째로 버린다.
 */
const pendingTest = ref<readonly UploadItem[] | null>(null)

/**
 * "①"을 고른다. **올려 둔 사진이 있으면 그것을 지우는 일이다** — 실험까지 함께
 * 사라지므로 먼저 묻는다. 표가 같은 자리에서 같은 것을 묻는다.
 *
 * **취소하면 그룹을 직접 되돌린다** (`architecture.md` §8.15) — 확인을 거치는 동안
 * `testChoice`는 그대로 `'provided'`라 Vue가 다시 그려도 라디오의 `checked`를 안 써 준다.
 */
function chooseHoldout(): void {
  if (usingProvidedTest.value) {
    testChoiceRadios.resync('provided')
    void requestRemoveTest()
  } else {
    manualTestChoice.value = 'holdout'
  }
}

/** "②"를 고른다. **아직 아무 일도 하지 않는다** — 올리는 자리를 펼칠 뿐이다. */
function chooseProvided(): void {
  manualTestChoice.value = 'provided'
}

/**
 * 올리기 요청. **지울 실험이 있으면 먼저 물어본다** — 표가 같은 자리에서 같은 것을
 * 묻는다 (`TabularPrepPanel`의 `requestApplyTest`).
 *
 * 전에는 여기만 안 묻고 올린 뒤에 "지웠습니다"라고 알렸다. 같은 판의 [지우기]는
 * 묻는데 [올리기]는 안 묻는 상태였다 (2026-08-29 전 경로 감사).
 */
async function requestTakeTest(items: readonly UploadItem[]): Promise<void> {
  if (items.length === 0) return
  if (experimentCount.value > 0) {
    pendingTest.value = items
    testAttaching.value = true
    return
  }
  await takeTest(items)
}

/** 취소. **들고 있던 것을 놓는다** — 사진 파일을 계속 붙들고 있을 이유가 없다. */
function cancelTakeTest(): void {
  testAttaching.value = false
  pendingTest.value = null
}

/** 확인을 받았다. 들고 있던 것을 굽는다. */
async function confirmTakeTest(): Promise<void> {
  const items = pendingTest.value
  if (!items) return
  testAttaching.value = false
  pendingTest.value = null
  await takeTest(items)
}

/** 되돌리기 요청. 지울 실험이 있으면 먼저 물어본다. */
async function requestRemoveTest(): Promise<void> {
  if (experimentCount.value > 0) {
    testRemoving.value = true
    return
  }
  await removeTest()
}

/**
 * 자리 자체의 잠금. **판정은 화면 밖에 있다** (`data/image/test-set.ts`) —
 * 규칙은 `open-decisions.md` "테스트용 zip (`split.method = 'provided'`)"이 갖는다.
 */
const testBlock = computed(() => testSetBlockFor(categories.value))

const testReason = computed(() => {
  const block = testBlock.value
  return block === null ? null : t(`client.${block.code}`, block.params ?? {})
})

/** 지금 이 화면에서 도는 일들 (architecture.md §8.10.4). */
const { busy, start, cancelAll } = useWork()

// **떠나면 굽던 것을 끊는다.** 이미지 판들이 전부 같은 규칙이다.
onBeforeUnmount(cancelAll)

/**
 * 사진을 받는 자리가 잠겼는가. **템플릿에서 조립하지 않는다** (architecture.md §10) —
 * 조건이 둘이 되는 순간이 이름을 붙일 순간이다. 이유는 위 `testReason`이 따로 말한다.
 */
const testDisabled = computed(() => testBlock.value !== null || busy.value)

/**
 * 테스트용 사진을 받는다.
 *
 * **범주를 먼저 대조하고 그다음에 굽는다.** 굽고 나서 거절하면 학생은 기다린 시간을
 * 통째로 버린다 — 장수·자리 상한을 굽기 전에 묻는 것과 같은 이유다.
 */
async function takeTest(items: readonly UploadItem[]): Promise<void> {
  const file = project.file
  if (!file || busy.value || items.length === 0) return

  const job = start()
  try {
    const block = testZipBlockFor(
      categories.value,
      items.map((item) => item.category),
    )
    if (block) {
      toasts.push('caution', `client.${block.code}`, block.params ?? {})
      return
    }

    const backbone = backboneFor(dataSettings('image', file.document.settings).backboneId)
    if (!backbone) throw new ClientError('BACKBONE_UNAVAILABLE')

    const overflow = imageOverflow(file, items.length, 'test')
    if (overflow) throw new ClientError('IMAGE_TOO_MANY_PHOTOS', { ...overflow })

    const shortfall = await imageRoomShortfall(file, items.length, backbone)
    if (shortfall) throw new ClientError('IMAGE_PHOTOS_EXCEED_STORAGE', { ...shortfall })

    // **손잡이를 버리지 않는다.** 버리면 학생이 굽는 도중에 다른 단계로 갔을 때 아무도
    // 안 듣는 워커가 계속 돈다 — 저사양 교실 PC가 기준이다 (R21, §8.10.4).
    const baking = canonicalizeImages(
      items.map((item) => item.file),
      { createWorker: spawnCanonicalizeWorker, size: backbone.canonicalSize },
    )
    job.hold(baking)
    const baked = await baking.result

    const byPath = new Map(items.map((item) => [item.path, item.category]))
    // **굽는 동안 파일이 달라졌을 수 있다** — 지금 파일에 얹는다 (architecture.md §8.10.3).
    let counts = { added: 0, droppedExperiments: 0 }
    await project.save((live) => {
      const applied = applyTestImages(
        live,
        baked.images.map((image) => ({
          hash: image.hash,
          bytes: image.bytes,
          category: byPath.get(image.sourceName) ?? IMAGE_UNLABELED,
        })),
        {
          canonicalSize: backbone.canonicalSize,
          now: new Date().toISOString(),
          format: baked.format,
        },
      )
      counts = { added: applied.added, droppedExperiments: applied.droppedExperiments }
      return applied.project
    })

    toasts.push('success', 'preprocess.testImagesAdded', { count: counts.added })
    // **조용히 지우지 않는다.** 테스트 데이터가 바뀌면 그 위의 점수는 다른 것을 잰 값이다.
    if (counts.droppedExperiments > 0) {
      toasts.push('caution', 'preprocess.testImagesDropped', {
        count: counts.droppedExperiments,
      })
    }
    if (baked.skipped.length > 0) {
      toasts.push('caution', 'data.image.skipped', { count: baked.skipped.length })
    }
  } catch (error) {
    // **끊은 것은 실패가 아니다.** 굽는 중에 학생이 다른 단계로 가면 `cancelAll()`이
    // 워커를 끊고 그 거절이 여기로 온다 — 학생이 스스로 한 일이라 알릴 것이 없고,
    // 게다가 그 알림은 다음 화면에서 **"학습을 멈췄습니다"**라고 말한다(굽기는 학습이
    // 아니고, 여기는 학습 화면도 아니다). 이미지 판 넷이 같은 자리를 이렇게 다룬다.
    if (isClientError(error) && error.code === 'JOB_CANCELLED') return
    toasts.pushError(error)
  } finally {
    job.done()
  }
}

/**
 * 들어온 파일을 읽어 넘긴다. **입구가 셋이어도 읽는 자리는 하나다** — 압축 파일 고르기,
 * 폴더 고르기, 끌어다 놓기가 전부 여기로 온다.
 */
async function readTest(files: readonly File[]): Promise<void> {
  if (files.length === 0) return

  try {
    const single = files[0]
    // **압축 파일과 사진 파일을 같은 함수가 가른다** (`data/image/upload.ts`의 IMAGE_ACCEPT).
    const items =
      files.length === 1 && single && single.name.toLowerCase().endsWith(ZIP_EXTENSION)
        ? await readImageZip(new Uint8Array(await single.arrayBuffer()), IMAGE_UNLABELED, {
            locale: uiLocale.value,
            // **여기서는 추측이 0이다.** 채점하려면 어차피 범주가 정확히 같아야 하므로
            // (`test-set.ts`), 그 목록이 곧 어느 인코딩인지의 증거다.
            expect: categories.value,
          })
        : readImageFiles(files)
    await requestTakeTest(items)
  } catch (error) {
    toasts.pushError(error)
  }
}

function onTestPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // 같은 것을 다시 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 안 뜬다.
  input.value = ''
  void readTest(files)
}

/** 끌어다 놓는 중인가. 데이터 화면의 드롭존과 같은 표시다. */
const dragging = ref(false)

const zipInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)

/**
 * **고르는 입구가 둘인 이유는 폴더가 필수여서다.** 범주는 폴더 이름에서 나오므로
 * (`data/image/upload.ts`의 `categoryOf`) 사진을 낱개로 고르면 전부 범주 없음이 되어
 * `TEST_IMAGES_UNLABELED`로 거절당한다 — 학생이 고를 수 있는 길만 남긴다.
 *
 * 데이터 화면이 [사진 추가]와 [폴더에서 추가]를 나눠 둔 것과 같은 갈림이고,
 * 여기서는 낱개 자리에 압축 파일이 선다.
 */
function pick(input: HTMLInputElement | null): void {
  input?.click()
}

/** 떨어뜨린 것. 압축 파일 하나이거나, 폴더째 끌어온 사진들이다. */
function onTestDrop(event: DragEvent): void {
  dragging.value = false
  void readTest([...(event.dataTransfer?.files ?? [])])
}

/**
 * 테스트용 사진을 전부 떼고 분할로 되돌린다.
 *
 * **실패를 삼키지 않는다.** 여기만 `try`가 없어서, 저장이 실패하면 아무것도 안 뜨는
 * 채로 경고창이 열려 있었다 — 표 쪽 셋과 같은 모양으로 맞춘다 (전 경로 감사).
 */
async function removeTest(): Promise<void> {
  const file = project.file
  if (!file) return

  const job = start()
  try {
    await project.save((live) => clearTestImages(live, new Date().toISOString()))
    manualTestChoice.value = 'holdout'
  } catch (error) {
    toasts.pushError(error)
  } finally {
    job.done()
    // **창은 성공하든 실패하든 닫는다.** 이유는 `TabularPrepPanel`의 `applyTest`와 같다.
    testRemoving.value = false
  }
}

/**
 * 체크박스는 **DOM을 파일 값으로 다시 쓴다** (architecture.md §8.15.1). 눌린 것이
 * 곧 값이 아니라, 값이 바뀐 결과가 눌린 상태다.
 */
function onStratify(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = project.file
  if (file) {
    project.update((live) => ({
      ...live,
      document: withSplit(
        live.document,
        { stratify: !live.document.settings.split.stratify },
        new Date().toISOString(),
      ),
    }))
  }
  input.checked = project.file?.document.settings.split.stratify ?? false
}
</script>

<template>
  <div v-if="settings" class="flex flex-col gap-5">
    <!--
      **테스트 데이터를 어디서 받나는 종류별이다** (architecture.md §9.1.1).
      표는 라디오로 갈래를 묻지만 여기는 안 묻는다 — **사진을 올리면 그것이 곧 선택이고,
      지우면 분할로 돌아온다.** 라디오를 두면 "②를 골랐지만 아직 안 올림"이라는 상태가
      하나 더 생기는데, 사진에는 표의 미리보기·머리글 같은 중간 단계가 없다.

      **할 일 목록에는 안 올린다** (open-decisions.md "이미지 전처리의 할 일은 없다,
      그리고 테스트용 zip이 와도 안 생긴다"). 테스트 데이터는 언제나 선택이라 언제나 체크된
      항목이 되고, 그건 학생에게 아무것도 안 알려 준다.
    -->
    <section class="rounded-panel border border-line bg-surface p-4">
      <h2 class="font-bold">{{ t('preprocess.testDataTitle') }}</h2>
      <!--
        **머리말이 상태를 따라간다.** 군집화는 나누지 않으므로(architecture.md §3.6)
        "점수는 이 데이터로 매깁니다"가 그 자리에서 거짓이 된다.
      -->
      <p class="mt-1 text-ink-soft">
        {{
          t(
            splitsData(project.taskType)
              ? 'preprocess.testDataLead'
              : 'preprocess.testDataClustering',
          )
        }}
      </p>

      <!--
        **양자택일이고 라디오로 묻는다** — 표와 같은 문법이다 (`TabularPrepPanel`).

        한때 여기는 안 물었다. 사진을 올리는 것이 곧 선택이고 지우면 분할로 돌아오니
        라디오가 군더더기라는 이유였는데, **그러면 같은 질문을 두 종류가 다른 문법으로
        묻는다** (2026-08-29, 코드 소유자). 걱정했던 "②를 골랐지만 아직 안 올림"이라는
        중간 상태는 표가 이미 `manualTestChoice`로 풀어 두었다.

        **군집화면 이 갈래 자체가 없다** — 나누지 않으므로 어느 쪽도 뜻이 없고, 그
        사실은 위 머리말이 말한다.
      -->
      <div v-if="scored" class="mt-3 flex flex-col gap-4">
        <div>
          <label class="flex cursor-pointer items-start gap-2">
            <input
              :ref="testChoiceRadios.register('holdout')"
              type="radio"
              name="image-test-data-choice"
              class="mt-1 size-4 accent-brand"
              :checked="testChoice === 'holdout'"
              @change="chooseHoldout"
            />
            <span class="flex flex-col">
              <span class="font-bold">{{ t('preprocess.testDataHoldout') }}</span>
              <span class="text-ink-faint">{{ t('preprocess.testDataImageHoldoutNote') }}</span>
            </span>
          </label>

          <div v-if="splitsByRatio" class="mt-3 ml-6 flex flex-col gap-4">
            <slot name="split-ratio" />

            <div>
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  class="size-4 accent-brand"
                  :checked="settings.split.stratify"
                  :disabled="stratifyDisabled"
                  @change="onStratify"
                />
                <span class="font-bold">{{ t('preprocess.stratify') }}</span>
              </label>
              <!-- 이유 없이 회색이면 고장으로 보이고, 켜진 채 걸린 것은 학생이 꺼야 한다. -->
              <p v-if="stratifyReason" class="mt-1 ml-6 text-caution">{{ stratifyReason }}</p>
            </div>
          </div>
        </div>

        <div>
          <label class="flex cursor-pointer items-start gap-2">
            <input
              :ref="testChoiceRadios.register('provided')"
              type="radio"
              name="image-test-data-choice"
              class="mt-1 size-4 accent-brand"
              :checked="testChoice === 'provided'"
              @change="chooseProvided"
            />
            <span class="flex flex-col">
              <span class="font-bold">{{ t('preprocess.testDataImageProvided') }}</span>
              <span class="text-ink-faint">{{ t('preprocess.testDataImageProvidedNote') }}</span>
            </span>
          </label>

          <div v-if="testChoice === 'provided'" class="mt-3 ml-6">
            <template v-if="testPhotos > 0">
              <p class="text-ink-soft">
                {{ t('preprocess.testImagesUsing', { count: testPhotos }) }}
              </p>
              <!-- **되돌리는 것도 먼저 묻는다** — 실험이 함께 사라진다. -->
              <AppButton variant="secondary" class="mt-3" :action="requestRemoveTest">
                {{ t('preprocess.testImagesRemove') }}
              </AppButton>
            </template>

            <template v-else>
              <!--
                **잠기는 자리에는 이유가 함께 있다** (architecture.md §9.4). 범주가 서기
                전에는 대조할 목록이 없어서 어떤 사진도 판정할 수 없다.
              -->
              <p v-if="testReason" class="text-caution">{{ testReason }}</p>

              <!--
                **데이터 화면과 같은 드롭존이다** (`views/data/ImagePanel.vue`). 파일
                입력을 날것으로 두면 브라우저마다 다른 회색 버튼이 나오고, 학생이 이미
                데이터 화면에서 익힌 "끌어다 놓으면 된다"가 여기서만 안 통한다.
              -->
              <div
                class="mt-3 grid place-items-center gap-3 rounded-panel border-2 border-dashed px-4 py-6 text-center transition-colors"
                :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface'"
                @dragover.prevent="dragging = true"
                @dragleave="dragging = false"
                @drop.prevent="onTestDrop"
              >
                <div>
                  <p class="font-bold">{{ t('preprocess.testImagesDrop') }}</p>
                  <p class="mt-1 text-ink-soft">{{ t('preprocess.testImagesDropNote') }}</p>
                </div>
                <div class="flex flex-wrap justify-center gap-2">
                  <AppButton
                    variant="secondary"
                    :disabled="testDisabled"
                    @click="pick(folderInput)"
                  >
                    {{ t('preprocess.testImagesAddFolder') }}
                  </AppButton>
                  <AppButton variant="secondary" :disabled="testDisabled" @click="pick(zipInput)">
                    {{ t('preprocess.testImagesAdd') }}
                  </AppButton>
                </div>
              </div>

              <input
                ref="zipInput"
                type="file"
                class="hidden"
                :accept="ZIP_EXTENSION"
                @change="onTestPick"
              />
              <!--
                **폴더째 고르는 입구를 따로 둔다** — 데이터 화면과 같은 이유다. 같은
                input에 `webkitdirectory`를 걸면 파일 하나만 고르는 길이 사라진다.
              -->
              <input
                ref="folderInput"
                type="file"
                webkitdirectory
                class="hidden"
                :accept="IMAGE_ACCEPT"
                @change="onTestPick"
              />
            </template>
          </div>
        </div>
      </div>

      <!--
        **군집화인데 사진이 올라와 있으면 지울 길이 있어야 한다.** 위 갈래가 통째로
        사라지므로, 여기가 없으면 학생은 안 쓰이는 사진을 안은 채 뺄 방법이 없다
        (R11 감사 B-3이 "권유하지 않는다"로 정한 것은 **없을 때** 이야기다).
      -->
      <div v-else-if="testPhotos > 0" class="mt-3">
        <h3 class="font-bold">{{ t('preprocess.testImagesTitle') }}</h3>
        <p class="mt-1 text-ink-soft">{{ t('preprocess.testImagesClustering') }}</p>
        <AppButton variant="secondary" class="mt-3" :action="requestRemoveTest">
          {{ t('preprocess.testImagesRemove') }}
        </AppButton>
      </div>

      <div class="mt-4">
        <slot />
      </div>
    </section>
  </div>

  <!--
    **올릴 때도 실험이 함께 사라진다.** 전에는 이 자리만 안 묻고 올린 뒤에 알렸다 —
    같은 판의 [지우기]는 묻는데 [올리기]는 안 묻는 상태였다(전 경로 감사). 설명문은
    표와 같은 것을 쓴다(`preprocess.testDataAttachDescription`) — 사라지는 것도
    사라지는 이유도 종류를 안 가린다.
  -->
  <AppDialog
    :open="testAttaching"
    :title="t('preprocess.testImagesAttachTitle')"
    :description="t('preprocess.testDataAttachDescription', experimentCount)"
    @close="cancelTakeTest"
  >
    <template #actions>
      <AppButton variant="secondary" @click="cancelTakeTest">
        {{ t('common.cancel') }}
      </AppButton>
      <AppButton variant="danger" :disabled="busy" :action="confirmTakeTest">
        {{ t('preprocess.testImagesAttachConfirm') }}
      </AppButton>
    </template>
  </AppDialog>

  <!--
    **되돌리면 실험이 함께 사라진다.** 표가 같은 자리에서 같은 것을 묻는다
    (`TabularPrepPanel`의 `testDataRemoveTitle`). 라디오로 바꾸면서 필요해졌다 —
    예전에는 `테스트용 사진 지우기`라는 이름 붙은 버튼이 유일한 길이었지만, 이제는
    ①을 누르는 것이 곧 지우는 일이다.
  -->
  <AppDialog
    :open="testRemoving"
    :title="t('preprocess.testImagesRemoveTitle')"
    :description="t('preprocess.testDataRemoveDescription', experimentCount)"
    @close="testRemoving = false"
  >
    <template #actions>
      <AppButton variant="secondary" @click="testRemoving = false">
        {{ t('common.cancel') }}
      </AppButton>
      <AppButton variant="danger" :disabled="busy" :action="removeTest">
        {{ t('preprocess.testImagesRemoveConfirm') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
