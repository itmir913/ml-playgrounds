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
  /**
   * 개수. **`items`가 있으면 무엇이었는지까지 안다.**
   *
   * 줄에 쓰는 것은 여전히 개수뿐이다 — 특성 스무 개가 열여덟 개가 된 것을 이름으로
   * 늘어놓으면 그 줄이 화면을 덮는다. `items`는 **학생이 눌러서 열 때** 쓴다.
   */
  | { readonly kind: 'count'; readonly count: number; readonly items?: readonly string[] }
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
 * 목록. **개수를 말하되 무엇이었는지도 들고 있는다.**
 *
 * `countOf`와 나누는 이유는 **이름을 그대로 보여도 되는 목록에만 쓰기 때문**이다.
 * 특성 이름은 학생의 CSV 컬럼명이라 그대로 읽히지만, 알고리즘 목록은 `knn:mljs` 같은
 * 식별자라 화면이 로케일을 찾아야 한다 — 그건 여기가 아니라 그 화면의 일이고, 지금
 * 필요하지 않다.
 */
const listOf: Describe = (value) => ({
  kind: 'count',
  count: Array.isArray(value) ? value.length : 0,
  items: Array.isArray(value) ? value.map(String) : [],
})

/**
 * 숫자 목록. **이어 붙여 그대로 보인다.**
 *
 * `countOf`를 쓸 수 없는 자리다 — 거기서 세는 것은 목록의 길이인데, 여기 목록의 길이는
 * **범주 수**이고 학생이 알고 싶은 것은 **사진 수**다. 바로 윗줄의 범주 목록과 같은
 * 순서라 나란히 읽힌다.
 */
/**
 * 해시의 앞자리. **읽으라고 보이는 것이 아니라 갈렸다는 표시다.**
 *
 * 64자를 통째로 보이면 그 줄이 화면을 덮고, 안 보이면 무엇이 달라졌는지 말할 자리가
 * 없어진다. 앞 여덟 자면 두 값이 다르다는 것이 눈에 들어온다.
 */
const shortHash: Describe = (value) => {
  if (typeof value !== 'string' || value === '') return { kind: 'absent' }
  return { kind: 'literal', text: value.slice(0, 8) }
}

const joined: Describe = (value) => {
  if (!Array.isArray(value) || value.length === 0) return { kind: 'absent' }
  return { kind: 'literal', text: value.map(String).join(' · ') }
}

export interface MemberDiff {
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

/**
 * 목록에서 무엇이 들어오고 무엇이 빠졌는지. **없으면 `null`이다.**
 *
 * **화면이 아니라 여기서 센다.** `.vue`의 computed는 아무도 테스트하지 않아서, 나중에
 * "단순화"가 규칙을 되돌려도 초록색이 유지된다.
 *
 * 양쪽이 `items`를 든 목록일 때만 답한다 — 개수만 아는 값(`countOf`)이나 어휘 값에는
 * 들고 날 것이 없다. **순서는 원본 그대로 둔다.** 학생이 고른 순서가 곧 표의 순서다.
 */
export function memberDiff(from: ChangeValue, to: ChangeValue): MemberDiff | null {
  if (from.kind !== 'count' || to.kind !== 'count') return null
  if (from.items === undefined || to.items === undefined) return null

  const before = new Set(from.items)
  const after = new Set(to.items)
  return {
    added: to.items.filter((name) => !before.has(name)),
    removed: from.items.filter((name) => !after.has(name)),
  }
}

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
    target: { labelKey: 'preprocess.tabular.roleTarget', describe: literal },
    // **특성만 `listOf`다.** 학생이 가장 자주 만지는 목록이고, 개수만 보고는 무엇을
    // 뺐는지 알 수 없어서 화면이 눌러 여는 자리를 준다 (results/ChangeList.vue).
    features: { labelKey: 'preprocess.tabular.roleFeature', describe: listOf },
    algorithms: { labelKey: 'train.chosenTitle', describe: countOf },
    'preprocessing.missing': {
      labelKey: 'preprocess.tabular.missing',
      describe: vocabulary('missingStrategy'),
    },
    'preprocessing.scaling': {
      labelKey: 'preprocess.tabular.scaling',
      describe: vocabulary('scalingMethod'),
    },
    'preprocessing.categoricalEncoding': {
      labelKey: 'preprocess.tabular.encoding',
      describe: vocabulary('categoricalEncoding'),
    },
    'split.method': { labelKey: 'preprocess.testDataTitle', describe: vocabulary('splitMethod') },
    'split.testSize': { labelKey: 'preprocess.testSize', describe: literal },
    'split.stratify': { labelKey: 'preprocess.stratify', describe: onOff },
    'split.randomState': { labelKey: 'preprocess.randomState', describe: literal },
    // 뽑기를 껐을 때는 `null`이고 `literal`이 그것을 `absent`로 편다 — 그래서
    // "전체 사용 → 3,000행"과 그 반대가 둘 다 문장이 된다 (target과 같은 방식).
    nSamples: { labelKey: 'preprocess.tabular.sampleRows', describe: literal },
    /**
     * **이미지의 넷.** 학습이 이 함수로 오게 된 2026-08-12에 붙였다 — 그 전에는 쓸
     * 대상이 없어서 일부러 비워 두었다 (architecture.md §8.10).
     *
     * `categories`가 `listOf`인 이유는 특성 이름과 같다 — **학생이 지은 말이라 그대로
     * 읽힌다.** 무엇이 들고 났는지까지 펼쳐 볼 수 있어야 한다.
     */
    categories: { labelKey: 'meta.image.categories', describe: listOf },
    categoryCounts: { labelKey: 'meta.image.photosPerCategory', describe: joined },
    unlabeledCount: { labelKey: 'meta.image.unlabeledCount', describe: literal },
    // 고르게 하지 않으므로 사실상 안 뜬다. 옛 파일을 다시 학습할 때를 위해 둔다.
    backboneId: { labelKey: 'meta.image.backbone', describe: literal },
    /**
     * 행 순서의 지문 (mlpx-spec.md §5.1).
     *
     * **이 줄이 없으면 라벨 맞바꾸기가 이력에서 통째로 사라진다** — 장수도 범주도 그대로라
     * 다른 칸이 하나도 안 움직이고, 화면은 "설정을 바꾸지 않고 다시 학습했습니다"라고
     * 말한다 (R6 감사 A-1).
     *
     * **앞자리만 보인다.** 학생이 읽을 것은 값이 아니라 **배지의 이름**이다 — 무엇이
     * 달라졌는지는 이름이 말하고, 값은 `backboneId`처럼 그저 서로 다르다는 표시다.
     */
    rowsHash: { labelKey: 'meta.image.photoOrder', describe: shortHash },
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
