<script setup lang="ts">
/**
 * 직전 학습에서 바뀐 것들. **git diff를 읽듯 보게 한다** (architecture.md §8.9).
 *
 * `ml/changes.ts`가 낸 서술을 문장으로 옮기기만 한다. **한 줄이 한 키다** — 라벨과
 * 전후 값을 조각으로 이어 붙이면 어순이 다른 언어에서 무너지고, 그런데 키 집합은
 * 완벽히 일치하므로 검사는 통과한다 (CLAUDE.md §3 규칙 3).
 *
 * **어느 모델의 손잡이인지는 문장 밖에 둔다.** 문장에 끼우면 "결정 트리의 최대 깊이를"
 * 같은 조사가 생기고, 그건 다른 언어로 옮길 때 그대로 짐이 된다.
 */

import { useI18n } from 'vue-i18n'

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
  <ul class="flex flex-col gap-1.5">
    <li
      v-for="change in props.changes"
      :key="change.path"
      class="flex flex-wrap items-baseline gap-x-2"
    >
      <!--
        **모르는 경로는 버리지 않는다.** 남의 파일이나 나중 버전에서 올 수 있고,
        모르는 것을 아는 척하는 것보다 경로를 그대로 보여주는 편이 정직하다.
      -->
      <span v-if="change.labelKey === null" class="text-ink-soft">
        {{ t('results.unknownChange', { path: change.path }) }}
      </span>

      <template v-else>
        <span v-if="change.model" class="rounded-field bg-surface-sunken px-2 py-0.5 text-ink-soft">
          {{
            t('results.modelScope', {
              algorithm: t(`algorithms.${change.model.algorithm}`),
              runtime: t(`runtimes.${change.model.runtime}`),
            })
          }}
        </span>
        <span>
          {{
            t('results.change', {
              label: t(change.labelKey),
              from: valueText(change.from),
              to: valueText(change.to),
            })
          }}
        </span>
      </template>
    </li>
  </ul>
</template>
