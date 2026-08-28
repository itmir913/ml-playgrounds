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

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { canonicalizeImages } from '@/data/image/client'
import { spawnCanonicalizeWorker } from '@/data/image/spawn'
import { testSetBlockFor, testZipBlockFor } from '@/data/image/test-set'
import {
  IMAGE_ACCEPT,
  readImageFiles,
  readImageZip,
  type UploadItem,
  ZIP_EXTENSION,
} from '@/data/image/upload'
import { ClientError } from '@/errors'
import { backboneFor } from '@/ml/backbones'
import { stratifyBlockFor, stratifyLocked } from '@/ml/selection'
import { IMAGE_UNLABELED } from '@/project/format'
import { dataSettings } from '@/project/schema'
import { imageRoomShortfall } from '@/data/image/room'
import { applyTestImages, clearTestImages, imageOverflow, readImages } from '@/project/images'
import { withSplit } from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

const { t } = useI18n()
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

/** 이 프로젝트의 범주. 올라온 사진을 대조할 목록이다. */
const categories = computed(() =>
  settings.value === null ? [] : dataSettings('image', settings.value).categories,
)

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
 * 자리 자체의 잠금. **판정은 화면 밖에 있다** (`data/image/test-set.ts`) —
 * 규칙은 `open-decisions.md` "평가용 zip (`split.method = 'provided'`)"이 갖는다.
 */
const testBlock = computed(() => testSetBlockFor(categories.value))

const testReason = computed(() => {
  const block = testBlock.value
  return block === null ? null : t(`client.${block.code}`, block.params ?? {})
})

const busy = ref(false)

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

  busy.value = true
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

    const baked = await canonicalizeImages(
      items.map((item) => item.file),
      { createWorker: spawnCanonicalizeWorker, size: backbone.canonicalSize },
    ).result

    const byPath = new Map(items.map((item) => [item.path, item.category]))
    const applied = applyTestImages(
      file,
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
    await project.save(applied.project)

    toasts.push('success', 'preprocess.testImagesAdded', { count: applied.added })
    // **조용히 지우지 않는다.** 평가셋이 바뀌면 그 위의 점수는 다른 것을 잰 값이다.
    if (applied.droppedExperiments > 0) {
      toasts.push('caution', 'preprocess.testImagesDropped', {
        count: applied.droppedExperiments,
      })
    }
    if (baked.skipped.length > 0) {
      toasts.push('caution', 'data.image.skipped', { count: baked.skipped.length })
    }
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
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
        ? await readImageZip(new Uint8Array(await single.arrayBuffer()))
        : readImageFiles(files)
    await takeTest(items)
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

/** 테스트용 사진을 전부 떼고 분할로 되돌린다. */
async function removeTest(): Promise<void> {
  const file = project.file
  if (!file) return
  await project.save(clearTestImages(file, new Date().toISOString()))
}

/**
 * 체크박스는 **DOM을 파일 값으로 다시 쓴다** (architecture.md §8.15.1). 눌린 것이
 * 곧 값이 아니라, 값이 바뀐 결과가 눌린 상태다.
 */
function onStratify(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = project.file
  if (file) {
    project.update({
      ...file,
      document: withSplit(
        file.document,
        { stratify: !file.document.settings.split.stratify },
        new Date().toISOString(),
      ),
    })
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
      그리고 평가용 zip이 와도 안 생긴다). 테스트 데이터는 언제나 선택이라 언제나 체크된
      항목이 되고, 그건 학생에게 아무것도 안 알려 준다.
    -->
    <section class="rounded-panel border border-line bg-surface p-4">
      <h2 class="font-bold">{{ t('preprocess.testDataTitle') }}</h2>
      <p class="mt-1 text-ink-soft">{{ t('preprocess.testDataLead') }}</p>

      <!--
        **넓은 화면에서는 두 열이고 가르는 것은 점선이다** (architecture.md §8.12).
        비율로 나누는 것과 사진을 따로 올리는 것은 **같은 자리를 두고 갈리는 두 갈래**라,
        학습 화면·결과 화면이 쓰는 그 문법을 그대로 쓴다. 선 좌우 여백은 카드 안쪽
        여백과 같은 4다.

        **사진이 대고 있으면 왼쪽이 통째로 사라지고 한 열이 된다** — 나눌 것이 없어서
        비율과 층화가 아무 일도 안 하기 때문이고(표도 같은 자리에서 같은 것을 감춘다),
        가를 것이 하나뿐이므로 점선도 함께 걷는다.
      -->
      <div class="mt-3 grid gap-4" :class="usingProvidedTest ? '' : 'md:grid-cols-2'">
        <div v-if="!usingProvidedTest" class="flex flex-col gap-4">
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

        <div
          :class="
            usingProvidedTest
              ? ''
              : 'border-t border-dashed border-line pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-4'
          "
        >
          <h3 class="font-bold">{{ t('preprocess.testImagesTitle') }}</h3>

          <template v-if="testPhotos > 0">
            <p class="mt-1 text-ink-soft">
              {{ t('preprocess.testImagesUsing', { count: testPhotos }) }}
            </p>
            <AppButton variant="secondary" class="mt-3" :action="removeTest">
              {{ t('preprocess.testImagesRemove') }}
            </AppButton>
          </template>

          <template v-else>
            <p class="mt-1 text-ink-soft">{{ t('preprocess.testImagesLead') }}</p>
            <!--
              **잠기는 자리에는 이유가 함께 있다** (architecture.md §9.4). 범주가 서기
              전에는 대조할 목록이 없어서 어떤 사진도 판정할 수 없다.
            -->
            <p v-if="testReason" class="mt-1 text-caution">{{ testReason }}</p>

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
                <AppButton variant="secondary" :disabled="testDisabled" @click="pick(folderInput)">
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

      <div class="mt-4">
        <slot />
      </div>
    </section>
  </div>
</template>
