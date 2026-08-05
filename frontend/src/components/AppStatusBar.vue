<script setup lang="ts">
/**
 * 아래 상태 표시줄. **이 프로젝트에서는 장식이 아니라 핵심 기능이다**
 * (architecture.md §8.8).
 *
 * **"저장"은 파일에만 쓴다.** 브라우저에 쓴 것을 "저장됨"이라 하면 안전하다고 읽히는데,
 * 재이미징되는 교실 PC에서는 그렇지 않다 — 이 저장소가 무결성 문구에 "verified"를
 * 금지한 것과 **같은 종류의 잘못**이다(mlpx-spec.md §7.3).
 *
 * **그래서 브라우저 저장 상태를 아예 보여주지 않는다.** 처음에는 "임시 보관됨"으로
 * 적어 두었는데, 파일 상태와 나란히 서면 학생 눈에 두 저장이 경쟁한다. 그리고
 * 자동 저장은 **학생이 켜고 끌 수 없다** — §8.9가 "체크할 수 없는 체크박스는 안내가
 * 아니라 방해다"라고 한 것과 같은 종류이고, 실패하면 어차피 알림이 뜬다.
 *
 * 남은 것은 **파일 상태 하나**다. 학생이 가져가야 할 문장도 하나다 — 파일로 저장해야
 * 영구적으로 남는다. 마지막으로 작업한 시각은 팝오버에 남겼다. 그건 상태가 아니라
 * 학생이 실제로 쓰는 정보다.
 *
 * **줄은 넘치는 대신 잘리고, 누르면 팝오버가 전부 보여준다.** 휴대폰에서 실측하면
 * 칸을 다 펼치는 데 654px이 필요한데 화면은 375px이다. 가로로 밀리게 두면 언어
 * 선택기가 화면 밖으로 나가고, 스크롤바는 숨겨 놨으므로 **더 있다는 표시조차 없다.**
 *
 * 잘려도 되는 이유는 **순서가 이미 중요한 것을 앞에 뒀기 때문이다** - 내보내기 상태가
 * 맨 앞이라 어떤 폭에서도 살아남는다.
 *
 * 그리고 팝오버가 지금 안 보이던 것을 살린다. `save.exportWarning`은 `title` 툴팁으로만
 * 있었는데 **터치 기기에는 hover가 없어서 휴대폰에서는 영원히 안 뜨는 문장이었다.**
 * 리셋 문제에 답하려고 만든 문장이 그 답이 가장 필요한 화면에서 빠져 있었다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppPopover from '@/components/AppPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '@/i18n'
import { useProjectStore } from '@/stores/project'
import { otherTheme, setTheme, theme } from '@/theme'

const { t, locale } = useI18n()
const format = useFormat()
const project = useProjectStore()

const sizeBytes = computed(() => {
  const file = project.file
  if (!file) return 0
  let total = file.dataset?.bytes.length ?? 0
  for (const bytes of file.models.values()) total += bytes.length
  return total
})

/**
 * 내보내기 상태. 셋으로 갈린다 — 안 내보냄 / 내보낸 뒤 고침 / 그대로.
 *
 * **가운데가 중요하다.** "내보냈다"만 보여주면 그 뒤에 한 시간을 더 작업한 학생이
 * 안심한 채로 컴퓨터를 끈다.
 */
const exportState = computed(() => {
  if (project.exportedAt === null) return 'notExported'
  if (project.savedAt !== null && project.savedAt > project.exportedAt) return 'stale'
  return 'exported'
})

/**
 * 브라우저 쪽 상태와 곁가지들. 가운뎃점으로 이어 붙일 것이라 배열로 만든다.
 *
 * **칸이 사라졌다 나타나지 않게 한다.** 저장이 도는 짧은 사이에 시각이 없어졌다가
 * 다시 생기면 줄 전체가 흔들려서, 바뀐 것 하나가 아니라 상태 표시줄이 통째로
 * 갈린 것처럼 보인다. 있는 칸은 계속 있고 **글자만 바뀐다.**
 *
 * 저장 중에도 마지막 저장 시각을 그대로 둔다 - 그건 여전히 사실이다.
 */
const facts = computed(() => {
  const parts: string[] = []
  if (project.savedAt !== null) parts.push(format.dateTime(project.savedAt))
  // 아직 아무것도 없는 프로젝트에 "0 byte"는 알려 주는 것이 없다.
  if (sizeBytes.value > 0) parts.push(format.bytes(sizeBytes.value))
  return parts
})

/** 팝오버 안의 이름 붙은 줄들. 잘린 줄에서는 값만 보이지만 여기서는 무엇인지 밝힌다. */
const details = computed(() => {
  const rows: { label: string; value: string }[] = []
  if (project.savedAt !== null) {
    rows.push({ label: t('projects.updatedAt'), value: format.dateTime(project.savedAt) })
  }
  if (sizeBytes.value > 0) {
    rows.push({ label: t('projects.size'), value: format.bytes(sizeBytes.value) })
  }
  return rows
})

/** 내보내기 상태의 색. 잘린 줄과 팝오버가 같은 것을 봐야 한다. */
const exportTone = computed(() =>
  exportState.value === 'exported' ? 'text-positive' : 'font-bold text-caution',
)

function onLocale(event: Event): void {
  void setLocale((event.target as HTMLSelectElement).value as Locale)
}

/** 스위치가 가리키는 곳. 아이콘도 설명도 **바뀔 쪽**을 말한다. */
const nextTheme = computed(() => otherTheme(theme.value))
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center gap-2 border-t border-line bg-surface px-3 text-ink-soft"
  >
    <AppPopover v-if="project.projectId !== null" side="top" class="min-w-0 flex-1">
      <template #trigger="{ open }">
        <!--
          내보내기 상태가 먼저다. 학생이 알아야 하는 것은 "내 작업이 이 컴퓨터를 나갈 수
          있는가" 하나이고, 브라우저 저장 상태는 그 뒤의 곁가지다. 그리고 앞에 있으므로
          줄이 잘려도 이것만은 남는다.

          flex가 아니라 block이다 - 말줄임표는 글자 흐름에서 나오고, flex 자식은 그
          흐름에 들어가지 않는다.
        -->
        <button
          type="button"
          :aria-expanded="open"
          class="block w-full truncate rounded-control text-left hover:text-ink"
        >
          <span :class="exportTone">
            <span class="mr-2 inline-block size-2 rounded-pill bg-current" aria-hidden="true" />
            {{ t(`save.${exportState}`) }}
          </span>
          <template v-for="(fact, slot) in facts" :key="slot">
            <span class="text-line-strong" aria-hidden="true"> · </span>
            <span>{{ fact }}</span>
          </template>
        </button>
      </template>

      <p :class="exportTone">{{ t(`save.${exportState}`) }}</p>
      <!--
        **저장했다고 끝이 아니다.** 내려받은 파일은 그 PC의 다운로드 폴더에 있고,
        컴퓨터실 PC는 그것까지 되돌린다. 저장 전에는 "저장해야 남는다"를, 저장 뒤에는
        "밖으로 옮겨야 남는다"를 말한다 — 안내가 비는 상태가 없다.
      -->
      <p class="mt-1 text-ink-soft">
        {{ exportState === 'exported' ? t('save.keepFile') : t('save.exportWarning') }}
      </p>

      <dl v-if="details.length > 0" class="mt-3 border-t border-line pt-3 text-ink-soft">
        <div
          v-for="row in details"
          :key="row.label"
          class="flex items-baseline justify-between gap-3"
        >
          <dt>{{ row.label }}</dt>
          <dd class="tabular-nums">{{ row.value }}</dd>
        </div>
      </dl>
    </AppPopover>

    <span v-else class="min-w-0 flex-1 truncate">{{ t('shell.noProject') }}</span>

    <select
      class="shrink-0 rounded-field bg-transparent px-1 py-0.5"
      :aria-label="t('shell.language')"
      :value="locale"
      @change="onLocale"
    >
      <option v-for="tag in SUPPORTED_LOCALES" :key="tag" :value="tag">
        {{ t(`language.${tag}`) }}
      </option>
    </select>

    <!--
      배색 스위치. **글자 없이 아이콘 하나다** - 상태 표시줄은 좁고, 여기서 폭을 먹으면
      왼쪽 줄이 그만큼 일찍 잘린다. 무엇인지는 설명과 아이콘이 말한다.
    -->
    <button
      type="button"
      class="shrink-0 rounded-control p-1 transition-colors hover:bg-surface-sunken hover:text-ink"
      :title="t(`shell.${nextTheme === 'dark' ? 'toDark' : 'toLight'}`)"
      :aria-label="t(`shell.${nextTheme === 'dark' ? 'toDark' : 'toLight'}`)"
      @click="setTheme(nextTheme)"
    >
      <component
        :is="nextTheme === 'dark' ? ACTION_ICONS.toDark : ACTION_ICONS.toLight"
        :size="18"
        aria-hidden="true"
      />
    </button>
  </footer>
</template>
