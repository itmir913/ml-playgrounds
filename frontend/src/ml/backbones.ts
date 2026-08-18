/**
 * 백본 등록부.
 *
 * **백본은 알고리즘도 실행 방법도 아니다** (open-decisions.md "백본을 붙이는 방법").
 * 알고리즘 등록부에 넣으면 "모델 고르기"에 백본이 섞이고, 실행 방법 등록부에 넣으면
 * `RuntimeSpec`이 뜻하지 않는 것을 뜻하게 된다. 백본이 하는 일은 **특성을 만드는 것**이고,
 * 그 뒤는 지금 있는 알고리즘 전부다.
 *
 * ```
 * 이미지 → (백본 forward 1회) → 특성 벡터 → 여기서부터 표와 같다
 * ```
 *
 * **"이 백본으로 무엇을 할 수 있나"는 여기 적는다. 화면에 적지 마라** (§9). 이미지
 * 회귀가 막히는 것은 화면의 `v-if`가 아니라 `tasks`가 짧기 때문이다.
 *
 * **가중치는 우리가 서빙하지 않는다.** 학생 브라우저가 원본에서 직접 받는다
 * (open-decisions.md "백본을 붙이는 방법", 2026-08-12에 뒤집었다) — 우리 Pages로
 * 서빙하면 한 반 한 차시가 335MB이고, 컴퓨터실 PC는 리셋을 전제라 캐시도 안 남는다.
 * `scripts/fetch-backbone.mjs`는 이제 **CI가 원본을 감시하는 장치**다.
 */

import type { TaskType } from '../project/schema'

/**
 * **id는 가중치가 아니라 우리 쪽 계약을 가리킨다** (mlpx-spec.md §1.3 규칙 2).
 *
 * 가중치가 그대로여도 우리가 무엇을 먹이는지가 바뀌면 **같은 사진의 벡터가 다른
 * 좌표계에 앉는다.** 그것을 가르는 유일한 장치가 `embeddings/{id}/` 경로라, 그럴 때는
 * 접미사 `-rN`으로 개정한다. `-r2`가 그 첫 사례다 (2026-08-19, open-decisions.md
 * "백본 입력 범위가 그래프의 계약과 어긋났다").
 *
 * **옛 id는 여기 남기지 않는다.** 남기면 그 프로젝트가 영원히 틀린 범위로 돌고,
 * 마이그레이션이 옛 파일을 새 id로 올려 주므로 남길 이유도 없다 (project/migrate.ts).
 */
export const BACKBONE_IDS = ['mobilenet-v2-r2'] as const

export type BackboneId = (typeof BACKBONE_IDS)[number]

export interface BackboneSpec {
  readonly id: BackboneId
  /**
   * 정본 한 변의 길이. **`dataset`에 값으로 적힌다.**
   *
   * 나중에 260을 요구하는 백본이 등록되면 "이 정본은 224라 그 백본은 못 쓴다"고
   * 카드를 잠그는 것이 이 값이다. 없는 화소를 만들어 늘리지 않는다.
   */
  readonly canonicalSize: number
  /**
   * 임베딩 차원. **`.mlpx`에 담기는 벡터의 길이다** — 한 장이 이 값 × 4바이트다.
   *
   * 실측으로 확인한 값이지 문서에서 옮겨 적은 값이 아니다 (2026-08-12).
   */
  readonly embeddingDim: number
  /**
   * 임베딩을 뽑을 그래프 노드.
   *
   * **`predict`가 아니라 `execute`에 준다.** `predict`는 분류기 머리까지 통과한
   * 로짓을 주는데 우리가 쓰는 것은 그 앞이다. 이름으로 뽑을 수 있어서 그래프를
   * 자르지 않아도 된다.
   */
  readonly embeddingNode: string
  /**
   * `loadGraphModel`에 주는 주소. **원본의 절대 주소다** — 우리 산출물에 없다.
   *
   * `scripts/fetch-backbone.mjs`가 같은 주소에서 받아 SHA-256을 대조하므로, 원격이
   * 조용히 바뀌면 학생이 아니라 **CI가 먼저 운다.**
   */
  readonly modelUrl: string
  /**
   * 화소값을 이 범위로 옮겨 넣는다. 백본마다 다르고, **틀리면 조용히 성적만 나빠진다** —
   * 예외가 안 난다.
   *
   * **그래프가 무엇을 기대하는지이지, 컨볼루션이 무엇을 받는지가 아니다.** TF-Hub
   * 모듈은 전처리를 자기 안에 들고 있어서, 우리가 `[-1,1]`을 넣으면 모듈이 한 번 더
   * 옮겨 `[-3,1]`이 된다. 그래서 이 값은 **모듈의 전처리를 역함수로 되돌린 것**이고,
   * `tests/backbones.spec.ts`가 샤드에서 그 상수를 직접 읽어 대조한다 (2026-08-19).
   */
  readonly inputRange: readonly [number, number]
  /**
   * 이 백본으로 할 수 있는 과제.
   *
   * **이미지 회귀는 여기 없어서 막힌다.** 구조적으로는 임베딩 위의 선형 회귀라 공짜인데,
   * 사진마다 숫자를 적는 화면이 통째로 달라지고 폴더=라벨 구조도 안 맞는다
   * (open-decisions.md "이미지 학습의 모양").
   */
  readonly tasks: readonly TaskType[]
}

/**
 * V4의 백본. **순서가 기본값 우선순위다** — 앞에 있는 것부터 고른다.
 *
 * **V4는 하나로 연다.** MobileNetV3-Small(빠름)과 EfficientNet-Lite0(정확도)은 줄을
 * 더하는 일이라 급하지 않다 (open-decisions.md "이미지 학습의 모양").
 *
 * **`BACKBONE_IDS` 값마다 한 줄이 있어야 한다** — 이름만 있고 명세가 없는 백본은
 * 화면에서 통째로 사라진다. 타입은 이걸 못 잡으므로 검사가 본다.
 */
export const BACKBONES: readonly BackboneSpec[] = [
  {
    id: 'mobilenet-v2-r2',
    canonicalSize: 224,
    embeddingDim: 1280,
    embeddingNode: 'module_apply_default/MobilenetV2/Logits/AvgPool',
    modelUrl:
      'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json',
    /**
     * **모듈이 안에서 `x*2-1`을 한다** — 그래서 우리가 넣을 것은 `[0,1]`이다.
     * `[-1,1]`로 두었던 것이 V11 R1 A-1이고, 실제 입력이 `[-3,1]`이 됐다.
     */
    inputRange: [0, 1],
    tasks: ['classification', 'clustering'],
  },
]

/** 이 백본을 다룰 수 있는가. 없으면 그 프로젝트는 임베딩을 못 뽑는다. */
export function backboneFor(id: string): BackboneSpec | undefined {
  return BACKBONES.find((backbone) => backbone.id === id)
}

/**
 * 새 이미지 프로젝트가 쓰는 백본.
 *
 * **고르게 하지 않는다.** 손잡이가 하나 늘면 재현 필드와 화면이 같이 늘고, V4는 이미
 * 크다. 둘째 백본이 등록되는 날 그때 고르게 할지 정한다.
 */
export const DEFAULT_BACKBONE_ID: BackboneId = 'mobilenet-v2-r2'
