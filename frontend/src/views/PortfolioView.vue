<script setup lang="ts">
/**
 * portfolio 단계. **학생이 과정을 글로 남긴다** (mlpx-spec.md §8).
 *
 * **양식은 마크다운이고 답은 서식 없는 글이다.** 쓰는 사람은 마크다운 기호를 한 번도
 * 보지 않는다 - 이 화면에 문법 편집기가 없는 이유가 그것이다.
 *
 * **빈 프로젝트에서 열어도 화면이 비지 않는다.** 양식이 아직 없으면 둘을 준다:
 * [빈 양식에서 시작]과 [양식 가져오기]. **바닥은 프리셋이 아니라 빈 양식이다** -
 * 프리셋은 `public/`에 있어 네트워크를 타고, 빈 양식은 코드가 만들어 무슨 일이
 * 있어도 시작할 수 있다 (§8.3).
 *
 * **판단은 전부 `project/portfolio.ts`에 있다.** 여기는 그 함수들을 부르고 결과를
 * 저장할 뿐이다 - 문항을 지울 때 답도 지우는 것 같은 규칙이 화면에 흩어지면 아무도
 * 그것을 테스트하지 않는다.
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepActionBar from '@/components/StepActionBar.vue'
import StepHeader from '@/components/StepHeader.vue'
import { ClientError } from '@/errors'
import type { Locale } from '@/i18n'
import { ACTION_ICONS } from '@/icons'
import { BYTES_PER_MB, MAX_PORTFOLIO_BYTES } from '@/limits'
import { bakeAttachments } from '@/project/attachments'
import { touch } from '@/project/create'
import { parsePortfolioForm } from '@/project/portfolio-form'
import {
  attachmentsOf,
  hasTemplate,
  nextAttachmentPath,
  orphanAnswers,
  portfolioBytes,
  portfolioSections,
  withAnswer,
  withAttachmentAdded,
  withAttachmentRemoved,
  withImportedSections,
  withSectionAdded,
  withSectionMoved,
  withSectionRemoved,
  withSectionText,
} from '@/project/portfolio'
import type { Portfolio } from '@/project/schema'
import { growToFit, nearestScrollport, stickyCover } from '@/screen'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import OrphanAnswers from './portfolio/OrphanAnswers.vue'
import PortfolioPreview from './portfolio/PortfolioPreview.vue'
import SectionCard from './portfolio/SectionCard.vue'
import SectionIndex from './portfolio/SectionIndex.vue'
import SizeMeter from './portfolio/SizeMeter.vue'
import TemplateSourceMenu from './portfolio/TemplateSourceMenu.vue'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

/** 아직 아무 파일도 안 열렸을 때도 판정은 돌아야 한다. */
const EMPTY: Portfolio = {
  template: { sections: [] },
  answerFormat: 'plain-v1',
  answers: {},
  attachments: {},
}

const portfolio = computed<Portfolio>(() => project.file?.document.portfolio ?? EMPTY)
const sections = computed(() => portfolioSections(portfolio.value))
const orphans = computed(() => orphanAnswers(portfolio.value))
const started = computed(() => hasTemplate(portfolio.value))

/**
 * 지금 담긴 양. **상한을 거는 것과 같은 함수로 잰다** - 두 벌이면 게이지가 가득 차기 전에
 * 거절당하거나 그 반대가 된다 (§8.6.1).
 */
const usedBytes = computed(() =>
  portfolioBytes(portfolio.value, project.file?.attachments ?? new Map()),
)

/** 쓰는 화면과 받는 사람이 볼 화면. 나란히 두지 않는다 - 휴대폰이 기준이다. */
const preview = ref(false)

/** 지울지 물어보고 있는 문항. 지우면 그 글도 함께 사라지므로 되돌릴 수 없다 (§8.4). */
const removing = ref<string | null>(null)
/**
 * 지울지 물어보는 중인 사진. **확인을 세운 이유는 되돌릴 수 없기 때문이다** —
 * `docs/copy.md`가 낱말을 "빼기"가 아니라 "지우기"로 고른 그 무게다. 데이터 화면은
 * 같은 무게의 일에 이미 대화상자를 세우는데 여기만 즉시였다 (V11 R5 C-4).
 */
const detaching = ref<{ sectionId: string; path: string } | null>(null)

/**
 * 고친 결과를 문서에 넣는다. **상한을 여기 하나로 건다** (§8.6.1).
 *
 * 거절할 때 `revert`를 부르는 이유는 **DOM과 스키마가 갈리면 화면이 파일과 다른 글자를
 * 들고 있기 때문이다** (architecture.md §8.15.1). 값이 안 바뀌면 Vue는 DOM을 다시
 * 안 쓴다.
 */
function apply(next: Portfolio, revert?: () => void, bytes?: Map<string, Uint8Array>): void {
  const file = project.file
  if (!file) return
  const attachments = bytes ?? file.attachments
  if (portfolioBytes(next, attachments) > MAX_PORTFOLIO_BYTES) {
    revert?.()
    toasts.pushError(
      new ClientError('PORTFOLIO_TOO_LARGE', { limitMb: MAX_PORTFOLIO_BYTES / BYTES_PER_MB }),
    )
    return
  }
  // **포트폴리오를 쓴 것도 프로젝트를 고친 것이다.** 안 찍으면 화면의 "수정한 날짜"가
  // 지난 차시로 남고, 목록이 updatedAt 인덱스로 정렬하므로 한 시간을 쓴 프로젝트가
  // 아무것도 안 한 프로젝트 아래로 가라앉는다 (V11 R5 A-1). 프로젝트를 고치는 다른
  // 열한 자리는 전부 찍는다 - 여기만 빠져 있었다.
  project.update({
    ...file,
    attachments,
    document: touch({ ...file.document, portfolio: next }, new Date().toISOString()),
  })
}

/** 문항 하나짜리 빈 양식. **코드가 만든다** - 파일도 연결도 필요 없다 (§8.3). */
function startEmpty(): void {
  apply(withSectionAdded(portfolio.value, { title: t('portfolio.firstSection') }))
}

/**
 * 문항을 하나 더한다. **더한 곳으로 데려간다** - 새 문항은 맨 뒤에 붙으므로, 붙박이 바에서
 * 누르면 **화면 밖에서 생긴다.** 눌렀는데 아무 일도 안 일어난 것으로 보인다.
 */
function addSection(): void {
  const before = new Set(sections.value.map((one) => one.id))
  apply(withSectionAdded(portfolio.value, { title: t('portfolio.newSection') }))
  void nextTick(() => {
    const added = sections.value.find((one) => !before.has(one.id))
    if (added !== undefined) goTo(added.id)
  })
}

/**
 * 양식을 가져온다. **대체가 아니라 추가다** (§8.3).
 *
 * 두 번 눌러도 문항이 안 불어나므로 "아무 일도 안 일어났다"가 정상인 경우가 있다.
 * 그때도 말해 준다 - 눌렀는데 화면이 그대로면 고장으로 읽힌다.
 */
function importMarkdown(markdown: string | null, locale?: Locale): void {
  // 파일 고르기를 닫은 것은 실패가 아니다. 아무 말도 하지 않는다.
  if (markdown === null) return

  const parsed = parsePortfolioForm(markdown)
  const before = portfolio.value.template.sections.length
  // **언어는 줄이 들고 온다** (§8.5). 모르는 출처는 안 넘기고, 그때 필드가 안 생긴다.
  const next = withImportedSections(portfolio.value, parsed.sections, locale)
  apply(next)
  const added = next.template.sections.length - before
  if (added > 0) toasts.push('success', 'portfolio.imported', { count: added })
  else toasts.push('caution', 'portfolio.importedNone')
}

/**
 * 파일 하나를 고르게 한다. **등록부에 넘겨줄 손이다** - DOM을 아는 것은 화면뿐이다.
 *
 * `value`를 비우는 이유는 **같은 파일을 다시 골라도 `change`가 오게** 하기 위해서다.
 * 고르지 않고 닫으면 `cancel`이 온다 - 그것이 없는 옛 브라우저에서는 목록을 닫았다
 * 다시 열면 풀린다(팝오버가 닫히면 그 줄이 통째로 사라진다).
 */
const fileInput = ref<HTMLInputElement | null>(null)
let picking: ((file: File | null) => void) | null = null

function pickFile(): Promise<File | null> {
  const input = fileInput.value
  if (input === null) return Promise.resolve(null)
  input.value = ''
  return new Promise((resolve) => {
    picking = resolve
    input.click()
  })
}

function onPicked(): void {
  const picked = fileInput.value?.files?.[0] ?? null
  picking?.(picked)
  picking = null
}

function setAnswer(id: string, text: string, element: HTMLTextAreaElement): void {
  apply(withAnswer(portfolio.value, id, text), () => {
    element.value = portfolio.value.answers[id] ?? ''
    // 되돌리면 글이 짧아진다. 값만 되돌리고 높이를 두면 칸이 늘어난 채로 남는다.
    growToFit(element)
  })
}

function setTitle(id: string, text: string, element: HTMLInputElement): void {
  apply(withSectionText(portfolio.value, id, { title: text }), () => {
    element.value = sections.value.find((section) => section.id === id)?.title ?? ''
  })
}

function setDescription(id: string, text: string, element: HTMLTextAreaElement): void {
  apply(withSectionText(portfolio.value, id, { description: text }), () => {
    element.value = sections.value.find((section) => section.id === id)?.description ?? ''
  })
}

/**
 * 목차에서 고른 문항으로 데려간다.
 *
 * **도착 지점은 붙박이 바 아래에서 멈춘다** (`under-step-bar`). 여백이 없으면 목표가
 * 화면 맨 위에 붙고 그 자리는 이미 동작 바가 덮고 있다 - 눌렀는데 아무 일도 안
 * 일어난 것처럼 보인다.
 */
function anchorId(id: string): string {
  return `portfolio-section-${id}`
}

function goTo(id: string): void {
  document.getElementById(anchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * 지금 보고 있는 문항. 목차가 이것을 표시한다.
 *
 * **판정선을 지난 문항 중 마지막이다.** 그 선은 `scrollIntoView`가 데려다 놓는 자리와
 * 같은 선이고(`under-step-bar`), 값은 `stickyCover`가 요소에서 읽어 온다 - 여기서 따로
 * 재면 두 선이 갈린다. **뒤엣것이 이기는 이유는 도착한 문항이 정확히 그 선에 얹히기
 * 때문이다** - 앞 문항의 끝도 같은 선에 걸려 있을 수 있다.
 *
 * **`IntersectionObserver`로는 이 자리를 못 고친다** (2026-08-15, 두 번 틀린 뒤에 옮겼다).
 * 그것은 **교차 상태가 바뀔 때만** 항목을 주는데, 완성본은 문항이 한 장 안에서 맞닿아
 * 있어서 앞 문항이 "닿아 있는 채로" 남는다 - 상태가 안 바뀌니 항목이 아예 안 오고,
 * 콜백 안에서 무엇을 걸러도 그 코드가 그 문항에는 돌지 않는다. 작성 화면은 카드 사이에
 * 여백이 있어 이 병을 안 앓았을 뿐이다.
 *
 * **화면과 뷰포트가 같지 않다는 것도 여기서 함께 걸린다.** 넓은 화면에서 굴리는 것은
 * 문서가 아니라 `<main>`이라(`AppShell`) 스크롤 사건도 거기서 난다 - `window`에만 붙이면
 * 아무 소리도 안 들린다. 그 상자는 `nearestScrollport`가 찾는다.
 *
 * **한 픽셀 아래는 자리 차이가 아니다.** 소수점 좌표를 그대로 견주면 도착한 문항이
 * `line + 0.4`에 서는 순간 앞 문항이 이긴다. 그래서 둘 다 픽셀로 반올림해 견준다 -
 * 임의의 여유값이 아니라 **같은 픽셀이면 같은 자리**라는 말이다.
 */
const active = ref<string | null>(null)

/** 다시 재기로 예약된 프레임. 스크롤마다 재면 한 번 굴릴 때 수십 번 잰다. */
let scheduled = 0
/** 스크롤 사건을 듣고 있는 상자. `window`일 수도 있고 `<main>`일 수도 있다. */
let listening: EventTarget | null = null

function measure(): void {
  let line: number | null = null
  let current: string | null = null

  for (const section of sections.value) {
    const element = document.getElementById(anchorId(section.id))
    if (element === null) continue
    // 선은 한 번만 읽는다. 문항들은 같은 규칙을 쓰므로 값이 같다.
    line ??= stickyCover(element)
    if (Math.round(element.getBoundingClientRect().top) > Math.round(line)) break
    current = section.id
  }

  // 첫 문항이 아직 선 아래에 있으면(맨 위에서) 그것이 지금 문항이다.
  active.value = current ?? sections.value[0]?.id ?? null
}

function schedule(): void {
  if (typeof requestAnimationFrame === 'undefined') {
    measure()
    return
  }
  if (scheduled !== 0) return
  scheduled = requestAnimationFrame(() => {
    scheduled = 0
    measure()
  })
}

function stopListening(): void {
  listening?.removeEventListener('scroll', schedule)
  listening = null
}

function watchSections(): void {
  stopListening()
  if (typeof window === 'undefined') return

  const first = sections.value
    .map((section) => document.getElementById(anchorId(section.id)))
    .find((element) => element !== null)
  if (first === undefined) return

  // 굴리는 상자에서 사건이 난다. 없으면 문서가 굴리는 것이고 그때는 창이 듣는다.
  listening = nearestScrollport(first) ?? window
  listening.addEventListener('scroll', schedule, { passive: true })
  measure()
}

// 문항이 늘거나 줄거나, 완성본으로 넘어가면 보고 있던 요소가 사라진다. 그려진 뒤에 다시 건다.
watch([sections, preview], () => void nextTick(watchSections), { immediate: true })

// 바가 두 줄로 접히거나 펴지면 선이 내려온다. 굴리는 상자가 바뀌는 폭도 여기서 걸린다.
function rewatch(): void {
  void nextTick(watchSections)
}

if (typeof window !== 'undefined') window.addEventListener('resize', rewatch)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', rewatch)
  if (typeof requestAnimationFrame !== 'undefined' && scheduled !== 0) {
    cancelAnimationFrame(scheduled)
  }
  stopListening()
})

/**
 * 사진을 붙인다. **굽고 나서 상한을 본다** - 구워 봐야 크기를 알기 때문이다.
 *
 * 여러 장이 한 번에 오면 **되는 데까지 붙인다.** 첫 장에서 멈추면 학생은 나머지가
 * 왜 없는지 모르고, 통째로 거절하면 한 장 때문에 아홉 장을 다시 고르게 된다.
 */
async function attach(sectionId: string, files: readonly File[]): Promise<void> {
  const file = project.file
  if (!file || files.length === 0) return

  try {
    const baked = await bakeAttachments(files)
    if (baked.length < files.length) {
      toasts.push('caution', 'portfolio.photoSkipped', { count: files.length - baked.length })
    }
    for (const one of baked) {
      const path = nextAttachmentPath(portfolio.value, one.extension)
      const bytes = new Map(project.file?.attachments ?? [])
      bytes.set(path, one.bytes)
      apply(withAttachmentAdded(portfolio.value, sectionId, path), undefined, bytes)
    }
  } catch (error) {
    toasts.pushError(error)
  }
}

/** 사진을 뗀다. **바이트도 함께 놓는다** - 저장에서 빠지는 것과 별개로 지금 자리를 비운다. */
function detach(): void {
  const target = detaching.value
  detaching.value = null
  if (!target) return
  const bytes = new Map(project.file?.attachments ?? [])
  bytes.delete(target.path)
  apply(withAttachmentRemoved(portfolio.value, target.sectionId, target.path), undefined, bytes)
}

/**
 * 사진의 미리보기 주소. **살아 있는 것만 남기고 나머지는 놓아준다** - 안 놓으면 붙였다
 * 뗀 사진의 바이트가 탭이 닫힐 때까지 메모리에 남는다.
 */
const urls = ref(new Map<string, string>())

watch(
  () => project.file?.attachments,
  (current) => {
    const alive = current ?? new Map<string, Uint8Array>()
    const next = new Map<string, string>()
    for (const [path, url] of urls.value) {
      if (alive.has(path)) next.set(path, url)
      else URL.revokeObjectURL(url)
    }
    for (const [path, bytes] of alive) {
      if (next.has(path)) continue
      // `Uint8Array`의 버퍼가 `SharedArrayBuffer`일 수도 있다고 보는 자리라 단언한다
      // (`project/download.ts`가 같은 이유로 같은 모양이다).
      next.set(path, URL.createObjectURL(new Blob([bytes as unknown as BlobPart])))
    }
    urls.value = next
  },
  { immediate: true, deep: false },
)

onBeforeUnmount(() => {
  for (const url of urls.value.values()) URL.revokeObjectURL(url)
})

/** 문항 하나에 붙은 사진들. 화면이 그리는 모양으로 만들어 넘긴다. */
function photosOf(sectionId: string): { path: string; url: string }[] {
  return attachmentsOf(portfolio.value, sectionId)
    .map((path) => ({ path, url: urls.value.get(path) ?? '' }))
    .filter((one) => one.url !== '')
}

function remove(): void {
  const id = removing.value
  removing.value = null
  if (id !== null) apply(withSectionRemoved(portfolio.value, id))
}
</script>

<template>
  <div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.portfolio.label')" :purpose="t('steps.portfolio.purpose')" />

    <template v-if="started">
      <!--
        **바가 비어 있으면 안 된다** (architecture.md §8.18). 왼쪽은 누를 것(가져오기,
        문항 추가), 오른쪽은 지금 무슨 일이 있는지(담긴 양)와 결론이다.
      -->
      <StepActionBar>
        <!--
          **좁은 화면에서는 글자를 접고 그림만 남긴다** (§8.18). 바가 두 줄이 되면 그만큼
          아래 글 칸이 줄어든다 - 읽을 이름은 `label`이 갖는다.
        -->
        <TemplateSourceMenu
          compact
          :pick-file="pickFile"
          @pick="importMarkdown"
          @failed="toasts.pushError"
        />

        <AppButton variant="secondary" :label="t('portfolio.addSection')" @click="addSection">
          <component :is="ACTION_ICONS.addSection" :size="18" aria-hidden="true" />
          <span class="max-md:hidden">{{ t('portfolio.addSection') }}</span>
        </AppButton>

        <!--
          **진행은 목차가 말한다** (§8.18). 여기에도 같은 문장이 있었는데, 한 화면에서
          같은 사실을 두 번 적으면 그중 하나는 언젠가 안 고쳐진다.

          **담긴 양은 결론 옆에 선다.** 지금 무슨 일이 있는지를 말하는 것이라 누를 것들과
          섞이면 안 읽힌다. **알려 주는 것은 좁은 화면에서 빠진다** - 바가 접히면서 먹는
          세로가 곧 아래 글 칸의 높이다.
        -->
        <template #end>
          <SizeMeter class="max-md:hidden" :used="usedBytes" :limit="MAX_PORTFOLIO_BYTES" />

          <!-- 결론은 이 화면에서도 primary다 (§8.13.1) - 왼쪽의 거드는 단추들과 무게가 다르다. -->
          <AppButton @click="preview = !preview">
            {{ preview ? t('portfolio.write') : t('portfolio.preview') }}
          </AppButton>
        </template>
      </StepActionBar>

      <!--
        **3 대 7이다** (2026-08-14, 사용자). 왼쪽은 어디까지 왔는지를 말하는 목차이고
        본체는 쓰는 자리라, 목차가 제목 한 줄을 담을 만큼만 가져간다. 기본 눈금
        열을 쓴다 - 임의 값을 템플릿에 두지 않는다 (CLAUDE.md §4).
      -->
      <div class="grid gap-5 md:grid-cols-10">
        <!--
          **왼쪽은 붙박이다.** `self-start`가 없으면 격자 기본값(`stretch`)이 이 칸을
          오른쪽만큼 늘려서 붙을 자리가 안 생긴다.
        -->
        <!--
          **좁은 화면에서는 붙박이를 풀고 맨 위에 선다** (§8.18.1). 거기서는 옆에 놓을
          자리가 없고(§8.10.1), 붙박이로 두면 그 높이만큼 글 칸이 줄어든다.
        -->
        <div class="self-start md:sticky md:col-span-3 md:stick-under-step-bar">
          <SectionIndex
            :sections="sections"
            :active="active ?? undefined"
            :outline="preview"
            @pick="goTo"
          />
        </div>

        <div class="flex min-w-0 flex-col gap-5 md:col-span-7">
          <PortfolioPreview
            v-if="preview"
            :sections="sections"
            :orphans="orphans"
            :anchor-id="anchorId"
            :photos-of="photosOf"
          />

          <template v-else>
            <SectionCard
              v-for="(section, index) in sections"
              :id="anchorId(section.id)"
              :key="section.id"
              class="under-step-bar"
              :section="section"
              :index="index"
              :count="sections.length"
              :photos="photosOf(section.id)"
              @answer="(text, element) => setAnswer(section.id, text, element)"
              @title="(text, element) => setTitle(section.id, text, element)"
              @description="(text, element) => setDescription(section.id, text, element)"
              @move="(delta) => apply(withSectionMoved(portfolio, section.id, delta))"
              @remove="removing = section.id"
              @attach="(files) => attach(section.id, files)"
              @detach="(path) => (detaching = { sectionId: section.id, path })"
            />

            <OrphanAnswers v-if="orphans.length > 0" :orphans="orphans" />
          </template>
        </div>
      </div>
    </template>

    <AppCard v-else>
      <AppEmpty :reason="t('portfolio.startReason')" :next="t('portfolio.startNext')">
        <AppButton size="lg" @click="startEmpty">{{ t('portfolio.startEmpty') }}</AppButton>

        <TemplateSourceMenu
          size="lg"
          :pick-file="pickFile"
          @pick="importMarkdown"
          @failed="toasts.pushError"
        />
      </AppEmpty>
    </AppCard>

    <!-- 양식 파일을 고르는 자리. `.mlpx` 열기와 같은 관용구다. -->
    <input
      ref="fileInput"
      type="file"
      accept=".md,text/markdown"
      class="hidden"
      @change="onPicked"
      @cancel="onPicked"
    />

    <AppDialog
      :open="detaching !== null"
      :title="t('portfolio.photoRemoveTitle')"
      :description="t('portfolio.photoRemoveLead')"
      @close="detaching = null"
    >
      <template #actions>
        <AppButton variant="secondary" @click="detaching = null">{{
          t('common.cancel')
        }}</AppButton>
        <AppButton variant="danger" @click="detach">{{ t('portfolio.removeConfirm') }}</AppButton>
      </template>
    </AppDialog>

    <AppDialog
      :open="removing !== null"
      :title="t('portfolio.removeTitle')"
      :description="t('portfolio.removeLead')"
      @close="removing = null"
    >
      <template #actions>
        <AppButton variant="secondary" @click="removing = null">{{ t('common.cancel') }}</AppButton>
        <AppButton variant="danger" @click="remove">{{ t('portfolio.removeConfirm') }}</AppButton>
      </template>
    </AppDialog>
  </div>
</template>
