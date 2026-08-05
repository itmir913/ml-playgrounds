/**
 * 지금 열려 있는 프로젝트 하나.
 *
 * **한 번에 하나만 연다** (open-decisions.md "프로젝트는 한 번에 하나만 연다").
 * 그래서 이 스토어는 목록이 아니라 단수를 들고 있고, 목록 화면은 IndexedDB를
 * 직접 훑는다 — 요약만 필요한 화면이 문서 전체를 메모리에 올릴 이유가 없다.
 */

import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'

import type { ProjectFile } from '@/project/format'
import { loadProject } from '@/project/storage'
import { NO_PROGRESS, type ProjectProgress } from '@/router/steps'

/**
 * 파일에서 단계 진입 조건을 뽑는다. **순수 함수라 스토어 없이 테스트한다.**
 *
 * 스키마를 아는 것은 여기까지이고, steps.ts는 결과인 네 개의 불리언만 본다.
 */
export function progressOf(file: ProjectFile | null): ProjectProgress {
  if (file === null) {
    return NO_PROGRESS
  }
  const { settings, runs } = file.document
  const batches = runs.batches
  return {
    // 참조와 본체는 함께 있고 함께 없다 (mlpx-spec.md §1). 어느 쪽을 봐도 같지만
    // 본체를 본다 - 화면이 알고 싶은 것은 "보여줄 표가 있는가"다.
    hasDataset: file.dataset !== undefined,
    hasSettings: settings.features.length > 0 && settings.selectedAlgorithms.length > 0,
    hasRuns: batches.some((batch) => batch.runs.length > 0),
    hasModels: batches.some((batch) => batch.runs.some((run) => run.model !== undefined)),
  }
}

export const useProjectStore = defineStore('project', () => {
  /**
   * shallowRef인 이유: 문서 안에는 데이터셋 바이트와 모델이 들어 있다. 깊은 반응성을
   * 걸면 50MB짜리 Uint8Array까지 프록시로 감싸고, 그 비용을 교실 PC가 낸다.
   * 교체는 언제나 통째로 한다.
   */
  const file = shallowRef<ProjectFile | null>(null)
  const opening = shallowRef(false)

  const projectId = computed(() => file.value?.document.manifest.projectId ?? null)
  const name = computed(() => file.value?.document.manifest.name ?? '')
  const progress = computed(() => progressOf(file.value))

  /**
   * 프로젝트를 연다. 이미 그 프로젝트가 열려 있으면 아무것도 하지 않는다.
   *
   * 라우터 가드가 화면 전환마다 부르므로, 같은 프로젝트 안에서 단계를 옮길 때
   * 매번 IndexedDB를 다시 읽으면 안 된다.
   */
  async function open(id: string): Promise<boolean> {
    if (projectId.value === id) {
      return true
    }
    opening.value = true
    try {
      const loaded = await loadProject(id)
      file.value = loaded
      return loaded !== null
    } finally {
      opening.value = false
    }
  }

  /**
   * 열려 있는 프로젝트를 통째로 바꿔 끼운다. **저장에 성공한 뒤에 부른다.**
   *
   * 화면이 문서를 조금씩 고치지 않고 새 값을 통째로 넘기게 해 둔 것이다 —
   * shallowRef라 안쪽을 고치면 화면이 따라오지 않고, 그건 조용히 어긋나는 종류다.
   */
  function replace(next: ProjectFile): void {
    file.value = next
  }

  function close(): void {
    file.value = null
  }

  return { file, opening, projectId, name, progress, open, replace, close }
})
