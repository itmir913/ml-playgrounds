<script setup lang="ts">
/**
 * 직전 학습에서 바뀐 것들. **git diff를 읽듯 보게 한다** (architecture.md §8.9).
 *
 * `ml/changes.ts`가 낸 서술을 문장으로 옮기기만 한다.
 *
 * **어느 모델의 손잡이인지도, 무엇이 바뀌었는지도 문장 밖에 둔다** — 이름은 배지,
 * 바뀐 값만 plaintext다 (architecture.md §8.13, 2026-08-07). 문장에 끼우면 "결정 트리의
 * 최대 깊이를" 같은 조사가 생기고, 그건 다른 언어로 옮길 때 그대로 짐이 된다.
 *
 * **이름을 배지로 뺀 것은 문장 조각 잇기가 아니다** (docs/i18n.md 규칙 3). 규칙 3이 막는
 * 것은 *한 문장*을 나눠 이어 붙이는 것이고, 배지에 들어가는 것은 문장의 일부가 아니라
 * **이름 그 자체**다. 값 쪽은 여전히 한 키다 — `{from} → {to}`를 셋으로 쪼개지 않는다.
 */

import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import type { Change, ChangeValue } from '@/ml/changes'

const props = defineProps<{ changes: readonly Change[] }>()

const { t } = useI18n()

/** 값 하나를 문자열로. 어휘는 로케일에서, 개수는 단위와 함께. */
function valueText(value: ChangeValue): string {
  if (value.kind === 'locale') return t(value.key)
  if (value.kind === 'count') return t('meta.countUnit', { count: value.count })
  if (value.kind === 'literal') return value.text
  return t('meta.none')
}
</script>

<template>
  <!--
    **불릿은 `list-outside`다** (architecture.md §8.13). 글머리표가 글자 바깥에 서므로
    한 변경이 두 줄로 접혀도 둘째 줄이 첫 줄과 나란히 들여쓰이고, 그래야 다음 항목의
    시작과 구별된다. 번호는 안 매긴다 - 변경들 사이에 순서나 우열이 없다.

    **`li`에 flex를 주지 않는다.** 주면 그 줄이 list-item이 아니게 되어 글머리표가
    사라진다 - 배치는 안쪽 상자가 맡는다.
  -->
  <ul class="flex list-outside list-disc flex-col gap-1.5 pl-5 marker:text-line-strong">
    <li v-for="change in props.changes" :key="change.path">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <!--
        **모르는 경로는 버리지 않는다.** 남의 파일이나 나중 버전에서 올 수 있고,
        모르는 것을 아는 척하는 것보다 경로를 그대로 보여주는 편이 정직하다.
      -->
        <AppBadge v-if="change.labelKey === null">
          {{ t('results.unknownChange', { path: change.path }) }}
        </AppBadge>

        <template v-else>
          <AppBadge v-if="change.model">
            {{
              t('results.modelScope', {
                algorithm: t(`algorithms.${change.model.algorithm}`),
                runtime: t(`runtimes.${change.model.runtime}`),
              })
            }}
          </AppBadge>
          <AppBadge>{{ t(change.labelKey) }}</AppBadge>
          <span>
            {{ t('results.change', { from: valueText(change.from), to: valueText(change.to) }) }}
          </span>
        </template>
      </div>
    </li>
  </ul>
</template>
