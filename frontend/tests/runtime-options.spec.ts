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
  BROWSER_RUNTIME_IDS,
  RUNTIMES,
  UNMEASURED,
  UNMEASURED_BASELINE,
  type AlgorithmSpec,
  type EngineState,
  type RuntimeContext,
  preferredRuntime,
  runtimeOptions,
} from '../src/ml/backend'

/**
 * 상한을 안 재 본 칸들. **표본이 전역 기본값을 따르게 둔다** - 여기서 확인하는 것은
 * 판정 규칙이고, 실측값은 등록부의 사실이라 바뀐다.
 */
const unmeasured = {
  tabular: { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED },
  image: { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED },
} as const

/** 표본은 시간도 안 쟀다. 빈 표는 예상을 못 낸다는 뜻이다. */
const noBaseline = { tabular: UNMEASURED_BASELINE, image: UNMEASURED_BASELINE } as const

/** 셋 다 도는 알고리즘. 결정트리가 그렇다. */
const anywhere: AlgorithmSpec = {
  id: 'decision_tree',
  runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
  maxRows: unmeasured,
  baseline: noBaseline,
}

/** 무거워서 서버에서만 도는 것. */
const serverOnly: AlgorithmSpec = {
  id: 'gradient_boosting',
  runtimes: { mljs: false, 'pyodide-sklearn': false, 'server-sklearn': true },
  maxRows: unmeasured,
  baseline: noBaseline,
}

/** 순수 JS 구현이 없어 sklearn에서만 도는 것. */
const sklearnOnly: AlgorithmSpec = {
  id: 'svm',
  runtimes: { mljs: false, 'pyodide-sklearn': true, 'server-sklearn': true },
  maxRows: unmeasured,
  baseline: noBaseline,
}

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return { serverStatus: 'unavailable', rowCount: 100, dataType: 'tabular', ...overrides }
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
      runtimeOptions(
        sklearnOnly,
        context({ serverStatus: 'unknown', rowCount: 999999, dataType: 'tabular' }),
      ),
      runtimeOptions(anywhere, context({ serverStatus: 'available', engineStates: ready })),
    ]
    for (const options of cases) {
      for (const option of options) {
        if (!option.enabled) expect(option.reason, JSON.stringify(option)).toBeDefined()
      }
    }
  })
})

/**
 * 켜는 자리가 화면에 있는 등록부. **지금 실제 등록부에는 그런 칸이 없다** —
 * `pyodide-sklearn`의 배선이 아직 없어서다 (`roadmap/01-v1-v5.md`). 그래서
 * `ENGINE_NOT_READY`("준비하면 된다") 쪽 규칙은 이 판으로 확인한다. 배선이 붙는 날
 * 등록부가 이 모양이 되고, 이 픽스처는 사라진다.
 */
const preparableRuntimes = RUNTIMES.map((runtime) =>
  runtime.id === 'pyodide-sklearn' ? { ...runtime, preparable: true } : runtime,
)

describe('엔진 준비 상태', () => {
  /**
   * **켤 자리가 없으면 "준비하면 된다"고 말하지 않는다** (2026-08-29 전 경로 감사).
   * 그 문장은 학생을 없는 문으로 보낸다.
   */
  it('켜는 자리가 없는 엔진은 ENGINE_NOT_WIRED로 잠긴다', () => {
    const options = runtimeOptions(anywhere, context())
    expect(optionFor(options, 'pyodide-sklearn')).toEqual({
      runtime: RUNTIMES[1],
      enabled: false,
      reason: 'ENGINE_NOT_WIRED',
      // 잠긴 칸에도 상한이 붙는다 - "얼마까지 되나"는 잠기기 전에도 묻는 질문이다.
      maxRows: BROWSER_ROW_LIMIT,
    })
  })

  it('켜는 자리가 있으면 ENGINE_NOT_READY로 잠긴다', () => {
    const options = runtimeOptions(anywhere, context(), preparableRuntimes)
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('ENGINE_NOT_READY')
  })

  it('준비되면 열린다', () => {
    const options = runtimeOptions(anywhere, context({ engineStates: ready }))
    expect(optionFor(options, 'pyodide-sklearn')?.enabled).toBe(true)
  })

  it('내려받기만 끝난 상태는 아직 준비가 아니다 - 시동 15초가 남아 있다', () => {
    const states: Record<string, EngineState> = { 'pyodide-sklearn': 'downloaded' }
    const options = runtimeOptions(anywhere, context({ engineStates: states }), preparableRuntimes)
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
      context({
        serverStatus: 'available',
        rowCount: BROWSER_ROW_LIMIT + 1,
        dataType: 'tabular',
        engineStates: ready,
      }),
    )
    expect(optionFor(options, 'mljs')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
    expect(optionFor(options, 'server-sklearn')?.enabled).toBe(true)
  })

  /**
   * **막힌 이유는 같지만 학생이 할 일이 다르다.** 표는 전처리에서 일부만 뽑고, 이미지는
   * 데이터 단계에서 사진을 지운다 — 한 문장으로 쓰면 한쪽은 없는 카드를 찾는다.
   */
  it('이미지에서는 사진으로 말한다', () => {
    const options = runtimeOptions(
      anywhere,
      context({ rowCount: BROWSER_ROW_LIMIT + 1, dataType: 'image' }),
    )
    expect(optionFor(options, 'mljs')?.reason).toBe('IMAGE_TOO_LARGE_FOR_BROWSER')
  })

  it('크기가 준비 상태보다 앞선다 - 엔진을 준비해도 소용없는 상황이다', () => {
    const options = runtimeOptions(anywhere, context({ rowCount: BROWSER_ROW_LIMIT + 1 }))
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('상한 자체는 허용한다', () => {
    const options = runtimeOptions(anywhere, context({ rowCount: BROWSER_ROW_LIMIT }))
    expect(optionFor(options, 'mljs')?.enabled).toBe(true)
  })

  it('같은 알고리즘이라도 구현마다 상한이 다르다', () => {
    // **이것이 (알고리즘 × 구현)이라는 말의 실체다** (open-decisions.md #13).
    // 같은 결정 트리인데 순수 JS는 O(특성 × 행²)이고 sklearn은 아니다.
    const uneven: AlgorithmSpec = {
      ...anywhere,
      maxRows: {
        tabular: { mljs: 100, 'pyodide-sklearn': 1000 },
        image: { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED },
      },
    }
    const options = runtimeOptions(uneven, context({ rowCount: 500, engineStates: ready }))
    expect(optionFor(options, 'mljs')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
    expect(optionFor(options, 'pyodide-sklearn')?.enabled).toBe(true)
  })

  it('같은 알고리즘·같은 구현이라도 데이터 종류마다 상한이 다르다', () => {
    // **사진 한 장이 1,280차원이라 같은 행 수가 같은 시간이 아니다** (open-decisions.md
    // #13의 "이미지의 상한"). 표에서 도는 크기가 이미지에서 16분이 되는 것이 결정 트리다.
    const uneven: AlgorithmSpec = {
      ...anywhere,
      maxRows: {
        tabular: { mljs: 1000, 'pyodide-sklearn': UNMEASURED },
        image: { mljs: 100, 'pyodide-sklearn': UNMEASURED },
      },
    }
    const rowCount = 500
    expect(optionFor(runtimeOptions(uneven, context({ rowCount })), 'mljs')?.enabled).toBe(true)

    const asImage = runtimeOptions(uneven, context({ rowCount, dataType: 'image' }))
    expect(optionFor(asImage, 'mljs')?.reason).toBe('IMAGE_TOO_LARGE_FOR_BROWSER')
    // **사유 문장의 숫자도 그 칸의 것이어야 한다** - 표의 1000을 말하면 학생은 지우지
    // 않아도 될 사진을 지운다.
    expect(optionFor(asImage, 'mljs')?.maxRows).toBe(100)
  })

  it('안 재 본 칸은 전역 기본값을 따른다 - 보수적으로 틀린다', () => {
    const partly: AlgorithmSpec = {
      ...anywhere,
      maxRows: {
        tabular: { mljs: BROWSER_ROW_LIMIT * 4, 'pyodide-sklearn': UNMEASURED },
        image: { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED },
      },
    }
    const context4x = context({ rowCount: BROWSER_ROW_LIMIT * 2, engineStates: ready })
    const options = runtimeOptions(partly, context4x)
    // 재서 얻은 값이 전역보다 높아도 그대로 이긴다. 이 방향이 뒤집힌 것이 이번 변경이다.
    expect(optionFor(options, 'mljs')?.enabled).toBe(true)
    expect(optionFor(options, 'pyodide-sklearn')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('서버 칸에는 상한이 걸리지 않는다 - 그 숫자는 협상이 준다', () => {
    // 등록부에 서버 칸이 없다는 것을 타입이 지키고, 판정이 서버를 건너뛴다는 것을
    // 여기가 지킨다 (open-decisions.md "서버의 상한은 등록부에 없다").
    const options = runtimeOptions(
      anywhere,
      context({ serverStatus: 'available', rowCount: 10_000_000, dataType: 'tabular' }),
    )
    const server = optionFor(options, 'server-sklearn')
    expect(server?.enabled).toBe(true)
    expect(server?.maxRows).toBeUndefined()
  })

  it('브라우저 실행 방법 목록이 RUNTIMES와 어긋나지 않는다', () => {
    // 어긋나면 등록부가 칸을 가진 실행 방법과 판정이 상한을 보는 실행 방법이 갈리고,
    // 새 브라우저 엔진의 상한이 조용히 무시된다. 타입은 이걸 못 잡는다.
    expect([...BROWSER_RUNTIME_IDS]).toEqual(
      RUNTIMES.filter((runtime) => runtime.location === 'browser').map((runtime) => runtime.id),
    )
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
      context({ serverStatus: 'available', rowCount: 999999, dataType: 'tabular' }),
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
