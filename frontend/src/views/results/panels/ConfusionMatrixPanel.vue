<script setup lang="ts">
/**
 * 혼동 행렬. **분류 전용이라는 사실은 여기가 아니라 등록부에 있다** (`ml/metric-panels.ts`).
 *
 * 이 파일은 "어떻게 그리는가"만 안다. 언제 뜨는지는 등록부가 정하므로 결과 화면에
 * `taskType === 'classification'`이 생기지 않는다 (architecture.md §9.1).
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import AppTable from '@/components/AppTable.vue'
import { CONFUSION_ROW_PAGE_SIZE } from '@/limits'
import { lockFor, turnPage } from '@/locks'
import { confusionRowsFor } from '@/ml/confusion-rows'
import type { PanelInput } from '@/ml/metric-panels'
import { readTestDataset } from '@/project/dataset'

const props = defineProps<{ input: PanelInput }>()

const run = computed(() => props.input.run)

const { t } = useI18n()

/**
 * 행을 연 칸. **연 적이 없으면 다시 예측하지 않는다** — 칸의 행은 저장된 모델로 테스트 데이터를 다시
 * 예측해 얻는다(`open-decisions.md` "98. 혼동 행렬의 칸을 누르면 그 칸의 행을 보일 것인가").
 */
const opened = ref<{ actual: number; predicted: number } | null>(null)
const page = ref(0)

const rowsResult = computed(() =>
  opened.value === null
    ? null
    : confusionRowsFor({
        run: props.input.run,
        experiment: props.input.experiment,
        dataset: props.input.dataset,
        testDataset: readTestDataset(props.input.file),
        preprocessor: props.input.preprocessor,
        modelBytes: props.input.modelBytes,
      }),
)

/**
 * 행을 열 수 있는가. **모델·정본·전처리기가 있는 표 프로젝트**에서만이다. 사진 프로젝트에는
 * 정본 표가 없어 단추 자체가 안 선다(결정 98의 5).
 */
const canOpen = computed(
  () =>
    props.input.modelBytes !== undefined &&
    props.input.dataset !== null &&
    props.input.preprocessor !== null,
)

function openCell(actual: number, predicted: number): void {
  opened.value = { actual, predicted }
  page.value = 0
}

const cellRows = computed(() => {
  const found = rowsResult.value
  const cell = opened.value
  if (found?.kind !== 'rows' || !cell) return []
  return found.rows.cells[cell.actual]?.[cell.predicted] ?? []
})

const pages = computed(() =>
  Math.max(1, Math.ceil(cellRows.value.length / CONFUSION_ROW_PAGE_SIZE)),
)
const shownRows = computed(() =>
  cellRows.value.slice(
    page.value * CONFUSION_ROW_PAGE_SIZE,
    (page.value + 1) * CONFUSION_ROW_PAGE_SIZE,
  ),
)

/** 그 행의 원래 값. 행이 놓인 정본(`provided`면 테스트 표)에서 읽는다. */
function cellsOf(row: number): readonly string[] {
  return rowsResult.value?.kind === 'rows' ? (rowsResult.value.rows.source.rows[row] ?? []) : []
}
</script>

<template>
  <!--
    등록부의 hasData가 이미 걸렀지만 타입은 여전히 선택 필드다. **이 v-if는 축 판정이
    아니라 필드가 있는지다** — 어느 필드에 담기는지를 아는 것이 이 패널의 몫이다 (§9.5).
  -->
  <section v-if="run.confusionMatrix" class="flex flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.confusion') }}</h4>
    <p class="text-ink-soft">{{ t('results.confusionLead') }}</p>

    <AppTable>
      <thead>
        <!--
          **축 이름이 표 안에 선다** (2026-08-29 화면 실측 C-5). 예전에는 모서리 칸에만
          `실제 값`이 있고 그 오른쪽에 값 이름들이 나란히 있어서, 머리 줄이
          `실제 값 | 불합격 | 합격`으로 읽혔다 — **뒤의 둘은 예측한 값인데** 학생은 셋 다
          실제 값으로 훑는다.

          바로 위 설명문이 옳게 말하고 있지만 그건 **읽어서 머리에서 조합해야** 하고,
          §8.13이 둔 팝오버는 **누를 때만** 답한다. 표 머리는 안 물어도 보인다.

          모서리는 비운다 — 두 축이 만나는 칸이라 어느 쪽 이름도 그 자리의 것이 아니다.
        -->
        <tr>
          <th :rowspan="2" class="align-bottom">{{ t('results.actual') }}</th>
          <th :colspan="run.confusionMatrix.labels.length" class="text-center">
            {{ t('results.cellPredicted') }}
          </th>
        </tr>
        <!--
          **값 이름은 줄을 바꾼다.** 머리 줄은 한 줄이 기본인데(`data-table`) 이 칸들은
          학생의 데이터라 길이를 모른다 - 긴 범주 하나가 표를 밀어 `예측한 값`이 화면 밖
          한가운데에 선다. 띄어쓰기 없는 이름은 여전히 한 덩어리다(`body`의 `keep-all`) -
          몸통의 줄 이름표와 같은 한계다. `wrap-anywhere`로 풀면 휴대폰에서 표가 최소 폭으로
          짜일 때 짧은 이름까지 거의 한 글자씩 갈려서 안 풀었다. 사람 확인(브라우저).
        -->
        <tr>
          <th v-for="label in run.confusionMatrix.labels" :key="label" class="whitespace-normal">
            {{ label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in run.confusionMatrix.matrix" :key="index">
          <th class="text-left">{{ run.confusionMatrix.labels[index] }}</th>
          <!--
            **맞힌 칸(대각선)은 굵기와 배경을 함께 준다.** 굵기만으로는 표를 눈으로
            훑을 때 잘 안 걸린다 — 배경색이 먼저 눈에 들어와야 어디를 봐야 하는지가
            읽기 전에 이미 보인다.

            **다만 0이면 굵기를 뺀다** (2026-08-29 화면 실측 C-5). 둘이 하는 일이
            다르다 — 배경은 **어디를 볼지**를, 굵기는 **이 숫자를 보라**를 말한다. 한
            번도 못 맞힌 범주의 초록 `0`이 굵게까지 서면 "잘했다"로 읽히고, 바로 아래
            `범주별 점수`는 같은 사실을 주황 `0%`로 칠한다. **배경은 남긴다** — 빼면
            대각선이 끊겨 표가 읽기 어려워지고, 그게 배경이 있는 이유다.
          -->
          <!--
            **칸을 누르면 그 칸이 무엇인지 말한다** (§8.13). 세로가 실제, 가로가 예측이라는
            것을 머리에서 다시 조합해야 읽히는 표라, 학생이 가장 자주 막히는 자리다.

            **문장으로 쓰지 않는다.** 값 종류는 학생의 데이터라 `{값}라고`/`{값}이라고`로
            조사가 갈리고, i18n.md 규칙 5는 회피형까지 금지한다. 이름은 배지, 값은
            plaintext로 세우면(§8.16) 조사가 생길 자리가 아예 없다.
          -->
          <td
            v-for="(count, column) in row"
            :key="column"
            :class="[
              index === column ? 'bg-positive-soft' : '',
              index === column && count > 0 ? 'font-bold' : '',
            ]"
          >
            <AppPopover size="wide">
              <template #trigger="{ open }">
                <button
                  type="button"
                  :aria-expanded="open"
                  class="w-full rounded-control text-left transition-colors hover:text-ink"
                >
                  {{ count }}
                </button>
              </template>

              <h4 class="font-bold text-ink">{{ t('results.cellTitle') }}</h4>

              <dl class="mt-1.5 flex flex-wrap gap-x-6 gap-y-1.5">
                <!--
                **표와 같은 순서로 놓는다** - 실제가 먼저, 예측이 나중이다. 안내 문장이
                "왼쪽에 적힌 것이 실제 값"이라고 말해 놓고 팝오버가 예측부터 보이면,
                학생은 방금 읽은 순서를 뒤집어 다시 맞춰야 한다.
              -->
                <div class="flex items-baseline gap-1.5">
                  <dt>
                    <AppBadge>{{ t('results.cellActual') }}</AppBadge>
                  </dt>
                  <dd class="font-bold text-ink">
                    {{ run.confusionMatrix?.labels[index] }}
                  </dd>
                </div>
                <div class="flex items-baseline gap-1.5">
                  <dt>
                    <AppBadge>{{ t('results.cellPredicted') }}</AppBadge>
                  </dt>
                  <dd class="font-bold text-ink">
                    {{ run.confusionMatrix?.labels[column] }}
                  </dd>
                </div>
                <div class="flex items-baseline gap-1.5">
                  <dt>
                    <AppBadge>{{ t('results.cellCount') }}</AppBadge>
                  </dt>
                  <dd class="font-bold tabular-nums text-ink">{{ count }}</dd>
                </div>
              </dl>

              <p class="mt-1.5 text-ink-soft">
                {{ index === column ? t('results.cellCorrect') : t('results.cellWrong') }}
              </p>

              <!--
                **그 칸의 행을 연다** (결정 98, Orange3 Confusion Matrix가 칸을 누르면 행을 내보내는
                자리). 행이 0인 칸과 행을 못 여는 파일(사진·모델 없음)에는 단추가 없다.
              -->
              <AppButton
                v-if="canOpen && count > 0"
                variant="secondary"
                class="mt-2"
                @click="openCell(index, column)"
              >
                {{ t('results.cellRowsOpen', { count }) }}
              </AppButton>
            </AppPopover>
          </td>
        </tr>
      </tbody>
    </AppTable>

    <p v-if="rowsResult?.kind === 'mismatch'" class="text-ink-soft">
      {{ t('results.cellRowsMismatch') }}
    </p>

    <div
      v-else-if="rowsResult?.kind === 'rows' && opened"
      class="mt-2 flex min-w-0 flex-col gap-1.5"
    >
      <h4 class="font-bold">{{ t('results.cellRowsTitle') }}</h4>
      <!-- 이름은 배지, 값은 plaintext다(§8.16) — 값이 학생의 데이터라 조사가 생길 자리를 안 만든다. -->
      <dl class="flex flex-wrap gap-x-6 gap-y-1.5">
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('results.cellActual') }}</AppBadge>
          </dt>
          <dd class="font-bold text-ink">{{ run.confusionMatrix.labels[opened.actual] }}</dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('results.cellPredicted') }}</AppBadge>
          </dt>
          <dd class="font-bold text-ink">{{ run.confusionMatrix.labels[opened.predicted] }}</dd>
        </div>
      </dl>

      <AppTable>
        <thead>
          <tr>
            <th
              v-for="name in rowsResult.rows.source.columns"
              :key="name"
              class="whitespace-normal"
            >
              {{ name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shownRows" :key="row">
            <td v-for="(cell, at) in cellsOf(row)" :key="at">{{ cell }}</td>
          </tr>
        </tbody>
      </AppTable>

      <p class="text-ink-faint">
        {{
          t(
            'results.cellRowsCount',
            { shown: shownRows.length, total: cellRows.length },
            cellRows.length,
          )
        }}
      </p>

      <!-- 한 쪽뿐이면 넘길 것이 없다. 못 누르는 단추 둘을 두지 않는다. -->
      <div v-if="pages > 1" class="flex items-center justify-between gap-4">
        <AppButton
          variant="secondary"
          :lock="lockFor('pageFirst', { page })"
          @click="page = turnPage(page, -1, pages)"
        >
          {{ t('common.prevPage') }}
        </AppButton>
        <p class="tabular-nums text-ink-soft">{{ page + 1 }} / {{ pages }}</p>
        <AppButton
          variant="secondary"
          :lock="lockFor('pageLast', { page, pages })"
          @click="page = turnPage(page, 1, pages)"
        >
          {{ t('common.nextPage') }}
        </AppButton>
      </div>
    </div>
  </section>
</template>
