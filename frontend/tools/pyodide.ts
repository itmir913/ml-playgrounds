/**
 * **실측 하니스가 scikit-learn을 띄우는 곳.**
 *
 * 어댑터(`src/ml/engines/pyodide-sklearn.ts`)는 *"이미 떠 있는 Pyodide에 sklearn 코드를
 * 먹인다"*까지만 하고, **띄우는 코드는 저장소에 아직 없다**(로드맵 "Pyodide 워커 배선").
 * 그 첫 구현이 여기다 — 앱보다 하니스가 먼저 띄우는 이유는 **띄우는 값이 얼마인지를
 * 모르면 앱의 모양을 못 정하기 때문이다**(학습마다 낼 것인가, 상주시킬 것인가).
 *
 * **여기 있는 것은 임시 거처다.** 배선이 붙는 날 버전 못과 로더는 `src/`로 옮기고 이
 * 파일은 그것을 가져다 쓴다 — 못이 두 군데 살면 하니스가 A를 재고 학생이 B를 받는다
 * (`scripts/fetch-backbone.mjs`가 백본에서 같은 위험을 지키는 방식).
 *
 * **아무것도 번들에 안 들어간다.** 주소로만 부르므로(`import(/* @vite-ignore *\/ …)`)
 * 빌드는 이 27MB를 보지도 않는다. 백본 가중치와 같은 규칙이다 — 큰 것은 원본이 서빙하고
 * 우리는 주소만 갖는다 (CLAUDE.md §2).
 */

import { setPyodide, type PyodideProxy } from '../src/ml/engines/pyodide-sklearn'

/**
 * 못 박은 배포판. **`v` 접두사는 주소에만 붙는다.**
 *
 * Pyodide는 2026년에 버전 체계를 바꿨다 — `0.x`가 아니라 **싣고 있는 CPython**이 이름이다
 * (`314.0.7` = CPython 3.14). 그래서 이 문자열 하나가 파이썬·numpy·scipy·sklearn 버전을
 * 전부 정한다. 이 배포판이 싣고 있는 것은 **sklearn 1.8.0 · numpy 2.4.6 · scipy 1.18.0**이고,
 * 그 셋은 `bootPyodide()`가 실제로 물어보므로 여기 적힌 것이 틀리면 실측 JSON이 다른 답을
 * 들고 온다 (사람 확인).
 */
export const PYODIDE_VERSION = '314.0.7'

/** 받는 곳. **원본이다** — 우리 산출물에는 이 27MB가 없다. */
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

/**
 * 부를 것. **의존성은 Pyodide가 따라온다** — sklearn 하나를 부르면 joblib·numpy·scipy·
 * threadpoolctl이 함께 온다(실측으로 확인했다, 2026-09-19).
 */
export const PYODIDE_PACKAGES = ['scikit-learn'] as const

/**
 * 시동의 네 국면. **하나로 뭉치면 어디를 고칠지 못 고른다.**
 *
 * 2026-08-04의 15.4초가 *"코어 2.9 + 휠 3.9 + 첫 `import sklearn` 8.6"*이었고, 셋 중
 * 마지막이 압도적이라는 사실이 그때의 판단(무거운 엔진은 켜는 자리를 따로 둔다)을 만들었다.
 * 그 셋을 다시 갈라 재지 않으면 오늘의 값이 그때보다 나아졌는지를 말할 수 없다.
 */
/**
 * **`interface`가 아니라 `type`이다.** 인터페이스에는 암묵 인덱스 서명이 안 붙어서
 * `Record<string, number>`(하니스가 국면을 싣는 칸)에 대입이 안 된다. 국면을 하나
 * 더하려고 이 모양을 흔들지 마라 — 칸 이름은 여기 넷이 전부다.
 */
export type BootParts = {
  /** `loadPyodide()` — WASM을 받아 파이썬을 세우기까지. */
  readonly core: number
  /** `loadPackage('scikit-learn')` — 휠 다섯을 받아 푸는 데까지. */
  readonly packages: number
  /** 첫 `import sklearn` — 순수 CPU다. **캐시가 절대 못 지우는 항목이 이것이다.** */
  readonly imports: number
  /** 위 셋의 합. 학생이 [학습하기]를 누르고 계산이 시작되기까지 기다리는 시간이다. */
  readonly total: number
}

export interface Boot {
  readonly parts: BootParts
  /**
   * 파이썬이 스스로 답한 버전들. **우리가 적은 것이 아니라 물어본 것이다.**
   *
   * `run.engine.version`에 무엇을 담을지가 이 값에 걸려 있다 — 재실행 대조는 버전이
   * 정확히 같을 때만 판정하므로(`ml/reproduce.ts`의 `engineIsHere`), 담는 순간 이 문자열이
   * 파일에 남는 계약이 된다.
   */
  readonly versions: Readonly<Record<string, string>>
}

/** Pyodide에서 우리가 더 쓰는 것. 어댑터의 계약(`PyodideProxy`)에 부팅용 둘을 얹는다. */
interface BootablePyodide extends PyodideProxy {
  loadPackage(names: readonly string[] | string): Promise<unknown>
}

/** 원격 모듈이 돌려주는 것. **타입이 없는 경계라 여기서 한 번만 좁힌다.** */
interface PyodideModule {
  loadPyodide(options: { indexURL: string }): Promise<BootablePyodide>
}

const now = (): number => performance.now()
const since = (started: number): number => Math.round(now() - started)

/**
 * Pyodide를 띄우고 **앱의 어댑터에 꽂는다**.
 *
 * **어댑터에 꽂는 것이 요점이다** (`setPyodide`). 하니스가 sklearn을 직접 부르면 재는 것이
 * 앱의 경로가 아니게 되고, 그건 교정 일감이 한동안 앓던 병이다 — 목록만 같고 절차가 갈려
 * 있었다(감사 B-4). 여기서 꽂아 두면 사다리의 `fit`이 **학생이 지나갈 그 코드**다.
 *
 * **점 하나마다 새 워커이므로 이 함수는 워커당 한 번 불린다** (`bench.ts`의 `runInWorker`).
 * 앱의 학습도 워커마다 새로 뜨므로 모양이 같다.
 */
export async function bootPyodide(): Promise<Boot> {
  const startedCore = now()
  /**
   * **주소로 부른다.** 번들러가 이것을 들여다보면 안 된다 — `@vite-ignore`가 없으면
   * vite가 빌드 시점에 풀려 들고, 그 순간 27MB가 우리 산출물의 문제가 된다.
   */
  const module = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`
  )) as PyodideModule
  const py = await module.loadPyodide({ indexURL: PYODIDE_INDEX_URL })
  const core = since(startedCore)

  const startedPackages = now()
  await py.loadPackage(PYODIDE_PACKAGES)
  const packages = since(startedPackages)

  /**
   * **여기서 미리 `import sklearn`을 지난다.** 안 하면 이 8초가 첫 사다리 점의 학습
   * 시간으로 들어가고, 그러면 **기준표의 첫 점만 조용히 부풀어** 행 수 보간이 거짓말을 한다.
   *
   * **`runPython`을 쓰는 것은 어댑터가 그것을 쓰기 때문이다** (`runPythonAsync`가 아니다).
   */
  const startedImports = now()
  py.runPython('import sklearn')
  const imports = since(startedImports)

  /**
   * **파이썬이 JSON 문자열로 답한다.** `toJs()`를 거치지 않는다 — **이 배포판의
   * `dict.toJs()`는 `Map`이 아니라 평범한 객체를 준다**(2026-09-19에 브라우저에서 확인했다.
   * `Object.fromEntries`가 *"object is not iterable"*로 터졌다). 사전의 변환 규칙은
   * 배포판마다 갈리는 자리라, 여기서는 **양쪽 다 흔들리지 않는 통로**를 쓴다.
   *
   * **리스트는 안 그렇다** — `_predictions`·`_assignments`·`_centroids`가 전부 배열로
   * 온다(같은 날 확인). 어댑터가 쓰는 것이 그 셋이라 **어댑터는 손댈 데가 없다.**
   */
  const versions = JSON.parse(
    String(
      py.runPython(`
import json, sklearn, numpy, scipy, sys
json.dumps({
    "python": sys.version.split()[0],
    "pyodide": "${PYODIDE_VERSION}",
    "scikit-learn": sklearn.__version__,
    "numpy": numpy.__version__,
    "scipy": scipy.__version__,
})
`),
    ),
  ) as Record<string, string>

  setPyodide(py)
  return {
    parts: { core, packages, imports, total: core + packages + imports },
    versions,
  }
}
