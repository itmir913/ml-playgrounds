/**
 * `settings.json`을 고친다. **순수 함수다** — 저장은 부르는 쪽이 한다
 * (`project/identity.ts`와 같은 모양이다).
 *
 * 화면이 문서를 직접 펼쳐 고치지 않는 이유는 하나다 — **여기 있는 규칙들이 화면 없이
 * 테스트돼야 하기 때문이다.**
 *
 * **한 필드를 쓰는 문이 다른 필드를 고쳐 쓰지 않는다** (`open-decisions.md` 55 *"끄지 않고
 * 잠근다"*). 유형이 모델 선택을 지우고 타깃이 특성 목록을 고치던 것이 여기 있었는데,
 * 그러면 되돌려도 안 돌아와 학생이 다시 골라야 했다. **적용되지 않는 값은 학습이 무시한다**
 * — 타깃이 특성에 들어가 정확도가 1.0으로 나오는 것은 `ml/plan.ts`가 막는다.
 *
 * 값의 어휘와 상한은 여기 없다. 어휘는 `project/schema.ts`, 하이퍼파라미터의 범위는
 * `ml/hyperparams.ts`가 출처다.
 */

import { own, withoutKey } from '../records'
import { MIN_SPLIT_ROWS } from '../limits'
import {
  dataSettings,
  type Preprocessing,
  type ProjectDocument,
  type Settings,
  type Split,
  type TabularSettings,
  type TaskType,
} from './schema'

/** 설정만 갈아 끼우고 시각을 찍는다. 아래 함수들이 전부 이걸 지난다. */
function withSettings(document: ProjectDocument, settings: Settings, now: string): ProjectDocument {
  return {
    ...document,
    manifest: { ...document.manifest, updatedAt: now },
    settings,
  }
}

/**
 * 표 프로젝트의 종류별 설정만 갈아 끼운다 (`settings.data`, mlpx-spec.md §3).
 *
 * **`withTarget`·`withFeatures`·`withPreprocessing`과 함께 표 전용이다.** 예고한 대로
 * 이미지가 등록되는 날 깨졌고(2026-08-12), 그래서 이름과 타입이 표의 것으로 못 박혔다.
 * 이미지가 자기 설정을 고치는 함수는 자기 이름으로 따로 선다.
 *
 * **어긋나면 던진다.** 이 함수를 부르는 화면은 표 프로젝트에서만 뜨므로, 이미지
 * 프로젝트가 여기 오면 그건 배선 버그다.
 */
function withTabularData(
  document: ProjectDocument,
  patch: Partial<TabularSettings>,
  now: string,
): ProjectDocument {
  return withSettings(
    document,
    { ...document.settings, data: { ...dataSettings('tabular', document.settings), ...patch } },
    now,
  )
}

/**
 * 기계학습 유형을 바꾼다. **`manifest`에 있다** — `settings`가 아니다.
 *
 * **모델 선택은 안 건드린다** (`open-decisions.md` 55 *"끄지 않고 잠근다"*). 전에는 그
 * 유형에 안 맞는 모델을 여기서 지웠고, 유형을 되돌려도 안 돌아와 학생이 다시 담아야 했다.
 * 이제 선택은 그대로 남고 **학습에 넘길 때만 뺀다**(`ml/training-source.ts`의
 * `trainableSelections`). 학습 화면은 그 줄을 이유와 함께 잠근다.
 */
export function withTaskType(
  document: ProjectDocument,
  taskType: TaskType,
  now: string,
): ProjectDocument {
  return { ...document, manifest: { ...document.manifest, taskType, updatedAt: now } }
}

/**
 * 타깃 열을 정한다. `undefined`면 고르지 않은 상태로 되돌린다.
 *
 * **특성 목록은 안 건드린다** (`open-decisions.md` 55). 전에는 고른 열을 특성에서 뺐고,
 * 타깃을 다른 열로 바꿔도 **그 열이 특성으로 안 돌아왔다.** 이제 목록에 남고, 타깃인 동안
 * 그 줄의 특성 칸이 잠긴다.
 *
 * **정답이 문제에 들어가는 것은 학습 계획이 막는다** (`ml/plan.ts`의 `featuresInUse`). 막는
 * 자리가 여기서 거기로 옮겼을 뿐이고 **자리는 하나다** — 정답을 문제에 함께 넣으면 어떤
 * 모델이든 정확도가 1.0으로 나오고, 학생은 자기가 아주 좋은 모델을 만들었다고 믿는다.
 */
export function withTarget(
  document: ProjectDocument,
  target: string | undefined,
  now: string,
): ProjectDocument {
  return withTabularData(document, { target }, now)
}

/**
 * 특성 목록을 통째로 갈아 끼운다. **타깃과 같은 이름도 그대로 든다** (위 `withTarget`과
 * 같은 이유) — 여기서 거르면 다른 특성 하나를 켜고 끄는 것만으로 타깃이 된 열이 목록에서
 * 조용히 사라진다. 학습에서 빼는 자리는 `ml/plan.ts` 하나다.
 */
export function withFeatures(
  document: ProjectDocument,
  features: readonly string[],
  now: string,
): ProjectDocument {
  return withTabularData(document, { features: [...features] }, now)
}

export function withPreprocessing(
  document: ProjectDocument,
  patch: Partial<Preprocessing>,
  now: string,
): ProjectDocument {
  return withTabularData(
    document,
    { preprocessing: { ...dataSettings('tabular', document.settings).preprocessing, ...patch } },
    now,
  )
}

/**
 * 분할 설정을 고친다.
 *
 * `randomState`는 여기로 들어오지 않는다 — 값이 바뀌면 실험 사이의 비교가 성립하지
 * 않으므로, 미끄러져 들어갈 수 있는 문을 아예 막아 둔다. 다시 뽑는 것은 아래
 * `withRandomState` 하나뿐이고 화면이 경고를 거친다
 * (`open-decisions.md` "난수 씨앗은 고정이 기본이고, 다시 뽑는 것은 경고 뒤에 준다").
 */
export function withSplit(
  document: ProjectDocument,
  patch: Partial<Omit<Split, 'randomState'>>,
  now: string,
): ProjectDocument {
  const split = { ...document.settings.split, ...patch }
  /**
   * **스키마가 받는 범위 밖이면 지금 값을 지킨다** (2026-09-19 R33 A-1의 이웃).
   *
   * 화면의 슬라이더가 `TEST_SIZE_RANGE` 안에서만 움직이므로 오늘은 안 닿지만,
   * `Number(input.value)`는 빈 칸에서 **`0`**이 되고 스키마는 `(0, 1)` 열린 구간이다.
   * 한 번 담기면 **파일은 저장되고 다시는 안 열린다.**
   *
   * **클램프가 아니라 무시다.** 범위 밖 값을 가까운 값으로 바꿔 담으면, 스키마는 받지만
   * 화면 밖에서 온 정상 파일(예: `testSize` 0.7)을 학생이 층화를 켤 때마다 **조용히
   * 고쳐 쓰게 된다.** 이 문이 지킬 것은 *"못 여는 문서를 안 만든다"*이지 *"내가 옳다고
   * 보는 값으로 고친다"*가 아니다.
   */
  if (!Number.isFinite(split.testSize) || split.testSize <= 0 || split.testSize >= 1) {
    split.testSize = document.settings.split.testSize
  }
  return withSettings(document, { ...document.settings, split }, now)
}

/**
 * 쓸 행을 몇 개만 뽑을지 (`open-decisions.md` #22). `undefined`면 전부 쓴다.
 *
 * **`undefined`를 넣으면 키를 지운다.** `nSamples: undefined`를 그대로 남기면 그 키가
 * 파일에 `null`로 나가는지 사라지는지가 직렬화에 달리게 되고, 스키마는 선택 항목이라
 * 둘 다 통과해 버린다 (`project/schema.ts`).
 *
 * **씨앗과 층화는 여기로 안 들어온다.** `split.randomState`와 `split.stratify`를
 * 따라가므로 손잡이가 하나뿐이다 — `withSplit`이 `randomState`를 막아 둔 것과 같은
 * 성격의 문이다.
 */
export function withSampling(
  document: ProjectDocument,
  nSamples: number | undefined,
  now: string,
): ProjectDocument {
  const rest = { ...document.settings }
  delete rest.nSamples
  if (nSamples === undefined) return withSettings(document, rest, now)
  /**
   * **바닥 아래로는 안 담는다** (2026-09-19 R33 A-1). 스키마가 `MIN_SPLIT_ROWS` 미만을
   * 거부하는데 **쓰는 길에는 검증이 없고 읽는 길에만 있어서**, 한 번 담기면 파일도
   * IndexedDB 사본도 다시는 안 열린다.
   *
   * **부르는 쪽이 이미 클램프한다.** 여기는 그 뒤에 서는 문이고, 문이 모양을 보장하는
   * 것이 이 저장소가 R32 A-1에서 고른 길이다 — 자리마다 조심하는 대신 **값이 문서로
   * 들어가는 자리 하나**에서 막는다.
   */
  return withSettings(document, { ...rest, nSamples: Math.max(nSamples, MIN_SPLIT_ROWS) }, now)
}

/**
 * 난수 씨앗을 다시 뽑는다. **되돌릴 수 없는 조작이라 화면이 먼저 경고한다.**
 *
 * **지난 실험은 건드리지 않는다.** 실험마다 자기 `randomState`와 행 번호 스냅샷을
 * 들고 있으므로(`mlpx-spec.md` §4) 그 기록도 재실행 대조도 그대로 성립한다. 바뀌는
 * 것은 앞으로의 분할뿐이고, 결과 화면의 변경 이력이 그 사실을 보여준다.
 *
 * **값을 인자로 받는다.** 난수를 여기서 부르면 같은 문서를 넣었을 때 결과가 달라져
 * 테스트가 무엇을 확인해야 할지 알 수 없게 된다. 부르는 쪽이 `newRandomState()`를 쓴다.
 */
export function withRandomState(
  document: ProjectDocument,
  randomState: number,
  now: string,
): ProjectDocument {
  // **정수가 아니면 지금 씨앗을 지킨다** (위 `withSplit`과 같은 이유). 스키마가 `int`를
  // 요구하므로 소수 하나가 **파일을 못 열게 만든다.** 씨앗은 재현의 뿌리라 지어내지 않고
  // 있던 것을 그대로 둔다 — 화면은 파일을 다시 읽으므로 안 바뀐 것이 그대로 보인다.
  const seed = Number.isInteger(randomState) ? randomState : document.settings.split.randomState
  return withSettings(
    document,
    { ...document.settings, split: { ...document.settings.split, randomState: seed } },
    now,
  )
}

/** 실험 전체의 기본 실행 방법. 모델별로 덮어쓴 것은 건드리지 않는다. */
export function withRuntime(
  document: ProjectDocument,
  runtime: string,
  now: string,
): ProjectDocument {
  return withSettings(document, { ...document.settings, runtime }, now)
}

/**
 * 학습할 모델 목록을 갈아 끼운다. **부르는 쪽이 완성된 목록을 넘긴다.**
 *
 * 여기서 합치거나 지우지 않는 이유는 화면이 (모델, 실행 방법) 쌍을 하나씩 쌓기
 * 때문이다 - 무엇을 더하고 뺄지는 화면이 이미 알고 있고, 이 함수가 다시 판단하면
 * 두 곳이 어긋난다.
 *
 * **같은 알고리즘이 실행 방법만 다르게 여러 번 들어갈 수 있다** (mlpx-spec.md §3).
 * "같은 결정트리인데 엔진이 다르면 왜 숫자가 다른가"가 이 배열이 있는 이유다.
 */
export function withSelectedAlgorithms(
  document: ProjectDocument,
  selected: readonly Settings['selectedAlgorithms'][number][],
  now: string,
): ProjectDocument {
  return withSettings(document, { ...document.settings, selectedAlgorithms: [...selected] }, now)
}

/**
 * 하이퍼파라미터 하나를 고친다. 키는 **(알고리즘, 실행 방법)**이다 (mlpx-spec.md §3).
 *
 * **`undefined`면 지운다.** 칸을 비운 학생은 "기본값으로 돌려 달라"고 말한 것이고,
 * 빈 값을 적어 두면 파일에는 값이 있는데 엔진은 기본값으로 도는 상태가 된다.
 * 비고 나면 남는 껍데기도 함께 걷는다 — 아무 값도 없는 `{"knn": {"mljs": {}}}`는
 * 학생이 그 모델을 만졌다는 뜻으로 잘못 읽힌다.
 */
export function withHyperparameter(
  document: ProjectDocument,
  target: { algorithm: string; runtime: string; name: string },
  value: number | undefined,
  now: string,
): ProjectDocument {
  const { algorithm, runtime, name } = target
  /**
   * **열쇠가 파일에서 온다** (2026-09-23 R37 C-5의 이웃). `algorithm`은 스키마에서
   * `userString`이라 손으로 고친 `.mlpx`의 `constructor`·`__proto__`가 그대로 온다.
   *
   * 그래서 읽기는 `own()`을 지나고, **쓰기는 색인 대입이 아니라 객체 리터럴**이다 —
   * `obj['__proto__'] = v`는 own 속성을 안 만들고 프로토타입을 바꿔, 학생이 고친
   * 하이퍼파라미터가 **저장은 된 것처럼 보이고 다시 열면 없다.**
   */
  const byAlgorithm = { ...document.settings.hyperparameters }
  const byRuntime = { ...(own(byAlgorithm, algorithm) ?? {}) }
  const values = { ...(own(byRuntime, runtime) ?? {}) }

  if (value === undefined) delete values[name]
  else values[name] = value

  const nextRuntime =
    Object.keys(values).length === 0
      ? withoutKey(byRuntime, runtime)
      : { ...byRuntime, [runtime]: values }
  const nextAlgorithm =
    Object.keys(nextRuntime).length === 0
      ? withoutKey(byAlgorithm, algorithm)
      : { ...byAlgorithm, [algorithm]: nextRuntime }

  return withSettings(document, { ...document.settings, hyperparameters: nextAlgorithm }, now)
}
