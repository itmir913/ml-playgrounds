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
        <tr>
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
            </AppPopover>
          </td>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
