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

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppPopover from '@/components/AppPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import { memberDiff, type Change, type ChangeItemKind, type ChangeValue } from '@/ml/changes'

const props = defineProps<{ changes: readonly Change[] }>()

const { t } = useI18n()
const format = useFormat()

/** 값 하나를 문자열로. 어휘는 로케일에서, 개수는 단위와 함께. */
function valueText(value: ChangeValue): string {
  if (value.kind === 'locale') return t(value.key)
  if (value.kind === 'count') return t('meta.countUnit', { count: value.count })
  if (value.kind === 'literal') return value.text
  if (value.kind === 'ratio') return format.percent(value.value)
  return t('meta.none')
}

/**
 * 목록 항목 하나를 사람이 읽는 이름으로.
 *
 * **`path`로 갈라지지 않는다** — 어떻게 읽을지는 값이 `itemKind`로 들고 온다
 * (`ml/changes.ts`). 열 이름은 학생의 낱말이라 그대로 두고, 모델은
 * `decision_tree:mljs` 꼴의 식별자라 여기서 로케일을 찾는다.
 *
 * **모르는 식별자는 그대로 보인다.** 남의 파일이나 나중 버전에서 올 수 있고,
 * 모르는 것을 아는 척하는 것보다 정직하다 (`labelKey`가 없을 때와 같은 규칙).
 */
function itemText(kind: ChangeItemKind, item: string): string {
  if (kind !== 'model') return item
  const [algorithm, runtime] = item.split(':')
  if (!algorithm || !runtime) return item
  return t('predict.modelName', {
    algorithm: t(`algorithms.${algorithm}`),
    runtime: t(`runtimes.${runtime}`),
  })
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

/**
 * 줄마다 한 번만 센다. **템플릿에서 부르면 렌더마다 다시 돈다** — 한 변경에 네 번씩,
 * 변경이 스물이면 여든 번이다 (V11 R5 C-3). 저사양 교실 PC가 기준 기기다.
 */
const rows = computed(() => props.changes.map((change) => ({ change, members: membersOf(change) })))
</script>

<template>
  <!--
    **불릿은 `list-outside`다** (architecture.md §8.13). 글머리표가 글자 바깥에 서므로
    한 변경이 두 줄로 접혀도 둘째 줄이 첫 줄과 나란히 들여쓰이고, 그래야 다음 항목의
    시작과 구별된다. 번호는 안 매긴다 - 변경들 사이에 순서나 우열이 없다.

    **`li`에 flex를 주지 않는다.** 주면 그 줄이 list-item이 아니게 되어 글머리표가
    사라진다 - 배치는 안쪽 상자가 맡는다.
  -->
  <ul class="flex list-outside list-disc flex-col gap-3 pl-5 marker:text-ink-faint">
    <li v-for="{ change, members } in rows" :key="change.path">
      <!--
        **가로 간격만 주면 접힌 줄이 붙는다.** 배지가 두 줄로 넘어가는 순간 세로 간격이
        0이라 배지들이 겹쳐 보였다 (좁은 화면, 2026-08-13). 그리고 **항목 사이가 항목
        안보다 넓어야 한다** - 둘이 같으면 어디까지가 한 변경인지 안 보인다.
      -->
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
        <!--
        **모르는 경로는 버리지 않는다.** 남의 파일이나 나중 버전에서 올 수 있고,
        모르는 것을 아는 척하는 것보다 경로를 그대로 보여주는 편이 정직하다.
      -->
        <AppBadge v-if="change.labelKey === null">
          {{ t('results.unknownChange', { path: change.path }) }}
        </AppBadge>

        <template v-else>
          <!--
            **모델과 실행을 따로 세운다** (2026-08-13). 하나로 이으면 가운뎃점 셋이
            서로 다른 층위를 같은 기호로 잇는다 - 앞은 모델과 실행을 가르고, 뒤는 실행
            이름 안의 라이브러리와 장소를 가른다. 학습 화면에서도 따로 고른 두 축이라
            결과에서도 따로 서는 편이 앞뒤가 맞는다.
          -->
          <template v-if="change.model">
            <AppBadge>{{ t(`algorithms.${change.model.algorithm}`) }}</AppBadge>
            <AppBadge>{{ t(`runtimes.${change.model.runtime}`) }}</AppBadge>
          </template>
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
          <AppPopover v-if="members" size="wide" side="top">
            <template #trigger="{ open }">
              <!--
                **누를 수 있는 글자에는 점선 밑줄과 색을 준다.** 값들 사이에 낀 평문이라
                옆의 `2개 → 4개`와 같은 무게로 서 있었고, 아무도 누르지 않았다. 학습
                화면의 `이유 보기`와 같은 모양이다 - 색만 다르다(거기는 실패라 danger).
                실선이 아닌 이유는 실선이 다른 곳으로 가는 링크로 읽히기 때문이다.
                여기서 일어나는 일은 이동이 아니라 펼침이다.
              -->
              <button
                type="button"
                :aria-expanded="open"
                class="flex items-center gap-1 rounded-control text-brand underline decoration-dotted underline-offset-4 transition-colors hover:text-brand-strong"
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
                {
                  key: 'added',
                  names: (members?.added ?? []).map((name) =>
                    itemText(members?.itemKind ?? 'text', name),
                  ),
                },
                {
                  key: 'removed',
                  names: (members?.removed ?? []).map((name) =>
                    itemText(members?.itemKind ?? 'text', name),
                  ),
                },
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
