/**
 * 실행 방법과 그 선택 규칙.
 *
 * **화면에는 하나의 목록으로 낸다.** "어디서 돌릴까"와 "무엇으로 돌릴까"를 드롭다운 두 개로
 * 나누면 중학생에게 답할 수 없는 질문을 두 번 던지는 셈이다. 파일에는 여전히 두 필드로
 * 남지만(computedBy / engine.kind) 그건 기록의 문제이지 화면의 문제가 아니다
 * (architecture.md 3.4).
 *
 * ```
 * 결정트리
 *   ● 순수 JS                   browser / mljs             기본
 *   ○ scikit-learn (내 컴퓨터)   browser / pyodide-sklearn
 *   ○ scikit-learn (학교 서버)   server  / sklearn           서버가 있을 때만
 * ```
 *
 * **못 쓰는 것도 숨기지 않는다.** 비활성화하되 왜 못 쓰는지 함께 준다 - 이유 없이 회색으로
 * 죽어 있는 항목은 학생에게 고장으로 보인다. 서버가 없는 것은 예외가 아니라 정상 경로다
 * (CLAUDE.md 1.1).
 *
 * 여기 있는 것은 전부 순수 함수다. 상단 상태 패널과 모델 선택 화면이 **같은 함수를 본다** -
 * 두 곳이 각자 판정하면 반드시 어긋난다.
 */

import { BROWSER_ROW_LIMIT } from '../limits'
import { supports, type Axis } from './axes'

/**
 * 학습이 실제로 도는 곳. .mlpx의 run.computedBy가 이 어휘를 그대로 쓴다.
 * 값을 바꾸면 파일 포맷이 바뀌는 것이므로 formatVersion을 올려야 한다.
 */
export const TRAINING_LOCATIONS = ['browser', 'server'] as const

export type TrainingLocation = (typeof TRAINING_LOCATIONS)[number]

/** 서버 상태. 'unknown'은 아직 확인 전이며 서버 옵션을 켜 주지 않는다. */
export type ServerStatus = 'unknown' | 'available' | 'unavailable'

/**
 * 무거운 엔진의 준비 상태. **네 단계다.**
 *
 * 'downloaded'가 따로 있는 이유 - 다운로드는 캐시에 남지만 **시동은 페이지를 열 때마다
 * 다시 든다.** scikit-learn은 실측 15.4초이고 그중 다운로드는 0초다. 세 단계로 줄이면
 * 학생이 "아까 받았는데 왜 또 기다리지"를 겪는다
 * (open-decisions.md "무거운 엔진은 상태 점검에서 학생이 켠다").
 */
export const ENGINE_STATES = ['absent', 'downloading', 'downloaded', 'ready'] as const

export type EngineState = (typeof ENGINE_STATES)[number]

/**
 * 고를 수 없는 이유. 로케일 키 client.* 와 1:1로 대응한다.
 *
 * 프런트엔드에서만 판정되는 조건이다. 서버가 꺼져 있을 때는 서버가 에러 코드를 줄 수
 * 없으므로 backend/app/errors.py 와는 별개 목록이다.
 */
export const UNAVAILABLE_REASONS = [
  'ALGORITHM_NOT_FOR_DATA_TYPE',
  'ALGORITHM_NOT_FOR_TASK_TYPE',
  'SERVER_UNAVAILABLE',
  'ALGORITHM_NOT_AVAILABLE_HERE',
  'DATASET_TOO_LARGE_FOR_BROWSER',
  'ENGINE_NOT_READY',
] as const

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

/**
 * 사유별로 로케일 문장이 요구하는 값. 나머지는 빈 파라미터다.
 *
 * **판정하는 곳 옆에 둔다.** 이유를 보여주는 자리가 둘이고(전처리 화면의 모델 목록,
 * 실패한 run) 각자 파라미터를 만들면 한쪽 문장에만 숫자가 빠진 채 뜬다.
 */
export function reasonParams(
  reason: UnavailableReason,
  /**
   * 이 알고리즘에 걸린 상한. **알고리즘마다 다르다** (AlgorithmSpec.maxRows).
   *
   * 기본값을 두는 이유는 나머지 사유가 이 값을 안 쓰기 때문이다. 다만 SVM처럼 상한이
   * 따로 있는 알고리즘에서 이걸 안 넘기면 **화면이 5000이라고 말하고 3000에서 꺼진다.**
   */
  limitRows: number = BROWSER_ROW_LIMIT,
): Record<string, number> {
  return reason === 'DATASET_TOO_LARGE_FOR_BROWSER' ? { limitRows } : {}
}

/**
 * 실행 방법의 이름. **알고리즘 등록부가 이 축에 칸을 하나씩 갖는다** (architecture.md §9).
 *
 * **여기 값을 더하면 모든 알고리즘 줄이 깨진다. 그게 목적이다** - 새 엔진에 그 알고리즘
 * 구현이 있는지는 알고리즘마다 다르고, 사람이 하나씩 판단해야 하는 것이다. 배열이었을
 * 때는 아무 일도 안 일어났다.
 */
export const RUNTIME_IDS = ['mljs', 'pyodide-sklearn', 'server-sklearn'] as const

export type RuntimeId = (typeof RUNTIME_IDS)[number]

/**
 * 번들에 들어 있는 실행 방법. **행 상한을 등록부가 선언할 수 있는 것이 정확히 이것뿐이다.**
 *
 * 서버 쪽 상한은 그 학교가 꽂은 하드웨어가 정하므로 우리가 적으면 거짓말이 된다 -
 * 능력 협상이 알려준다 (open-decisions.md "서버의 상한은 등록부에 없다").
 *
 * **RUNTIMES와 어긋나면 안 된다.** 타입은 이걸 못 잡으므로 tests/runtime-options.spec.ts가
 * 두 목록을 대조한다.
 */
export const BROWSER_RUNTIME_IDS = ['mljs', 'pyodide-sklearn'] as const

export type BrowserRuntimeId = (typeof BROWSER_RUNTIME_IDS)[number]

export function isBrowserRuntimeId(id: RuntimeId): id is BrowserRuntimeId {
  return (BROWSER_RUNTIME_IDS as readonly RuntimeId[]).includes(id)
}

/**
 * **아직 재 보지 않았다는 표시.** 빈 칸이 아니라 값이다.
 *
 * 숫자를 지어 넣으면 근거 없는 값이 실측처럼 보이고, 옵셔널로 비워 두면 빠뜨림이 합법이
 * 된다 (ml/axes.ts가 `Partial<>`을 금지하는 것과 같은 이유). 이 칸은 전역 기본값을 따르고,
 * **보수적으로 틀리는 쪽이다** - 실제로는 더 큰 데이터가 될 가능성이 높다.
 */
export const UNMEASURED = null

export type RowLimit = number | typeof UNMEASURED

/**
 * 실행 방법 하나.
 *
 * location과 engineKind가 파일에 남는 값이고, id는 화면과 등록부가 쓰는 이름이다.
 * 같은 엔진이 두 위치에서 도는 일이 실제로 있으므로(sklearn) id가 따로 필요하다.
 */
export interface RuntimeSpec {
  readonly id: RuntimeId
  readonly location: TrainingLocation
  /** run.engine.kind에 그대로 들어간다. 재실행 대조가 이 값으로 엔진을 가린다. */
  readonly engineKind: string
  /** 쓰기 전에 내려받고 시동해야 하는가. 순수 JS는 번들에 이미 있다. */
  readonly needsPreparation: boolean
}

/**
 * 아무 정보도 없을 때 적어 두는 실행 방법.
 *
 * 새 프로젝트를 만드는 시점에는 서버가 있는지도, 무거운 엔진이 받아졌는지도 모른다.
 * 그때 쓰는 값이고, 화면은 실제 상황을 보고 preferredRuntime으로 다시 고른다.
 * **브라우저에서 도는 것이어야 한다** - 서버 없는 것이 기본 상태이기 때문이다.
 */
export const FALLBACK_RUNTIME_ID: RuntimeId = 'mljs'

/**
 * V1의 실행 방법. **순서가 곧 기본값 우선순위다** - 앞에 있는 것부터 고른다.
 *
 * 순수 JS가 맨 앞인 이유는 gzip 25KB에 시동이 없기 때문이다. scikit-learn은 26.3MB에
 * 시동 15.4초라 기본값이 될 수 없다 (open-decisions.md "브라우저 학습 엔진은 둘 다 간다").
 *
 * **RUNTIME_IDS 값마다 한 줄이 있어야 한다** - 이름만 있고 명세가 없는 실행 방법은
 * 화면에서 통째로 사라진다. 타입은 이걸 못 잡으므로 검사가 본다 (§9.3.2).
 */
export const RUNTIMES: readonly RuntimeSpec[] = [
  { id: 'mljs', location: 'browser', engineKind: 'mljs', needsPreparation: false },
  {
    id: 'pyodide-sklearn',
    location: 'browser',
    engineKind: 'pyodide-sklearn',
    needsPreparation: true,
  },
  { id: 'server-sklearn', location: 'server', engineKind: 'sklearn', needsPreparation: false },
]

export interface AlgorithmSpec {
  readonly id: string
  /**
   * 어느 실행 방법에 이 알고리즘의 구현이 있는가. 등록부가 알고리즘마다 선언한다.
   *
   * **정적 사실이다** (architecture.md §9의 표). "지금 그 서버가 붙어 있는가"는 여기가
   * 아니라 RuntimeContext가 답한다 - 등록부에 지금 상태를 넣으면 표가 시간에 따라
   * 변하고, 그 순간 표를 신뢰할 수 없다.
   */
  readonly runtimes: Axis<RuntimeId>
  /**
   * 브라우저 구현마다 걸리는 행 상한. **알고리즘 하나에 값 하나가 아니다.**
   *
   * 전역 하나로는 못 담고(10만 행 0.3초인 선형 회귀와 5000행 7분인 랜덤포레스트),
   * **알고리즘 하나로도 못 담는다** - `ml-cart`의 분할 탐색이 O(특성 × 행²)인 것은
   * `ml-cart`의 성질이지 결정 트리의 성질이 아니다. 같은 결정 트리를 sklearn으로 돌리면
   * 다른 숫자가 나온다 (open-decisions.md #13의 "(알고리즘 × 구현)에 걸린다").
   *
   * **칸을 다 채운다** (`Axis`와 같은 이유, ml/axes.ts). 안 재 본 칸에는 `UNMEASURED`를
   * 적는다 - 새 브라우저 엔진이 붙는 날 알고리즘 줄마다 "이건 얼마인가"를 묻게 하려고
   * `Partial`이 아니다. 값은 limits.ts가 출처이고 여기는 어느 칸에 걸리는지만 선언한다.
   *
   * **서버 칸이 없다.** 여기 적을 수 있는 것은 번들에 든 우리 구현의 성질뿐이고, 서버의
   * 상한은 능력 협상이 알려준다 (BROWSER_RUNTIME_IDS).
   */
  readonly maxRows: Readonly<Record<BrowserRuntimeId, RowLimit>>
}

export interface RuntimeOption {
  readonly runtime: RuntimeSpec
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. UI는 이 값을 t()에 넣어 이유를 보여준다. */
  readonly reason?: UnavailableReason
  /**
   * 이 칸을 판정할 때 **실제로 쓴 행 상한.** 사유 문장의 숫자가 여기서 나온다.
   *
   * **판정한 값을 그대로 들려 보낸다** - 부르는 쪽이 등록부를 다시 뒤져 상한을 고르면
   * 그 순간 두 벌이 되고, 어긋나는 모양은 "화면이 5000이라고 말하고 3000에서 꺼진다"다.
   *
   * 서버 칸에는 없다. 브라우저 칸에는 꺼졌든 켜졌든 채워진다 - 학생이 "얼마까지 되나"를
   * 묻는 자리가 잠기기 전에도 있다.
   */
  readonly maxRows?: number
}

export interface RuntimeContext {
  serverStatus: ServerStatus
  /**
   * 실행 방법 id -> 준비 상태. 없으면 'absent'로 본다.
   *
   * **여기는 Axis가 아니다.** 등록부의 선언이 아니라 지금 이 순간의 상태이고, 비어 있는
   * 것이 정상이므로(아직 아무것도 안 받았다) 칸을 강제하지 않는다.
   */
  engineStates?: Readonly<Partial<Record<RuntimeId, EngineState>>>
  rowCount: number
}

/**
 * 실행 방법마다 지금 고를 수 있는지 판정한다.
 *
 * **이유의 우선순위가 설계다** (mlpx-spec.md 0.1). 알고리즘이 아예 지원하지 않는 것이
 * 먼저고, 그다음이 실행 위치, 마지막이 엔진 준비 상태다. 데이터가 너무 크면 엔진을
 * 준비해도 소용없으므로 크기가 준비 상태보다 앞에 온다.
 *
 * 순수 함수다. 화면은 이 결과를 그대로 그리기만 한다.
 */
function isReady(context: RuntimeContext, id: RuntimeId): boolean {
  return (context.engineStates?.[id] ?? 'absent') === 'ready'
}

export function runtimeOptions(
  algorithm: AlgorithmSpec,
  context: RuntimeContext,
  runtimes: readonly RuntimeSpec[] = RUNTIMES,
  browserRowLimit: number = BROWSER_ROW_LIMIT,
): RuntimeOption[] {
  return runtimes.map((runtime): RuntimeOption => {
    if (!supports(algorithm.runtimes, runtime.id)) {
      return { runtime, enabled: false, reason: 'ALGORITHM_NOT_AVAILABLE_HERE' }
    }
    if (runtime.location === 'server' && context.serverStatus !== 'available') {
      return { runtime, enabled: false, reason: 'SERVER_UNAVAILABLE' }
    }

    // **서버 칸에는 상한을 걸지 않는다.** 그 숫자는 능력 협상이 알려줄 것이고, 우리가
    // 대신 정하면 GPU 서버를 띄운 학교의 상한을 우리 상수가 깎는다 (open-decisions.md #13).
    if (!isBrowserRuntimeId(runtime.id)) {
      if (runtime.needsPreparation && !isReady(context, runtime.id)) {
        return { runtime, enabled: false, reason: 'ENGINE_NOT_READY' }
      }
      return { runtime, enabled: true }
    }

    // 상한의 출처는 등록부의 **이 칸**이다. 전역은 **아직 재 보지 않은 칸의 기본값**일
    // 뿐이므로 칸의 값이 더 높아도 그대로 이긴다 - 더 작은 쪽을 고르면 재서 얻은 값을
    // 재지 않은 값이 덮는다 (open-decisions.md #13의 "역할이 뒤집힌다").
    const maxRows = algorithm.maxRows[runtime.id] ?? browserRowLimit
    if (context.rowCount > maxRows) {
      return { runtime, enabled: false, reason: 'DATASET_TOO_LARGE_FOR_BROWSER', maxRows }
    }
    if (runtime.needsPreparation && !isReady(context, runtime.id)) {
      // 여기서 내려받게 하지 않는다. 준비는 상단 상태 점검 한 곳에서만 일어나야
      // 교사가 "다 같이 지금 눌러라"로 부하 타이밍을 쥘 수 있다.
      return { runtime, enabled: false, reason: 'ENGINE_NOT_READY', maxRows }
    }
    return { runtime, enabled: true, maxRows }
  })
}

/**
 * 기본으로 고를 실행 방법.
 *
 * RUNTIMES 순서대로 처음 고를 수 있는 것을 쓴다. 순수 JS가 맨 앞이므로 학생이
 * 아무것도 안 건드리면 즉시 시작된다. 전부 안 되면 null이고, 화면은 이유를 보여줘야 한다.
 */
export function preferredRuntime(options: readonly RuntimeOption[]): RuntimeSpec | null {
  return options.find((option) => option.enabled)?.runtime ?? null
}
