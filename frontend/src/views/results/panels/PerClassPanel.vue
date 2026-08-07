<script setup lang="ts">
/**
 * 값 종류별 점수. **분류 전용이라는 사실은 등록부에 있다** (`ml/metric-panels.ts`).
 *
 * 혼동 행렬과 나란히 서지만 서로를 모른다. 하나가 빠진 파일이 실제로 있으므로
 * (mlpx-spec.md §4.2) 둘을 한 컴포넌트에 묶으면 한쪽이 없을 때 나머지도 못 그린다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import TermPopover from '@/components/TermPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { isWeakestPerClass, weakestPerClass } from '@/ml/results'
import type { Run } from '@/project/schema'

const props = defineProps<{ run: Run }>()

const { t } = useI18n()
const format = useFormat()

const weakest = computed(() => weakestPerClass(props.run.perClass ?? []))
</script>

<template>
  <section v-if="props.run.perClass" class="flex flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.perClass') }}</h4>

    <AppTable>
      <thead>
        <tr>
          <th>{{ t('results.label') }}</th>
          <!-- 키를 자리마다 적어 둔다 - 조립하면 CI의 정적 t() 검사가 못 잡는다. -->
          <th>
            <TermPopover
              :title="t('metrics.precision')"
              :body="t('metricHelp.precision')"
              :numerator="t('metricFormula.precision.top')"
              :denominator="t('metricFormula.precision.bottom')"
            />
          </th>
          <th>
            <TermPopover
              :title="t('metrics.recall')"
              :body="t('metricHelp.recall')"
              :numerator="t('metricFormula.recall.top')"
              :denominator="t('metricFormula.recall.bottom')"
            />
          </th>
          <th>
            <TermPopover
              :title="t('metrics.specificity')"
              :body="t('metricHelp.specificity')"
              :numerator="t('metricFormula.specificity.top')"
              :denominator="t('metricFormula.specificity.bottom')"
            />
          </th>
          <th>
            <TermPopover
              :title="t('metrics.f1')"
              :body="t('metricHelp.f1')"
              :numerator="t('metricFormula.f1.top')"
              :denominator="t('metricFormula.f1.bottom')"
            />
          </th>
          <th><TermPopover :title="t('results.support')" :body="t('metricHelp.support')" /></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in props.run.perClass" :key="entry.label">
          <th class="text-left">{{ entry.label }}</th>
          <!--
            **가장 약한 범주를 지표마다 캐션 색으로 짚는다.** 혼동 행렬의
            대각선(맞힌 칸, `bg-positive-soft`)과 반대 방향이다 — 저기는 "옳다"를
            말하고 여기는 "여기를 다시 보라"를 말하므로 색을 다르게 둔다.
          -->
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'precision')
                ? 'bg-caution-soft font-bold'
                : ''
            "
          >
            {{ format.percent(entry.precision) }}
          </td>
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'recall') ? 'bg-caution-soft font-bold' : ''
            "
          >
            {{ format.percent(entry.recall) }}
          </td>
          <!--
            **특이도가 낮은 범주도 짚는다.** 그 칸이 가리키는 것은 **모델이 자꾸 이
            범주라고 잘못 부른다**는 사실이고, 그건 분포가 아니라 모델의 편향이다.
            정밀도와 같은 실수를 벌하므로 두 칸이 같은 줄에 함께 노래지는 일이 잦은데,
            **같은 사실을 두 각도에서 확인시켜 주는 것**이라 그대로 둔다.

            **옛 파일에는 이 값이 없다** (mlpx-spec.md §4). 그때는 0으로 채우지 않고
            비운다 - 0은 "특이도가 0인 모델"이라는 거짓말이고 표에서 구별되지 않는다.
          -->
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'specificity')
                ? 'bg-caution-soft font-bold'
                : ''
            "
          >
            {{ entry.specificity === undefined ? '' : format.percent(entry.specificity) }}
          </td>
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'f1') ? 'bg-caution-soft font-bold' : ''
            "
          >
            {{ format.percent(entry.f1) }}
          </td>
          <td>{{ entry.support }}</td>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
