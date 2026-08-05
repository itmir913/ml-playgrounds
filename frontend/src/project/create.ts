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
  DEFAULT_PORTFOLIO_TEMPLATE_ID,
  FORMAT_VERSION,
  PROJECT_KIND_ML,
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

/** 실제 실행에서 쓰는 씨앗. 테스트는 이걸 안 부르고 값을 직접 넘긴다. */
export function newProjectSeed(): ProjectSeed {
  return {
    projectId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    randomState: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
  }
}

export interface NewProject {
  readonly name: string
  readonly taskType: TaskType
  /** 만든 사람의 언어. 파일을 받은 교사에게 어떤 문항으로 썼는지 알려준다. */
  readonly locale: string
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
      taskType: input.taskType,
      // V1은 표 데이터뿐이라 고르게 하지 않는다. 이미지·음성이 들어오는 V5에서
      // 업로드한 것으로 정해진다 (architecture.md §6).
      dataType: 'tabular',
      locale: input.locale,
    },
    settings: {
      // 표를 아직 안 올렸다. dataset은 없는 것이 맞다.
      dataset: undefined,
      // 열 이름을 알아야 정할 수 있는 것들은 비워 둔다.
      features: [],
      target: undefined,
      /**
       * 스케일링은 꺼진 채로 시작한다. **학생이 켰을 때 숫자가 달라지는 것을 보는 것이
       * 이 도구가 만드는 수업 장면이고**, 처음부터 켜져 있으면 그 장면이 없다.
       * 범주형 인코딩은 반대다 - 꺼져 있으면 문자 열이 든 표로는 아무것도 못 한다.
       */
      preprocessing: { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' },
      split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: seed.randomState },
      // 서버가 있는지 아직 모른다. 화면이 실제 상황을 보고 다시 고른다.
      runtime: FALLBACK_RUNTIME_ID,
      selectedAlgorithms: [],
      hyperparameters: {},
    },
    runs: { batches: [] },
    portfolio: { template: { id: DEFAULT_PORTFOLIO_TEMPLATE_ID }, answers: {} },
  }
}

/** 값이 바뀐 시각을 새로 찍는다. 저장 직전에 부른다. */
export function touch(document: ProjectDocument, now: string): ProjectDocument {
  return { ...document, manifest: { ...document.manifest, updatedAt: now } }
}
