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
  'SERVER_UNAVAILABLE',
  'ALGORITHM_NOT_AVAILABLE_HERE',
  'DATASET_TOO_LARGE_FOR_BROWSER',
  'ENGINE_NOT_READY',
] as const

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

/**
 * 실행 방법 하나.
 *
 * location과 engineKind가 파일에 남는 값이고, id는 화면과 등록부가 쓰는 이름이다.
 * 같은 엔진이 두 위치에서 도는 일이 실제로 있으므로(sklearn) id가 따로 필요하다.
 */
export interface RuntimeSpec {
  readonly id: string
  readonly location: TrainingLocation
  /** run.engine.kind에 그대로 들어간다. 재실행 대조가 이 값으로 엔진을 가린다. */
  readonly engineKind: string
  /** 쓰기 전에 내려받고 시동해야 하는가. 순수 JS는 번들에 이미 있다. */
  readonly needsPreparation: boolean
}

/**
 * V1의 실행 방법. **순서가 곧 기본값 우선순위다** - 앞에 있는 것부터 고른다.
 *
 * 순수 JS가 맨 앞인 이유는 gzip 25KB에 시동이 없기 때문이다. scikit-learn은 26.3MB에
 * 시동 15.4초라 기본값이 될 수 없다 (open-decisions.md "브라우저 학습 엔진은 둘 다 간다").
 *
 * 여기 항목을 늘리는 것은 포맷 변경이 아니다. 등록부에 추가하면 화면이 따라온다.
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
  /** 이 알고리즘을 돌릴 수 있는 실행 방법의 id. 등록부가 알고리즘마다 선언한다. */
  readonly runtimes: readonly string[]
}

export interface RuntimeOption {
  readonly runtime: RuntimeSpec
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. UI는 이 값을 t()에 넣어 이유를 보여준다. */
  readonly reason?: UnavailableReason
}

export interface RuntimeContext {
  serverStatus: ServerStatus
  /** 실행 방법 id -> 준비 상태. 없으면 'absent'로 본다. */
  engineStates?: Readonly<Record<string, EngineState>>
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
export function runtimeOptions(
  algorithm: AlgorithmSpec,
  context: RuntimeContext,
  runtimes: readonly RuntimeSpec[] = RUNTIMES,
  browserRowLimit: number = BROWSER_ROW_LIMIT,
): RuntimeOption[] {
  return runtimes.map((runtime): RuntimeOption => {
    if (!algorithm.runtimes.includes(runtime.id)) {
      return { runtime, enabled: false, reason: 'ALGORITHM_NOT_AVAILABLE_HERE' }
    }
    if (runtime.location === 'server' && context.serverStatus !== 'available') {
      return { runtime, enabled: false, reason: 'SERVER_UNAVAILABLE' }
    }
    if (runtime.location === 'browser' && context.rowCount > browserRowLimit) {
      return { runtime, enabled: false, reason: 'DATASET_TOO_LARGE_FOR_BROWSER' }
    }
    if (runtime.needsPreparation && (context.engineStates?.[runtime.id] ?? 'absent') !== 'ready') {
      // 여기서 내려받게 하지 않는다. 준비는 상단 상태 점검 한 곳에서만 일어나야
      // 교사가 "다 같이 지금 눌러라"로 부하 타이밍을 쥘 수 있다.
      return { runtime, enabled: false, reason: 'ENGINE_NOT_READY' }
    }
    return { runtime, enabled: true }
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
