/**
 * `settings.json`을 고치는 순수 함수들.
 *
 * **여기가 막는 것은 문 하나가 다른 필드를 고쳐 쓰는 것이다** (`open-decisions.md` 55
 * *"끄지 않고 잠근다"*). 유형이 모델 선택을 지우고 타깃이 특성 목록을 고치던 것이 여기
 * 있었다. **정답이 특성에 들어가는 것(정확도 1.0)은 이제 `plan.spec.ts`가 막는다** — 막는
 * 자리가 학습 계획 하나로 옮겼다.
 *
 * 결과가 스키마를 통과하는지도 함께 본다. 이 층의 산출물이 곧 `.mlpx`다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'

import { newProjectDocument } from '../src/project/create'
import * as doors from '../src/project/settings'
import { projectDocumentSchema, type ProjectDocument } from '../src/project/schema'
import {
  withFeatures,
  withHyperparameter,
  withPreprocessing,
  withRuntime,
  withSelectedAlgorithms,
  withRandomState,
  withSampling,
  withSplit,
  withTarget,
  withTaskType,
} from '../src/project/settings'

const NOW = '2026-08-06T01:00:00.000Z'

function base(): ProjectDocument {
  return newProjectDocument(
    { name: '붓꽃', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-05T00:00:00.000Z',
      randomState: 42,
    },
  )
}

/** 특성 몇 개와 모델 몇 개를 고른 상태. 대부분의 검사가 여기서 시작한다. */
function chosen(): ProjectDocument {
  const document = withFeatures(base(), ['꽃받침길이', '꽃잎길이', '품종'], NOW)
  return withSelectedAlgorithms(
    document,
    [
      { algorithm: 'decision_tree', runtime: 'mljs' },
      { algorithm: 'linear_regression', runtime: 'mljs' },
    ],
    NOW,
  )
}

describe('고친 시각을 남긴다', () => {
  it('설정을 고치면 updatedAt이 따라 움직인다', () => {
    // 목록 화면이 이 값으로 정렬한다. 안 찍히면 방금 만진 프로젝트가 아래에 남는다.
    expect(withFeatures(base(), ['키'], NOW).manifest.updatedAt).toBe(NOW)
    expect(withTaskType(base(), 'regression', NOW).manifest.updatedAt).toBe(NOW)
  })
})

/**
 * **타깃을 고르는 문은 특성 목록을 안 건드린다** (`open-decisions.md` 55 *"끄지 않고
 * 잠근다"*). 전에는 고른 열을 특성에서 뺐고, 타깃을 다른 열로 바꿔도 **그 열이 특성으로 안
 * 돌아왔다.** 정답이 문제에 들어가는 것은 이제 학습 계획이 막는다 — `plan.spec.ts`의
 * *"타깃과 같은 이름은 특성에서 빠진다"*가 그 자리다.
 */
describe('타깃과 특성은 서로를 고쳐 쓰지 않는다', () => {
  it('타깃으로 골라도 특성 목록은 그대로다', () => {
    const before = chosen()
    const next = withTarget(before, '품종', NOW)
    expect(next.settings.data.target).toBe('품종')
    expect(next.settings.data.features).toEqual(before.settings.data.features)
  })

  it('타깃을 다른 열로 옮기면 특성으로 골라 두었던 것이 그대로 살아 있다', () => {
    const withLength = withFeatures(base(), ['꽃잎길이', '품종'], NOW)
    const asTarget = withTarget(withLength, '품종', NOW)
    const moved = withTarget(asTarget, '꽃받침길이', NOW)
    expect(moved.settings.data.features).toEqual(['꽃잎길이', '품종'])
  })

  it('특성 하나를 켜고 꺼도 타깃과 같은 이름이 목록에서 사라지지 않는다', () => {
    const start = withTarget(withFeatures(base(), ['꽃잎길이', '품종'], NOW), '품종', NOW)
    const next = withFeatures(start, ['꽃잎길이', '품종', '꽃받침길이'], NOW)
    expect(next.settings.data.features).toEqual(['꽃잎길이', '품종', '꽃받침길이'])
  })

  it('타깃을 지우면 고르지 않은 상태로 돌아간다', () => {
    const next = withTarget(withTarget(base(), '품종', NOW), undefined, NOW)
    expect(next.settings.data.target).toBeUndefined()
  })
})

describe('기계학습 유형', () => {
  it('manifest에 적힌다 - settings가 아니다', () => {
    expect(withTaskType(base(), 'regression', NOW).manifest.taskType).toBe('regression')
  })

  /**
   * **유형을 바꿔도 모델 선택은 그대로다** (`open-decisions.md` 55). 전에는 그 유형에 안 맞는
   * 모델을 여기서 지웠다 — 유형을 되돌려도 안 돌아왔다.
   */
  it('모델 선택을 안 건드린다', () => {
    const before = chosen()
    const next = withTaskType(before, 'regression', NOW)
    expect(next.settings.selectedAlgorithms).toEqual(before.settings.selectedAlgorithms)
  })
})

describe('모델 목록', () => {
  it('넘긴 목록을 그대로 담는다', () => {
    const next = withSelectedAlgorithms(base(), [{ algorithm: 'knn', runtime: 'mljs' }], NOW)
    expect(next.settings.selectedAlgorithms).toEqual([{ algorithm: 'knn', runtime: 'mljs' }])
  })

  it('같은 모델이 실행 방법만 다르게 여러 줄 들어간다', () => {
    // **이게 이 배열이 있는 이유다** (mlpx-spec.md §3). "같은 결정트리인데 엔진이
    // 다르면 왜 숫자가 다른가"를 한 실험 안에서 본다.
    const rows = [
      { algorithm: 'decision_tree', runtime: 'mljs' },
      { algorithm: 'decision_tree', runtime: 'server-sklearn' },
      { algorithm: 'naive_bayes', runtime: 'mljs' },
    ]
    expect(withSelectedAlgorithms(base(), rows, NOW).settings.selectedAlgorithms).toEqual(rows)
  })

  it('앞의 문서를 건드리지 않는다', () => {
    const before = withSelectedAlgorithms(base(), [{ algorithm: 'knn', runtime: 'mljs' }], NOW)
    withSelectedAlgorithms(before, [], NOW)
    expect(before.settings.selectedAlgorithms).toEqual([{ algorithm: 'knn', runtime: 'mljs' }])
  })
})

describe('하이퍼파라미터', () => {
  it('알고리즘과 실행 방법으로 키를 잡는다', () => {
    const next = withHyperparameter(
      base(),
      { algorithm: 'decision_tree', runtime: 'mljs', name: 'maxDepth' },
      5,
      NOW,
    )
    expect(next.settings.hyperparameters).toEqual({ decision_tree: { mljs: { maxDepth: 5 } } })
  })

  it('실행 방법이 다르면 값이 섞이지 않는다', () => {
    const one = withHyperparameter(
      base(),
      { algorithm: 'decision_tree', runtime: 'mljs', name: 'maxDepth' },
      5,
      NOW,
    )
    const two = withHyperparameter(
      one,
      { algorithm: 'decision_tree', runtime: 'server-sklearn', name: 'max_depth' },
      7,
      NOW,
    )
    expect(two.settings.hyperparameters).toEqual({
      decision_tree: { mljs: { maxDepth: 5 }, 'server-sklearn': { max_depth: 7 } },
    })
  })

  it('undefined면 지우고 빈 껍데기도 걷는다', () => {
    const one = withHyperparameter(base(), { algorithm: 'knn', runtime: 'mljs', name: 'k' }, 9, NOW)
    const two = withHyperparameter(
      one,
      { algorithm: 'knn', runtime: 'mljs', name: 'k' },
      undefined,
      NOW,
    )
    expect(two.settings.hyperparameters).toEqual({})
  })

  it('앞의 값을 건드리지 않는다', () => {
    const before = withHyperparameter(
      base(),
      { algorithm: 'knn', runtime: 'mljs', name: 'k' },
      9,
      NOW,
    )
    withHyperparameter(before, { algorithm: 'knn', runtime: 'mljs', name: 'k' }, 3, NOW)
    expect(before.settings.hyperparameters).toEqual({ knn: { mljs: { k: 9 } } })
  })
})

describe('전처리와 분할', () => {
  it('건드린 값만 바뀐다', () => {
    const next = withPreprocessing(base(), { scaling: 'standard' }, NOW)
    expect(next.settings.data.preprocessing).toEqual({
      missing: 'drop',
      scaling: 'standard',
      categoricalEncoding: 'onehot',
    })
  })

  it('난수 씨앗은 분할을 고쳐도 그대로다', () => {
    // 값이 바뀌면 실험 사이의 비교가 성립하지 않으므로 이 문으로는 안 들어온다.
    const next = withSplit(base(), { testSize: 0.4, stratify: false }, NOW)
    expect(next.settings.split).toEqual({
      method: 'holdout',
      testSize: 0.4,
      stratify: false,
      randomState: 42,
    })
  })

  it('뽑을 행 수를 정하면 그 값만 는다', () => {
    const next = withSampling(base(), 3000, NOW)
    expect(next.settings.nSamples).toBe(3000)
    // 씨앗과 층화는 여기로 안 들어온다 - split의 값을 따라간다 (open-decisions.md #22).
    expect(next.settings.split).toEqual(base().settings.split)
  })

  it('전부 쓰기로 되돌리면 **키가 사라진다** - undefined로 남기지 않는다', () => {
    // undefined를 그대로 두면 파일에 null로 나가는지 사라지는지가 직렬화에 달리고,
    // 스키마는 선택 항목이라 둘 다 통과해 버린다.
    const next = withSampling(withSampling(base(), 3000, NOW), undefined, NOW)
    expect(next.settings).not.toHaveProperty('nSamples')
  })

  it('씨앗을 다시 뽑는 문은 따로 있고 나머지 분할 설정은 안 건드린다', () => {
    // 화면이 경고를 거친 뒤에만 부른다
    // (open-decisions.md "난수 씨앗은 고정이 기본이고, 다시 뽑는 것은 경고 뒤에 준다").
    const next = withRandomState(withSplit(base(), { testSize: 0.4 }, NOW), 12345, NOW)
    expect(next.settings.split).toEqual({
      method: 'holdout',
      testSize: 0.4,
      stratify: true,
      randomState: 12345,
    })
  })

  it('씨앗을 다시 뽑아도 지난 실험은 그대로다 - 스냅샷이 실험마다 있다', () => {
    const document = base()
    document.runs.experiments = [
      {
        id: 'experiment-1',
        startedAt: NOW,
        settings: {
          taskType: 'classification',
          runtime: 'mljs',
          selectedAlgorithms: [],
          data: {
            features: ['키'],
            preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
          },
          split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
          trainIndices: [0, 1],
          testIndices: [2],
        },
        runs: [],
      },
    ]

    const next = withRandomState(document, 999, NOW)
    expect(next.settings.split.randomState).toBe(999)
    expect(next.runs.experiments[0]?.settings.split.randomState).toBe(42)
    expect(next.runs.experiments[0]?.settings.trainIndices).toEqual([0, 1])
  })

  it('실행 방법을 바꿔도 모델별 덮어쓰기는 그대로다', () => {
    const document = base()
    document.settings.selectedAlgorithms = [{ algorithm: 'svm', runtime: 'server-sklearn' }]
    const next = withRuntime(document, 'pyodide-sklearn', NOW)
    expect(next.settings.runtime).toBe('pyodide-sklearn')
    expect(next.settings.selectedAlgorithms).toEqual([
      { algorithm: 'svm', runtime: 'server-sklearn' },
    ])
  })
})

/**
 * **어떤 문도 다시 안 열리는 문서를 못 만든다** (2026-09-19 R33 A-1, 코드 소유자).
 *
 * **같은 종류의 A가 두 라운드 연속으로 났다.** R32는 `modelOmittedDetail`이 235자,
 * R33은 `nSamples`가 바닥 아래였다. 모양이 똑같다 — **쓰는 길에는 검증이 없고 읽는
 * 길에만 있어서**, 스키마를 어기는 값이 한 번 담기면 `.mlpx`도 IndexedDB 사본도
 * **저장은 성공하고 다시는 안 열린다.** 학생은 한 차시가 끝난 뒤에 안다.
 *
 * **그래서 자리마다 조심하는 대신 문 전부를 훑는다.** 설정을 고치는 길은 이 파일이
 * 내보내는 함수들뿐이고(아래가 그 목록이 닫혀 있는지도 센다), 각 문은 둘 중 하나여야
 * 한다 — **스키마를 통과하는 문서를 내거나, `ClientError`로 시끄럽게 서거나.**
 * **조용히 못 읽는 문서를 내는 것만 금지다.**
 *
 * **쓰는 길에 검증을 넣는 길은 안 간다** — `내보내기는 무조건 성공해야 한다`가 규칙이다.
 * 막는 자리는 값이 문서로 들어가는 문이고, 이 검사가 그 문들을 지킨다.
 */
describe('어떤 문도 안 열리는 문서를 못 만든다', () => {
  /** 바닥·천장·정수·유한성을 찌르는 값들. **스키마가 거부하는 모양을 겨눈다.** */
  const DOORS: Record<string, readonly (() => ProjectDocument)[]> = {
    withTaskType: [() => withTaskType(base(), 'clustering', NOW)],
    withTarget: [
      () => withTarget(base(), '', NOW),
      () => withTarget(base(), undefined, NOW),
      () => withTarget(base(), 'x'.repeat(1000), NOW),
    ],
    withFeatures: [
      () => withFeatures(base(), [], NOW),
      () => withFeatures(base(), ['x'.repeat(1000)], NOW),
      () => withFeatures(base(), ['같은열', '같은열'], NOW),
    ],
    withPreprocessing: [() => withPreprocessing(base(), {}, NOW)],
    withSplit: [
      () => withSplit(base(), { testSize: 0 }, NOW),
      () => withSplit(base(), { testSize: 1 }, NOW),
      () => withSplit(base(), { testSize: Number.NaN }, NOW),
      () => withSplit(base(), { testSize: -1 }, NOW),
    ],
    withSampling: [
      // **R33 A-1이 여기였다.** 화면의 클램프가 천장을 뒤에 걸어 바닥을 도로 깎았다.
      () => withSampling(base(), 1, NOW),
      () => withSampling(base(), 0, NOW),
      () => withSampling(base(), -1, NOW),
      () => withSampling(base(), undefined, NOW),
    ],
    withRandomState: [
      () => withRandomState(base(), 0, NOW),
      () => withRandomState(base(), -1, NOW),
      () => withRandomState(base(), 1.5, NOW),
      () => withRandomState(base(), Number.NaN, NOW),
    ],
    withRuntime: [() => withRuntime(base(), '', NOW), () => withRuntime(base(), '없는엔진', NOW)],
    withSelectedAlgorithms: [
      () => withSelectedAlgorithms(base(), [], NOW),
      () => withSelectedAlgorithms(base(), [{ algorithm: '' }], NOW),
    ],
    withHyperparameter: [
      () => withHyperparameter(base(), { algorithm: 'knn', runtime: 'mljs', name: 'k' }, 0, NOW),
      () =>
        withHyperparameter(
          base(),
          { algorithm: 'knn', runtime: 'mljs', name: 'k' },
          Number.NaN,
          NOW,
        ),
      () =>
        withHyperparameter(
          base(),
          { algorithm: 'knn', runtime: 'mljs', name: 'k' },
          undefined,
          NOW,
        ),
    ],
  }

  /**
   * **목록이 닫혀 있는지 센다** (R30 C-4가 이름 붙인 병 — *"그물이 자기를 센다"*).
   * 새 문이 생기면 여기서 운다. 수를 손으로 적지 않는다.
   *
   * **소스를 정규식으로 훑지 않는다** (2026-09-19 R34 B-1). 한때 `^export function
   * (with\w+)\(`로 셌는데, **`export const withZzz =`와 `export async function withYyy(`이
   * 그대로 빠져나갔다** — 둘 다 스키마를 못 지나는 문서를 내는데 33개가 전부 초록이었다.
   * **정규식을 넓히는 것은 같은 병의 다음 판이다**: 표기는 계속 는다.
   *
   * **그래서 모듈이 실제로 내보내는 것을 본다.** 이름이 어떻게 적혔든 `import *`의
   * 네임스페이스에는 같은 모양으로 선다. **비동기 문이 들어와도 걸린다** — 아래 반복이
   * `Promise`를 받아 스키마에 먹이고 거기서 운다.
   */
  it('훑는 문이 설정 모듈이 내보내는 것 전부다', () => {
    const exported = Object.entries(doors)
      .filter(([name, value]) => name.startsWith('with') && typeof value === 'function')
      .map(([name]) => name)
    expect(exported.length).toBeGreaterThan(8)
    expect(exported.filter((name) => DOORS[name] === undefined)).toEqual([])
  })

  for (const [name, calls] of Object.entries(DOORS)) {
    it(`${name}: 무엇을 넣어도 다시 열 수 있는 문서이거나, 시끄럽게 선다`, () => {
      for (const [index, call] of calls.entries()) {
        let document: ProjectDocument
        try {
          document = call()
        } catch (error) {
          // **서는 것은 괜찮다.** 그 자리에서 알 수 있고 파일이 안 죽는다.
          expect(isClientError(error), `${name}[${index}]`).toBe(true)
          continue
        }
        const parsed = projectDocumentSchema.safeParse(document)
        const where = parsed.success ? '' : (parsed.error.issues[0]?.path.join('.') ?? '')
        expect(parsed.success, `${name}[${index}] -> ${where}`).toBe(true)
      }
    })
  }
})

describe('결과가 스키마를 통과한다', () => {
  it('이 층의 산출물이 곧 .mlpx다', () => {
    let document = withTaskType(base(), 'regression', NOW)
    document = withTarget(document, '점수', NOW)
    document = withFeatures(document, ['키', '몸무게'], NOW)
    document = withPreprocessing(document, { missing: 'mean', scaling: 'robust' }, NOW)
    document = withSplit(document, { testSize: 0.35 }, NOW)
    document = withRuntime(document, 'mljs', NOW)
    document = withSelectedAlgorithms(document, [{ algorithm: 'linear_regression' }], NOW)
    document = withHyperparameter(
      document,
      { algorithm: 'linear_regression', runtime: 'mljs', name: '뭔가' },
      1,
      NOW,
    )

    expect(() => projectDocumentSchema.parse(document)).not.toThrow()
  })
})
