/**
 * Pyodide-sklearn 어댑터 — **Python 소스로 나가는 것만 본다.**
 *
 * sklearn 자체는 브라우저에서 실물로 확인한다. 여기서 덮는 것은 어댑터가 만드는
 * 문자열이다: **학생 파일의 문자열이 `runPython()`에 닿는 경로가 없는가.**
 *
 * `.mlpx`는 교사와 학생이 서로 주고받는 것이 이 도구의 전제이고(CLAUDE.md §1.3),
 * 파일의 `hyperparameters`는 `z.record(z.string(), z.unknown())`이라 **키가 임의의
 * 문자열이다.** Pyodide의 Python은 `import js`로 IndexedDB와 `fetch`에 닿으므로,
 * 그 키가 소스에 이어 붙는 순간 남의 파일이 학생 브라우저에서 코드를 돌린다.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import type { FitInput } from '../src/ml/engines/mljs'
import {
  PYODIDE_SKLEARN_ALGORITHMS,
  type PyodideProxy,
  fit,
  resetPyodide,
  setPyodide,
} from '../src/ml/engines/pyodide-sklearn'

/** 실행된 Python 소스를 모아 두는 가짜 Pyodide. 아무것도 실행하지 않는다. */
function fakePyodide(): { proxy: PyodideProxy; sources: string[] } {
  const sources: string[] = []
  const proxy: PyodideProxy = {
    runPython: (code) => {
      sources.push(code)
      return undefined
    },
    globals: {
      get: (name) => ({
        toJs: () => (name === '_centroids' ? [[0, 0]] : [0]),
        destroy: () => {},
      }),
      set: () => {},
    },
  }
  return { proxy, sources }
}

function input(hyperparameters: Record<string, unknown>): FitInput {
  return {
    features: [
      [0, 0],
      [1, 1],
    ],
    rowIndices: [0, 1],
    target: ['a', 'b'],
    taskType: 'classification',
    hyperparameters,
    randomState: 42,
  }
}

afterEach(() => {
  resetPyodide()
})

describe('하이퍼파라미터가 Python 소스로 나갈 때', () => {
  it('서술에 없는 키는 들어가지 않는다', () => {
    const { proxy, sources } = fakePyodide()
    setPyodide(proxy)

    fit(
      'decision_tree',
      input({
        max_depth: 7,
        // 남의 .mlpx가 들고 올 수 있는 것. resolveWith는 모르는 키를 손대지 않고
        // 통과시키므로 여기까지 온다 (ml/hyperparams.ts).
        "x=1)\nimport js\njs.eval('alert(1)')\n_ignored = dict(y": 1,
      }),
    )

    const source = sources.join('\n')
    expect(source).toContain('max_depth=7')
    // **낱말로 본다.** `import json`이 `import js`를 부분 문자열로 품어서, 글자로 찾으면
    // 직렬화기가 쓰는 정당한 임포트가 오탐으로 걸린다 (2026-09-19).
    expect(source).not.toMatch(/import js/)
    expect(source).not.toContain('_ignored')
  })

  it('군집 경로도 같다', () => {
    const { proxy, sources } = fakePyodide()
    setPyodide(proxy)

    fit('k_means', input({ n_clusters: 2, 'evil=1)\n_leak = open': 1 }))

    const source = sources.join('\n')
    expect(source).toContain('n_clusters=2')
    expect(source).toContain('random_state=42')
    expect(source).not.toContain('_leak')
  })

  it('서술에 있어도 수치가 아니면 들어가지 않는다', () => {
    const { proxy, sources } = fakePyodide()
    setPyodide(proxy)

    // resolveWith가 이미 기본값으로 되돌리므로 정상 경로에서는 안 나온다. 그래도
    // 여기서 한 번 더 막는다 - boolean은 Python에서 `true`가 이름 오류이고,
    // 문자열은 따옴표째 소스가 된다.
    fit('knn', input({ n_neighbors: true }))

    const source = sources.join('\n')
    expect(source).not.toContain('n_neighbors=true')
    // 기본값(sklearn의 5)으로 돌아간 값이 들어간다.
    expect(source).toContain('n_neighbors=5')
  })

  /**
   * 위 검사의 주석이 *"문자열은 따옴표째 소스가 된다"*라고 적어 두었는데 **표본이
   * boolean 하나뿐이었다** (R8 감사 C-5). 문자열은 boolean과 다른 길로 샌다 —
   * 따옴표가 없으면 이름으로, 있으면 값으로 들어가고 둘 다 우리가 안 정한 소스다.
   */
  it('문자열도 들어가지 않는다', () => {
    const { proxy, sources } = fakePyodide()
    setPyodide(proxy)

    fit('knn', input({ n_neighbors: '7' }))

    const source = sources.join('\n')
    expect(source).not.toContain("n_neighbors='7'")
    expect(source).not.toContain('n_neighbors=7')
    expect(source).toContain('n_neighbors=5')
  })
})

/**
 * **클래스 순서 그물이 실제로 무는가** (2026-09-19 R30 C-1).
 *
 * `agrees()`가 sklearn의 `classes_`와 우리 정렬을 견주고, **어긋나면 아무것도 안 담는다.**
 * 나무는 `sklearnTreeModel`이 한 번 더 보지만 **로지스틱·SVM·나이브 베이즈의 유일한 그물이
 * 이것**인데, 감사자가 `agrees()`를 늘 참으로 만들어도 정렬을 뒤집어도 **아무 검사도 안
 * 울었다** — 가짜가 주던 `_dump`이 어차피 우리 형식이 아니라 양쪽 답이 같았기 때문이다.
 *
 * 그래서 **성한 JSON을 주되 클래스 순서만 뒤집는다.** 담기면 잎과 계수의 번호가 다른
 * 라벨을 가리켜 **조용히 틀린 예측**이 된다.
 */
/**
 * **못 담은 사유가 갈린다** (2026-09-19 R30 C-5). 한동안 넷이 전부 `serializer-missing`
 * 이었는데, 그건 *"이 알고리즘에는 직렬화기가 없다"*는 말이고 **셋은 있고 거절한 것**이었다.
 */
describe('못 담은 사유를 갈라 적는다', () => {
  /**
   * **이제 여덟이 다 직렬화기를 갖는다** (2026-09-19). 랜덤 포레스트가 마지막이었고
   * `mlpx-tree-v2`로 열렸다 — 그래서 `serializer-missing`은 **오늘 아무 알고리즘도 안 낸다.**
   *
   * **그 갈래를 지우지는 않았다.** 새 알고리즘이 칸을 비운 채 들어올 수 있고, 그때 사유가
   * *"클래스가 갈렸다"*로 적히면 고치는 사람이 엉뚱한 데를 판다. **대신 그 사실을 여기서
   * 못 박는다** — 하나라도 비면 이 검사가 운다.
   */
  it('직렬화기가 없는 알고리즘이 하나도 없다', async () => {
    const missing: string[] = []
    for (const algorithm of PYODIDE_SKLEARN_ALGORITHMS) {
      setPyodide(fakePyodide().proxy)
      const result = await fit(algorithm, input({}))
      if (result.modelOmittedDetail?.endsWith(':serializer-missing') === true) {
        missing.push(algorithm)
      }
      resetPyodide()
    }
    expect(PYODIDE_SKLEARN_ALGORITHMS.length, 'the registry must not be empty').toBe(8)
    expect(missing).toEqual([])
  })
})

describe('클래스 순서가 어긋나면 아무것도 안 담는다', () => {
  /** 잎 둘짜리 나무 하나. `classes`만 갈아 끼운다. */
  const dumpWith = (classes: readonly string[]): string =>
    JSON.stringify({
      trees: [
        {
          left: [1, -1, -1],
          right: [2, -1, -1],
          feature: [0, -2, -2],
          threshold: [0.5, -2, -2],
          leafClass: [0, 0, 1],
        },
      ],
      classes,
    })

  function pyodideSaying(dump: string): PyodideProxy {
    return {
      runPython: () => undefined,
      globals: {
        get: (name) => ({
          toJs: () => (name === '_dump' ? dump : [0]),
          destroy: () => {},
        }),
        set: () => {},
      },
    }
  }

  it('sklearn이 우리와 같은 순서를 말하면 담는다 - 바닥', async () => {
    setPyodide(pyodideSaying(dumpWith(['a', 'b'])))
    const result = await fit('decision_tree', input({ max_depth: 3 }))
    expect(result.model).toBeDefined()
  })

  it('순서가 뒤집혀 있으면 안 담는다', async () => {
    setPyodide(pyodideSaying(dumpWith(['b', 'a'])))
    const result = await fit('decision_tree', input({ max_depth: 3 }))
    expect(result.model).toBeUndefined()
  })

  it('클래스 수가 다르면 안 담는다', async () => {
    setPyodide(pyodideSaying(dumpWith(['a'])))
    const result = await fit('decision_tree', input({ max_depth: 3 }))
    expect(result.model).toBeUndefined()
  })

  /**
   * **나무는 이 그물이 없어도 산다** — `sklearnTreeModel`이 `dump.classes`를 한 번 더
   * 견주기 때문이다. **선형 계열에는 그 둘째 그물이 없다**: `sklearnLinearModel`이 받는
   * 것은 계수와 절편뿐이라 클래스 순서를 알 길이 없다.
   *
   * 그래서 `agrees()`가 죽었는지를 보려면 **여기로 찔러야 한다.** 감사자의 M6이 조용했던
   * 이유가 나무로만 찔렀기 때문이다 (R30 C-1).
   */
  const linearDump = (classes: readonly string[]): string =>
    JSON.stringify({ coef: [[1, 2]], intercept: [0], classes })

  it('로지스틱: 순서가 같으면 담는다 - 바닥', async () => {
    setPyodide(pyodideSaying(linearDump(['a', 'b'])))
    const result = await fit('logistic_regression', input({}))
    expect(result.model).toBeDefined()
  })

  it('로지스틱: 순서가 뒤집혀 있으면 안 담는다 - 그물이 여기 하나뿐이다', async () => {
    setPyodide(pyodideSaying(linearDump(['b', 'a'])))
    const result = await fit('logistic_regression', input({}))
    expect(result.model).toBeUndefined()
  })
})

/**
 * **직렬화가 학습을 죽이지 않는다** (2026-09-19).
 *
 * 파이썬이 다른 모양을 주거나 JSON이 깨져 있어도 잃는 것은 **모델 하나**여야 한다 —
 * 지표는 이미 나와 있고, 던지면 그 run이 통째로 실패해 **학생이 학습을 다시 해야 한다.**
 */
describe('배운 것을 못 받아써도', () => {
  it('학습은 끝나고 모델만 안 담긴다', async () => {
    const { proxy } = fakePyodide()
    setPyodide(proxy)

    // 가짜는 `_dump`에 JSON이 아닌 것을 준다 — `String([0])`은 `'0'`이라 파싱은 되지만
    // 우리 형식이 아니고, 그 앞뒤로 무엇이 터져도 결과는 같아야 한다.
    const result = await fit('decision_tree', input({ max_depth: 3 }))
    expect(result.model).toBeUndefined()
    // **어느 갈래로 못 담았는지가 적힌다** (R30 C-5). 가짜가 주는 `_dump`은 `'0'`이라
    // 클래스 목록이 없고, 그러면 `agrees()`가 먼저 거절한다.
    expect(result.modelOmittedDetail).toBe('pyodide-sklearn:decision_tree:classes-differ')
    expect(result.predict([[0, 0]])).toHaveLength(1)
  })
})

describe('준비되지 않은 엔진', () => {
  it('Pyodide가 없으면 던진다', async () => {
    expect.assertions(2)
    try {
      await fit('decision_tree', input({}))
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('ENGINE_NOT_READY')
    }
  })
})
