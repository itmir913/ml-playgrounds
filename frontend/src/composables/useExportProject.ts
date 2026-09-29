/**
 * **`.mlpx`를 내보내는 한 길** — 상태 표시줄의 [파일로 저장](`components/ExportButton.vue`)과
 * 떠나기 확인 창의 [파일로 저장](`components/LeaveGuard.vue`, open-decisions.md 74)이 함께 쓴다.
 * 두 벌이면 인적사항을 넣는 순서나 알림이 한쪽에서만 고쳐진다.
 */

import { useI18n } from 'vue-i18n'

import { identifiedExport } from '@/project/portfolio-text'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

/** 파일 이름 앞에 붙는 인적사항. 빈 글자는 안 붙는다(`project/identity.ts`). */
export interface ExportIdentity {
  readonly studentId: string
  readonly studentName: string
}

export function useExportProject(): { exportNow: (identity: ExportIdentity) => Promise<boolean> } {
  const { t, locale } = useI18n()
  const project = useProjectStore()
  const toasts = useToastStore()

  /**
   * 내보낸다. **파일이 나갔으면 참이다.** 실패는 **던진다** — 말하는 자리가 부르는 쪽마다 다르다:
   * 팝오버는 알림으로, 모달 창은 창 안의 문장으로 말한다(결정문 65 "모달 창 안의 거절") — 알림은
   * 모달의 최상위 층 뒤에 덮인다.
   */
  async function exportNow(identity: ExportIdentity): Promise<boolean> {
    const file = project.file
    if (!file) return false
    // 적은 인적사항을 문서에 넣고, **그 문서로** 마크다운까지 만든다. 둘을 따로
    // 부르면 마크다운이 갱신 전 manifest를 본다 (`identifiedExport`의 주석).
    //
    // portfolio/document.md는 파생물이지만 파일에 담는다 - 교사가 압축을 풀어 메모장으로
    // 열어도 학생이 무엇을 썼는지 보여야 한다 (CLAUDE.md §1.3).
    const exported = identifiedExport(
      file.document,
      {
        name: file.document.manifest.name,
        studentId: identity.studentId,
        studentName: identity.studentName,
      },
      new Date().toISOString(),
      (key) => t(key),
      locale.value,
    )

    // 파일 이름이 인적사항으로 만들어져야 하므로 문서를 먼저 넣는다.
    project.update((live) => ({ ...live, document: exported.document }))

    const dropped = await project.exportFile(exported.markdown)

    toasts.push('success', 'project.exportDone')
    if (dropped.length > 0) {
      // 조용히 빠지면 학생은 예측이 왜 안 되는지 모른다.
      toasts.push('caution', 'project.exportDropped', { count: dropped.length })
    }
    return true
  }

  return { exportNow }
}
