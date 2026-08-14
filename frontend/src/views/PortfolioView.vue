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
import { ACTION_ICONS } from '@/icons'
import { BYTES_PER_MB, MAX_PORTFOLIO_BYTES } from '@/limits'
import { bakeAttachments } from '@/project/attachments'
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
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import OrphanAnswers from './portfolio/OrphanAnswers.vue'
import PortfolioPreview from './portfolio/PortfolioPreview.vue'
import SectionCard from './portfolio/SectionCard.vue'
import SectionIndex from './portfolio/SectionIndex.vue'
import TemplateSourceMenu from './portfolio/TemplateSourceMenu.vue'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

/** 아직 아무 파일도 안 열렸을 때도 판정은 돌아야 한다. */
const EMPTY: Portfolio = { template: { sections: [] }, answers: {}, attachments: {} }

const portfolio = computed<Portfolio>(() => project.file?.document.portfolio ?? EMPTY)
const sections = computed(() => portfolioSections(portfolio.value))
const orphans = computed(() => orphanAnswers(portfolio.value))
const started = computed(() => hasTemplate(portfolio.value))

/** 쓰는 화면과 받는 사람이 볼 화면. 나란히 두지 않는다 - 휴대폰이 기준이다. */
const preview = ref(false)

/** 지울지 물어보고 있는 문항. 지우면 그 글도 함께 사라지므로 되돌릴 수 없다 (§8.4). */
const removing = ref<string | null>(null)

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
  project.update({ ...file, attachments, document: { ...file.document, portfolio: next } })
}

/** 문항 하나짜리 빈 양식. **코드가 만든다** - 파일도 연결도 필요 없다 (§8.3). */
function startEmpty(): void {
  apply(withSectionAdded(portfolio.value, { title: t('portfolio.firstSection') }))
}

function addSection(): void {
  apply(withSectionAdded(portfolio.value, { title: t('portfolio.newSection') }))
}

/**
 * 양식을 가져온다. **대체가 아니라 추가다** (§8.3).
 *
 * 두 번 눌러도 문항이 안 불어나므로 "아무 일도 안 일어났다"가 정상인 경우가 있다.
 * 그때도 말해 준다 - 눌렀는데 화면이 그대로면 고장으로 읽힌다.
 */
function importMarkdown(markdown: string | null): void {
  // 파일 고르기를 닫은 것은 실패가 아니다. 아무 말도 하지 않는다.
  if (markdown === null) return

  const parsed = parsePortfolioForm(markdown)
  const before = portfolio.value.template.sections.length
  const next = withImportedSections(portfolio.value, parsed.sections)
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
 * **화면에 조금이라도 보이는 문항 중 가장 위다.** 판정에 숫자를 넣지 않는 이유는
 * 근거 없는 임계값이 되기 때문이다 - "얼마나 보여야 지금 문항인가"에 답이 없다.
 * 순서는 양식이 갖는다.
 *
 * **`IntersectionObserver`가 없으면 표시만 안 뜬다** (jsdom이 그렇다). 화면은 그대로
 * 돌고 목차도 그대로 눌린다.
 */
const active = ref<string | null>(null)
const visible = new Set<string>()
let spy: IntersectionObserver | null = null

function watchSections(): void {
  spy?.disconnect()
  visible.clear()
  if (typeof IntersectionObserver === 'undefined') return

  spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target.id)
      else visible.delete(entry.target.id)
    }
    const top = sections.value.find((section) => visible.has(anchorId(section.id)))
    // 아무것도 안 보이는 순간(전환 중)에 표시를 지우지 않는다 - 깜빡이는 것이 더 나쁘다.
    if (top !== undefined) active.value = top.id
  })

  for (const section of sections.value) {
    const element = document.getElementById(anchorId(section.id))
    if (element !== null) spy.observe(element)
  }
}

// 문항이 늘거나 줄거나, 완성본으로 넘어가면 보고 있던 요소가 사라진다. 그려진 뒤에 다시 건다.
watch([sections, preview], () => void nextTick(watchSections), { immediate: true })

onBeforeUnmount(() => spy?.disconnect())

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
function detach(sectionId: string, path: string): void {
  const bytes = new Map(project.file?.attachments ?? [])
  bytes.delete(path)
  apply(withAttachmentRemoved(portfolio.value, sectionId, path), undefined, bytes)
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
      <StepActionBar>
        <TemplateSourceMenu
          :pick-file="pickFile"
          @pick="importMarkdown"
          @failed="toasts.pushError"
        />

        <template #end>
          <AppButton variant="secondary" @click="preview = !preview">
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
        <div class="self-start max-md:hidden md:sticky md:col-span-3 md:stick-under-step-bar">
          <SectionIndex :sections="sections" :active="active ?? undefined" @pick="goTo" />
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
              @detach="(path) => detach(section.id, path)"
            />

            <div class="flex justify-center">
              <AppButton variant="secondary" @click="addSection">
                <component :is="ACTION_ICONS.addSection" :size="18" aria-hidden="true" />
                {{ t('portfolio.addSection') }}
              </AppButton>
            </div>

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
