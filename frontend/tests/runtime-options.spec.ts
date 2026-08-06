/**
 * 실행 방법 선택 규칙.
 *
 * 핵심 요구 셋.
 *
 *   1. 서버가 없어도 수업이 계속돼야 한다 - 서버 없음은 예외가 아니라 정상 경로다
 *   2. 못 고르는 항목에는 **항상** 이유가 있어야 한다 - 이유 없는 회색은 고장으로 보인다
 *   3. 아무것도 안 건드리면 즉시 시작되는 것이 골라져 있어야 한다
 */

import { describe, expect, it } from 'vitest'

import { BROWSER_ROW_LIMIT } from '../src/limits'
import {
  RUNTIMES,
  type AlgorithmSpec,
  type EngineState,
  type RuntimeContext,
  preferredRuntime,
  runtimeOptions,
} from '../src/ml/backend'

/** 셋 다 도는 알고리즘. 결정트리가 그렇다. */
const anywhere: AlgorithmSpec = {
  id: 'decision_tree',
  runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
}

/** 무거워서 서버에서만 도는 것. */
const serverOnly: AlgorithmSpec = {
  id: 'gradient_boosting',
  runtimes: { mljs: false, 'pyodide-sklearn': false, 'server-sklearn': true },
}

/** 순수 JS 구현이 없어 sklearn에서만 도는 것. */
const sklearnOnly: AlgorithmSpec = {
  id: 'svm',
  runtimes: { mljs: false, 'pyodide-sklearn': true, 'server-sklearn': true },
}

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return { serverStatus: 'unavailable', rowCount: 100, ...overrides }
}

const ready: Record<string, EngineState> = { 'pyodide-sklearn': 'ready' }

function optionFor(options: ReturnType<typeof runtimeOptions>, id: string) {
  return options.find((option) => option.runtime.id === id)
}

describe('실행 방법 목록', () => {
  it('서버가 없어도 목록에서 사라지지 않는다 - 숨기지 않고 이유를 준다', () => {
    const options = runtimeOptions(anywhere, context())
    expect(options.map((option) => option.runtime.id)).toEqual(RUNTIMES.map((r) => r.id))
    expect(optionFor(options, 'server-sklearn')?.reason).toBe('SERVER_UNAVAILABLE')
  })

  it('순수 JS는 준비 없이 바로 쓸 수 있다', () => {
    expect(optionFor(runtimeOptions(anywhere, context()), 'mljs')?.enabled).toBe(true)
  })

  it('아직 확인 전인 서버는 열어 주지 않는다 - 낙관적으로 켰다 실패하는 것보다 낫다', () => {
    const options = runtimeOptions(anywhere, context({ serverStatus: 'unknown' }))
    expect(optionFor(options, 'server-sklearn')?.enabled).toBe(false)
  })

  it('서버가 살아 있으면 서버 항목이 열린다', () => {
    const options = runtimeOptions(anywhere, context({ serverStatus: 'available' }))
    expect(optionFor(options, 'server-sklearn')?.enabled).toBe(true)
  })

  it('알고리즘이 지원하지 않는 실행 방법은 이유와 함께 잠근다', () => {
    const options = runtimeOptions(serverOnly, context({ serverStatus: 'available' }))
    expect(optionFor(options, 'mljs')).toEqual({
      runtime: RUNTIMES[0],
      enabled: false,
      reason: 'ALGORITHM_NOT_AVAILABLE_HERE',
    })
  })

  it('잠긴 항목에는 언제나 이유가 있다', () => {
    const cases = [
      runtimeOptions(anywhere, context({ rowCount: BROWSER_ROW_LIMIT + 1 })),
      runtimeOptions(serverOnly, context()),
      runtimeOptions(sklearnOnly, context({ serverStatus: 'unknown', rowCount: 999999 })),
      runtimeOptions(anywhere, context({ serverStatus: 'available', engineStates: ready })),
    ]
    for (const options of cases) {
      for (const option of options) {
        if (!option.enabled) expect(option.reason, JSON.stringify(option)).toBeDefined()
      }
    }
  })
})

describe('엔진 준비 상태', () => {
  it('준비되지 않은 엔진은 ENGINE_NOT_READY로 잠긴다', () => {
    const options = runtimeOptions(anywhere, context())
    expect(optionFor(options, 'pyodide-sklearn')).toEqual({
      runtime: RUNTIMES[1],
      enabled: false,
      reason: 'ENGINE_NOT_READY',
    })
  })

  it('준비되면 열린다', () => {
    const options = runtimeOptions(anywhere, context({ engineStates: ready }))
    expect(optionFor(options, 'pyodide-sklearn')?.enabled).toBe(true)
  })

  it('내려받기만 끝난 상태는 아직 준비가 아니다 - 시동 15초가 남아 있다', () => {
    const states: Record<string, EngineState> = { 'pyodide-sklearn': 'downloaded' }
    const options = runtimeOptions(anywhere, context({ engineStates: states }))
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('ENGINE_NOT_READY')
  })

  it('내려받는 중에도 아직 못 쓴다', () => {
    const states: Record<string, EngineState> = { 'pyodide-sklearn': 'downloading' }
    const options = runtimeOptions(anywhere, context({ engineStates: states }))
    expect(optionFor(options, 'pyodide-sklearn')?.enabled).toBe(false)
  })

  it('준비가 필요 없는 실행 방법은 상태와 무관하다', () => {
    const options = runtimeOptions(anywhere, context({ serverStatus: 'available' }))
    expect(optionFor(options, 'mljs')?.enabled).toBe(true)
    expect(optionFor(options, 'server-sklearn')?.enabled).toBe(true)
  })
})

describe('데이터 크기', () => {
  it('브라우저가 감당 못 할 크기면 브라우저 항목이 전부 잠긴다', () => {
    const options = runtimeOptions(
      anywhere,
      context({ serverStatus: 'available', rowCount: BROWSER_ROW_LIMIT + 1, engineStates: ready }),
    )
    expect(optionFor(options, 'mljs')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
    expect(optionFor(options, 'server-sklearn')?.enabled).toBe(true)
  })

  it('크기가 준비 상태보다 앞선다 - 엔진을 준비해도 소용없는 상황이다', () => {
    const options = runtimeOptions(anywhere, context({ rowCount: BROWSER_ROW_LIMIT + 1 }))
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('상한 자체는 허용한다', () => {
    const options = runtimeOptions(anywhere, context({ rowCount: BROWSER_ROW_LIMIT }))
    expect(optionFor(options, 'mljs')?.enabled).toBe(true)
  })
})

describe('preferredRuntime', () => {
  it('아무것도 안 건드리면 순수 JS다 - 즉시 시작된다', () => {
    const options = runtimeOptions(anywhere, context({ serverStatus: 'available' }))
    expect(preferredRuntime(options)?.id).toBe('mljs')
  })

  it('준비된 무거운 엔진이 있어도 순수 JS가 먼저다', () => {
    const options = runtimeOptions(anywhere, context({ engineStates: ready }))
    expect(preferredRuntime(options)?.id).toBe('mljs')
  })

  it('순수 JS 구현이 없으면 다음 것으로 넘어간다', () => {
    const options = runtimeOptions(sklearnOnly, context({ engineStates: ready }))
    expect(preferredRuntime(options)?.id).toBe('pyodide-sklearn')
  })

  it('브라우저가 안 되면 서버로 넘어간다', () => {
    const options = runtimeOptions(
      anywhere,
      context({ serverStatus: 'available', rowCount: 999999 }),
    )
    expect(preferredRuntime(options)?.id).toBe('server-sklearn')
  })

  it('전부 안 되면 null이다', () => {
    expect(preferredRuntime(runtimeOptions(anywhere, context({ rowCount: 999999 })))).toBeNull()
  })
})

describe('파일에 남는 값', () => {
  it('실행 방법마다 computedBy와 engine.kind가 정해져 있다', () => {
    expect(RUNTIMES.map((runtime) => [runtime.id, runtime.location, runtime.engineKind])).toEqual([
      ['mljs', 'browser', 'mljs'],
      ['pyodide-sklearn', 'browser', 'pyodide-sklearn'],
      // 같은 sklearn이지만 WASM과 네이티브는 숫자가 갈린다. 그래서 실행 방법이 다르다.
      ['server-sklearn', 'server', 'sklearn'],
    ])
  })

  it('id가 겹치지 않는다', () => {
    expect(new Set(RUNTIMES.map((runtime) => runtime.id)).size).toBe(RUNTIMES.length)
  })
})
