<script setup lang="ts">
/**
 * **무결성 판** — 이 파일이 학생의 마지막 저장 뒤에 바뀌었는가 (mlpx-spec.md §7.2).
 *
 * **층 셋 중 둘만 여기 있다** (open-decisions.md "점검은 읽기 전용 열람기다"). 엔트리별
 * 해시와 파일 전체 해시가 이 판의 몫이고, 재실행 대조는 다음 판이다. **셋째 층 — 수거
 * 시점의 해시 기록 — 은 앱 밖이고 그것이 설계다**: 교사가 `certutil`/`Get-FileHash`로
 * 우리 도구 없이 계산한다. 그러므로 **이 판이 답하지 못하는 것이 하나 있다** — 파일이
 * 수거된 뒤에 바뀌었는가. 그 한 줄을 화면이 스스로 말한다.
 *
 * **접히는 것은 학생에 대한 독립성이 아니라 우리 구현에 대한 독립성이다.** 이 계산은
 * 교사 브라우저에서 돌고 학생은 거기 못 닿는다.
 *
 * **어긋난 엔트리만 펼친다.** 서른 개를 훑는 교사에게 `그대로`인 줄 스물아홉은 소음이고,
 * 신호는 "무엇이 달라졌는가" 하나다 (`entries`에는 `UNCHANGED`도 들어 있다).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { HashCheck } from '@/project/integrity'

const props = defineProps<{ integrity: HashCheck }>()

const { t } = useI18n()

/** 그대로가 아닌 엔트리. **이것이 비어 있는 것이 정상이다.** */
const changed = computed(() => props.integrity.entries.filter((one) => one.state !== 'UNCHANGED'))
</script>

<template>
  <section class="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h4 class="font-bold">{{ t('inspect.integrity') }}</h4>
      <p :class="props.integrity.status === 'UNCHANGED' ? 'font-bold' : 'font-bold text-caution'">
        {{ t(`fileHash.${props.integrity.status}`) }}
      </p>
    </div>

    <!--
      **어긋난 자리는 이름으로 말한다** (mlpx-spec.md §7.2). `runs.json은 바뀌었고
      dataset/은 그대로`가 교사에게 넘길 신호이고, "파일이 바뀌었습니다" 한 줄로는
      학생에게도 교사에게도 할 수 있는 일이 없다.
    -->
    <ul v-if="changed.length > 0" class="flex flex-col gap-1">
      <li v-for="entry in changed" :key="entry.path" class="flex flex-wrap justify-between gap-x-4">
        <span class="font-mono break-all">{{ entry.path }}</span>
        <span class="text-caution">{{ t(`entryHash.${entry.state}`) }}</span>
      </li>
    </ul>

    <!--
      **이 판이 답하지 못하는 것을 이 판이 말한다.** 여기서 보는 것은 "학생의 마지막 저장
      뒤에 바뀌었는가"까지다 — 수거 뒤의 변조는 교사가 받은 날 남긴 해시 기록만 답한다.
    -->
    <p class="text-ink-soft">{{ t('inspect.integrityNote') }}</p>
  </section>
</template>
