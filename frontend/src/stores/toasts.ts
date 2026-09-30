/**
 * 화면 구석에 잠깐 뜨는 알림.
 *
 * **문장이 아니라 로케일 키를 담는다.** 백엔드가 코드만 돌려주는 것과 같은 이유다
 * (CLAUDE.md §1.4) — 알림이 떠 있는 동안 학생이 언어를 바꿔도 문장이 따라와야 하고,
 * 스토어에 완성된 문장이 들어가는 순간 그 자리는 번역 밖으로 나간다.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

import { errorMessageKey, toMessage } from '@/errors'
import { TOAST_DURATION_MS } from '@/limits'

export const TOAST_TONES = ['info', 'success', 'caution', 'danger'] as const

export type ToastTone = (typeof TOAST_TONES)[number]

export interface Toast {
  readonly id: number
  readonly tone: ToastTone
  /** 로케일 키. 예: `client.STORAGE_QUOTA_EXCEEDED` */
  readonly key: string
  readonly params: Readonly<Record<string, unknown>>
}

/**
 * 저절로 사라지는 어조. **성공 하나뿐이고, 나머지는 학생이 닫아야 한다.**
 *
 * **목록을 뒤집어 적는 이유는 기본값 때문이다.** "사라지지 않는 것"을 세면 어조를
 * 하나 더 만드는 사람이 아무것도 안 적어도 사라지는 알림이 되고, **그게 잘못된
 * 쪽으로 조용하다** — 못 읽은 알림은 아무 흔적을 안 남긴다. 여기서는 안 적으면
 * 남는다.
 *
 * **성공만 사라져도 되는 이유**는 그 알림이 **이미 화면에 결과가 보이는 일**을
 * 말하기 때문이다 — 데이터를 사용했으면 표가 떠 있고, 파일로 저장했으면 파일이
 * 내려와 있다. 못 읽어도 잃는 것이 없다.
 *
 * 나머지 셋은 전부 **학생이 모르면 다음 판단이 틀어지는 것**이다. 실패(`danger`)는
 * 무엇이 왜 안 됐는지이고, `caution`은 **몰래 빠진 것**이다 — 읽지 못한 파일, 선택에서
 * 빠진 열, 저장하지 못한 모델, 꺼진 범주 비율 유지. `info`도 지금 하나뿐인데 같은 성질이다
 * ("이미 있는 사진 {count}장은 넘어갔습니다" — 40장을 올렸는데 12장만 늘어난 이유).
 */
const AUTO_DISMISS: ReadonlySet<ToastTone> = new Set<ToastTone>(['success'])

/**
 * **키만으로 같은 알림인 것.** 원문(`detail`)이 달라도 학생이 할 일이 하나라서다 — 화면을 못 받았으면
 * 새로고침이다(open-decisions.md 85·86). 옛 탭의 결과 화면에서 지연 패널 여럿이 한꺼번에 청크를 못 받으면
 * 패널마다 주소가 달라 같은 문장이 패널 수만큼 쌓였다. `toasts.spec.ts`의
 * *"화면을 못 받았다는 알림은 원문이 달라도 하나다"*가 문다.
 */
const ONE_PER_KEY: ReadonlySet<string> = new Set([errorMessageKey('SCREEN_LOAD_FAILED')])

export const useToastStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([])
  let lastId = 0

  function dismiss(id: number): void {
    items.value = items.value.filter((toast) => toast.id !== id)
  }

  /**
   * 같은 알림이 이미 떠 있으면 하나로 둔다.
   *
   * **한 번의 동작이 알림 하나여야 한다는 규칙이 아니다** - 판정이 입력마다 도는 자리가
   * 있어서다. 포트폴리오는 상한을 넘긴 상태에서 글을 치면 **글자마다** 거절이 뜬다
   * (2026-08-15). 사라지지 않는 어조라 화면이 그대로 덮인다.
   *
   * **어조·키·파라미터가 전부 같을 때만 같은 알림이다.** 파일 이름이 다르면 다른 사실을
   * 말하는 것이라 둘 다 떠야 한다. 예외는 위 `ONE_PER_KEY`의 키뿐이고 그것은 파라미터를 안 본다.
   *
   * **같은 알림의 판정은 여기 하나다** — 전역 오류 처리기(`app-errors.ts`)도 `shown`으로 이것을 묻는다.
   */
  function same(tone: ToastTone, key: string, params: Record<string, unknown>): Toast | undefined {
    return items.value.find(
      (toast) =>
        toast.tone === tone &&
        toast.key === key &&
        (ONE_PER_KEY.has(key) || JSON.stringify(toast.params) === JSON.stringify(params)),
    )
  }

  /** 같은 알림이 떠 있는가 (`same`). 목록을 건드리지 않고 묻는다. */
  function shown(tone: ToastTone, key: string, params: Record<string, unknown> = {}): boolean {
    return same(tone, key, params) !== undefined
  }

  /**
   * **같은 알림이면 옛 것을 빼고 새 id로 다시 민다.** 여전히 하나로 서되 id는 지금의 것이라,
   * 이동의 수위선(`router/index.ts`의 `afterEach`)이 방금 다시 일어난 일의 알림을 걷지 않는다.
   * `router.spec.ts`의 *"같은 저장 실패가 이어지면 …"*이 문다. 화면 안 부품이 먼저 띄운 새로고침
   * 알림 위로 이동이 실패해도 같다 — 안 밀고 두면 실패한 이동 끝에 걷혀 말없이 선다.
   * `route-chunk-failure.spec.ts`의 *"화면 안 부품의 새로고침 알림이 떠 있어도 …"*가 문다.
   */
  function push(tone: ToastTone, key: string, params: Record<string, unknown> = {}): number {
    const already = same(tone, key, params)
    if (already !== undefined) dismiss(already.id)

    lastId += 1
    const id = lastId
    items.value = [...items.value, { id, tone, key, params }]
    if (AUTO_DISMISS.has(tone)) {
      setTimeout(() => {
        dismiss(id)
      }, TOAST_DURATION_MS)
    }
    return id
  }

  /**
   * 잡은 예외를 그대로 알림으로 만든다.
   *
   * **변환은 `errors.ts`의 `toMessage` 하나다.** 학습 화면도 같은 실패를 버튼 옆에
   * 남겨야 하는데, 변환이 두 벌이면 한쪽만 고쳐져 어긋난다.
   */
  function pushError(error: unknown): number {
    const { key, params } = toMessage(error)
    return push('danger', key, params)
  }

  function clear(): void {
    items.value = []
  }

  /**
   * **떠나는 화면의 알림만 걷는다.** `id`가 `after` 이하인 것을 지운다.
   *
   * 화면을 옮기면 그 화면에서 뜬 오류가 따라와 **다음 화면의 첫 선택지를 덮었다**
   * (2026-08-29 화면 실측 B-8). 전처리에서 오류 둘을 내고 레일로 학습에 가면 기계학습
   * 유형 버튼 줄이 가려진다.
   *
   * **통째로 지우면 안 되는 이유**가 하나 있다 — 라우터 가드가 **이동하는 도중에도**
   * 알림을 민다(`router/index.ts`의 flush 실패). 그건 방금 일어난 일이라 새 화면에서
   * 읽혀야 한다. 그래서 수위선을 넘긴다.
   *
   * **스토어의 원칙과 부딪히는 것은 사실이다** — 위 `AUTO_DISMISS`는 "성공만 사라진다"
   * 이고, 학생이 못 읽은 알림은 흔적을 안 남긴다. 다만 **떠난 화면의 오류는 맥락도 함께
   * 떠난 것**이고, 그 자리에 머무는 동안에는 그대로 남는다.
   */
  function dismissUpTo(after: number): void {
    items.value = items.value.filter((toast) => toast.id > after)
  }

  /** 지금까지 나간 마지막 id. 수위선을 잡는 쪽이 읽는다. */
  function highWaterMark(): number {
    return lastId
  }

  return { items, push, pushError, shown, dismiss, clear, dismissUpTo, highWaterMark }
})
