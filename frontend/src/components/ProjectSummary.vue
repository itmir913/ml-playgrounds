<script setup lang="ts">
/**
 * 지금 이 프로젝트가 무엇인지. 언제 만들었고, 무슨 데이터가 몇 줄이고, 무엇을
 * 예측하려 하고, 모델이 몇 개 나왔는가.
 *
 * **두 곳이 같은 것을 본다** — 도구 막대의 팝오버(좁은 화면용)와 대시보드 오른쪽 열.
 * 한 벌로 두는 이유는 뻔하다. 두 벌이면 한쪽만 고쳐지고, 학생은 같은 프로젝트가
 * 자리마다 다르게 보이는 화면을 갖게 된다.
 *
 * **여기는 "지금 할 일"을 말하는 자리가 아니다.** 그건 대시보드 왼쪽 열이 한다.
 * 두 군데서 재촉하면 학생은 어느 쪽을 따라야 하는지 모른다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormat } from '@/composables/useFormat'
import { dataKindFor } from '@/data/kinds'
import { totalBytes } from '@/project/storage'
import { useProjectStore } from '@/stores/project'

const props = withDefaults(defineProps<{ withName?: boolean }>(), { withName: false })

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()

/**
 * 보여줄 값들. **문서에서 읽기만 한다** — 여기서 판단을 만들지 않는다.
 *
 * 표의 크기는 정본 CSV를 파싱해서 센다. 저장해 둔 숫자가 아니라 실제 바이트에서
 * 세는 이유는, 파일을 손으로 고친 남의 프로젝트에서도 맞아야 하기 때문이다.
 */
const kind = computed(() => dataKindFor(project.file?.document.manifest.dataType ?? ''))

const info = computed(() => {
  const file = project.file
  if (!file) return null
  const { manifest, settings, runs } = file.document

  const allRuns = runs.experiments.flatMap((experiment) => experiment.runs)
  return {
    manifest,
    /**
     * **저장이 세는 것과 같은 함수다** (`project/storage.ts`의 `totalBytes`). 여기서
     * 따로 세고 있었고 사진과 임베딩이 빠져 있어서, 이미지 프로젝트는 사진 200장을
     * 들고도 `0byte`라고 말했다.
     */
    bytes: totalBytes(file),
    /**
     * **번역된 이름이다. 등록부 id가 아니다.** `decision_tree`가 그대로 뜨고 있었다 -
     * 화면에 나가는 모든 알고리즘 이름은 `algorithms.*`를 지난다(결과·예측 화면이 이미
     * 그렇게 하고 있고, 여기만 빠져 있었다).
     *
     * 등록부에 없는 id면 `t()`가 키를 그대로 돌려준다. 그대로 둔다 - 남의 파일에서
     * 온 모르는 모델이고, 모르는 것을 아는 척하는 것보다 낫다(§8.13의 모르는 경로와
     * 같은 판단이다).
     */
    algorithms: settings.selectedAlgorithms.map((one) => t(`algorithms.${one.algorithm}`)),
    runs: allRuns.length,
  }
})
</script>

<template>
  <div v-if="info">
    <h2 v-if="props.withName" class="mb-3 truncate font-bold">{{ info.manifest.name }}</h2>

    <dl class="flex flex-col gap-1.5">
      <div class="flex justify-between gap-4">
        <dt class="font-bold text-ink-soft">{{ t('meta.taskType') }}</dt>
        <!-- 아직 안 골랐으면 없는 것이 맞다. 기본값을 보여주면 고른 것처럼 읽힌다. -->
        <dd>
          {{
            info.manifest.taskType === undefined
              ? t('meta.none')
              : t(`taskTypes.${info.manifest.taskType}`)
          }}
        </dd>
      </div>

      <!--
        **무엇을 셀지 이 화면이 모른다** (architecture.md §9.3.2). 여기 파일 이름·행·열·
        타깃·특성이 박혀 있었고, 이미지 프로젝트는 그 다섯 줄이 전부 `없음`·`0개`로
        떴다 — 없는 것이 아니라 **애초에 그 종류에 없는 항목**인데 "아직 안 골랐다"로
        읽힌다.
      -->
      <component :is="kind.summaryRows" v-if="kind" />

      <div class="flex justify-between gap-4">
        <dt class="shrink-0 font-bold text-ink-soft">{{ t('meta.algorithms') }}</dt>
        <dd class="truncate">
          {{ info.algorithms.length === 0 ? t('meta.none') : info.algorithms.join(', ') }}
        </dd>
      </div>

      <div class="flex justify-between gap-4">
        <dt class="font-bold text-ink-soft">{{ t('meta.runs') }}</dt>
        <dd class="tabular-nums">{{ t('meta.countUnit', info.runs) }}</dd>
      </div>

      <div class="mt-2 flex justify-between gap-4 border-t border-line pt-2">
        <dt class="font-bold text-ink-soft">{{ t('meta.created') }}</dt>
        <dd>{{ format.dateTime(info.manifest.createdAt) }}</dd>
      </div>

      <div class="flex justify-between gap-4">
        <dt class="font-bold text-ink-soft">{{ t('meta.updated') }}</dt>
        <dd>{{ format.dateTime(info.manifest.updatedAt) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="font-bold text-ink-soft">{{ t('meta.size') }}</dt>
        <dd>{{ format.bytes(info.bytes) }}</dd>
      </div>
    </dl>
  </div>
</template>
