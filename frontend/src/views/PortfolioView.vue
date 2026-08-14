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

import { computed, ref } from 'vue'
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
import { FALLBACK_LOCALE, isSupportedLocale, type Locale } from '@/i18n'
import { parsePortfolioForm } from '@/project/portfolio-form'
import type { TemplateSource } from '@/project/portfolio-sources'
import {
  hasTemplate,
  orphanAnswers,
  portfolioSections,
  portfolioTextBytes,
  withAnswer,
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
import TemplateSourceMenu from './portfolio/TemplateSourceMenu.vue'

const { t, locale } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

/** 아직 아무 파일도 안 열렸을 때도 판정은 돌아야 한다. */
const EMPTY: Portfolio = { template: { sections: [] }, answers: {} }

const portfolio = computed<Portfolio>(() => project.file?.document.portfolio ?? EMPTY)
const sections = computed(() => portfolioSections(portfolio.value))
const orphans = computed(() => orphanAnswers(portfolio.value))
const started = computed(() => hasTemplate(portfolio.value))

/** 쓰는 화면과 받는 사람이 볼 화면. 나란히 두지 않는다 - 휴대폰이 기준이다. */
const preview = ref(false)

/** 지울지 물어보고 있는 문항. 지우면 그 글도 함께 사라지므로 되돌릴 수 없다 (§8.4). */
const removing = ref<string | null>(null)

const current = computed<Locale>(() =>
  isSupportedLocale(locale.value) ? locale.value : FALLBACK_LOCALE,
)

/**
 * 고친 결과를 문서에 넣는다. **상한을 여기 하나로 건다** (§8.6.1).
 *
 * 거절할 때 `revert`를 부르는 이유는 **DOM과 스키마가 갈리면 화면이 파일과 다른 글자를
 * 들고 있기 때문이다** (architecture.md §8.15.1). 값이 안 바뀌면 Vue는 DOM을 다시
 * 안 쓴다.
 */
function apply(next: Portfolio, revert?: () => void): void {
  const file = project.file
  if (!file) return
  if (portfolioTextBytes(next) > MAX_PORTFOLIO_BYTES) {
    revert?.()
    toasts.pushError(
      new ClientError('PORTFOLIO_TOO_LARGE', { limitMb: MAX_PORTFOLIO_BYTES / BYTES_PER_MB }),
    )
    return
  }
  project.update({ ...file, document: { ...file.document, portfolio: next } })
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
async function importFrom(source: TemplateSource): Promise<void> {
  try {
    const parsed = parsePortfolioForm(await source.load({ locale: current.value }))
    const before = portfolio.value.template.sections.length
    const next = withImportedSections(portfolio.value, parsed.sections)
    apply(next)
    const added = next.template.sections.length - before
    if (added > 0) toasts.push('success', 'portfolio.imported', { count: added })
    else toasts.push('caution', 'portfolio.importedNone')
  } catch (error) {
    toasts.pushError(error)
  }
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
        <TemplateSourceMenu :load="importFrom" />

        <template #end>
          <AppButton variant="secondary" @click="preview = !preview">
            {{ preview ? t('portfolio.write') : t('portfolio.preview') }}
          </AppButton>
        </template>
      </StepActionBar>

      <PortfolioPreview v-if="preview" :sections="sections" :orphans="orphans" />

      <div v-else class="flex flex-col gap-5">
        <SectionCard
          v-for="(section, index) in sections"
          :key="section.id"
          :section="section"
          :index="index"
          :count="sections.length"
          @answer="(text, element) => setAnswer(section.id, text, element)"
          @title="(text, element) => setTitle(section.id, text, element)"
          @description="(text, element) => setDescription(section.id, text, element)"
          @move="(delta) => apply(withSectionMoved(portfolio, section.id, delta))"
          @remove="removing = section.id"
        />

        <div class="flex justify-center">
          <AppButton variant="secondary" @click="addSection">
            <component :is="ACTION_ICONS.addSection" :size="18" aria-hidden="true" />
            {{ t('portfolio.addSection') }}
          </AppButton>
        </div>

        <OrphanAnswers v-if="orphans.length > 0" :orphans="orphans" />
      </div>
    </template>

    <AppCard v-else>
      <AppEmpty :reason="t('portfolio.startReason')" :next="t('portfolio.startNext')">
        <AppButton size="lg" @click="startEmpty">{{ t('portfolio.startEmpty') }}</AppButton>

        <TemplateSourceMenu size="lg" :load="importFrom" />
      </AppEmpty>
    </AppCard>

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
