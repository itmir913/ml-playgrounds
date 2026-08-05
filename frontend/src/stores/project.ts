/**
 * 지금 열려 있는 프로젝트 하나.
 *
 * **한 번에 하나만 연다** (open-decisions.md "프로젝트는 한 번에 하나만 연다").
 * 그래서 이 스토어는 목록이 아니라 단수를 들고 있고, 목록 화면은 IndexedDB를
 * 직접 훑는다 — 요약만 필요한 화면이 문서 전체를 메모리에 올릴 이유가 없다.
 */

import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'

import { AUTOSAVE_DELAY_MS } from '@/limits'
import { downloadBytes } from '@/project/download'
import {
  projectFileName,
  writeProject,
  type DroppedModel,
  type ProjectFile,
} from '@/project/format'
import type { TaskType } from '@/project/schema'
import { loadProject, markExported, readExportedAt, saveProject } from '@/project/storage'
import { NO_FACTS, type ProjectFacts } from '@/router/steps'
import { useToastStore } from './toasts'

/**
 * 파일에서 사실들을 뽑는다. **순수 함수라 스토어 없이 테스트한다.**
 *
 * 스키마를 아는 것은 여기까지다. steps.ts는 결과인 불리언들만 보고, 체크리스트와
 * 잠금이 **둘 다 여기서 나온다** (architecture.md §8.7).
 */
export function factsOf(file: ProjectFile | null): ProjectFacts {
  if (file === null) {
    return NO_FACTS
  }
  const { settings, runs, portfolio } = file.document
  const experiments = runs.experiments
  return {
    // 참조와 본체는 함께 있고 함께 없다 (mlpx-spec.md §1). 어느 쪽을 봐도 같지만
    // 본체를 본다 - 화면이 알고 싶은 것은 "보여줄 표가 있는가"다.
    datasetReady: file.dataset !== undefined,
    targetChosen: settings.target !== undefined,
    featuresChosen: settings.features.length > 0,
    algorithmsChosen: settings.selectedAlgorithms.length > 0,
    trainingDone: experiments.some((experiment) => experiment.runs.length > 0),
    modelReady: experiments.some((experiment) =>
      experiment.runs.some((run) => run.model !== undefined),
    ),
    portfolioWritten: Object.values(portfolio.answers).some((answer) => answer.trim() !== ''),
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
  const saving = shallowRef(false)
  /** 마지막으로 IndexedDB에 쓴 시각. 상태 표시줄이 보여준다. */
  const savedAt = shallowRef<string | null>(null)
  /** 마지막으로 .mlpx를 내려받은 시각. 파일에는 없고 이 기기에만 있다. */
  const exportedAt = shallowRef<string | null>(null)
  /** 화면은 바뀌었는데 아직 안 쓴 상태. 상태 표시줄이 이걸 보여준다. */
  const dirty = shallowRef(false)

  /** 미뤄 둔 자동 저장. 새 변경이 오면 앞의 것을 버리고 다시 잡는다. */
  let pending: ReturnType<typeof setTimeout> | null = null

  const projectId = computed(() => file.value?.document.manifest.projectId ?? null)
  const name = computed(() => file.value?.document.manifest.name ?? '')
  const facts = computed(() => factsOf(file.value))

  /**
   * 지금 프로젝트의 기계학습 유형. 할 일 목록이 이것으로 걸러진다 (steps.ts).
   *
   * 프로젝트가 없을 때 분류로 떨어지는 것은 화면이 아무것도 안 그리는 상태라
   * 무엇을 돌려주든 보이지 않기 때문이다. 그래도 값은 있어야 타입이 성립한다.
   */
  const taskType = computed<TaskType>(
    () => file.value?.document.manifest.taskType ?? 'classification',
  )

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
      // 열린 직후는 방금 읽은 그대로이므로 저장된 상태다.
      dirty.value = false
      savedAt.value = loaded === null ? null : loaded.document.manifest.updatedAt
      exportedAt.value = loaded === null ? null : await readExportedAt(id)
      return loaded !== null
    } finally {
      opening.value = false
    }
  }

  /**
   * 바뀐 프로젝트를 저장하고 화면에 반영한다.
   *
   * **쓰기와 교체를 한 함수로 묶은 이유**는 둘이 갈라지면 언젠가 화면만 바뀌고 저장이
   * 안 된 상태가 생기기 때문이다. 그리고 shallowRef라 문서 안쪽을 고쳐도 화면이
   * 따라오지 않으므로, 부르는 쪽은 언제나 새 값을 통째로 넘긴다.
   *
   * 던지면 **아무것도 바꾸지 않는다.** 저장이 실패했는데 화면만 새 값이면 학생은
   * 되지도 않은 것을 됐다고 믿는다.
   */
  async function save(next: ProjectFile): Promise<void> {
    cancelPending()
    file.value = next
    dirty.value = true
    await write()
  }

  /** 실제로 쓰는 곳. 지금 열려 있는 값을 쓴다. */
  async function write(): Promise<void> {
    const current = file.value
    if (current === null || !dirty.value) return
    saving.value = true
    try {
      await saveProject(current)
      // 쓰는 동안 또 바뀌었을 수 있다. 그러면 여전히 안 쓴 상태로 두어야 한다.
      dirty.value = file.value !== current
      savedAt.value = new Date().toISOString()
    } finally {
      saving.value = false
    }
  }

  function cancelPending(): void {
    if (pending !== null) {
      clearTimeout(pending)
      pending = null
    }
  }

  /**
   * 값을 바꾸고 **잠시 뒤** 저장한다. 화면은 즉시 새 값을 본다.
   *
   * 슬라이더를 끌거나 글을 쓰는 화면이 쓰는 경로다 - 한 글자마다 수십 MB를 쓰면
   * 교실 PC가 멈춘다. 되돌릴 수 없는 큰 변경(데이터셋 교체)은 `save`로 즉시 쓴다.
   *
   * **실패하면 알림을 띄운다.** 타이머가 부르는 것이라 기다리는 사람이 없고,
   * 조용히 실패하면 학생은 저장된 줄 안다.
   */
  function update(next: ProjectFile): void {
    file.value = next
    dirty.value = true
    cancelPending()
    pending = setTimeout(() => {
      pending = null
      void write().catch((error: unknown) => useToastStore().pushError(error))
    }, AUTOSAVE_DELAY_MS)
  }

  /** 미뤄 둔 저장을 지금 한다. 화면을 떠날 때와 내보내기 전에 부른다. */
  async function flush(): Promise<void> {
    cancelPending()
    await write()
  }

  /**
   * `.mlpx`를 내려받는다. **학생의 유일한 반출 경로다** (CLAUDE.md §1.1).
   *
   * 미뤄 둔 저장을 먼저 끝낸다 - 방금 쓴 글이 빠진 파일이 나가면 안 된다.
   * 담지 못한 모델을 돌려주므로 화면이 경고할 수 있다.
   */
  async function exportFile(portfolioMarkdown: string): Promise<DroppedModel[]> {
    await flush()
    const current = file.value
    if (current === null) return []

    const { bytes, dropped } = await writeProject(current, portfolioMarkdown)
    downloadBytes(bytes, projectFileName(current.document.manifest))

    const at = new Date().toISOString()
    await markExported(current.document.manifest.projectId, at)
    exportedAt.value = at
    return dropped
  }

  function close(): void {
    cancelPending()
    file.value = null
    dirty.value = false
    savedAt.value = null
    exportedAt.value = null
  }

  return {
    file,
    opening,
    saving,
    dirty,
    savedAt,
    exportedAt,
    projectId,
    name,
    facts,
    taskType,
    open,
    save,
    update,
    flush,
    exportFile,
    close,
  }
})
