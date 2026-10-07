/**
 * 재실행 대조를 **지금 시작할 수 있는가** — [대조 시작]의 판정 (architecture.md §8.21, §10.7).
 *
 * **`reproduce.ts`에서 떼어 낸 이유는 무게다.** 이 판정은 잠금 등록부(`@/locks`)에 올라가고, 그
 * 등록부는 첫 화면의 부품(단계 레일)도 들여온다. `reproduce.ts`는 학습 엔진과 실험 계산을 통째로
 * 들여오므로(수백 KB) 그 파일을 등록부가 들이면 **첫 화면이 엔진을 받는다.** 그래서 판정만
 * 가벼운 이 파일에 두고, 엔진을 봐야 하는 한 가지(`engineHere`)는 부르는 쪽이 넘긴다 —
 * 화면은 `reproduce.ts`의 `engineIsHere`를 넘긴다. `reproduce.ts`가 이 파일을 다시 내보내므로
 * 옛 입구도 그대로다.
 */

import type { DataType, Experiment, Run } from '../project/schema'
import { succeeded } from './run-status'

/** 대조를 막는 이유. **boolean이 아니라 목록이다** (CLAUDE.md §2). */
export const REPRODUCE_BLOCKERS = [
  /** 정본 표가 파일에 없다. 다시 돌릴 재료가 없다. */
  'NO_DATASET',
  /** 성공한 run이 하나도 없다. 견줄 주장이 없다. */
  'NO_CLAIM',
  /** 사진 프로젝트. **첫 판에서 안 연다** — 못 하는 것이 아니다. */
  'IMAGE_NOT_OPEN',
  /** 이 파일을 만든 엔진이 여기 하나도 없다. */
  'ENGINE_MISSING',
  /** `provided`인데 테스트 표가 없다. */
  'NO_TEST_DATASET',
  /** 같은 판에서 다른 실험의 대조가 돈다. 판 하나가 워커 하나를 쥔다. */
  'COMPARING_OTHER',
] as const

export type ReproduceBlocker = (typeof REPRODUCE_BLOCKERS)[number]

export interface ReproduceSubject {
  readonly experiment: Experiment
  readonly dataType: DataType
  readonly hasDataset: boolean
  readonly hasTestDataset: boolean
  /** 이 판에서 **다른** 실험의 대조가 도는가. 이 실험 자신이 도는 것은 여기 안 든다. */
  readonly comparingOther: boolean
  /**
   * 이 run을 만든 엔진이 이 브라우저에 있는가. **`reproduce.ts`의 `engineIsHere`를 넘긴다** —
   * 위 머리말의 이유로 이 파일은 엔진 등록부를 안 들인다.
   */
  readonly engineHere: (run: Run) => boolean
}

/**
 * 이 실험을 지금 대조할 수 있는가. **막히면 무엇이 막는지 전부 돌려준다.**
 *
 * **순서는 근본적인 것이 먼저다** (architecture.md §10.2) — 성공한 run이 0이면 엔진
 * 이야기는 공집합에 대한 말이라 뜻이 없다.
 *
 * **이 실험 자신이 도는 것은 여기 없다** — 그때 단추 자리는 [멈추기]다. **다른 실험이
 * 도는 것은 있다**(`COMPARING_OTHER`, 맨 뒤) — 파일의 사정이 아니지만, 이유 목록 밖에서
 * 잠그면 교사가 왜 회색인지 모른다 (architecture.md §8.21). `inspect-reproduce-live.spec.ts`의
 * *"다른 실험이 대조 중이면"*이 문다.
 *
 * **`reproduce()`의 거절이 이 함수를 본다**(`@/locks`의 `reproduce`, 결정문 65). **단추의 잠금은
 * 아래 `comparingBlockers`만이다**(`@/locks`의 `reproduceComparing`) — 파일의 사정은 잠그지 않고
 * 누르면 알린다(결정문 65 "구조 뒤 감사에서 더한 것"). 잠금의 조건이 이 함수의 일부라 둘이 갈릴 수
 * 없다.
 */
export function reproduceBlockers(subject: ReproduceSubject): ReproduceBlocker[] {
  return [...fileBlockers(subject), ...comparingBlockers(subject.comparingOther)]
}

/**
 * **자원이 바쁜 것**만. 다른 실험의 대조가 도는 동안이다 — 판 하나가 워커 하나를 쥐므로 둘째
 * 대조는 띄울 수 없다. [대조 시작]에 **잠금으로 남는 유일한 이유**다.
 */
export function comparingBlockers(comparingOther: boolean): ReproduceBlocker[] {
  return comparingOther ? ['COMPARING_OTHER'] : []
}

/** 파일이 막는 것. 순서는 근본적인 것이 먼저다. */
function fileBlockers(subject: ReproduceSubject): ReproduceBlocker[] {
  const blockers: ReproduceBlocker[] = []
  // 사진 프로젝트의 정본은 표가 아니라 파일 안의 사진이다 — 표가 없다고 `NO_DATASET`을
  // 붙이면 거짓말이 된다. `reproduce.spec.ts`의 *"사진 프로젝트에는"*이 문다.
  if (subject.dataType !== 'tabular') blockers.push('IMAGE_NOT_OPEN')
  else if (!subject.hasDataset) blockers.push('NO_DATASET')

  const claims = subject.experiment.runs.filter(succeeded)
  if (claims.length === 0) {
    blockers.push('NO_CLAIM')
    return blockers
  }

  // **`run.engine`이 없는 run은 "안 맞음"으로 센다** — 무엇으로 만들었는지 모르는 것과
  // 다른 엔진으로 만든 것은 대조 가능성에서 같다. **이번 학기까지의 파일은 전부 여기
  // 걸린다** (`mljs@2`로 만들었고 지금은 3이다) — 그것이 이 줄이 있는 이유다.
  if (!claims.some((claim) => subject.engineHere(claim))) blockers.push('ENGINE_MISSING')

  // **테스트 표도 표 프로젝트만 본다** — 위 `NO_DATASET`과 같은 까닭이다. `hasTestDataset`은 정본 테스트 표가 있는지라
  // (`ReproducePanel.vue`), 사진 프로젝트의 provided 실험에는 테스트용 사진이 있어도 늘 "테스트 데이터가 파일에 없다"가 섰다
  // (R43-1 계획 2차 물음 3). 사진 대조를 열 때 테스트용 사진의 판정을 여기 더한다. `reproduce.spec.ts`의 *"사진 프로젝트에는"*이 문다.
  if (
    subject.dataType === 'tabular' &&
    subject.experiment.settings.split.method === 'provided' &&
    !subject.hasTestDataset
  ) {
    blockers.push('NO_TEST_DATASET')
  }
  return blockers
}
