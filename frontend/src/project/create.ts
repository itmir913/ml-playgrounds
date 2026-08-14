/**
 * 새 프로젝트를 만든다.
 *
 * **순수 함수다.** 시각·난수·id를 인자로 받으므로 같은 씨앗이면 같은 문서가 나오고,
 * 테스트가 시간을 고정할 수 있다. 부르는 쪽이 `newProjectSeed()`로 씨앗을 만든다.
 *
 * 나오는 것은 **표가 아직 없는 프로젝트**다. 정상 상태이고 데이터 단계에서 시작한다
 * (open-decisions.md "데이터 없는 프로젝트는 정상 상태다").
 */

import { FALLBACK_RUNTIME_ID } from '@/ml/backend'
import {
  DATA_SCHEMAS,
  FORMAT_VERSION,
  PROJECT_KIND_ML,
  type DataType,
  type ProjectDocument,
  type TaskType,
} from './schema'

export interface ProjectSeed {
  readonly projectId: string
  /** ISO 8601. createdAt과 updatedAt 모두 이 값으로 시작한다. */
  readonly createdAt: string
  /**
   * 분할 난수의 씨앗. **항상 저장하고 항상 쓴다** (CLAUDE.md §2).
   *
   * 만들 때 정해서 파일에 박아 두는 이유는, 학생이 설정을 바꿔가며 여러 번 학습할 때
   * 분할이 매번 달라지면 **무엇 때문에 숫자가 달라졌는지 알 수 없기** 때문이다.
   *
   * 범위는 부호 없는 32비트다. sklearn 엔진이 받는 범위와 같아서 서버로 그대로 넘어간다.
   */
  readonly randomState: number
}

/**
 * 분할 난수의 씨앗 하나. **여기가 유일한 출처다** — 전처리 화면의 [난수 다시 뽑기]도
 * 이걸 부른다 (`project/settings.ts`의 `withRandomState`).
 */
export function newRandomState(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

/**
 * 프로젝트 식별자. **`crypto.randomUUID`를 쓰지 않는다.**
 *
 * 그것은 보안 컨텍스트(https, localhost)에서만 존재하는데 **자가호스팅 서버는 대개
 * http://192.168.x.x 로 접속한다** — `hash.ts`가 `crypto.subtle`을 버린 것과 같은
 * 이유이고 같은 배포 경로다. 실제로 아이폰에서 개발 서버(http://192.168.x.x)로 들어가니
 * 새 프로젝트 만들기가 그 자리에서 죽었다 (2026-08-14).
 *
 * `getRandomValues`는 보안 컨텍스트를 안 따진다. 나오는 값은 UUID v4 그대로라
 * **이미 나간 `.mlpx`의 `projectId`와 같은 모양이다** - 형식이 갈리지 않는다.
 */
export function newProjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // 버전(4)과 변형 자리를 규격대로 박는다. 나머지 122비트가 난수다.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

/** 실제 실행에서 쓰는 씨앗. 테스트는 이걸 안 부르고 값을 직접 넘긴다. */
export function newProjectSeed(): ProjectSeed {
  return {
    projectId: newProjectId(),
    createdAt: new Date().toISOString(),
    randomState: newRandomState(),
  }
}

export interface NewProject {
  readonly name: string
  /** 만든 사람의 언어. 파일을 받은 교사에게 어떤 문항으로 썼는지 알려준다. */
  readonly locale: string
  /**
   * 표로 할 것인가 사진으로 할 것인가. **여기서 정해지고 그 뒤로 안 바뀐다**
   * (open-decisions.md "데이터 종류는 프로젝트를 만들 때 고르고, 그 뒤로 안 바뀐다").
   * 업로드한 파일로 추론하지 않는다.
   *
   * **기본값이 없다.** 부르는 쪽이 반드시 고르게 하는 것이 이 필드의 목적이다 - 기본값을
   * 두면 판이 늘어도 화면이 계속 표만 만들고, 그건 컴파일에서 안 잡힌다.
   */
  readonly dataType: DataType
  /**
   * 무엇을 하는 프로젝트인가. **만들 때는 안 물어보고 기본값도 없다.**
   *
   * 표를 보기도 전에 분류인지 회귀인지 아는 학생은 없다. 그래서 비워 두고 모델을 고르는
   * 학습 화면에서 정한다 - 그 자리가 판단이 서는 곳이고, 유형이 좁히는 것은 모델 목록이다.
   *
   * **기본값을 넣지 마라.** 넣는 순간 학생이 고른 분류와 아무도 안 고른 분류가 파일에서
   * 구분되지 않는다 (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
   */
  readonly taskType?: TaskType
}

export function newProjectDocument(input: NewProject, seed: ProjectSeed): ProjectDocument {
  return {
    manifest: {
      formatVersion: FORMAT_VERSION,
      appVersion: __APP_VERSION__,
      projectId: seed.projectId,
      name: input.name,
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
      kind: PROJECT_KIND_ML,
      // 아직 안 골랐다. 없는 것이 맞다.
      taskType: input.taskType,
      dataType: input.dataType,
      locale: input.locale,
    },
    settings: {
      /**
       * 데이터 종류별 설정. 위 dataType과 짝이다 (mlpx-spec.md §3).
       *
       * **무엇이 들어가는지는 이 함수가 모른다.** 등록부가 답한다 - 여기서 알기 시작하면
       * 종류가 늘 때마다 이 자리에 분기가 하나씩 생긴다 (architecture.md §9.2.3).
       */
      data: DATA_SCHEMAS[input.dataType].initial(),
      split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: seed.randomState },
      // 서버가 있는지 아직 모른다. 화면이 실제 상황을 보고 다시 고른다.
      runtime: FALLBACK_RUNTIME_ID,
      selectedAlgorithms: [],
      hyperparameters: {},
    },
    runs: { experiments: [] },
    // **양식은 비어 있다.** 새 프로젝트에는 아직 고른 양식이 없고, 그 상태를
    // 화면이 시작 화면으로 받는다 (mlpx-spec.md §8.3·§8.5).
    portfolio: {
      template: { sections: [] },
      answerFormat: 'plain-v1',
      answers: {},
      attachments: {},
    },
  }
}

/** 값이 바뀐 시각을 새로 찍는다. 저장 직전에 부른다. */
export function touch(document: ProjectDocument, now: string): ProjectDocument {
  return { ...document, manifest: { ...document.manifest, updatedAt: now } }
}
