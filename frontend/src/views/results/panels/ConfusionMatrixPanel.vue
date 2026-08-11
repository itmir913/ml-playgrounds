<script setup lang="ts">
/**
 * 혼동 행렬. **분류 전용이라는 사실은 여기가 아니라 등록부에 있다** (`ml/metric-panels.ts`).
 *
 * 이 파일은 "어떻게 그리는가"만 안다. 언제 뜨는지는 등록부가 정하므로 결과 화면에
 * `taskType === 'classification'`이 생기지 않는다 (architecture.md §9.1).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppPopover from '@/components/AppPopover.vue'
import AppTable from '@/components/AppTable.vue'
import type { PanelInput } from '@/ml/metric-panels'

const props = defineProps<{ input: PanelInput }>()

/** 이 패널이 쓰는 것은 `run` 하나뿐이다. 나머지 재료는 군집 패널의 것이다. */
const run = computed(() => props.input.run)

const { t } = useI18n()
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
        <tr>
          <!-- 모서리 칸. 세로축이 실제이고 가로축이 예측이라는 것을 여기서 말한다. -->
          <th>{{ t('results.actual') }}</th>
          <th v-for="label in run.confusionMatrix.labels" :key="label">{{ label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in run.confusionMatrix.matrix" :key="index">
          <th class="text-left">{{ run.confusionMatrix.labels[index] }}</th>
          <!--
            **맞힌 칸(대각선)은 굵기와 배경을 함께 준다.** 굵기만으로는 표를 눈으로
            훑을 때 잘 안 걸린다 — 배경색이 먼저 눈에 들어와야 어디를 봐야 하는지가
            읽기 전에 이미 보인다.
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
            :class="index === column ? 'bg-positive-soft font-bold' : ''"
          >
            <AppPopover wide>
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
                    <AppBadge>{{ t('results.cellActual') }}</AppBadge>
                  </dt>
                  <dd class="font-bold text-ink">
                    {{ run.confusionMatrix?.labels[index] }}
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
            </AppPopover>
          </td>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
