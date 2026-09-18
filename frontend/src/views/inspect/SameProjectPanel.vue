<script setup lang="ts">
/**
 * **이 파일이 어디서 왔나** — 같은 프로젝트에서 나온 파일들 (architecture.md §8.21).
 *
 * `manifest.projectId`는 파일을 열어 다시 저장해도 따라가므로, 같은 값을 가진 파일들은
 * **한쪽이 다른 쪽에서 나왔다.** 이름과 내용은 얼마든지 바뀌어서 눈으로는 안 보인다.
 *
 * **판정은 여기서 안 한다.** 교사가 나눠 준 시작 파일이면 여러 명이 같은 값을 갖는다 —
 * 이 판은 **누구와 같은지**만 세워 주고, 그것이 무엇을 뜻하는지는 교사가 안다.
 *
 * **시각을 안 적는다** (2026-09-18, 사용자). *마지막 저장이 빠른 쪽이 원본*이라는 추론은
 * 틀린다 — 열어서 다시 저장하기만 해도 갱신된다. 시각은 **요약 카드가 파일마다** 보여
 * 주고, 교사가 줄을 옮겨 가며 읽는다.
 */

import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'

defineProps<{
  /** 이 묶음의 이름표들. **명렬의 순서 그대로** 온다. */
  labels: readonly string[]
  /** 지금 열어 둔 줄. 그 자리에 표시가 붙는다. */
  current: string
  /** 표의 `프로젝트` 열에 선 그 글자. **두 자리가 같은 것을 가리킨다는 표시다.** */
  name: string
  /**
   * 진짜 아이디. **표에는 안 적고 여기에만 적는다** (2026-09-24 기준 서른여섯 글자) —
   * 서른 줄에 깔면 못 읽지만, 판을 연 순간에는 **교사가 확인할 수 있는 유일한 사실**이다.
   */
  projectId: string
}>()

const { t } = useI18n()
</script>

<template>
  <!-- 절의 리듬은 이웃 판들과 같다 (`IntegrityPanel`). 카드는 화면이 두른다. -->
  <section class="flex min-w-0 flex-col gap-1.5">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="font-bold text-ink-soft">{{ t('inspect.sameProjectTitle') }}</h3>
      <AppBadge class="whitespace-nowrap">{{ name }}</AppBadge>
    </div>
    <p class="text-ink-faint">{{ t('inspect.sameProjectNote') }}</p>

    <!-- 아이디는 줄 어디에서든 끊는다. 서른여섯 글자라 286px 카드에서 두 줄이 된다. -->
    <p class="break-all text-ink-soft">{{ projectId }}</p>

    <!--
      **점이 글자 밖에 선다** (`list-outside`, 2026-09-18 사용자). 파일 이름이 길어 줄을
      바꿀 때 둘째 줄이 첫 줄과 나란히 들여쓰여서, 이름 하나가 어디서 끝나는지가 보인다.

      **줄을 flex로 만들면 점이 사라진다** — `display: list-item`이 아니게 되기 때문이다.
      그래서 이름과 표시는 inline으로 두고 사이를 `ml-2`로 벌린다.
    -->
    <ul class="list-outside list-disc space-y-1 pl-5">
      <li v-for="label in labels" :key="label" class="break-words">
        <span :class="label === current ? 'font-bold' : ''">{{ label }}</span>
        <span v-if="label === current" class="ml-2 text-ink-faint">{{
          t('inspect.thisFile')
        }}</span>
      </li>
    </ul>
  </section>
</template>
