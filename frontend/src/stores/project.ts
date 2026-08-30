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
import { downloadBlob } from '@/project/download'
import {
  projectFileName,
  writeProject,
  type DroppedModel,
  type ProjectFile,
} from '@/project/format'
import { dataFactsOf } from '@/project/facts'
import { isPortfolioAnswered } from '@/project/portfolio'
import { type DataType, type TaskType } from '@/project/schema'
import {
  loadProject,
  markExported,
  readExportedAt,
  requestPersistence,
  saveProject,
} from '@/project/storage'
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
    // **데이터 쪽 셋은 종류가 답한다** (`project/facts.ts`). 표는 타깃 열과 특성 열로,
    // 이미지는 사진과 범주로 같은 질문에 답한다 — 여기서 종류를 묻지 않는다.
    ...dataFactsOf(file),
    // 기본값이 없으므로 이건 진짜로 "학생이 골랐는가"다
    // (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
    taskTypeChosen: file.document.manifest.taskType !== undefined,
    algorithmsChosen: settings.selectedAlgorithms.length > 0,
    trainingDone: experiments.some((experiment) => experiment.runs.length > 0),
    modelReady: experiments.some((experiment) =>
      experiment.runs.some((run) => run.model !== undefined),
    ),
    // **판정은 포트폴리오가 갖는다** (`project/portfolio.ts`). 여기서 한 번 더
    // 세면 화면과 체크리스트가 갈릴 자리가 생긴다.
    portfolioAnswered: isPortfolioAnswered(portfolio),
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

  /**
   * 저장소를 지우지 말아 달라고 이미 청했는가 (`askToKeep`).
   *
   * **화면에 안 보이는 값이라 ref가 아니다.** 상태 표시줄이 이걸 읽지 않는다 —
   * 학생에게 "지워질 수도 있습니다"를 말해 봐야 할 수 있는 일이 없다.
   */
  let askedToKeep = false

  const projectId = computed(() => file.value?.document.manifest.projectId ?? null)
  const name = computed(() => file.value?.document.manifest.name ?? '')
  const facts = computed(() => factsOf(file.value))

  /**
   * 지금 프로젝트의 기계학습 유형. 할 일 목록과 잠금이 이것으로 걸러진다 (steps.ts).
   *
   * **없는 것이 정상 상태다.** 학습 화면에서 고르기 전까지는 아무것도 아니고, 그때는
   * 어떤 사실도 빠지지 않는다 (factAppliesTo).
   */
  const taskType = computed<TaskType | undefined>(() => file.value?.document.manifest.taskType)
  /** 이 프로젝트의 데이터 종류. 만들 때 정해져 안 바뀐다 (open-decisions.md). */
  const dataType = computed<DataType | undefined>(() => file.value?.document.manifest.dataType)

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
      // **못 읽는 것은 없는 것과 다르다** (architecture.md §8.10.2). 형식이 바뀐 뒤의
      // 옛 레코드나 손상된 레코드가 여기서 던지는데, 그대로 두면 렌더 중 예외가 되어
      // 그 프로젝트만이 아니라 앱 전체가 멈춘다. 받아서 알리고 목록으로 돌려보낸다.
      const loaded = await loadProject(id).catch((error: unknown) => {
        useToastStore().pushError(error)
        return null
      })
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
   * **던져도 화면은 새 값을 들고 있는다** (`open-decisions.md` "저장은 화면을 먼저
   * 바꾸고, 실패는 알림과 상태 표시줄이 말한다"). `update()`와 같은 약속이다.
   *
   * **되돌리지 않는 이유는 내보내기다.** 이 경로가 실제로 던지는 가장 흔한 자리가 사진
   * 저장인데(다 굽고 나서 쿼터에 걸린다), 여기서 `file.value`를 되돌리면 방금 구운 것이
   * 화면에서도 사라져 **학생이 그 세션에 그것을 내보낼 길이 없어진다.** `exportFile`은
   * `file.value`로 `.mlpx`를 만들므로 지금은 저장에 실패해도 제출은 된다 —
   * **브라우저에만 있는 프로젝트는 제출을 못 하면 죽은 것이다.**
   *
   * **값은 치른다.** 저장 안 된 채 화면만 새 값인 상태가 실재하고, 새로고침하면 그것을
   * 잃는다. 그래서 `dirty`가 실패 뒤에도 참으로 남아 상태 표시줄이 계속 말하는 것이
   * 이 결정의 짝이다. 부르는 쪽은 던진 것을 잡아 토스트를 띄워야 한다.
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
      askToKeep(current)
    } finally {
      saving.value = false
    }
  }

  /**
   * **표가 들어간 첫 저장에서 한 번만** 브라우저에 "지우지 말아 달라"고 청한다
   * (`open-decisions.md` #7).
   *
   * **빈 프로젝트에서는 안 청한다.** 프로젝트를 만들면 빈 문서가 곧장 쓰이는데 그때는
   * 지킬 것이 없다. 표를 올린 직후가 학생에게 잃을 것이 생긴 순간이고, 내보내기까지는
   * 아직 한참 남았다 — **내보낸 뒤에 청하면 위험이 사라진 다음에 도착한다.**
   *
   * **한 번만 부른다.** 자동저장은 슬라이더를 끌 때마다 도는데 그때마다 부르면 매번
   * 브라우저에 묻는 꼴이다(파이어폭스는 권한 팝업을 띄운다).
   *
   * **기다리지 않고 실패도 삼킨다.** 저장은 이미 끝났고, 이건 그 저장을 오래 살게 하는
   * 요청일 뿐이라 거절당해도 학생이 할 일이 없다. `write()`가 이것 때문에 느려지거나
   * 실패하면 안 된다.
   */
  /**
   * **"올린 것이 있는가"는 종류가 답한다** (`project/facts.ts`의 `datasetReady`).
   *
   * 예전에는 `saved.dataset !== undefined`로 물었는데 그 칸은 **표의 정본 한 자리**다.
   * 이미지 프로젝트는 사진을 `images` 맵에 들고 그 칸이 언제나 비어 있어서
   * **조건이 항상 참이 되어 한 번도 안 청했다** (V11 R1 감사 B-11). 그리고 이미지가
   * 이 앱에서 제일 큰 프로젝트다 — 사진 5,000장이면 80~100MB이고, 그것이 계속
   * "지워도 되는 데이터"로 남아 iOS 사파리의 기간 만료 삭제와 용량 압박 삭제의 첫
   * 대상이 된다. 종류가 답하게 두면 음성이 오는 날에도 안 샌다.
   */
  function askToKeep(saved: ProjectFile): void {
    if (askedToKeep || !dataFactsOf(saved).datasetReady) return
    askedToKeep = true
    void requestPersistence()
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
    // **저장이 실패해도 내보내기는 계속한다.** 라우터 가드와 같은 처방이다
    // (router/index.ts) - 잡아서 알리되 막지 않는다.
    //
    // 막으면 무슨 일이 나는지가 이 try의 이유다. flush()는 저장소가 모자라면
    // STORAGE_QUOTA_EXCEEDED를 던지는데, 그것을 그대로 올려보내면 아래 writeProject도
    // downloadBlob도 한 줄을 못 돈다 - **파일을 만들 재료가 전부 메모리에 있고
    // 저장소를 한 바이트도 안 쓰는 작업인데도 그렇다.** 게다가 write()는 실패해도
    // dirty를 안 내리므로 그 뒤의 모든 내보내기가 같은 자리에서 죽는다.
    // 서버가 없고 결과물이 파일 하나인 도구에서 그것은 **학생이 작업을 기기 밖으로
    // 꺼낼 길이 없어진다**는 뜻이다 (CLAUDE.md §1.1·§1.3).
    //
    // 미뤄 둔 저장을 먼저 끝내려는 의도 자체는 옳다 - 방금 쓴 글이 빠진 파일이 나가면
    // 안 된다. 그래서 버리지 않고 **알린 뒤 있는 값으로 내보낸다.**
    try {
      await flush()
    } catch (error) {
      useToastStore().pushError(error)
    }
    const current = file.value
    if (current === null) return []

    const { blob, dropped } = await writeProject(current, portfolioMarkdown)
    downloadBlob(blob, projectFileName(current.document.manifest))

    // **여기서부터는 파일이 이미 나갔다.** markExported는 IndexedDB에 쓰므로 저장소가
    // 모자라면 던지는데, 그것을 올려보내면 화면이 성공한 내보내기를 실패로 말한다.
    // 내보낸 시각은 이 기기의 곁가지 정보이고(storage.ts) 파일 안에는 없다.
    const at = new Date().toISOString()
    try {
      await markExported(current.document.manifest.projectId, at)
      exportedAt.value = at
    } catch (error) {
      useToastStore().pushError(error)
    }
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
    dataType,
    open,
    save,
    update,
    flush,
    exportFile,
    close,
  }
})
