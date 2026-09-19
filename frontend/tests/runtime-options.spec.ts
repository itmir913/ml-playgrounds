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
const noBaseline = {
  tabular: { mljs: UNMEASURED_BASELINE, 'pyodide-sklearn': UNMEASURED_BASELINE },
  image: { mljs: UNMEASURED_BASELINE, 'pyodide-sklearn': UNMEASURED_BASELINE },
} as const

/** 재현 판정도 안 쟀다. 여기서 확인하는 것은 실행 방법 판정이다. */
const noReproduction = {
  mljs: 'unmeasured',
  'pyodide-sklearn': 'unmeasured',
  sklearn: 'unmeasured',
} as const

/** 셋 다 도는 알고리즘. 결정트리가 그렇다. */
const anywhere: AlgorithmSpec = {
  id: 'decision_tree',
  runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
  maxRows: unmeasured,
  baseline: noBaseline,
  reproduction: noReproduction,
}

/** 무거워서 서버에서만 도는 것. */
const serverOnly: AlgorithmSpec = {
  id: 'gradient_boosting',
  runtimes: { mljs: false, 'pyodide-sklearn': false, 'server-sklearn': true },
  maxRows: unmeasured,
  baseline: noBaseline,
  reproduction: noReproduction,
}

/** 순수 JS 구현이 없어 sklearn에서만 도는 것. */
const sklearnOnly: AlgorithmSpec = {
  id: 'svm',
  runtimes: { mljs: false, 'pyodide-sklearn': true, 'server-sklearn': true },
  maxRows: unmeasured,
  baseline: noBaseline,
  reproduction: noReproduction,
}

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    serverStatus: 'unavailable',
    rowCount: 100,
    dataType: 'tabular',
    limitsOff: false,
    ...overrides,
  }
}

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
      runtimeOptions(anywhere, context({ serverStatus: 'available' })),
    ]
    for (const options of cases) {
      for (const option of options) {
        if (!option.enabled) expect(option.reason, JSON.stringify(option)).toBeDefined()
      }
    }
  })
})

describe('무거운 엔진은 잠그지 않고 비용을 말한다', () => {
  /**
   * **2026-09-19에 뒤집었다.** 이 자리에는 *"받아 놓지 않았으면 잠근다"*는 규칙이 있었고,
   * 사유가 `ENGINE_NOT_READY`("준비하면 된다") 또는 `ENGINE_NOT_WIRED`("아직 못 켠다")로
   * 갈렸다. **켜는 자리를 안 만들기로 하면서 그 잠금은 열리지 않는 문이 됐다** —
   * 지금은 [학습하기]가 그 run 앞에서 준비를 선행한다 (`open-decisions.md`
   * "scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다").
   */
  it('안 받아 놨어도 고를 수 있다', () => {
    const options = runtimeOptions(anywhere, context())
    expect(optionFor(options, 'pyodide-sklearn')).toEqual({
      runtime: RUNTIMES[1],
      enabled: true,
      // 잠기지 않아도 상한은 붙는다 - "얼마까지 되나"는 고르기 전에도 묻는 질문이다.
      maxRows: BROWSER_ROW_LIMIT,
    })
  })

  /**
   * **대신 무엇이 드는지는 등록부가 들고 있다.** 화면이 그 값을 읽어 고르기 전에
   * 알린다 — 잠그는 것과 알리는 것은 다른 일이다. **수를 화면 문구에 적지 않는다**:
   * 실측이 번역 파일에 살면 다시 잰 날 그 파일을 고치게 된다.
   */
  it('무거운 엔진은 무엇이 드는지 선언한다', () => {
    const heavy = RUNTIMES.filter((runtime) => runtime.preparation !== undefined)
    expect(heavy.map((runtime) => runtime.id)).toEqual(['pyodide-sklearn'])
    for (const runtime of heavy) {
      expect(runtime.preparation?.bytes).toBeGreaterThan(0)
      expect(runtime.preparation?.ms).toBeGreaterThan(0)
    }
  })

  it('순수 JS와 서버는 준비 칸이 없다', () => {
    for (const id of ['mljs', 'server-sklearn'] as const) {
      expect(RUNTIMES.find((runtime) => runtime.id === id)?.preparation).toBeUndefined()
    }
  })

  it('준비와 무관하게 나머지도 그대로 열린다', () => {
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
    const options = runtimeOptions(uneven, context({ rowCount: 500 }))
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
    const context4x = context({ rowCount: BROWSER_ROW_LIMIT * 2 })
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
    const options = runtimeOptions(anywhere, context())
    expect(preferredRuntime(options)?.id).toBe('mljs')
  })

  it('순수 JS 구현이 없으면 다음 것으로 넘어간다', () => {
    const options = runtimeOptions(sklearnOnly, context())
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

/**
 * **상한을 끄면 이 한 곳이 연다** (`limits-switch.ts`, `open-decisions.md` "상한은 누가
 * 정했느냐" §2).
 *
 * 등록부의 값을 `Infinity`로 바꾸는 대신 **판정하는 자리에서** 끄기로 했다. 그래서
 * 여기서 볼 것이 셋이다 — 열리는가, **다른 잠금까지 열지는 않는가**, 그리고 상한이 몇인지
 * 여전히 말하는가.
 *
 * **이 판정은 워커에서도 돈다** (`ml/experiment.ts`). 그래서 스위치가 모듈이 아니라
 * `RuntimeContext`의 값으로 실려 온다 — 메인만 풀면 카드는 열리는데 워커가 그 자리에서
 * 실패시킨다.
 */
describe('상한을 끄면 행 상한만 열린다', () => {
  const tooBig = { rowCount: BROWSER_ROW_LIMIT * 10, dataType: 'tabular' } as const

  it('꺼져 있으면 그대로 막는다 - 기본값이 안전한 쪽이다', () => {
    const options = runtimeOptions(anywhere, context({ ...tooBig, limitsOff: false }))
    expect(optionFor(options, 'mljs')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('켜면 상한을 넘겨도 열린다', () => {
    const options = runtimeOptions(anywhere, context({ ...tooBig, limitsOff: true }))
    expect(optionFor(options, 'mljs')?.enabled).toBe(true)
  })

  /**
   * **상한을 껐다고 상한이 사라지지는 않는다.** 화면은 여전히 "이 알고리즘은 N행까지"를
   * 말할 수 있어야 한다 — 등록부의 값을 `Infinity`로 바꾸지 않고 판정만 건너뛰는 이유가
   * 이것이다.
   */
  it('켜도 그 칸의 상한은 그대로 말한다', () => {
    const options = runtimeOptions(anywhere, context({ ...tooBig, limitsOff: true }))
    expect(optionFor(options, 'mljs')?.maxRows).toBe(BROWSER_ROW_LIMIT)
  })

  /**
   * **스위치가 여는 것은 우리 기기가 정한 줄뿐이다** (결정문 §2). 서버가 없는 것은 기기가
   * 빨라져도 안 바뀌는 사실이라, 켠다고 열리면 안 된다.
   *
   * **엔진 쪽 짝은 없어졌다** (2026-09-19). 여기에는 *"엔진이 안 왔으면 켜도 안 열린다"*가
   * 나란히 있었는데, **무거운 엔진을 잠그지 않기로 하면서 잠길 일 자체가 없다.**
   */

  it('서버가 없으면 켜도 안 열린다', () => {
    const options = runtimeOptions(
      anywhere,
      context({ ...tooBig, limitsOff: true, serverStatus: 'unavailable' }),
    )
    expect(optionFor(options, 'server-sklearn')?.reason).toBe('SERVER_UNAVAILABLE')
  })
})
