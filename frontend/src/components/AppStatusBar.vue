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
 * **그 폭에서는 곁가지를 아예 지운다** (architecture.md §8.8). 레일이 아래로 내려가는
 * 폭(`md` 미만)에서 시각과 용량은 어차피 말줄임표 뒤에 있었다. 잘린 채로 두면
 * **말줄임표가 "더 있는데 못 보여준다"고 말하는데**, 실은 눌러서 팝오버를 열면 다 있다.
 * 팝오버는 안 건드린다 — 지우는 것이 아니라 자리를 옮기는 것이다.
 *
 * 그리고 팝오버가 지금 안 보이던 것을 살린다. `save.exportWarning`은 `title` 툴팁으로만
 * 있었는데 **터치 기기에는 hover가 없어서 휴대폰에서는 영원히 안 뜨는 문장이었다.**
 * 리셋 문제에 답하려고 만든 문장이 그 답이 가장 필요한 화면에서 빠져 있었다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import { exportStateOf } from '@/project/export-state'
import { needsSizeWarning } from '@/project/file-size'
import { PROJECT_FILE_WARN_BYTES } from '@/limits'
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import { hasEstimates } from '@/ml/estimate'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '@/i18n'
import { limitsOff, setLimitsOff } from '@/limits-switch'
import { totalBytes } from '@/project/storage'
import { useProjectStore } from '@/stores/project'
import { otherTheme, setTheme, theme } from '@/theme'

const { t, locale } = useI18n()
const format = useFormat()
const project = useProjectStore()

/**
 * 이 프로젝트가 차지하는 자리. **저장이 세는 것과 같은 함수다** (`project/storage.ts`의
 * `totalBytes`).
 *
 * 여기서 따로 세고 있었고 **사진과 임베딩이 빠져 있었다** — 사진 2,000장짜리 프로젝트가
 * 요약에서는 18.9MB인데 이 줄에서는 829.5kB였다(2026-08-14 실측). 프로젝트 요약이
 * 같은 이유로 같은 자리에서 이미 한 번 고쳐졌는데, 이 줄만 옛 계산을 들고 있었다.
 */
const sizeBytes = computed(() => (project.file === null ? 0 : totalBytes(project.file)))

/**
 * 제출을 막을 만큼 커졌는가. **막지 않고 알린다** (`project/file-size.ts`).
 *
 * **내보내기 순간이 아니라 그 전이다** — 사진을 줄이거나 나눌 수 있는 시점은 [파일로
 * 저장]을 누르기 전이다.
 */
const oversized = computed(() => needsSizeWarning(sizeBytes.value))

/**
 * 내보내기 상태. 셋으로 갈린다 — 안 내보냄 / 내보낸 뒤 고침 / 그대로.
 *
 * **가운데가 중요하다.** "내보냈다"만 보여주면 그 뒤에 한 시간을 더 작업한 학생이
 * 안심한 채로 컴퓨터를 끈다.
 */
const exportState = computed(() => exportStateOf(project.savedAt, project.exportedAt))

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

/**
 * 팝오버 안의 이름 붙은 줄들. 잘린 줄에서는 값만 보이지만 여기서는 무엇인지 밝힌다.
 *
 * **이름은 프로젝트 요약과 같은 키를 쓴다** (`meta.*`). 같은 두 사실을 여기서는
 * `마지막 작업`·`용량`, 요약에서는 `마지막 수정 시각`·`용량`이라 부르고 있었다 -
 * 한쪽만 고쳐지면 학생은 두 화면이 다른 것을 말한다고 읽는다 (2026-08-13).
 */
const details = computed(() => {
  const rows: { label: string; value: string }[] = []
  // **요약 화면과 같은 값을 그린다.** 이름표가 `meta.updated`("수정한 날짜")인데
  // 여기만 `savedAt`(브라우저에 쓴 시각)을 보고 있었다 - 같은 이름 두 값이다
  // (V11 R5 A-1). 저장했는지는 바로 위 `save.*` 줄이 이미 말한다.
  const updatedAt = project.file?.document.manifest.updatedAt
  if (updatedAt !== undefined) {
    rows.push({ label: t('meta.updated'), value: format.dateTime(updatedAt) })
  }
  if (sizeBytes.value > 0) {
    rows.push({ label: t('meta.size'), value: format.bytes(sizeBytes.value) })
  }
  return rows
})

/** 내보내기 상태의 색. 잘린 줄과 팝오버가 같은 것을 봐야 한다. */
const exportTone = computed(() =>
  exportState.value === 'exported' ? 'font-bold text-positive' : 'font-bold text-caution',
)

function onLocale(event: Event): void {
  void setLocale((event.target as HTMLSelectElement).value as Locale)
}

/** 스위치가 가리키는 곳. 아이콘도 설명도 **바뀔 쪽**을 말한다. */
const nextTheme = computed(() => otherTheme(theme.value))

/**
 * 다음에 켤 테마의 이름. **키를 조립하지 않는다** — 값이 둘뿐이고 둘 다 여기서 아는데,
 * 조립하면 그 자리가 "짝이 있는가"를 물어야 하는 자리가 된다 (docs/i18n.md).
 */
const themeLabel = computed(() =>
  nextTheme.value === 'dark' ? t('shell.toDark') : t('shell.toLight'),
)

/**
 * **상한을 푼 상태는 줄에 남는다** (`limits-switch.ts`).
 *
 * 켜 둔 것을 잊은 학생은 탭이 멈췄을 때 **그것이 자기가 고른 결과라는 것을 모른다.**
 * 그래서 이 상태만 글자를 얻는다 — 색으로만 말하면 좁은 화면과 색각 이상에서 사라진다
 * (`architecture.md` §8.18).
 */
const limitsLabel = computed(() =>
  limitsOff.value ? t('shell.limitsReleased') : t('shell.limitsApplied'),
)

/**
 * **사진 프로젝트에는 예상 시간이 없다** (2026-09-01 감사 B-5).
 *
 * 등록부의 이미지 기준표 여덟이 전부 비어 있어(`UNMEASURED_BASELINE`) 학습 화면의 그
 * 칸은 **모든 줄에서 `알 수 없음`**이다. 그런데 팝오버는 *"학습 화면의 예상 시간이 말해
 * 줍니다"*라고 안내했다 — **상한을 푸는 전형이 사진 학생**이고, 등록부 주석이 사진
 * 1,000장에 521.7초라고 적는 그 자리다.
 *
 * **종류로 문구를 가른다** (`docs/i18n.md`의 종류별 키). 프로젝트가 없으면 표 쪽 문장이
 * 맞다 — 그때는 아직 무엇을 학습할지도 안 정해졌다.
 */
const estimateKey = computed(() => {
  const dataType = project.file?.document.manifest.dataType
  // **화면이 종류를 비교하지 않는다** (`architecture.md` §9.1). 등록부에 묻는다 —
  // 기준표가 채워지는 날 이 문구가 저절로 바뀐다.
  return dataType === undefined || hasEstimates(dataType)
    ? 'shell.limitsEstimate'
    : 'shell.limitsEstimateImage'
})
</script>

<template>
  <!--
    **`md` 미만에서 화면 아래에 붙는다** (architecture.md §8.6). 그 폭에서는 문서가
    스크롤하므로, 흐름에 두면 페이지 맨 끝까지 내려야 보인다 — **저장 상태는 늘 보여야
    하는 것**이라(§8.8) 그건 이 줄의 존재 이유를 없앤다.

    아래 여백은 아이폰의 홈 인디케이터 자리다. `h-statusbar`는 그 위의 줄 높이이고,
    비워 둔 만큼은 `--shell-bottom`이 이미 세어 두었다(`base.css`).
  -->
  <footer
    class="z-30 flex h-statusbar shrink-0 items-center gap-2 border-t border-line bg-surface px-3 text-ink-soft max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:box-content max-md:pad-safe-bottom"
  >
    <AppPopover v-if="project.projectId !== null" side="top" size="medium" class="min-w-0 flex-1">
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
          class="block w-full truncate rounded-control px-1.5 py-0.5 text-left transition-colors hover:bg-surface-sunken"
        >
          <span :class="exportTone">
            <span class="mr-2 inline-block size-2 rounded-pill bg-current" aria-hidden="true" />
            {{ t(`save.${exportState}`) }}
          </span>
          <!--
            **구분자도 글자다.** 테두리 토큰(`line-strong`)을 글자색으로 쓰고 있었는데
            흰 바탕에서 대비가 1.6:1이라 가운뎃점이 사실상 안 보였다. 글자 토큰 중
            가장 옅은 것을 쓴다 — 옆 글자(`ink-soft`)보다 한 단 옅어 종속돼 보이면서
            눈에는 들어온다.

            **`md` 미만에서는 통째로 사라진다.** 그 폭에서 이것들은 말줄임표 뒤에 있었고,
            잘린 채 두면 못 보여주는 것이 있다고 말하게 된다 (§8.8). 팝오버에는 그대로 있다.
          -->
          <span v-for="(fact, slot) in facts" :key="slot" class="hidden md:inline">
            <span class="text-ink-faint" aria-hidden="true"> · </span>
            <span>{{ fact }}</span>
          </span>
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
          <dt class="font-bold">{{ row.label }}</dt>
          <dd class="tabular-nums">{{ row.value }}</dd>
        </div>
      </dl>

      <!--
        **막는 것이 아니라 알리는 것이다** (open-decisions.md #32). 그래서 경고색이 아니라
        주의색이고, 여기서 할 수 있는 일은 없다 - 줄이는 자리는 데이터 화면이다.
      -->
      <p v-if="oversized" class="mt-3 border-t border-line pt-3 leading-relaxed text-caution">
        {{ t('meta.sizeWarning', { limit: format.bytes(PROJECT_FILE_WARN_BYTES) }) }}
      </p>
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
      이 기기의 상한 (`limits-switch.ts`). **팝오버인 이유는 바꾸는 것이 무엇인지 그
      자리에서 말해야 하기 때문이다** (open-decisions.md "상한은 누가 정했느냐" §2) —
      학생이 에러를 없애려고 켤 수 있고, 그때 만나는 것이 "더 큰 데이터"가 아니라
      "안 끝나는 학습"일 수 있다.

      **푼 상태에서만 글자가 붙는다.** 평소에는 아이콘 하나로 폭을 아끼고, 켜 둔 것을
      잊었을 때만 줄이 그 사실을 말한다.
    -->
    <AppPopover side="top" align="right" size="medium" class="shrink-0">
      <template #trigger="{ open }">
        <button
          type="button"
          :aria-expanded="open"
          :aria-label="limitsOff ? t('shell.limitsOpenName') : t('shell.limits')"
          :title="limitsLabel"
          class="flex items-center gap-1 rounded-control p-1 transition-colors hover:bg-surface-sunken hover:text-ink"
          :class="limitsOff ? 'text-caution' : ''"
        >
          <component :is="ACTION_ICONS.limits" :size="18" aria-hidden="true" />
          <!--
            **글줄 높이를 아이콘 아래로 낮춘다** (2026-09-01, 사용자가 화면에서 잡았다).

            팝오버는 **트리거의 위쪽 끝**에 붙는다 — `AppPopover`가 패널의 아래를
            `innerHeight - trigger.top + GAP`으로 잡는다. 그래서 **트리거가 커지면 패널이
            그만큼 위로 밀리고**, 상태 표시줄과의 여백이 상태마다 달라진다.

            글자를 그대로 두면 줄 상자가 24px(`text-base` × 1.5)이라 18px 아이콘보다 커서
            버튼이 26px에서 32px이 된다 — 트리거가 가운데 정렬이라 위쪽 끝이 3px 올라가고,
            **여백이 딱 그만큼 벌어진다.** `leading-none`이면 줄 상자가 16px이라 아이콘이
            여전히 높이를 정하고, 두 상태의 버튼이 같은 크기가 된다.

            **글자 크기는 안 건드린다** — 가장 작은 것이 `text-base`다 (`base.css`).

            **이 자리는 상태이지 동작이 아니다** (2026-09-01, 사용자). 처음에는 팝오버 안
            단추의 이름(`limitsRelease`)을 그대로 썼는데, 그건 **누르면 일어날 일**의
            이름이다 — 줄에 붙는 것은 **지금 어떤 상태인가**여야 한다. 영어에서 더 나빴다:
            상태 표시 자리에 `Turn limits off`라는 **명령문**이 떠 있었다.

            **`md` 미만에서는 글자를 접는다** (2026-09-01 감사 B-6). 375px에서 이 글자가
            내보내기 상태의 폭을 **194px에서 106px로** 깎는데, §8.8이 *"내보내기 상태는
            어떤 폭에서도 살아남는다"*고 못 박았다. 이 줄의 다른 곁가지도 전부 그 폭에서
            사라진다(`facts` 스팬 · `ExportButton` · `ProjectStatus`).

            **그 폭에서 색만 남는 것은 아니다** — 위 `aria-label`이 상태를 이름에 담고,
            팝오버가 문장으로 말한다. 그래도 **시각적으로는 색이 유일한 신호**이므로,
            좁은 화면에서 이 상태를 더 크게 알려야 한다면 그건 이 줄이 아니라 학습 화면이
            할 일이다.
          -->
          <span v-if="limitsOff" class="leading-none max-md:hidden">{{
            t('shell.limitsOff')
          }}</span>
        </button>
      </template>

      <!--
        **네 줄이 각자 한 가지만 말한다** — 지금 어떤 상태인가 · 그 상태가 뜻하는 것 ·
        다음에 볼 곳 · 이 설정이 미치는 범위.

        **가운데 둘은 상태마다 다른 문장이다** (2026-09-01, 사용자). 켠 뒤에도 *"해제하면"*
        이라고 적고 있었는데, **이미 해제한 사람에게 가정법으로 말하는 것**이라 그 줄만
        화면과 어긋났다. 키를 조립하지 않고 둘 중 하나를 고른다 (배색 스위치와 같은 모양).
      -->
      <p :class="limitsOff ? 'font-bold text-caution' : 'font-bold'">{{ limitsLabel }}</p>
      <p class="mt-1 leading-relaxed text-ink-soft">
        {{ limitsOff ? t('shell.limitsRiskOn') : t('shell.limitsWhy') }}
      </p>
      <p class="mt-1 leading-relaxed text-ink-soft">
        {{ limitsOff ? t(estimateKey) : t('shell.limitsRisk') }}
      </p>
      <p class="mt-1 leading-relaxed text-ink-faint">{{ t('shell.limitsDevice') }}</p>

      <!--
        **`action`으로 준다.** 저장이 IndexedDB를 지나므로 `@click`으로 두면 Vue가
        기다려 주지 않아 두 번 눌리는 것을 못 막는다 (CLAUDE.md §4).
      -->
      <AppButton
        class="mt-3"
        :variant="limitsOff ? 'secondary' : 'danger'"
        :action="() => setLimitsOff(!limitsOff)"
      >
        {{ limitsOff ? t('shell.limitsRestore') : t('shell.limitsRelease') }}
      </AppButton>
    </AppPopover>

    <!--
      배색 스위치. **글자 없이 아이콘 하나다** - 상태 표시줄은 좁고, 여기서 폭을 먹으면
      왼쪽 줄이 그만큼 일찍 잘린다. 무엇인지는 설명과 아이콘이 말한다.
    -->
    <button
      type="button"
      class="shrink-0 rounded-control p-1 transition-colors hover:bg-surface-sunken hover:text-ink"
      :title="themeLabel"
      :aria-label="themeLabel"
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
