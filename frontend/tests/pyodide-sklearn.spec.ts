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
import { type PyodideProxy, fit, resetPyodide, setPyodide } from '../src/ml/engines/pyodide-sklearn'

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
    expect(source).not.toContain('import js')
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

describe('준비되지 않은 엔진', () => {
  it('Pyodide가 없으면 던진다', () => {
    expect.assertions(2)
    try {
      fit('decision_tree', input({}))
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('ENGINE_NOT_READY')
    }
  })
})
