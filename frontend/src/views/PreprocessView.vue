<script setup lang="ts">
/**
 * preprocess 단계 — **데이터 얘기만 한다.**
 *
 * 타깃·특성·결측치·스케일링·인코딩·분할이 전부이고 모델은 없다 (architecture.md §8.2).
 * 타깃과 특성은 **데이터의 성질**이라 분류인지 회귀인지와 무관하게 정해진다 — 모델을
 * 골라야 열을 고를 수 있다면 워크플로가 거꾸로 선다. 유형이 좁히는 것은 모델 목록이고
 * 그래서 학습 화면에 있다
 * (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
 *
 * **원본은 안 건드린다.** 정본 `dataset/data.csv`는 가져오기 시점에 확정된 뒤 아무도
 * 손대지 않고, 변환은 학습할 때 메모리에서만 일어난다. 파일에 남는 것은 변환된 데이터가
 * 아니라 파라미터다 (`ml/preprocess.ts`). 그래서 스케일링을 켰다 꺼도 되돌아온다.
 *
 * **판단은 전부 이 파일 밖에 있다** — 열 판정은 `ml/selection.ts`, 설정 고치기는
 * `project/settings.ts`다. 여기서 하는 일은 이어 붙이는 것뿐이다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useFormat } from '@/composables/useFormat'
import { dataKindFor } from '@/data/kinds'
import { newRandomState } from '@/project/create'
import { readDataset } from '@/project/dataset'
import type { ProjectDocument } from '@/project/schema'
import { withRandomState, withSplit } from '@/project/settings'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()

/** 평가용 비율 슬라이더의 눈금. 스키마는 0과 1 사이면 받는다. */
const TEST_SIZE = { min: 0.05, max: 0.5, step: 0.05 }

const settings = computed(() => project.file?.document.settings ?? null)

/**
 * 이 프로젝트의 데이터 종류를 다루는 판 (`data/kinds.ts`).
 *
 * **여기서 종류를 보지 않는다** (architecture.md §9.1). 등록부에 줄이 없으면 아직 못
 * 다루는 종류이고, 그때는 데이터 화면이 이미 그 사실을 말했다.
 */
const kind = computed(() => dataKindFor(project.file?.document.manifest.dataType ?? ''))

/** 정본을 파싱한 표. 바이트가 같으면 다시 파싱하지 않는다 (project/dataset.ts). */
const dataset = computed(() => readDataset(project.file))

function apply(next: ProjectDocument): void {
  const file = project.file
  if (file) project.update({ ...file, document: next })
}

function now(): string {
  return new Date().toISOString()
}

function onTestSize(event: Event): void {
  const file = project.file
  if (!file) return
  const testSize = Number((event.target as HTMLInputElement).value)
  apply(withSplit(file.document, { testSize }, now()))
}

/**
 * 씨앗을 다시 뽑기 전에 한 번 막는다
 * (`open-decisions.md` "난수 씨앗은 고정이 기본이고, 다시 뽑는 것은 경고 뒤에 준다").
 *
 * **누르자마자 바뀌면 안 된다.** 되돌릴 수 없고, 지금까지의 실험과 점수를 나란히
 * 비교할 수 없게 되는 조작이다.
 */
const reseeding = ref(false)

function reseed(): void {
  const file = project.file
  reseeding.value = false
  if (!file) return
  apply(withRandomState(file.document, newRandomState(), now()))
}
</script>

<template>
  <div v-if="settings && dataset" class="flex flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.preprocess.label')" :purpose="t('steps.preprocess.purpose')">
      <template #context>
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('data.rows') }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums text-ink">{{ dataset.rows.length }}</dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('data.columns') }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums text-ink">{{ dataset.columns.length }}</dd>
        </div>
      </template>
    </StepHeader>

    <StepChecklist step="preprocess" />

    <!--
      **무엇을 그릴지 여기서 정하지 않는다** (architecture.md §9.1). 표의 열 고르기와
      정리하기와 **평가 데이터 받기**는 `data/kinds.ts`의 판이 갖고, 이 화면은 그 판을
      하나 그린다.

      **슬롯으로 내려가는 것은 "얼마나 나눌 것인가"뿐이다** (§9.1.1) — 비율·층화·씨앗은
      `settings.split`이라 모든 종류에 공통이고, "무엇을 어디서 받나"는 종류마다 다르다.
    -->
    <component :is="kind.prepPanel" v-if="kind">
      <!-- 나눌 비율. 판이 층화 위에 놓는다 (architecture.md 9.1.2). -->
      <template #split-ratio>
        <div>
          <!--
              **이름과 값은 기준선으로 맞춘다.** items-center는 글자가 아니라 상자를
              맞추므로, 값이 길어져 이름이 두 줄로 접히면 한 줄짜리 값이 두 줄 높이의
              가운데로 떠서 첫 줄보다 위에 놓인다. 영어는 같은 이름이 30% 정도 길어
              한국어에서 안 접히는 폭에서도 접힌다.
            -->
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.testSize') }}</h3>
            <output class="font-bold tabular-nums">
              {{ format.percent(settings.split.testSize) }}
            </output>
          </div>
          <input
            type="range"
            class="mt-1.5 w-full accent-brand"
            :min="TEST_SIZE.min"
            :max="TEST_SIZE.max"
            :step="TEST_SIZE.step"
            :value="settings.split.testSize"
            :aria-label="t('preprocess.testSize')"
            @input="onTestSize"
          />
          <p class="mt-1 text-ink-faint">{{ t('preprocess.testSizeNote') }}</p>
        </div>
      </template>

      <!-- 난수 씨앗. 판이 층화 아래에 놓는다. -->
      <div>
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 class="font-bold text-ink-soft">{{ t('preprocess.randomState') }}</h3>
          <span class="tabular-nums">{{ settings.split.randomState }}</span>
        </div>
        <p class="mt-1 text-ink-faint">{{ t('preprocess.randomStateNote') }}</p>
        <AppButton class="mt-2" variant="secondary" @click="reseeding = true">
          {{ t('preprocess.reseed') }}
        </AppButton>
      </div>
    </component>

    <!--
      **누르자마자 바뀌지 않는다.** 되돌릴 수 없고 지금까지의 실험과 점수를 나란히
      비교할 수 없게 되는 조작이다 (§8.2).
    -->
    <AppDialog
      :open="reseeding"
      :title="t('preprocess.reseedTitle')"
      :description="t('preprocess.reseedDescription')"
      @close="reseeding = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="reseeding = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="danger" @click="reseed">{{ t('preprocess.reseedConfirm') }}</AppButton>
      </template>
    </AppDialog>
  </div>

  <AppEmpty v-else :reason="t('preprocess.emptyReason')" :next="t('preprocess.emptyNext')" />
</template>
