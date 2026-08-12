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

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { stratifyBlockFor, stratifyLocked } from '@/ml/selection'
import { IMAGE_UNLABELED } from '@/project/format'
import { readImages } from '@/project/images'
import { withSplit } from '@/project/settings'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const settings = computed(() => project.file?.document.settings ?? null)

/**
 * 층화 판정에 넘길 라벨.
 *
 * **라벨 없는 사진은 안 센다.** 분류에서 그 사진들은 학습에 안 들어가고, 그건 표에서
 * 타깃이 빈 행이 `usableRows`에서 빠지는 것과 같다 (open-decisions.md "이미지
 * 프로젝트의 데이터 화면"). 함께 세면 화면은 멀쩡한데 [학습]이 거부한다.
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
      **평가 데이터를 어디서 받나는 종류별이다** (architecture.md §9.1.1).
      **지금은 갈래가 하나뿐이라 고르게 하지 않는다** — 사진 꾸러미로 평가 데이터를 받는
      길은 V4의 마지막에 붙는다 (open-decisions.md "평가용 zip"). 선택지가 하나면 묻지
      않는 것이 이 저장소의 규칙이고, 라디오 하나짜리 양자택일은 고르는 시늉일 뿐이다.
    -->
    <section class="rounded-panel border border-line bg-surface p-4">
      <h2 class="font-bold">{{ t('preprocess.testDataTitle') }}</h2>
      <p class="mt-1 text-ink-soft">{{ t('preprocess.testDataLead') }}</p>

      <div class="mt-3 flex flex-col gap-4">
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

        <slot />
      </div>
    </section>
  </div>
</template>
