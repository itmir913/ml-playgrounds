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
import AppPopover from '@/components/AppPopover.vue'
import { ACTION_ICONS } from '@/icons'
import { memberDiff, type Change, type ChangeValue } from '@/ml/changes'

const props = defineProps<{ changes: readonly Change[] }>()

const { t } = useI18n()

/** 값 하나를 문자열로. 어휘는 로케일에서, 개수는 단위와 함께. */
function valueText(value: ChangeValue): string {
  if (value.kind === 'locale') return t(value.key)
  if (value.kind === 'count') return t('meta.countUnit', { count: value.count })
  if (value.kind === 'literal') return value.text
  return t('meta.none')
}

/**
 * 이 변경에 "무엇이" 들고 났는지까지 있는가.
 *
 * **개수만 바뀌고 구성이 같을 수는 없다** — 그래도 들고 난 것이 둘 다 비면 보여줄 것이
 * 없으므로 `null`로 접는다. 판정은 `ml/changes.ts`가 한다.
 */
function membersOf(change: Change): ReturnType<typeof memberDiff> {
  const diff = memberDiff(change.from, change.to)
  if (diff === null) return null
  return diff.added.length + diff.removed.length === 0 ? null : diff
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

          <!--
            **개수만으로는 무엇을 뺐는지 알 수 없다.** 그렇다고 이름을 줄에 늘어놓으면
            특성 스무 개가 화면을 덮는다 - 그래서 **눌러야 나온다** (§8.13의 용어 설명과
            같은 규칙이다). 궁금한 학생에게만, 그 자리에서 답한다.

            **위로 연다.** 변경 이력은 실험 속의 맨 위에 있고 그 아래가 전부 지표라,
            아래로 열면 정작 견주려던 숫자들이 가려진다.
          -->
          <AppPopover v-if="membersOf(change)" wide side="top">
            <template #trigger="{ open }">
              <button
                type="button"
                :aria-expanded="open"
                class="flex items-center gap-1 rounded-control text-ink-soft transition-colors hover:text-ink"
              >
                {{ t('results.whatChanged') }}
                <component :is="ACTION_ICONS.explainTerm" :size="16" aria-hidden="true" />
              </button>
            </template>

            <h4 class="font-bold text-ink">{{ t(change.labelKey) }}</h4>

            <!--
              **들어온 것과 빠진 것을 나눠 쌓는다.** 한 줄에 섞으면 어느 쪽인지 기호로만
              읽히고, 기호는 언어를 안 넘는다. 이름은 학생의 컬럼명이라 그대로 둔다 -
              문장에 끼우면 조사가 붙는다 (docs/i18n.md 규칙 5).
            -->
            <div
              v-for="side in [
                { key: 'added', names: membersOf(change)?.added ?? [] },
                { key: 'removed', names: membersOf(change)?.removed ?? [] },
              ]"
              :key="side.key"
            >
              <p v-if="side.names.length > 0" class="mt-2">
                <span class="font-bold text-ink">
                  {{
                    side.key === 'added' ? t('results.membersAdded') : t('results.membersRemoved')
                  }}
                </span>
              </p>
              <ul v-if="side.names.length > 0" class="mt-1 flex flex-wrap gap-1.5">
                <li v-for="name in side.names" :key="name">
                  <AppBadge>{{ name }}</AppBadge>
                </li>
              </ul>
            </div>
          </AppPopover>
        </template>
      </div>
    </li>
  </ul>
</template>
