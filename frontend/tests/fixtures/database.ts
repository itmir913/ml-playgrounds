/**
 * **검사의 저장소(IndexedDB)를 지우는 길은 이것 하나다** (결정문 65 "관문이 흔들린 원인 하나", #33).
 *
 * 지우기 전에 **프로젝트 스토어를 닫는다.** 스토어의 `update`는 저장을 `AUTOSAVE_DELAY_MS` 뒤로
 * 미루는데, 검사가 끝난 뒤 그 타이머가 터지면 **다음 검사의 저장소에** 같은 `projectId`의 옛 파일을
 * 덮어쓴다 — 단언 실패로 보이지만 틱 수의 경합이 아니라 검사 사이의 누수라 `vi.waitFor`로는 안
 * 고쳐진다. 전에는 스펙마다 `afterEach`에 `useProjectStore().close()`를 손으로 적었고(자리는 스펙마다
 * 달랐다), 적는 것을 잊은 스펙은 그대로 샜다. 이제 지우는 도우미가 닫으므로 **새 스펙이 이 줄을 빠뜨릴 수 없다.**
 * `tests/database-reset.spec.ts`가 이 도우미를 안 거치고 저장소를 지우는 스펙을 막는다.
 *
 * **지금 활성인 pinia만이 아니라 이 도우미가 본 pinia를 모두 닫는다.** `beforeEach`에서만 지우는
 * 스펙은 보통 `setActivePinia(createPinia())`를 **먼저** 부른다 — 그 뒤에 활성 스토어만 닫으면 새로 만든
 * 빈 스토어를 닫을 뿐이고, 타이머를 쥔 것은 앞 검사의 스토어다. `database-reset.spec.ts`가 그 순서를 문다.
 *
 * **연결(`closeStorage`)은 닫지 않는다.** 그것은 부르는 쪽이 정한다 — `storage.spec.ts`의
 * *"한 번 실패해도 그 세션이 통째로 죽지 않는다"*는 연결을 안 닫고 지우는 것이 요점이다.
 */

import { getActivePinia, setActivePinia, type Pinia } from 'pinia'

import { DB_NAME } from '../../src/project/storage'

/** 이 파일(스펙 하나)에서 도우미가 본 pinia. 스펙 파일마다 모듈이 새로 뜨므로 파일 사이로는 안 샌다. */
const seen = new Set<Pinia>()

/** 프로젝트 스토어의 id (`stores/project.ts`의 `defineStore('project', …)`). 바뀌면 `database-reset.spec.ts`가 운다. */
const PROJECT_STORE_ID = 'project'

/**
 * 그 pinia가 **이미 만든** 프로젝트 스토어. 없으면 `undefined`이고, 새로 만들지 않는다.
 *
 * **스토어 모듈을 들이지 않고 pinia의 스토어 표(`_s`)에서 꺼낸다.** 들이면 이 도우미를 쓰는 스펙이 전부
 * 스토어 → 탭 잠금(`project/tab-lock.ts`)의 DOM 가드에 닿아 jsdom을 밝혀야 한다(`ui-rules.spec.ts`
 * "DOM이 필요한 검사는 스스로 밝힌다") — 스토어를 안 쓰는 `storage.spec.ts`까지. 스토어가 있다면 그것을 만든
 * 스펙이 이미 스토어를 들였다.
 *
 * **한계 — 공개 API가 아니다.** `_s`는 pinia가 문서로 약속하지 않은 내부 표다. 그물은 이것뿐이다 — 표가
 * `Map`이 아니면 던지고, 꺼낸 스토어에 `close`가 없으면 던진다. **이름과 모양은 그대로인데 뜻이 바뀌는 것**
 * (스토어를 다른 곳에 두고 `_s`를 빈 `Map`으로 남기는 것)은 못 잡는다 — 그때는 스토어를 못 찾아 조용히 안
 * 닫는다. 그 경우와 id `'project'`가 바뀐 경우는 `database-reset.spec.ts`의 행동 검사(실제 타이머로 옛 파일이
 * 안 돌아오는가)가 운다.
 */
function projectStoreOf(pinia: Pinia): ProjectStoreHandle | undefined {
  const stores = (pinia as unknown as { _s?: unknown })._s
  if (!(stores instanceof Map)) throw new Error('pinia no longer keeps its stores in _s')
  const store: unknown = stores.get(PROJECT_STORE_ID)
  if (store === undefined) return undefined
  const close = (store as { close?: unknown }).close
  if (typeof close !== 'function') throw new Error('the project store has no close()')
  if (typeof (store as { opening?: unknown }).opening !== 'boolean') {
    throw new Error('the project store has no opening flag')
  }
  return store as ProjectStoreHandle
}

/** 도우미가 쓰는 스토어의 몫 — 닫기와, 닫을 것이 남았는지 보는 칸. */
interface ProjectStoreHandle {
  close: () => void
  readonly file: unknown
  readonly opening: boolean
}

/**
 * 닫을 것이 남았는가. 미뤄 둔 저장은 `update`가 파일을 세울 때만 걸리고 `close`가 파일을 비우며 끊으므로,
 * **파일이 비었고 여는 중도 아니면** 걸린 타이머도, 쥔 탭 잠금도, 도는 열기도 없다.
 */
function needsClosing(store: ProjectStoreHandle): boolean {
  return store.file !== null || store.opening
}

/**
 * 본 pinia의 프로젝트 스토어를 모두 닫는다. 미뤄 둔 자동 저장이 여기서 끊긴다.
 *
 * **지금 pinia의 스토어는 늘 닫고, 옛 pinia의 스토어는 닫을 것이 남았을 때만 닫은 뒤 잊는다.** 탭 잠금
 * (`project/tab-lock.ts`)은 모듈에 하나라, 이미 닫힌 옛 스토어를 다시 닫으면 지금 스토어가 쥔 잠금을 놓아
 * 버린다 — `afterEach`에서 활성으로 닫은 스토어가 다음 `beforeEach`에서 옛 것으로 한 번 더 닫히던 것이
 * 그 모양이었다. 옛 스토어가 그 뒤에 다시 쓰였으면(파일이 섰거나 여는 중) 그때는 닫는다.
 */
export function closeProjectStores(): void {
  const active = getActivePinia()
  if (active !== undefined) seen.add(active)
  for (const pinia of seen) {
    const store = projectStoreOf(pinia)
    if (pinia === active) {
      store?.close()
      continue
    }
    if (store !== undefined && needsClosing(store)) store.close()
    seen.delete(pinia)
  }
  // 스토어의 동작(`close`)을 부르면 pinia가 **그 스토어의 pinia를 활성으로 세운다** — 되돌리지 않으면 이 뒤의
  // 검사가 앞 검사의 스토어를 쓴다(`database-reset.spec.ts`의 "새 pinia를 먼저 세워도"가 이 줄을 문다).
  if (active !== undefined) setActivePinia(active)
}

/** 스토어를 닫고 저장소를 지운다. 지우기가 막히거나 실패해도 기다리지 않는다(부르는 쪽이 새로 연다). */
export async function resetDatabase(): Promise<void> {
  closeProjectStores()
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
