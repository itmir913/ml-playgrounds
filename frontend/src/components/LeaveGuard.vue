<script setup lang="ts">
/**
 * **브라우저 저장이 실패한 채 프로젝트를 떠나려 할 때의 확인 창** (open-decisions.md 74).
 *
 * 라우터 가드가 이동을 멈추고 목적지를 `useLeaveStore`에 두면 뜬다. 선택지는 셋이다.
 *
 * - [머무르기] — 아무것도 안 하고 닫는다. 메모리의 편집은 그대로이고 다음 저장이 다시 시도한다.
 * - [파일로 저장] — 상태 표시줄의 내보내기와 **같은 길**(`useExportProject`)로 내보내고 **머문다.**
 *   내려받기가 실제로 됐는지 앱은 모르므로(인앱 브라우저) 떠나기는 학생이 한 번 더 누른다 — 그때는
 *   지금 판이 내보낸 판이라 묻지 않는다. 인적사항은 이미 적힌 것을 쓴다.
 * - [저장하지 않고 이동] — 그 목적지로 한 번 통과시킨다. 편집은 버려진다.
 *
 * **앱 껍데기에 하나만 있다**(`App.vue`) — 떠나는 이동은 어느 화면에서든 시작될 수 있다.
 */

import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useExportProject } from '@/composables/useExportProject'
import { toMessage } from '@/errors'
import { identityOf } from '@/project/identity'
import { useLeaveStore } from '@/stores/leave'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const router = useRouter()
const leave = useLeaveStore()
const project = useProjectStore()
const { exportNow } = useExportProject()

/**
 * 내보내기가 실패한 이유. **창 안에서 말한다** (결정문 65 "모달 창 안의 거절") — 알림은 모달의
 * 최상위 층 뒤에 덮인다. 그래서 이 창은 `ui-rules.spec.ts`의 `CLOSERS`(실패하면 창을 닫아 알림을
 * 보이게 하는 창)가 아니다 — 실패하면 창이 남아 이유를 말하고, 학생은 [저장하지 않고 이동]을 고를 수 있다.
 */
const failure = ref<{ key: string; params: Record<string, unknown> } | null>(null)

// 창이 새로 열리면 지난번 실패 문장은 남기지 않는다.
watch(
  () => leave.target,
  () => {
    failure.value = null
  },
)

async function exportAndStay(): Promise<void> {
  const manifest = project.file?.document.manifest
  if (manifest === undefined) return
  const identity = identityOf(manifest)
  failure.value = null
  try {
    const done = await exportNow({
      studentId: identity.studentId,
      studentName: identity.studentName,
    })
    if (done) leave.stay()
  } catch (error) {
    failure.value = toMessage(error)
  }
}

function leaveAnyway(): void {
  const to = leave.allow()
  if (to === null) return
  // **중단·리다이렉트는 거부가 아니라 `NavigationFailure`로 이행한다** — 통과를 거두지 않으면
  // 다음 이동이 그것을 믿는다(`TrainView.vue`의 `leave`와 같은 사정).
  void router
    .push(to)
    .then((failure) => {
      if (failure) leave.forget()
    })
    .catch(() => {
      leave.forget()
    })
}
</script>

<template>
  <AppDialog
    :open="leave.target !== null"
    :title="t('project.leaveTitle')"
    :description="t('project.leaveBody')"
    @close="leave.stay()"
  >
    <p v-if="failure" role="alert" class="text-danger">{{ t(failure.key, failure.params) }}</p>
    <template #actions>
      <AppButton variant="secondary" @click="leave.stay()">{{ t('project.leaveStay') }}</AppButton>
      <AppButton :action="exportAndStay">{{ t('project.export') }}</AppButton>
      <AppButton variant="danger" @click="leaveAnyway">{{ t('project.leaveAnyway') }}</AppButton>
    </template>
  </AppDialog>
</template>
