<script setup lang="ts">
/**
 * 양식을 가져올 곳들. **등록부에서 나온 줄을 그대로 그린다**
 * (`project/portfolio-sources.ts`, mlpx-spec.md §8.3).
 *
 * **목록을 열 때 받아 온다.** 팝오버가 열릴 때 이 컴포넌트가 붙으므로, 프리셋 목록을
 * 받는 일이 화면에 들어오는 것이 아니라 **누른 순간**에 일어난다. 포트폴리오 화면을
 * 열기만 한 사람은 네트워크를 안 탄다.
 *
 * **한 출처가 실패해도 나머지는 선다.** 프리셋 목록을 못 받아도 파일 열기는 그대로다.
 * 실패는 조용히 넘기지 않는다 - 누른 사람은 무슨 일이 있었는지 알아야 한다.
 *
 * **오래 걸리는 것은 `action`으로 준다** - 받아 오는 동안 두 번 눌리면 안 된다.
 */

import { onMounted, ref } from 'vue'

import AppButton from '@/components/AppButton.vue'
import {
  templateRows,
  type TemplateRow,
  type TemplateSourceContext,
} from '@/project/portfolio-sources'

const props = defineProps<{ context: TemplateSourceContext }>()

const emit = defineEmits<{
  /** 받아 온 양식. `null`이면 아무 일도 없었다 - 파일 고르기를 닫았을 때다. */
  pick: [markdown: string | null]
  failed: [error: unknown]
}>()

const rows = ref<TemplateRow[]>([])

onMounted(async () => {
  const { rows: found, failures } = await templateRows(props.context)
  rows.value = found
  for (const failure of failures) emit('failed', failure)
})

async function choose(row: TemplateRow): Promise<void> {
  try {
    emit('pick', await row.load())
  } catch (error) {
    emit('failed', error)
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <AppButton v-for="row in rows" :key="row.key" variant="subtle" :action="() => choose(row)">
      {{ row.label }}
    </AppButton>
  </div>
</template>
