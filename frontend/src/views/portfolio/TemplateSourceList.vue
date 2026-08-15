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
 *
 * **무게를 단추 모양으로 옮기는 표가 여기 있는 전부다** (mlpx-spec.md §8.3). 어느 줄이
 * 앞서는지는 등록부가 정한다 - 여기서 `if`로 가르면 출처를 같은 모양으로 만들어 둔
 * 것(§8.7)이 그 자리에서 깨진다.
 *
 * **`subtle`이 아니라 `secondary`다.** 팝오버 패널이 흰 면이라, 면만 있고 테두리가 없는
 * 옅은 회색 단추가 거기서는 **꺼진 것으로 읽힌다**(사용자가 겪었다). `AppButton`의
 * `subtle`은 회색 바탕 위에서 secondary와 비중이 같아지는 것을 피하려고 있는 변종이라
 * 흰 면에서는 역할이 뒤집힌다.
 */

import { onMounted, ref } from 'vue'

import AppButton from '@/components/AppButton.vue'
import {
  templateRows,
  type TemplateRow,
  type TemplateSourceContext,
  type TemplateWeight,
} from '@/project/portfolio-sources'
import type { Locale } from '@/i18n'

const props = defineProps<{ context: TemplateSourceContext }>()

const emit = defineEmits<{
  /**
   * 받아 온 양식. `null`이면 아무 일도 없었다 - 파일 고르기를 닫았을 때다.
   *
   * **언어가 함께 온다** (mlpx-spec.md §8.5). 줄이 아는 것이고, 모르는 출처는
   * `undefined`다 - 그때 양식에 언어가 안 박힌다.
   */
  pick: [markdown: string | null, locale?: Locale]
  failed: [error: unknown]
}>()

/** 무게 -> 단추 모양. **표 하나다** - 변종을 고르는 `if`를 화면에 두지 않는다. */
const VARIANTS: Readonly<Record<TemplateWeight, 'primary' | 'secondary'>> = {
  lead: 'primary',
  normal: 'secondary',
}

const rows = ref<TemplateRow[]>([])

onMounted(async () => {
  const { rows: found, failures } = await templateRows(props.context)
  rows.value = found
  for (const failure of failures) emit('failed', failure)
})

async function choose(row: TemplateRow): Promise<void> {
  try {
    emit('pick', await row.load(), row.locale)
  } catch (error) {
    emit('failed', error)
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <AppButton
      v-for="row in rows"
      :key="row.key"
      :variant="VARIANTS[row.weight]"
      :action="() => choose(row)"
    >
      {{ row.label }}
    </AppButton>
  </div>
</template>
