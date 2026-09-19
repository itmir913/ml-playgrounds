/**
 * **scikit-learn을 띄우는 곳.** 어댑터(`pyodide-sklearn.ts`)는 *"이미 떠 있는 Pyodide에
 * sklearn 코드를 먹인다"*까지만 하고, 띄우는 일은 여기가 한다.
 *
 * **둘을 가르는 이유는 테스트다.** 어댑터의 `parameters`·`resolve`는 Pyodide 없이 돌고,
 * 여기는 브라우저에서 실물로 확인한다 (`tools/bench.html`의 [sklearn 시동만]).
 *
 * ## 아무것도 번들에 안 들어간다
 *
 * 27.3MB를 **원본이 서빙한다** — 주소로만 부르므로(`import(/* @vite-ignore *\/ …)`)
 * 빌드는 이것을 보지도 않는다. 백본 가중치와 같은 규칙이고 계산도 같다: 한 반 30명이면
 * 한 차시 820MB이고, 컴퓨터실 PC는 리셋을 전제라 캐시가 차시마다 사라진다
 * (`open-decisions.md` "scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다").
 *
 * ## 시동은 학습마다다
 *
 * **학습 워커는 학습마다 새로 뜨고 끝나면 죽는다**(취소가 `terminate` 하나여서 그렇다,
 * `architecture.md` §3.4). 그러므로 아래 `prepare()`는 **워커마다 한 번** 불리고, 그 값이
 * 실측 7.7초다. 상주 워커를 두지 않는 판단은 결정문에 있다.
 *
 * **모듈 상태가 워커 하나의 수명과 같다.** 메인 스레드에서는 이 모듈이 로드될 일이
 * 없고(학습은 워커에서만 돈다), 혹시 로드되더라도 `prepare()`를 안 부르면 아무 일도
 * 일어나지 않는다.
 */

import { ClientError, failureDetail } from '../../errors'
import type { EngineState } from '../backend'
import { setPyodide, type PyodideProxy } from './pyodide-sklearn'

/**
 * 못 박은 배포판. **`v` 접두사는 주소에만 붙는다.**
 *
 * Pyodide는 2026년에 버전 체계를 바꿨다 — `0.x`가 아니라 **싣고 있는 CPython**이 이름이다
 * (`314.0.7` = CPython 3.14.2). 그래서 이 문자열 하나가 파이썬·numpy·scipy·sklearn 버전을
 * 전부 정한다.
 *
 * **이 배포판이 싣고 있는 것은 sklearn 1.8.0 · numpy 2.4.6 · scipy 1.18.0이고, 그것은
 * 우리가 적은 말이 아니라 `pyodide-lock.json`이 말하는 것이다** —
 * `scripts/fetch-pyodide.mjs`가 원본의 락 파일을 받아 대조하므로, 원격이 조용히 바뀌면
 * 학생이 아니라 **CI가 먼저 운다.**
 *
 * **`run.engine.version`과 다른 값이다.** 저쪽은 파일에 남아 재실행 대조의 열쇠가 되고,
 * 이쪽은 *지금 새 학습이 무엇으로 도는가*다 (결정문의 마지막 조항).
 */
export const PYODIDE_VERSION = '314.0.7'

/** 받는 곳. **원본이다** — 우리 산출물에는 이 27.3MB가 없다. */
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

/**
 * 부를 것. **의존성은 Pyodide가 따라온다** — sklearn 하나를 부르면 joblib·numpy·scipy·
 * threadpoolctl이 함께 온다(실측으로 확인했다).
 */
export const PYODIDE_PACKAGES = ['scikit-learn'] as const

/**
 * 시동의 네 국면. **하나로 뭉치면 어디를 고칠지 못 고른다.**
 *
 * 2026-08-04의 15.4초가 *"코어 2.9 + 휠 3.9 + 첫 `import sklearn` 8.6"*이었고, 셋 중
 * 마지막이 압도적이라는 사실이 그때의 판단을 만들었다. 갈라 재지 않으면 오늘의 값이
 * 그때보다 나아졌는지를 말할 수 없다.
 *
 * **`interface`가 아니라 `type`이다.** 인터페이스에는 암묵 인덱스 서명이 안 붙어서
 * `Record<string, number>`(하니스가 국면을 싣는 칸)에 대입이 안 된다.
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

/** Pyodide에서 우리가 더 쓰는 것. 어댑터의 계약(`PyodideProxy`)에 부팅용 하나를 얹는다. */
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
 * Pyodide를 띄우고 **어댑터에 꽂는다** (`setPyodide`).
 *
 * **국면마다 걸린 시간을 돌려준다.** 앱은 그 값을 안 쓰고 실측 하니스가 쓴다 — 앱이 쓰는
 * 것은 아래 `prepare()`이고, 그쪽은 시간 대신 **상태**를 흘린다.
 */
export async function bootPyodide(onState?: (state: EngineState) => void): Promise<Boot> {
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
  // **여기가 "바이트는 다 왔다"는 자리다.** 남은 것은 순수 CPU이고, 그 둘을 한 상태로
  // 뭉치면 학생이 보는 문장이 받는 동안과 푸는 동안 내내 같아진다.
  onState?.('downloaded')

  /**
   * **여기서 미리 `import sklearn`을 지난다.** 안 하면 이 4초가 첫 모델의 학습 시간으로
   * 들어간다 — 학생에게는 *"준비가 끝났다는데 왜 또 기다리지"*이고, 기준표에는 첫 점만
   * 조용히 부푼 값이 남는다.
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
   * 온다(같은 날 확인). 어댑터가 쓰는 것이 그 셋이라 **어댑터는 손댈 데가 없었다.**
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
  return { parts: { core, packages, imports, total: core + packages + imports }, versions }
}

/**
 * **이 워커에서 한 번만 띄운다.** 두 번째 sklearn 모델은 기다리지 않는다.
 *
 * 약속을 들고 있는 이유는 **모델 둘이 동시에 부를 수 있어서가 아니다**(실험은 모델을
 * 하나씩 돈다). 그래도 약속으로 두는 것은 값이 거의 안 들고, **실패도 함께 기억하면
 * 안 되기 때문**에 실패하면 지운다 — 회선이 잠깐 끊겼을 때 그 워커가 영원히 못 쓰게
 * 되는 것은 학생이 이해할 수 없는 상태다.
 */
let booting: Promise<Boot> | null = null

/**
 * 학습 전에 엔진을 준비한다. **이미 준비됐으면 상태만 알리고 곧장 돌아온다.**
 *
 * **상태는 넷이 아니라 셋만 흐른다** — `absent`는 *아직 아무 일도 안 일어난 것*이라
 * 알릴 것이 없다. `downloading`(받는 중) → `downloaded`(바이트는 왔다) →
 * `ready`(`import sklearn`까지 끝났다).
 *
 * **비율(fraction)은 안 준다.** `loadPyodide`도 `loadPackage`도 받은 양을 안 알려 준다 —
 * **모르는 것을 지어내면 진행 막대가 거짓말을 한다.** 백본은 TF.js가 알려 줘서 주는 것이고
 * (`ml/embed/runner.ts`), 여기는 사정이 다르다.
 *
 * **실패는 `ENGINE_BOOT_FAILED`다.** 학교망이 CDN을 막는 것이 가장 흔한 실패이고,
 * 그때 학생이 할 일은 순수 JS로 돌리는 것이지 다시 누르는 것이 아니다.
 * (`ENGINE_UNAVAILABLE`은 **재현 판정의 어휘**이고 이것과 다른 물건이다.)
 */
export async function prepare(
  onState?: (state: EngineState, fraction?: number) => void,
  /**
   * 띄우는 일 자체. **검사가 가짜를 넣으려고 있다** — 진짜는 27.3MB를 받으므로
   * 여기서 도는 것은 **상태의 순서와 실패의 모양**뿐이어야 한다.
   *
   * 앱은 이 인자를 안 준다 (`ml/engines/index.ts`가 `prepare` 하나만 등록한다).
   */
  boot: (onState?: (state: EngineState) => void) => Promise<Boot> = bootPyodide,
): Promise<void> {
  if (booting !== null) {
    // **이미 떠 있다.** 그래도 상태는 알린다 — 화면이 이 run에서도 같은 순서를 본다.
    onState?.('ready')
    await booting
    return
  }
  onState?.('downloading')
  booting = boot(onState)
  try {
    await booting
  } catch (error) {
    // **실패를 기억하지 않는다.** 다음 학습은 다시 받아 본다.
    booting = null
    throw new ClientError('ENGINE_BOOT_FAILED', failureDetail(error))
  }
  onState?.('ready')
}

/** 테스트가 상태를 초기화할 때. 앱에서는 쓰지 않는다. */
export function resetPyodideRuntime(): void {
  booting = null
}
