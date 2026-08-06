/**
 * 실험 사이에서 **무엇이 어떻게 바뀌었는가**. 결과 화면의 세로줄이 이걸 읽는다
 * (architecture.md 8.13).
 *
 * `experiment.changed`는 **경로만** 들고 있다 - `preprocessing.scaling`이 바뀌었다는
 * 사실뿐이고 무엇에서 무엇으로 갔는지는 없다. 그 값은 두 실험의 설정 스냅샷에 있으므로
 * 여기서 잇는다. **경로 모양을 정한 것은 `comparablePair`이고 값도 거기서 꺼낸다** -
 * 두 벌로 만들면 반드시 어긋난다.
 *
 * **문장은 만들지 않는다.** 로케일 키와 값 서술만 내고 번역은 화면이 한다
 * (CLAUDE.md 1.4와 같은 정신이다 - 여기서 문장을 지으면 그 자리는 영원히 한국어다).
 */

import { comparablePair, type ComparableSource } from './experiment'

/**
 * 전후 값 하나의 서술.
 *
 * `absent`가 따로 있는 이유는 **없던 것이 생긴 것과 값이 바뀐 것이 다른 일**이기
 * 때문이다. 타깃을 안 고른 채 학습할 수는 없지만 남의 파일에는 있을 수 있고, 그때
 * 빈 문자열을 보여주면 화면에 `→` 만 남는다.
 */
export type ChangeValue =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'locale'; readonly key: string }
  | { readonly kind: 'count'; readonly count: number }
  | { readonly kind: 'absent' }

export interface Change {
  /** 설정 경로. 화면의 키가 아니라 우리끼리 쓰는 식별자다. */
  readonly path: string
  /**
   * 라벨의 로케일 키. **등록부에 없으면 null이다.**
   *
   * 그때도 이 변경을 버리지 않는다 - 남의 파일이나 나중 버전에서 우리가 모르는 경로가
   * 올 수 있고, 모르는 것을 아는 척하는 것보다 경로를 그대로 보여주는 편이 정직하다.
   */
  readonly labelKey: string | null
  readonly from: ChangeValue
  readonly to: ChangeValue
  /**
   * 이 변경이 특정 모델에만 걸리는가. 하이퍼파라미터가 그렇다.
   *
   * **문장 안에 넣지 않는다.** 화면이 앞에 따로 붙인다 - 문장에 끼우면 "결정 트리의
   * 최대 깊이를" 같은 조사가 생기고, 그건 언어를 옮길 때 그대로 짐이 된다
   * (CLAUDE.md 3 규칙 5).
   */
  readonly model?: { readonly algorithm: string; readonly runtime: string }
}

/** 값 하나를 어떻게 서술할지. 경로마다 다르다. */
type Describe = (value: unknown) => ChangeValue

function literal(value: unknown): ChangeValue {
  if (value === null || value === undefined || value === '') return { kind: 'absent' }
  return { kind: 'literal', text: String(value) }
}

/** 어휘 값. `standard`가 `scalingMethod.standard`가 된다. */
function vocabulary(prefix: string): Describe {
  return (value) => {
    if (typeof value !== 'string' || value === '') return { kind: 'absent' }
    return { kind: 'locale', key: `${prefix}.${value}` }
  }
}

/** 참/거짓. 어휘와 같은 취급이라 화면에 켬/끔 낱말이 그대로 온다. */
const onOff: Describe = (value) => ({
  kind: 'locale',
  key: value === true ? 'common.on' : 'common.off',
})

/**
 * 목록. **개수만 말한다.**
 *
 * 특성 스무 개가 열여덟 개가 된 것을 이름으로 늘어놓으면 그 줄이 화면을 덮는다.
 * 무엇이 빠졌는지는 전처리 화면에 그대로 있다.
 */
const countOf: Describe = (value) => ({
  kind: 'count',
  count: Array.isArray(value) ? value.length : 0,
})

/**
 * 경로 -> 라벨과 값 서술.
 *
 * **여기 없는 경로도 화면에 뜬다.** 이 표는 "우리가 문장을 아는 것"의 목록이지
 * "보여줄 것"의 목록이 아니다.
 */
const LABELS: Readonly<Record<string, { readonly labelKey: string; readonly describe: Describe }>> =
  {
    taskType: { labelKey: 'meta.taskType', describe: vocabulary('taskTypes') },
    runtime: { labelKey: 'train.pickRuntime', describe: vocabulary('runtimes') },
    target: { labelKey: 'preprocess.roleTarget', describe: literal },
    features: { labelKey: 'preprocess.roleFeature', describe: countOf },
    algorithms: { labelKey: 'train.chosenTitle', describe: countOf },
    'preprocessing.missing': {
      labelKey: 'preprocess.missing',
      describe: vocabulary('missingStrategy'),
    },
    'preprocessing.scaling': {
      labelKey: 'preprocess.scaling',
      describe: vocabulary('scalingMethod'),
    },
    'preprocessing.categoricalEncoding': {
      labelKey: 'preprocess.encoding',
      describe: vocabulary('categoricalEncoding'),
    },
    'split.method': { labelKey: 'preprocess.splitTitle', describe: vocabulary('splitMethod') },
    'split.testSize': { labelKey: 'preprocess.testSize', describe: literal },
    'split.stratify': { labelKey: 'preprocess.stratify', describe: onOff },
    'split.randomState': { labelKey: 'preprocess.randomState', describe: literal },
  }

/** 점 표기 경로로 값을 꺼낸다. 없으면 undefined다. */
function at(source: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = source
  for (const step of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[step]
  }
  return current
}

/**
 * 하이퍼파라미터 경로를 갈라 읽는다 - `hyperparameters.knn:mljs.k`.
 *
 * **경로에 콜론이 있는 것이 이 갈래의 표식이다.** 알고리즘 id에는 점이 없고
 * (ml/algorithms.ts) 실행 방법 id에도 없으므로 점으로 잘라도 조각 수가 셋으로 고정된다.
 */
function hyperparameter(
  path: string,
): { model: { algorithm: string; runtime: string }; name: string } | null {
  const parts = path.split('.')
  if (parts.length !== 3 || parts[0] !== 'hyperparameters') return null
  const [algorithm, runtime] = (parts[1] ?? '').split(':')
  if (!algorithm || !runtime || !parts[2]) return null
  return { model: { algorithm, runtime }, name: parts[2] }
}

/**
 * 두 실험 사이의 변경들. **`changed`에 적힌 경로만** 본다.
 *
 * 경로 목록을 여기서 다시 계산하지 않는 이유는, 그것이 **학습 시점에 확정된 사실**이기
 * 때문이다. 파일에 적힌 것과 화면이 보여주는 것이 다르면 어느 쪽이 참인지 아무도 모른다.
 */
export function describeChanges(
  previous: ComparableSource,
  current: ComparableSource,
  paths: readonly string[],
): Change[] {
  const { before, after } = comparablePair(previous, current)

  return paths.map((path) => {
    const parameter = hyperparameter(path)
    if (parameter) {
      const steps = path.split('.')
      return {
        path,
        labelKey: `hyperparams.${parameter.name}`,
        from: literal(at(before, steps)),
        to: literal(at(after, steps)),
        model: parameter.model,
      }
    }

    const known = LABELS[path]
    const steps = path.split('.')
    const describe = known?.describe ?? literal
    return {
      path,
      labelKey: known?.labelKey ?? null,
      from: describe(at(before, steps)),
      to: describe(at(after, steps)),
    }
  })
}
