/**
 * 학습 실행 위치와 그 선택 규칙.
 *
 * 이 프로젝트의 운영비는 서버가 얼마나 일하느냐로 결정된다.
 * 교실에서 쓰는 데이터는 대부분 수천 행 이하이고, 그 정도는 브라우저에서 학습해도 된다.
 * 따라서 **브라우저를 기본으로 삼고 서버는 브라우저가 감당 못 할 때만 쓴다.**
 *
 * 서버에 연결되지 않은 상태(교사가 자기 컴퓨터실에 설치하지 않았거나, 우리 서버가
 * 내려갔거나, 학교 방화벽에 막혔거나)에서도 학생은 브라우저 학습으로 수업을 계속할 수
 * 있어야 한다. 그때 서버 실행 옵션은 선택 불가로 두되, **왜 못 쓰는지 이유를 함께 준다.**
 * 이유 없이 비활성화된 버튼은 학생에게 고장으로 보인다.
 *
 * 실제 학습 실행(TrainingBackend.train)은 .mlproj 스키마가 정해진 뒤에 붙인다.
 */

export const TRAINING_LOCATIONS = ['browser', 'server'] as const

export type TrainingLocation = (typeof TRAINING_LOCATIONS)[number]

/** 서버 상태. 'unknown'은 아직 확인 전이며 서버 옵션을 켜 주지 않는다. */
export type ServerStatus = 'unknown' | 'available' | 'unavailable'

/**
 * 브라우저에서 학습할 수 있는 행 수의 상한.
 *
 * 이 값은 WASM 런타임의 메모리와 체감 대기 시간에서 온다. 서버 상한과는 무관하다.
 * 실제 값은 브라우저 학습 엔진을 정한 뒤 측정해서 조정한다.
 */
export const BROWSER_ROW_LIMIT = 5000

/**
 * 선택할 수 없는 이유. 로케일 키 client.* 와 1:1로 대응한다.
 *
 * 이것은 프런트엔드에서만 판정되는 조건이다. 서버가 꺼져 있을 때는 서버가
 * 에러 코드를 줄 수 없으므로 backend/app/errors.py 와는 별개 목록이다.
 */
export const UNAVAILABLE_REASONS = [
  'SERVER_UNAVAILABLE',
  'ALGORITHM_NOT_AVAILABLE_HERE',
  'DATASET_TOO_LARGE_FOR_BROWSER',
] as const

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]

export interface AlgorithmSpec {
  readonly id: string
  /** 이 알고리즘을 실행할 수 있는 위치. 등록부가 알고리즘마다 선언한다. */
  readonly locations: readonly TrainingLocation[]
}

export interface LocationOption {
  readonly location: TrainingLocation
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. UI는 이 값을 t()에 넣어 이유를 보여준다. */
  readonly reason?: UnavailableReason
}

/**
 * 주어진 알고리즘과 데이터에 대해 각 실행 위치를 고를 수 있는지 판정한다.
 *
 * 순수 함수다. 화면은 이 결과를 그대로 그리기만 한다.
 */
export function locationOptions(
  algorithm: AlgorithmSpec,
  serverStatus: ServerStatus,
  rowCount: number,
  browserRowLimit: number = BROWSER_ROW_LIMIT,
): LocationOption[] {
  return TRAINING_LOCATIONS.map((location) => {
    if (!algorithm.locations.includes(location)) {
      return { location, enabled: false, reason: 'ALGORITHM_NOT_AVAILABLE_HERE' }
    }
    if (location === 'server' && serverStatus !== 'available') {
      return { location, enabled: false, reason: 'SERVER_UNAVAILABLE' }
    }
    if (location === 'browser' && rowCount > browserRowLimit) {
      return { location, enabled: false, reason: 'DATASET_TOO_LARGE_FOR_BROWSER' }
    }
    return { location, enabled: true }
  })
}

/**
 * 기본으로 고를 위치.
 *
 * 브라우저를 먼저 본다. 서버 비용이 들지 않고, 데이터가 서버로 나가지 않으며,
 * 서버가 없어도 동작하기 때문이다. 브라우저가 안 되면 서버로 넘어간다.
 * 둘 다 안 되면 null이고, 화면은 이유를 보여줘야 한다.
 */
export function preferredLocation(options: readonly LocationOption[]): TrainingLocation | null {
  return options.find((option) => option.enabled)?.location ?? null
}
