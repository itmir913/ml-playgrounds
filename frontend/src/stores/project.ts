/**
 * 지금 열려 있는 프로젝트 하나.
 *
 * **한 번에 하나만 연다** (open-decisions.md "프로젝트는 한 번에 하나만 연다").
 * 그래서 이 스토어는 목록이 아니라 단수를 들고 있고, 목록 화면은 IndexedDB를
 * 직접 훑는다 — 요약만 필요한 화면이 문서 전체를 메모리에 올릴 이유가 없다.
 */

import { computed, customRef, shallowRef, watch, type Ref } from 'vue'
import { defineStore } from 'pinia'

import { ClientError } from '@/errors'
import { AUTOSAVE_DELAY_MS, AUTOSAVE_MAX_WAIT_MS } from '@/limits'
import { appWriteSite, isWatchWrite, type WatchWriteId } from '@/locks'
import { downloadBlob } from '@/project/download'
import { acquireTabLock, releaseTabLock } from '@/project/tab-lock'
import {
  projectFileName,
  writeProject,
  type DroppedModel,
  type ProjectFile,
} from '@/project/format'
import { forgetTabularPlan } from '@/ml/plan-cache'
import { trainableSelections } from '@/ml/selection'
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
 * 지금 열린 파일을 받아 새 파일을 돌려주는 함수. **긴 계산의 끝은 이 모양으로 쓴다**
 * (architecture.md §8.10.3).
 *
 * 붙든 파일에 쓰면 그 사이 학생이 한 일이 사라진다 — 예측이 도는 동안 놓은 사진,
 * 백본을 받는 동안 뺀 모델. **자리마다 가드를 붙이는 대신 쓰기의 모양을 바꾼다.**
 */
export type ProjectRevision = (current: ProjectFile) => ProjectFile

/**
 * `open()`이 말하는 세 갈래 (2026-09-23 R37-V C-1).
 *
 * **`boolean`으로는 둘이 겹쳤다.** `취소당함`과 `못 열었음`이 같은 `false`라, 라우터가
 * 취소를 실패로 읽고 **학생이 [점검]을 눌렀는데 목록으로 리다이렉트했다**(실측: 누른 곳
 * `inspect`, 선 곳 `projects`). 취소는 **학생이 이미 다른 데로 가고 있다**는 뜻이므로
 * 이동을 덮어쓰면 안 된다.
 *
 * 안에서는 이 축을 이미 갈라 쓰고 있었다(취소면 *"다른 탭에서 열려 있습니다"*를 안 띄운다).
 * **밖으로 한 칸 내보낸 것이 전부다.** `tests/project-open-cancel.spec.ts`가 문다.
 */
export type OpenOutcome = 'opened' | 'failed' | 'cancelled'

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
    // **학습에 넘어가는 모델로 센다** (`open-decisions.md` 55, R38-D55 B-2). 유형에 안 맞는 줄은
    // 목록에 남지만 학습이 무시한다 — 그것만 담겼는데 체크하면 [학습하기]는 잠겼는데 체크리스트는
    // 끝냈다고 한다. 유형이 없으면 아무것도 안 잠기므로 목록 그대로다(특성의 `featuresInUse`와 같은 모양).
    algorithmsChosen:
      (file.document.manifest.taskType === undefined
        ? settings.selectedAlgorithms
        : trainableSelections(settings.selectedAlgorithms, file.document.manifest.taskType)
      ).length > 0,
    trainingDone: experiments.some((experiment) => experiment.runs.length > 0),
    modelReady: experiments.some((experiment) =>
      experiment.runs.some((run) => run.model !== undefined),
    ),
    // **판정은 포트폴리오가 갖는다** (`project/portfolio.ts`). 여기서 한 번 더
    // 세면 화면과 체크리스트가 갈릴 자리가 생긴다.
    portfolioAnswered: isPortfolioAnswered(portfolio),
  }
}

/**
 * **감시자 안에서는 프로젝트를 쓰지 않는다** (결정문 65 ④ *"앱이 설정을 스스로 쓰는 것"*).
 *
 * 한 옵션이 다른 옵션을 무의미하게 만들 때 앱이 그 값을 끄거나 옮기면 학생이 다시 켜러 돌아가야
 * 하고, 옵션 사이에 고리가 생기면 폭주한다(결정문 55). 그 쓰기의 모양은 거의 언제나 **감시자가
 * 값을 보고 쓰는 것**이라, 글자를 세지 않고 **쓰는 순간을 막는다**: Vue가 감시자 콜백을 도는 동안
 * 세우는 표지(`getCurrentWatcher`)가 서 있으면 던진다. 예외는 `@/locks`의 `WATCH_WRITES`에 적힌
 * 이름을 넘긴 쓰기뿐이다.
 *
 * **화면이 뜨는 동안도 같다** (결정문 65 "구조 뒤 감사에서 더한 것"). *"화면에 들어오면 앱이 옵션을
 * 되돌리는"* 모양은 감시자가 아니라 `onMounted`에서 나온다 — 부품이 뜨거나 고쳐 그려지는 동안
 * (`setup`·수명주기 훅·그리기) Vue가 세우는 표지(`getCurrentInstance`)도 본다(`@/locks`의
 * `appWriteSite`). 라우터 가드와 이벤트 리스너는 학생의 동작이라 보지 않는다.
 *
 * **닿는 범위는 콜백의 동기 구간이다** (`tests/watch-writes.spec.ts`가 잰다). Vue는 콜백이
 * 돌아오는 순간 표지를 내리므로, `await` 뒤·`setTimeout`·`nextTick().then`의 쓰기는 이 검사가 못
 * 본다 — `docs/rule-coverage.md`가 그 사각을 적는다. 파일 객체를 제자리에서 고치는 것(얕은 반응성이라
 * 원래도 화면에 안 닿는다)도 못 본다.
 */
function refuseWatcherWrite(write: WatchWriteId | undefined): void {
  const site = appWriteSite()
  if (site === null || isWatchWrite(write)) return
  // **새 자리는 새 이름으로 더하라고 말한다** (구조 뒤 감사 A-1). 이름은 쓰는 파일에 묶여 있어서
  // 있는 이름을 빌려 쓰면 `ui-rules.spec.ts`가 운다 — 그 길로 보내지 않는다.
  throw new Error(
    site === 'watcher'
      ? 'PROJECT_WRITE_IN_WATCHER: add a new entry for this site to the watch-write registry in locks.ts (each name is bound to one file; do not reuse an existing name)'
      : 'PROJECT_WRITE_IN_LIFECYCLE: a component wrote the project while mounting or updating; add a new entry for this site to the watch-write registry in locks.ts (each name is bound to one file; do not reuse an existing name)',
  )
}

export const useProjectStore = defineStore('project', () => {
  /**
   * shallowRef인 이유: 문서 안에는 데이터셋 바이트와 모델이 들어 있다. 깊은 반응성을
   * 걸면 50MB짜리 Uint8Array까지 프록시로 감싸고, 그 비용을 교실 PC가 낸다.
   * 교체는 언제나 통째로 한다.
   */
  const file = watchGuardedFile()

  /** `save`·`update`가 거치는 쓰기인가. 그 둘은 들어올 때 이미 물었다(`refuseWatcherWrite`). */
  let passing = false

  function permitted(assign: () => void): void {
    passing = true
    try {
      assign()
    } finally {
      passing = false
    }
  }

  /**
   * 열린 파일의 칸. **얕은 칸이고(`shallowRef`와 같다), 감시자 안에서 직접 쓰면 던진다** — 위
   * `refuseWatcherWrite`. `save`·`update`를 안 거치고 `project.file = …`로 쓰는 길도 여기서 막힌다.
   * 같은 값을 다시 쓰면 아무 일도 안 한다(`shallowRef`처럼).
   */
  function watchGuardedFile(): Ref<ProjectFile | null> {
    let value: ProjectFile | null = null
    return customRef<ProjectFile | null>((track, trigger) => ({
      get() {
        track()
        return value
      },
      set(next) {
        if (!passing) refuseWatcherWrite(undefined)
        if (Object.is(next, value)) return
        value = next
        trigger()
      },
    }))
  }
  const opening = shallowRef(false)

  /**
   * 열기가 몇 번 시작했는가. **값에 뜻이 없고 달라졌다는 것에만 뜻이 있다** — `close()`가
   * 올리면 도는 중인 열기가 자기 차례가 지났음을 안다 (R37 A-1).
   */
  let openings = 0
  const saving = shallowRef(false)
  /** 마지막으로 IndexedDB에 쓴 시각. 상태 표시줄이 보여준다. */
  const savedAt = shallowRef<string | null>(null)
  /** 마지막으로 .mlpx를 내려받은 시각. 파일에는 없고 이 기기에만 있다. */
  const exportedAt = shallowRef<string | null>(null)
  /** 화면은 바뀌었는데 아직 안 쓴 상태. 상태 표시줄이 이걸 보여준다. */
  const dirty = shallowRef(false)
  /**
   * **마지막 쓰기가 실패했는가** (open-decisions.md 74). 다음 쓰기가 성공하면 내려간다.
   * `dirty`만으로는 "아직 차례를 기다리는 편집"과 "쓰려다 거절당한 편집"이 같다.
   */
  const saveFailed = shallowRef(false)
  /**
   * **지금 판이 마지막으로 파일로 내보낸 판인가** (open-decisions.md 74). 참이면 브라우저에 못 썼어도
   * 작업은 파일에 있다. **시각이 아니라 판 자체로 잰다** — 내보낸 시각(`exportedAt`)은 저장이 끝난
   * 뒤에야 IndexedDB에 적히므로 저장이 실패하는 동안에는 안 선다.
   *
   * **판을 쥐지 않고 불리언으로 든다** (P 검토 C-1). 내보낸 `ProjectFile`을 쥐면 그 뒤 사진을 바꿔도
   * 옛 바이트(수십~100MB)가 닫을 때까지 메모리에 남는다. 판이 바뀌는 순간(아래 감시) 내려가므로
   * "지금 판 === 내보낸 판"과 같은 뜻이다.
   */
  const exportedCurrent = shallowRef(false)
  watch(
    file,
    () => {
      exportedCurrent.value = false
    },
    { flush: 'sync' },
  )
  /**
   * **브라우저에도 파일에도 없는 편집이 메모리에만 있는가** (open-decisions.md 74). 마지막 쓰기가
   * 실패했고, 아직 안 쓴 편집이 있고, 지금 판이 내보낸 판이 아닐 때다. 참이면 프로젝트를 떠나는
   * 이동이 멈추고(`router/index.ts`) 탭을 닫을 때 브라우저가 경고한다(`useUnloadWarning`).
   *
   * **저장이 성공하는 정상 상태에서는 거짓이다** — 미뤄 둔 저장을 기다리는 짧은 사이도 거짓이다.
   * 무는 검사: `leave-unsaved.spec.ts`.
   */
  const stranded = computed(
    () => saveFailed.value && dirty.value && file.value !== null && !exportedCurrent.value,
  )

  /** 미뤄 둔 자동 저장. 새 변경이 오면 앞의 것을 버리고 다시 잡는다. */
  let pending: ReturnType<typeof setTimeout> | null = null
  /** 미뤄 둔 저장의 최대 대기. **새 변경이 와도 다시 잡지 않는다** — 첫 변경부터 잰다. */
  let deadline: ReturnType<typeof setTimeout> | null = null

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
  async function open(id: string): Promise<OpenOutcome> {
    if (projectId.value === id) {
      return 'opened'
    }
    /**
     * **이 열기가 아직 유효한가를 재는 표** (2026-09-22 R37 A-1).
     *
     * `open()`은 `await` 넷을 지난 뒤 `file.value`를 **조건 없이** 썼다. 그 사이에
     * `close()`가 돌면 **목록으로 나간 학생의 화면에 옛 프로젝트가 다시 뜨고 자동
     * 저장이 그것을 쓴다** — 바로 아래 `resolve()`가 같은 이유로 지키는 규칙을
     * `open()`만 안 지키고 있었다 (R20 감사).
     *
     * **`projectId`로는 못 잰다.** 여는 중에는 아직 비어 있어서, 닫힌 것과 아직 안
     * 열린 것이 같은 모양이다.
     */
    const attempt = (openings += 1)
    const stale = (): boolean => attempt !== openings
    /**
     * **다른 프로젝트로 갈아 끼우면 미뤄 둔 저장을 거둔다** (open-decisions.md 81의 개정). 가드가 떠나기 전에
     * `flush()`로 끝내지만 [저장하지 않고 이동]은 그것을 건너뛴다 — 남기면 여는 사이에 앞 프로젝트를 쓰고,
     * 그 쓰기의 실패 알림이 새 프로젝트 화면에 선다.
     *
     * **첫 `await` 앞에서 거둔다.** 파일이 바뀌는 줄(아래 `file.value = loaded`)에서 거두면 그 사이에 타이머가
     * 먼저 돈다. 잠금을 못 잡았거나 취소되어 앞 프로젝트가 남아도 편집은 잃지 않는다 — 판은 메모리에 있고
     * `dirty`가 참으로 남아, 다음 입력이 타이머를 다시 걸고 떠나는 이동의 `flush()`가 쓴다(사람 확인 — 그 갈래를
     * 무는 검사는 없다). 읽기가 실패하면 앞 프로젝트는 어차피 아래에서 `null`로 비워진다. 같은 프로젝트는 위에서
     * 돌아가므로 여기 안 온다. 무는 검사: `autosave.spec.ts`의 *"다른 프로젝트로 갈아 끼우면"* 묶음(같은
     * 프로젝트는 *"같은 프로젝트를 다시 열면 미뤄 둔 저장이 그대로 도착한다"*).
     * **한계:** 떠나는 이동이 가드의 `flush()`를 기다리는 사이 친 편집은 열기가 성공하면 버려진다 — `close()`와 같고,
     * 고치려면 별도 결정이다(open-decisions.md 81 개정의 "대가", 무는 검사 없음 — 사람 확인).
     */
    cancelPending()
    opening.value = true
    try {
      // **다른 탭이 쥔 프로젝트는 열지 않는다** (open-decisions.md "프로젝트는 한 번에
      // 하나만 연다"). 반쯤 열면 자동 저장이 따라 들어와, 잊힌 탭의 저장이 이쪽 실험을
      // 흔적 없이 덮는 바로 그 사고를 다시 부른다. 알리고 목록으로 돌려보낸다.
      if (!(await acquireTabLock(id))) {
        /**
         * **취소당한 것과 남이 쥔 것은 다르다** (R37 A-1). 잠금은 둘 다 `false`로
         * 돌려주는데, 취소는 **학생이 방금 다른 데로 간 것**이라 알릴 일이 아니다 —
         * 아무도 안 쥐었는데 *"다른 탭에서 열려 있습니다"*가 뜬다.
         */
        if (stale()) return 'cancelled'
        useToastStore().pushError(new ClientError('PROJECT_OPEN_ELSEWHERE'))
        return 'failed'
      }
      // 잡고 보니 이미 닫으라는 말이 왔으면 들고 있을 이유가 없다.
      if (stale()) {
        releaseTabLock()
        return 'cancelled'
      }
      // **못 읽는 것은 없는 것과 다르다** (architecture.md §8.10.2). 형식이 바뀐 뒤의
      // 옛 레코드나 손상된 레코드가 여기서 던지는데, 그대로 두면 렌더 중 예외가 되어
      // 그 프로젝트만이 아니라 앱 전체가 멈춘다. 받아서 알리고 목록으로 돌려보낸다.
      //
      // **본체 없는 폴더 참조를 떼고 열었으면 말한다** (open-decisions.md "본체 없는 폴더 참조는
      // 기대는 실험이 없을 때만 떼고 연다"). 말없이 떼면 학생은 사진 자리가 왜 비었는지 모른다.
      // 알림은 **이 열기가 아직 유효할 때만** 띄운다. 무는 검사: `project-open-detach.spec.ts`.
      let detached = false
      const loaded = await loadProject(id, () => {
        detached = true
      }).catch((error: unknown) => {
        useToastStore().pushError(error)
        return null
      })
      // 못 열었으면 잠금도 놓는다 - 안 열린 프로젝트를 쥔 채로 두면 다른 탭까지 막는다.
      if (loaded === null) releaseTabLock()
      // **읽는 동안 닫혔으면 되살리지 않는다.** 잠금은 `close()`가 이미 놓았다.
      if (stale()) return 'cancelled'
      if (detached) useToastStore().push('caution', 'project.emptyPhotoFolderRemoved')
      file.value = loaded
      // **뗐으면 그 판을 한 번 쓴다** (`persistDetached`). 뗀 적 없는 열기는 쓰지 않는다.
      if (detached && loaded !== null) persistDetached(loaded)
      // 다른 프로젝트로 갈아 끼웠다 — 앞 프로젝트의 표를 쥔 계획 캐시도 비운다. 라우터는
      // A → B를 `close()` 없이 `open(B)`로 바꾼다(`tabular-plan-cache.spec.ts`가 문다).
      forgetTabularPlan()
      // 열린 직후는 방금 읽은 그대로이므로 저장된 상태다.
      dirty.value = false
      saveFailed.value = false
      exportedCurrent.value = false
      savedAt.value = loaded === null ? null : loaded.document.manifest.updatedAt
      // **내보낸 시각을 못 읽으면 "안 내보냄"으로 둔다** (2026-09-29 감사 H A-2). 곁가지 정보다 —
      // 전에는 여기서 던지면 파일은 이미 앉았는데 라우터 가드가 던져 이동이 취소되고, 학생은 알림
      // 없이 목록에 남은 채 스토어만 그 프로젝트를 쥐었다(탭 잠금까지). 틀려도 상태 표시줄이
      // "안 내보냄"이라 말하는 쪽이 안전하다. 무는 검사: `project-open-exported.spec.ts`의
      // *"내보낸 시각을 못 읽어도 프로젝트로 간다"*.
      const exported = loaded === null ? null : await readExportedAt(id).catch(() => null)
      // **마지막 `await` 뒤에도 차례를 다시 잰다** (0.30.0 최종 승인 감사 C-11). 그 사이 `close()`가
      // 끼면 파일은 비었는데 `'opened'`가 나가 라우터가 빈 사실로 단계를 판정하고, 닫힌 프로젝트의
      // 시각이 앉는다. `project-open-lock.spec.ts`의 *"내보낸 시각을 읽는 동안 닫히면"*이 문다.
      if (stale()) return 'cancelled'
      exportedAt.value = exported
      return loaded === null ? 'failed' : 'opened'
    } finally {
      opening.value = false
    }
  }

  /**
   * **지금 열린 프로젝트를 붙든다.** 돌려준 함수는 **같은 id의 프로젝트가 같은 열기로 아직
   * 열려 있는가**에 답한다 — 닫혔거나, 다른 프로젝트가 열렸거나, 다시 열렸으면(`openings`)
   * 거짓이다.
   *
   * 긴 `await`(굽기·임베딩·학습) 뒤에 조각을 앉히는 화면이 시작할 때 부르고 앉히기 전에
   * 묻는다.
   *
   * **`App.vue`의 화면 키와 겹쳐 지킨다.** 프로젝트가 바뀌면 키가 화면을 새로 띄워 `alive`가
   * 내려간다(`project-switch-remount.spec.ts`). 그래도 이것이 남는 것은 **키가 못 덮는 틈**
   * 때문이다 — 라우터 가드가 `open(B)`로 파일을 갈아 끼운 뒤 화면이 바뀌기까지 옛 화면이
   * 살아 있고, 그 사이에 끝난 계산은 `alive`로 못 가른다. 키 없는 `RouterView`로 옮기거나
   * 스토어만 바꾸는 `train-project-switch.spec.ts` · `image-panel-drop.spec.ts` ·
   * `image-predict-fail.spec.ts` · `image-prep-fail.spec.ts` · `portfolio-attach.spec.ts`가 문다.
   */
  function claim(): () => boolean {
    const held = projectId.value
    const generation = openings
    return () => held !== null && projectId.value === held && openings === generation
  }

  /**
   * 넘어온 것을 지금 쓸 값으로 바꾼다. **함수면 지금 열린 파일에 적용한다**
   * (architecture.md §8.10.3).
   *
   * **닫혔으면 `null`을 돌려주고 부르는 쪽은 아무것도 안 한다.** 되살리면 목록으로
   * 나간 학생의 화면에 옛 프로젝트가 다시 뜨고 자동 저장이 그것을 쓴다 — R20 감사가
   * 학습 화면에서 실측한 것이 그것이다(백본이 늦게 도착해 `close()` 뒤에 앉았다).
   *
   * **어느 프로젝트의 조각인지는 여기서 모른다.** 다른 프로젝트를 연 뒤에 옛 계산이
   * 도착하는 것은 화면이 스스로 멈춰야 한다(`alive`·취소 손잡이·위 `claim`).
   */
  function resolve(next: ProjectFile | ProjectRevision): ProjectFile | null {
    if (typeof next !== 'function') return next
    const current = file.value
    return current === null ? null : next(current)
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
   * 잃는다. 그래서 `dirty`가 실패 뒤에도 참으로 남는 것이 이 결정의 짝이다. 상태 표시줄은
   * 그것을 **내보내기 상태로 접어** 말한다 — `dirty`면 "파일로 저장함"이라 하지 않는다
   * (`export-state.ts`, `status-bar-export.spec.ts`가 문다). 브라우저 저장이 실패했다는 것을
   * 따로 적는 줄은 없고 그것은 알림이 말한다. 부르는 쪽은 던진 것을 잡아 토스트를 띄워야 한다.
   */
  async function save(next: ProjectFile | ProjectRevision, writeId?: WatchWriteId): Promise<void> {
    refuseWatcherWrite(writeId)
    const value = resolve(next)
    if (value === null) return
    cancelPending()
    permitted(() => {
      file.value = value
    })
    dirty.value = true
    await write()
  }

  /**
   * 앞선 쓰기가 끝나는 약속. **쓰기는 온 순서대로 하나씩 한다** (2026-09-28 감사 C, C-2).
   *
   * 겹치게 두면 `saveProject`가 트랜잭션을 세우기 전에 `estimate()`를 기다리는 사이 순서가
   * 뒤집힐 수 있다 — 먼저 시작한 쓰기가 늦게 트랜잭션을 세우면 **옛 값이 새 값을 덮고**, 끝난
   * 뒤에는 `dirty`만 참인 채 다시 쓸 타이머가 없다. `autosave.spec.ts`의 *"겹친 두 쓰기는
   * 나중 값을 남긴다"*가 문다. 앞의 실패는 줄을 끊지 않는다 — 같은 파일의 *"앞의 쓰기가
   * 실패해도 다음 쓰기는 돈다"*가 문다.
   */
  let writing: Promise<void> = Promise.resolve()

  /**
   * 실제로 쓰는 곳. **차례가 왔을 때** 열려 있는 값을 쓴다 — 줄을 서는 동안 바뀌었으면 바뀐
   * 값이 쓰인다. 던진 것은 부른 쪽에 그대로 간다(`flush`·`save`가 던지는 약속) —
   * `autosave.spec.ts`의 *"앞의 쓰기가 실패해도 다음 쓰기는 돈다"*가 문다.
   */
  function write(): Promise<void> {
    const turn = writing.then(writeNow)
    writing = turn.then(
      () => undefined,
      () => undefined,
    )
    return turn
  }

  async function writeNow(): Promise<void> {
    const current = file.value
    if (current === null || !dirty.value) return
    saving.value = true
    const generation = openings
    try {
      await saveProject(current)
      // **쓰는 동안 닫혔거나 다른 프로젝트가 열렸으면 그쪽 상태를 건드리지 않는다** (0.30.0 최종
      // 승인 감사 C-11의 이웃). 전에는 닫힌 뒤에 `dirty`가 참이 되고 `savedAt`이 앉았다.
      // `project-open-lock.spec.ts`의 *"쓰는 동안 닫히면"*이 문다.
      if (openings !== generation) return
      // 쓰는 동안 또 바뀌었을 수 있다. 그러면 여전히 안 쓴 상태로 두어야 한다.
      dirty.value = file.value !== current
      saveFailed.value = false
      savedAt.value = new Date().toISOString()
      askToKeep(current)
    } catch (error) {
      // 실패는 그대로 부른 쪽에 간다. 여기서는 떠나기를 멈출지 정하는 표지만 세운다(결정 74).
      if (openings === generation) saveFailed.value = true
      throw error
    } finally {
      saving.value = false
    }
  }

  /**
   * **본체 없는 폴더 참조를 떼고 연 판을 한 번 쓴다** (open-decisions.md "본체 없는 폴더 참조는
   * 기대는 실험이 없을 때만 떼고 연다"의 코드 소유자 후속). `open()`이 뗐을 때만 부른다.
   *
   * **쓰기 줄에 선다**(`writing`) — 학생의 저장과 순서가 안 뒤집힌다(줄에 서는 것은 무는 검사 없음,
   * 사람 확인 — 여는 순간 같은 레코드에 앞선 쓰기가 줄에 있는 경우를 스펙으로 못 세웠다). 차례가 왔을 때 판이 바뀌었거나
   * 닫혔으면 쓰지 않는다: 바뀐 판은 학생의 편집이라 자동 저장이 쓰고, 그것도 뗀 판 위의 편집이다.
   * 판이 바뀐 경우를 거르는 것은 헛쓰기 한 번을 덜 뿐이다 — 안 걸러도 마지막에 남는 것은 편집이라
   * 그 칸만 무는 검사는 없다(사람 확인).
   *
   * **학생의 편집이 아니다.** 그래서 `dirty`·`saveFailed`·`savedAt`을 안 건드리고 문서의 시각
   * (`manifest.updatedAt`)도 안 찍는다. 레코드의 "파일로 안 나간 편집" 표지는 참이 된다 — 뗀 판은
   * 어느 파일에도 없다(결정 75, 보수 쪽). **실패는 삼킨다** — 지금처럼 다음에 열 때 다시 떼고 다시
   * 알린다. 알리면 학생이 할 일이 없는 영어 오류가 뜨고, 표지를 세우면 떠나기가 멈춘다(결정 74).
   * 무는 검사: `project-open-detach.spec.ts`의 *"뗀 문서는 열자마자 쓴다"* 묶음.
   */
  function persistDetached(opened: ProjectFile): void {
    const generation = openings
    const turn = writing.then(async () => {
      if (openings !== generation || file.value !== opened) return
      saving.value = true
      try {
        await saveProject(opened)
      } catch {
        // 위 머리말 — 다시 열 때 또 뗀다.
      } finally {
        saving.value = false
      }
    })
    writing = turn
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

  /**
   * 미뤄 둔 저장과 그 최대 대기를 **함께** 거둔다. 하나만 남으면 다음 입력의 대기가 옛 시각부터 재진다.
   * 부르는 자리는 `flush`·`save`·`close`와 **다른 프로젝트로 갈아 끼우는 `open`**이다(open-decisions.md 81).
   */
  function cancelPending(): void {
    if (pending !== null) {
      clearTimeout(pending)
      pending = null
    }
    if (deadline !== null) {
      clearTimeout(deadline)
      deadline = null
    }
  }

  /** 미뤄 둔 저장을 지금 한다. 디바운스와 최대 대기 중 먼저 온 쪽이 부른다. */
  function writeDeferred(): void {
    cancelPending()
    void write().catch((error: unknown) => useToastStore().pushError(error))
  }

  /**
   * 값을 바꾸고 **잠시 뒤** 저장한다. 화면은 즉시 새 값을 본다.
   *
   * 슬라이더를 끌거나 글을 쓰는 화면이 쓰는 경로다 - 한 글자마다 수십 MB를 쓰면
   * 교실 PC가 멈춘다. 되돌릴 수 없는 큰 변경(데이터셋 교체)은 `save`로 즉시 쓴다.
   *
   * **실패하면 알림을 띄운다.** 타이머가 부르는 것이라 기다리는 사람이 없고,
   * 조용히 실패하면 학생은 저장된 줄 안다.
   *
   * **쉬지 않고 바꿔도 최대 대기가 지나면 쓴다** (open-decisions.md 81). 디바운스 타이머는 입력마다
   * 다시 걸지만 최대 대기 타이머는 미뤄 둔 첫 입력에서 한 번만 건다. `autosave.spec.ts`의
   * *"쉬지 않고 바꿔도 최대 대기가 지나면 쓴다"*가 문다.
   */
  function update(next: ProjectFile | ProjectRevision, writeId?: WatchWriteId): void {
    refuseWatcherWrite(writeId)
    const value = resolve(next)
    if (value === null) return
    permitted(() => {
      file.value = value
    })
    dirty.value = true
    if (pending !== null) clearTimeout(pending)
    pending = setTimeout(writeDeferred, AUTOSAVE_DELAY_MS)
    deadline ??= setTimeout(writeDeferred, AUTOSAVE_MAX_WAIT_MS)
  }

  /** 미뤄 둔 저장을 지금 한다. 화면을 떠날 때와 내보내기 전에 부른다. */
  async function flush(): Promise<void> {
    cancelPending()
    await write()
  }

  /**
   * `.mlpx`를 내려받는다. **학생의 유일한 반출 경로다** (CLAUDE.md §1.1).
   *
   * **파일이 나가는 길은 IndexedDB를 기다리지 않는다** (2026-09-28 감사 A B-1). 파일의 내용은
   * 아래에서 쥔 `current`가 전부 정한다 — 미뤄 둔 저장(`flush`)은 그 값을 브라우저에 쓸 뿐
   * 파일에 한 글자도 보태지 않는다. 그런데 전에는 `await flush()`를 먼저 해서, 저장이 끝나지
   * 않으면(막힌 트랜잭션, 닫힌 연결) **파일을 만드는 줄에 영영 닿지 못했다.** 그래서 저장은
   * 시작만 하고, 파일을 만들어 내려보낸 뒤 돌아온다.
   *
   * 담지 못한 모델을 돌려주므로 화면이 경고할 수 있다. **돌아온 순간 파일은 이미 나갔다** —
   * 내보낸 시각을 적는 일은 뒤에서 돈다. 무는 검사: `autosave.spec.ts`의
   * *"저장이 끝나지 않아도 파일은 나간다"*.
   */
  async function exportFile(portfolioMarkdown: string): Promise<DroppedModel[]> {
    // **내보낼 파일은 저장을 시작하기 전에 쥔다.** 받은 마크다운은 지금 열린 프로젝트의 것이라,
    // 그 뒤에 프로젝트가 바뀌면 다시 읽은 파일에 남의 글이 실린다. `autosave.spec.ts`의
    // "저장을 기다리는 사이 프로젝트가 바뀌어도 쥔 프로젝트를 내보낸다"가 문다.
    const current = file.value
    if (current === null) return []
    const exportedId = current.document.manifest.projectId
    /** 쥔 순간. 쥔 뒤에 고친 것이 있으면 내보낸 시각을 이것으로 적는다 — 아래 `at`. */
    const capturedAt = new Date().toISOString()

    // **저장은 시작만 하고 실패는 알린다.** 막지 않는 이유는 라우터 가드와 같다
    // (router/index.ts) — 파일을 만들 재료는 전부 메모리에 있고, 저장소가 모자라다고
    // (`STORAGE_QUOTA_EXCEEDED`) 반출까지 막으면 **학생이 작업을 기기 밖으로 꺼낼 길이
    // 없어진다** (CLAUDE.md §1.1·§1.3). 방금 쓴 글은 `current`에 이미 들어 있다.
    const saved = flush().catch((error: unknown) => {
      useToastStore().pushError(error)
    })

    const { blob, dropped } = await writeProject(current, portfolioMarkdown)
    downloadBlob(blob, projectFileName(current.document.manifest))
    // **이 판은 이제 파일에 있다** (결정 74). 브라우저 저장이 실패하는 중이어도 떠날 수 있다.
    // 쥔 뒤에 판이 바뀌었으면 지금 판은 파일에 없다 — 그때는 세우지 않는다(판을 쥐던 때와 같은 뜻).
    if (file.value === current) exportedCurrent.value = true

    // **여기서부터는 파일이 이미 나갔다.** 내보낸 시각은 이 기기의 곁가지 정보이고
    // (storage.ts) 파일 안에는 없다. **저장이 끝난 뒤에 뒤에서 적는다** — 둘 다 IndexedDB라
    // 저장이 멈추면 이것도 멈추는데, 기다리면 화면이 성공한 내보내기를 끝나지 않은 것으로
    // 보인다. 실패하면 알린다: 올려보내면 성공한 내보내기를 실패로 말하게 된다.
    //
    // **무슨 시각을 적는가는 저장이 끝난 뒤의 판이 정한다** (2026-09-28, C-5a를 닫는다).
    // 상태 표시줄은 이 시각을 `savedAt`과 견준다(`exportStateOf`). `savedAt`은 세션 안에서는
    // 쓰기가 **끝난** 시각이고(`writeNow`), 다시 열면 레코드의 `manifest.updatedAt`이다(`open`) —
    // 학생이 프로젝트를 고치는 자리는 그 칸을 찍는다. **예외 하나: `addEmbeddings`는 일부러 안
    // 찍는다**(`project/embeddings.ts` — 우리가 계산을 캐시한 것이지 학생의 편집이 아니다). 그래서
    // 쥔 뒤에 임베딩만 앉으면 다시 연 뒤에는 "내보냄"으로 보인다. **해가 작다** — 임베딩은
    // 파생물이라 파일을 연 쪽이 없는 것을 다시 뽑으면 되고(mlpx-spec.md §1.3), 학생의 글·설정·
    // 사진은 하나도 빠지지 않았다. 세션 안에서는 아래 판 비교가 그것도 "변경됨"으로 잡는다.
    // - **지금 판이 쥔 판이면** 저장된 것도 그 판이다 → 지금 시각. 저장 시각보다 뒤라 "내보냄"이
    //   서고, 다시 열어도 레코드의 `updatedAt`(쥐기 전에 찍힌 시각)보다 뒤다. 전에는 저장이
    //   끝나기 **전에** 시각을 찍어서, 정상 내보내기 뒤에도 늘 "변경됨"이 섰다.
    // - **다르면** 쥔 뒤에 고친 것이 있다 — 그 편집은 파일에 없다 → 쥔 시각. 그 편집의 저장
    //   시각과 `updatedAt`이 둘 다 이보다 뒤라 "변경됨"이 선다. 직렬화된 `flush`가 차례에서 나중
    //   판을 읽어 쓴 경우도 여기로 온다. 이것이 C-5a의 틈("쥔 뒤에 고치면 '내보냄'이라 말한다")을
    //   닫는다. 무는 검사: `status-bar-export.spec.ts`의 *"정상 내보내기는 다시 열어도 내보냄이다"*,
    //   *"쥔 뒤 저장이 끝나기 전에 고치면 변경됨이다"*.
    //
    // **"파일로 안 나간 편집" 표지도 같은 판정이 내린다** (결정 75). 지금 판이 쥔 판이면 쥔 판의
    // `updatedAt`을 넘기고, `markExported`는 레코드가 그 판 그대로일 때만 표지를 거짓으로 적는다.
    void saved
      .then(() => {
        const unchanged = file.value === current
        const at = unchanged ? new Date().toISOString() : capturedAt
        const exportedUpdatedAt = unchanged ? current.document.manifest.updatedAt : null
        return markExported(exportedId, at, exportedUpdatedAt).then(() => at)
      })
      .then(
        (at) => {
          // 화면의 "내보낸 시각"은 지금 열린 프로젝트의 것이다 — 바뀌었으면 남의 줄에 앉히지
          // 않는다. 열기 세대(`claim`)가 아니라 id로 본다: A→B→A로 다시 열었으면 이 시각이
          // A의 것이 맞다. 그 경합은 `open()`과 이 적기가 끝나는 차례에 달려 검사로 고정하지
          // 못했다(사람 확인).
          if (projectId.value === exportedId) exportedAt.value = at
        },
        (error: unknown) => {
          useToastStore().pushError(error)
        },
      )
    return dropped
  }

  function close(): void {
    // **도는 중인 열기를 낡게 만든다** (R37 A-1). 아래 `releaseTabLock()`이 잠금 쪽을
    // 취소하고, 이 줄이 화면 쪽을 취소한다 — 둘이 함께여야 상태가 안 갈린다.
    openings += 1
    cancelPending()
    releaseTabLock()
    file.value = null
    // 화면들이 나눠 쓰는 계획의 한 칸도 비운다 — 닫은 프로젝트의 표를 쥐고 있지 않는다
    // (`ml/plan-cache.ts`, `tabular-plan-cache.spec.ts`가 문다).
    forgetTabularPlan()
    dirty.value = false
    saveFailed.value = false
    exportedCurrent.value = false
    savedAt.value = null
    exportedAt.value = null
  }

  return {
    file,
    opening,
    saving,
    dirty,
    saveFailed,
    stranded,
    savedAt,
    exportedAt,
    projectId,
    name,
    facts,
    taskType,
    dataType,
    open,
    claim,
    save,
    update,
    flush,
    exportFile,
    close,
  }
})
