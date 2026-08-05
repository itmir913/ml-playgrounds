/**
 * `settings.json`을 고친다. **순수 함수다** — 저장은 부르는 쪽이 한다
 * (`project/identity.ts`와 같은 모양이다).
 *
 * 화면이 문서를 직접 펼쳐 고치지 않는 이유는 하나다 — **여기 있는 규칙들이 화면 없이
 * 테스트돼야 하기 때문이다.** "타깃으로 고른 열은 특성에서 빠진다" 같은 것은 눈으로
 * 보면 당연해 보이지만, 안 지켜지면 같은 열이 정답이자 문제로 들어가 **정확도가 1.0으로
 * 나오는 조용히 틀린 학습**이 된다.
 *
 * 값의 어휘와 상한은 여기 없다. 어휘는 `project/schema.ts`, 하이퍼파라미터의 범위는
 * `ml/hyperparams.ts`가 출처다.
 */

import type { Preprocessing, ProjectDocument, Settings, Split, TaskType } from './schema'

/** 설정만 갈아 끼우고 시각을 찍는다. 아래 함수들이 전부 이걸 지난다. */
function withSettings(document: ProjectDocument, settings: Settings, now: string): ProjectDocument {
  return {
    ...document,
    manifest: { ...document.manifest, updatedAt: now },
    settings,
  }
}

/**
 * 기계학습 유형을 바꾼다. **`manifest`에 있다** — `settings`가 아니다.
 *
 * 뜻을 잃은 모델 선택은 부르는 쪽이 `algorithmsLosingMeaning`으로 골라 `drop`에 넘긴다.
 * 여기서 등록부를 보지 않는 이유는, 지우는 판단과 지우는 동작이 한 함수에 있으면
 * 화면이 "무엇이 지워질지" 미리 물어볼 수가 없어서다 — 학생에게 알려야 하는 변경이다
 * (architecture.md §8.9).
 */
export function withTaskType(
  document: ProjectDocument,
  taskType: TaskType,
  drop: readonly string[],
  now: string,
): ProjectDocument {
  const dropped = new Set(drop)
  return {
    ...document,
    manifest: { ...document.manifest, taskType, updatedAt: now },
    settings: {
      ...document.settings,
      selectedAlgorithms: document.settings.selectedAlgorithms.filter(
        (selection) => !dropped.has(selection.algorithm),
      ),
    },
  }
}

/**
 * 타깃 열을 정한다. `undefined`면 고르지 않은 상태로 되돌린다.
 *
 * **고른 열은 특성에서 빠진다.** 정답을 문제에 함께 넣으면 어떤 모델이든 정확도가
 * 1.0으로 나오고, 학생은 자기가 아주 좋은 모델을 만들었다고 믿는다.
 */
export function withTarget(
  document: ProjectDocument,
  target: string | undefined,
  now: string,
): ProjectDocument {
  return withSettings(
    document,
    {
      ...document.settings,
      target,
      features: document.settings.features.filter((name) => name !== target),
    },
    now,
  )
}

/** 특성 목록을 통째로 갈아 끼운다. 타깃은 어떤 경로로도 특성이 되지 않는다. */
export function withFeatures(
  document: ProjectDocument,
  features: readonly string[],
  now: string,
): ProjectDocument {
  const { target } = document.settings
  return withSettings(
    document,
    { ...document.settings, features: features.filter((name) => name !== target) },
    now,
  )
}

export function withPreprocessing(
  document: ProjectDocument,
  patch: Partial<Preprocessing>,
  now: string,
): ProjectDocument {
  return withSettings(
    document,
    { ...document.settings, preprocessing: { ...document.settings.preprocessing, ...patch } },
    now,
  )
}

/**
 * 분할 설정을 고친다.
 *
 * `randomState`는 여기로 들어오지 않는다 — 프로젝트를 만들 때 정해져 파일에 박히는
 * 값이고, 학생이 바꾸면 실험 사이의 비교가 성립하지 않는다 (`project/create.ts`).
 */
export function withSplit(
  document: ProjectDocument,
  patch: Partial<Omit<Split, 'randomState'>>,
  now: string,
): ProjectDocument {
  return withSettings(
    document,
    { ...document.settings, split: { ...document.settings.split, ...patch } },
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
 * 학습할 모델 목록을 갈아 끼운다.
 *
 * **있던 줄은 그대로 옮긴다.** 같은 알고리즘이 실행 방법만 다르게 두 번 들어가 있을 수
 * 있고(mlpx-spec.md §3), 목록을 새로 만들면 그 덮어쓰기가 조용히 사라진다. 새로 체크한
 * 것만 실험 기본을 따르는 줄로 뒤에 붙는다.
 */
export function withAlgorithms(
  document: ProjectDocument,
  algorithms: readonly string[],
  now: string,
): ProjectDocument {
  const wanted = new Set(algorithms)
  const kept = document.settings.selectedAlgorithms.filter((selection) =>
    wanted.has(selection.algorithm),
  )
  const already = new Set(kept.map((selection) => selection.algorithm))
  const added = algorithms
    .filter((algorithm) => !already.has(algorithm))
    .map((algorithm) => ({ algorithm }))

  return withSettings(
    document,
    { ...document.settings, selectedAlgorithms: [...kept, ...added] },
    now,
  )
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
  const byAlgorithm = { ...document.settings.hyperparameters }
  const byRuntime = { ...(byAlgorithm[algorithm] ?? {}) }
  const values = { ...(byRuntime[runtime] ?? {}) }

  if (value === undefined) delete values[name]
  else values[name] = value

  if (Object.keys(values).length === 0) delete byRuntime[runtime]
  else byRuntime[runtime] = values

  if (Object.keys(byRuntime).length === 0) delete byAlgorithm[algorithm]
  else byAlgorithm[algorithm] = byRuntime

  return withSettings(document, { ...document.settings, hyperparameters: byAlgorithm }, now)
}
