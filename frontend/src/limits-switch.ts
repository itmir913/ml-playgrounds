/**
 * **상한 off 스위치** — `limits.ts`의 `우리 기기가 정했다` 줄을 끄는 자리
 * (`open-decisions.md` "상한은 누가 정했느냐로 갈리고, 우리 기기가 정한 것은 끌 수 있다").
 *
 * **값은 저쪽이 갖고 여기는 켜고 끄기만 한다.** `limits.ts`는 지금도 `import` 줄이 하나도
 * 없는 잎 모듈이고, 워커도 하니스도 테스트도 그것을 그대로 문다 — 여기에 반응성을 넣으면
 * 워커 셋(`train` 203KB · `canonicalize` 80KB · `embed` 1.98MB, 셋 다 지금 vue가 0줄)에
 * `@vue/reactivity`가 따라 들어간다. 그래서 파일이 둘이다. **이름을 나란히 둔 것도
 * 그래서다** — `limits.ts`를 여는 사람이 이 파일을 못 보고 지나가면 안 된다.
 *
 * **여기 사는 것은 일곱뿐이다.** 스물셋을 끈다고 해서 스물셋이 여기 있어야 하는 것은
 * 아니다 — 행 상한 열여섯은 **판정이 한 곳으로 모여 있어서**(`ml/backend.ts`의
 * `runtimeOptions`) 거기서 한 번에 꺼진다. 그 값들을 여기서 `Infinity`로 바꾸면
 * **화면이 "무제한 행까지"라고 말하게 된다** — 상한이 몇인지는 꺼진 뒤에도 말할 거리다.
 *
 * **워커에는 이 모듈이 안 간다.** 학습은 워커에서 돌고 거기서도 상한을 보는데
 * (`ml/experiment.ts`), 그쪽은 `RuntimeContext.limitsOff`로 **값을 실어** 받는다.
 * `randomState`가 지나는 그 길이다.
 *
 * **기기의 설정이지 프로젝트의 내용이 아니다.** `.mlpx`에는 안 적는다 — 같은 파일을 학교
 * PC에서 열든 집 PC에서 열든 그 기기의 판단이 이겨야 한다. 그래서 **파일에 적히는 숫자를
 * 바꾸는 상한은 애초에 이 스위치의 것이 아니다** (결정문 §1.3이 `SILHOUETTE_BUDGET_MS`를
 * 그 이유로 빼냈다).
 */

import { ref } from 'vue'

import {
  CLUSTER_SCATTER_POINT_LIMIT,
  IMAGE_PREDICT_PAGE_SIZE,
  MAX_DATASET_COLUMNS,
  MAX_DATASET_ROWS,
  MAX_IMAGE_COUNT,
  MAX_PORTFOLIO_BYTES,
  PREDICT_PAGE_SIZE,
} from './limits'

/**
 * 상한을 껐는가. **기기 하나에 하나뿐이라 스토어가 아니다** (`theme.ts`와 같은 판단).
 *
 * 프로젝트가 없을 때도 살아 있어야 하는 값이고, 스토어에 넣으면 프로젝트의 수명에
 * 얹히게 된다.
 */
export const limitsOff = ref(false)

/** 저장된 선택을 앱이 뜰 때 넣는다. **읽는 곳은 `project/storage.ts`다** (언어 선택 옆). */
export function applyLimitsOff(next: boolean): void {
  limitsOff.value = next
}

/**
 * 꺼져 있으면 상한이 없다. **`Infinity`인 이유는 비교가 그대로 통하기 때문이다** —
 * `rows > Infinity`도 `grid.length >= Infinity`도 거짓이라, 부르는 쪽이 "껐나"를 다시
 * 묻지 않는다.
 *
 * **`Infinity`가 그대로 통하지 않는 자리가 셋 있다** — 페이지 크기 둘과 눈금 하나다.
 * 거기는 이 함수의 결과를 그대로 쓰지 말고 그 화면이 "상한이 없는 경우"를 다뤄야 한다
 * (`0 * Infinity`가 `NaN`이라 판이 통째로 빈다).
 */
function open(value: number): number {
  return limitsOff.value ? Number.POSITIVE_INFINITY : value
}

/**
 * **판 크기를 실제 수로 바꾼다.** 껐으면 한 판에 전부다.
 *
 * `Infinity`를 판 크기로 그대로 쓰면 **첫 판이 통째로 빈다** — 부르는 쪽이
 * `page * 크기`로 시작 위치를 내는데 `0 * Infinity`가 `NaN`이고, `slice(NaN, NaN)`은
 * 빈 배열이다. 아무 오류도 안 나고 화면만 빈다.
 *
 * **컴포넌트 밖에 있는 이유는 그것이 검사할 수 있는 유일한 자리이기 때문이다**
 * (`CLAUDE.md` §4).
 *
 * @param total 지금 세울 것의 전체 개수. 0이어도 판은 하나여야 한다.
 */
export function pageSizeOf(limit: number, total: number): number {
  return Number.isFinite(limit) ? limit : Math.max(total, 1)
}

/** 표 데이터의 행 상한. 업로드가 여기서 거절된다 (`data/table.ts`). */
export function maxDatasetRows(): number {
  return open(MAX_DATASET_ROWS)
}

/** 표 데이터의 열 상한. */
export function maxDatasetColumns(): number {
  return open(MAX_DATASET_COLUMNS)
}

/** 한 프로젝트에 담는 사진 수. */
export function maxImageCount(): number {
  return open(MAX_IMAGE_COUNT)
}

/**
 * 예측 판 하나에 세우는 행 수. **`Infinity`가 그대로 못 가는 자리다** — 부르는 쪽이
 * `page * 크기`로 시작 위치를 내므로 첫 판에서 `0 * Infinity = NaN`이 된다.
 */
export function predictPageSize(): number {
  return open(PREDICT_PAGE_SIZE)
}

/** 예측 판 하나에 세우는 사진 수. **위와 같은 자리다.** */
export function imagePredictPageSize(): number {
  return open(IMAGE_PREDICT_PAGE_SIZE)
}

/** 산점도에 그릴 점의 수. 넘으면 표본을 뽑는다 (`ml/clusters.ts`의 `scatterPoints`). */
export function clusterScatterPointLimit(): number {
  return open(CLUSTER_SCATTER_POINT_LIMIT)
}

/**
 * 포트폴리오 글과 첨부의 크기 상한.
 *
 * **끄면 실패의 모양이 바뀐다** — 붙여넣기 폭탄이 `PORTFOLIO_TOO_LARGE` 대신
 * `STORAGE_QUOTA_EXCEEDED`가 된다. 설명 가능한 실패가 설명 불가능한 실패로 옮겨가는
 * 것이고, 결정문 §1.1이 **스위치 화면이 말해야 할 것**으로 적어 둔 자리다.
 */
export function maxPortfolioBytes(): number {
  return open(MAX_PORTFOLIO_BYTES)
}
