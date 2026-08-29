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

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useFormat } from '@/composables/useFormat'
import { dataKindFor, stepTextKey } from '@/data/kinds'
import { newRandomState } from '@/project/create'
import { dataSettings, type ProjectDocument } from '@/project/schema'
import { withRandomState, withSplit } from '@/project/settings'
import { TEST_SIZE_RANGE } from '@/limits'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()

const settings = computed(() => project.file?.document.settings ?? null)

/**
 * 이 프로젝트의 데이터 종류를 다루는 판 (`data/kinds.ts`).
 *
 * **여기서 종류를 보지 않는다** (architecture.md §9.1). 등록부에 줄이 없으면 아직 못
 * 다루는 종류이고, 그때는 데이터 화면이 이미 그 사실을 말했다.
 */
const kind = computed(() => dataKindFor(project.file?.document.manifest.dataType ?? ''))

/**
 * 이 단계의 설명문. **등록부가 준다** (architecture.md §8.10) — 공통 자리에 두었더니
 * 표의 말("데이터를 다듬습니다")이 이미지 화면에도 떴다. 이미지에는 다듬을 것이 없다.
 */
const purpose = computed(() => stepTextKey(kind.value, 'preprocess', 'purpose'))

/**
 * 아직 데이터가 없을 때의 문장. **이것도 등록부가 준다** — 공통 자리에 두었더니
 * 이미지 프로젝트에 "파일을 불러오면 무엇을 예측할지 고를 수 있습니다"가 떴다.
 * 이미지에는 불러오기도 타깃 고르기도 없다.
 */
const emptyReason = computed(() => stepTextKey(kind.value, 'preprocess', 'emptyReason'))
const emptyNext = computed(() => stepTextKey(kind.value, 'preprocess', 'emptyNext'))

/**
 * 정본이 앉았는가. **종류를 안 묻는다** — 세 종류가 다 `settings.data.dataset`을 갖고,
 * 그것이 없으면 아직 전처리할 것이 없다는 뜻이 종류를 가리지 않고 같다.
 *
 * 예전에는 이 자리가 "표가 파싱되는가"였다. 그러면 이미지 프로젝트는 **영원히 빈
 * 화면**이고, 그 사실이 컴파일에서도 검사에서도 안 드러난다.
 */
const hasData = computed(() => {
  const file = project.file
  if (!file) return false
  return dataSettings(file.document.manifest.dataType, file.document.settings).dataset !== undefined
})

function apply(next: ProjectDocument): void {
  const file = project.file
  if (file) project.update({ ...file, document: next })
}

function now(): string {
  return new Date().toISOString()
}

/**
 * 끄는 동안의 값. **저장된 값과 따로 둔다.**
 *
 * 슬라이더를 잡고 끄는 내내 설정을 고치면 두 가지가 매 프레임 일어난다 — 프로젝트가
 * IndexedDB에 저장되고, **전처리 요약이 `fitPreprocessor`를 다시 돌린다.** 5천 행 ×
 * 수십 열이면 저사양 교실 PC에서 눈에 띄게 끊긴다.
 *
 * 그렇다고 `@change`로 옮기기만 하면 **끄는 동안 옆의 퍼센트가 굳어** 고장으로 보인다.
 * 그래서 표시는 여기가, 저장과 계산은 손을 뗄 때가 맡는다.
 */
const dragging = ref<number | null>(null)

/**
 * 화면에 뜨는 비율. 끄는 중이면 그 값이고, 아니면 저장된 값이다.
 *
 * **슬라이더의 `value`도 이것을 봐야 한다.** 저장된 값에 묶어 두면 끄는 동안 잔상이
 * 생긴다 — `dragging`이 바뀔 때마다 다시 그려지고, 그때 Vue가 DOM의 `value`를 **저장된
 * 값으로 되돌려 놓기** 때문이다. 손잡이가 원래 자리로 튀었다가 마우스 위치로 돌아온다.
 */
const shownTestSize = computed(() => dragging.value ?? settings.value?.split.testSize ?? 0)

function onTestSizeInput(event: Event): void {
  dragging.value = Number((event.target as HTMLInputElement).value)
}

/** 손을 뗐다. 여기서만 저장한다. */
function onTestSizeChange(event: Event): void {
  const file = project.file
  dragging.value = null
  if (!file) return
  const testSize = Number((event.target as HTMLInputElement).value)
  // 안 움직였어도 change는 뜬다. 그때 저장하면 안 바뀐 값으로 파일의 시각만 새로 찍힌다.
  if (testSize === file.document.settings.split.testSize) return
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
  <div v-if="kind && settings && hasData" class="flex flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.preprocess.label')" :purpose="t(purpose)">
      <!--
        **무엇을 셀지 이 화면이 모른다** (architecture.md §9.3.2). 여기 "열 수"가 박혀
        있었는데 이미지에는 열이 없다 — 종류별 문맥은 등록부가 갖는다.
      -->
      <template #context>
        <component :is="kind.prepContext" v-if="kind" />
      </template>
    </StepHeader>

    <StepChecklist step="preprocess" />

    <!--
      **무엇을 그릴지 여기서 정하지 않는다** (architecture.md §9.1). 표의 열 고르기와
      정리하기와 **테스트 데이터 받기**는 `data/kinds.ts`의 판이 갖고, 이 화면은 그 판을
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
              {{ format.percent(shownTestSize) }}
            </output>
          </div>
          <input
            type="range"
            class="mt-1.5 w-full accent-brand"
            :min="TEST_SIZE_RANGE.min"
            :max="TEST_SIZE_RANGE.max"
            :step="TEST_SIZE_RANGE.step"
            :value="shownTestSize"
            :aria-label="t('preprocess.testSize')"
            @input="onTestSizeInput"
            @change="onTestSizeChange"
          />
          <p class="mt-1 text-ink-faint">{{ t('preprocess.testSizeNote') }}</p>
        </div>
      </template>

      <!--
        난수 씨앗. **어디에 서는지는 판이 정한다** (architecture.md §9.1.1) — 표 판은
        뽑기 카드 아래에, 이미지 판은 층화 아래에 놓는다. 그래서 이 설명 문구는 **어느
        판에서 읽어도 맞아야 한다** - 뽑기가 없는 종류가 있다.
      -->
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

  <AppEmpty v-else-if="kind" :reason="t(emptyReason)" :next="t(emptyNext)" />

  <!--
    **종류를 모르면 종류별 문구를 안 부른다.** `stepTextKey`는 등록부에 줄이 없을 때
    `steps.preprocess.emptyReason`으로 떨어지는데 **그 열쇠는 로케일에 없다** - 화면에
    키 문자열이 그대로 뜨고 콘솔이 빨개진다. 종류마다 갈리는 문구라 공통 자리에 기본값을
    두지 않기로 한 것이 그 이유다 (`router/steps.ts`의 `KIND_SPECIFIC_STEP_TEXT`).

    **데이터·예측 화면과 같은 문장으로 떨어진다.** 여기만 아무 말도 안 하면 학생은
    빈 화면을 보고 자기가 뭘 잘못한 줄 안다.
  -->
  <AppEmpty v-else :reason="t('data.unsupportedKind')" :next="t('data.unsupportedKindNext')" />
</template>
