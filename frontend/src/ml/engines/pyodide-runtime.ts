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
 * 실측 8.7초다. 상주 워커를 두지 않는 판단은 결정문에 있다.
 *
 * **모듈 상태가 워커 하나의 수명과 같다.** 학습은 워커에서만 돌기 때문이다.
 *
 * **그렇다고 이 모듈이 메인 번들 밖에 있는 것은 아니다** (2026-09-19 R29 C-4가 잡았다).
 * 점검 화면이 `ml/reproduce.ts`를 쓰고 그쪽이 `ml/engines`를 들여오므로 **이 파일은
 * 메인이 읽는 청크에 들어간다.** 해가 없는 이유는 **원격 `import()`가 `bootPyodide`
 * 안에만 있어서**다 — `prepare()`를 안 부르면 27.3MB는 한 바이트도 안 움직인다.
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
 * **새 학습은 이것으로 돈다. 재실행은 파일이 말하는 것으로 돈다** (결정문의 넷째 조항) —
 * 그래서 이 문자열은 *기본값*이지 유일한 값이 아니다.
 */
export const PYODIDE_VERSION = '314.0.7'

/**
 * 믿을 수 있는 배포판 이름인가. **못 믿으면 `null`이고 그때는 못 박은 것을 쓴다.**
 *
 * **이 값이 주소가 되고 그 주소를 `import()`가 부른다.** 그리고 이 값의 출처는 학생
 * 파일이다 — `.mlpx`는 교사와 학생이 서로 주고받는 것이 이 도구의 전제이고(CLAUDE.md
 * §1.3), Pyodide의 파이썬은 `import js`로 IndexedDB와 `fetch`에 닿는다. 어댑터의 손잡이
 * 문자열을 서술로 막은 것과 **같은 자리, 같은 이유**다(`pyodide-sklearn.ts`의
 * `formatHyperparameters`).
 *
 * 그래서 **숫자 셋만** 통과시킨다. `..`도, 슬래시도, 온전한 URL도, `latest`도 아니다.
 */
export function distributionVersion(value: string | undefined): string | null {
  return value !== undefined && /^\d+\.\d+\.\d+$/.test(value) ? value : null
}

/** 받는 곳. **원본이다** — 우리 산출물에는 이 27.3MB가 없다. */
export function indexUrlFor(version: string): string {
  return `https://cdn.jsdelivr.net/pyodide/v${version}/full/`
}

/** 못 박은 배포판의 주소. 감시 스크립트와 고지가 이것을 본다. */
export const PYODIDE_INDEX_URL = indexUrlFor(PYODIDE_VERSION)

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
   * **실제로 뜬 배포판.** 부른 것과 다를 수 있다 — 원본이 그 배포판을 더 안 서빙하면
   * 못 박은 것으로 한 번 더 부르기 때문이다(아래 `prepare`).
   *
   * 이 값이 `run.engine.version`이 된다 (결정문의 넷째 조항).
   */
  readonly version: string
  /**
   * 파이썬이 스스로 답한 버전들. **`pyodide` 칸만 우리가 적은 값이다**(아래 `json.dumps`) —
   * 나머지 넷은 물어본 값이다.
   *
   * 이 중 파이썬이 답한 넷이 `run.engine.packages`가 된다. **교사가 파일만 보고 sklearn이
   * 몇인지 알아야 하기 때문이다** — 배포판 이름은 CPython 버전이라 그 말을 안 한다.
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
export async function bootPyodide(
  onState?: (state: EngineState) => void,
  /**
   * 띄울 배포판. **부르는 쪽이 이미 걸러 온 값이어야 한다**(`distributionVersion`) —
   * 여기서 주소가 된다.
   */
  version: string = PYODIDE_VERSION,
): Promise<Boot> {
  const indexURL = indexUrlFor(version)
  const startedCore = now()
  /**
   * **주소로 부른다.** 번들러가 이것을 들여다보면 안 된다 — `@vite-ignore`가 없으면
   * vite가 빌드 시점에 풀려 들고, 그 순간 27MB가 우리 산출물의 문제가 된다.
   */
  const module = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as PyodideModule
  const py = await module.loadPyodide({ indexURL })
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
    "pyodide": "${version}",
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
    version,
    versions,
  }
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
 * 뜬 것. **`booting`이 끝나야 채워진다.**
 *
 * 부르는 쪽이 *"무엇으로 돌았나"*를 물을 자리이고(`bootedDistribution`), 그 답이
 * `run.engine`에 적힌다. **부른 것이 아니라 뜬 것이어야 한다** — 원본이 그 배포판을 더
 * 안 서빙하면 둘이 갈리고, 그때 파일에 부른 것을 적으면 **그 파일은 거짓말을 한다.**
 */
let booted: Boot | null = null

/**
 * 지금 워커에 떠 있는 배포판과 그것이 싣고 있는 것. **아직 안 떴으면 없다.**
 *
 * `packages`에서 `pyodide` 칸을 뺀다 — 그 값은 `version`과 같은 사실이고, **한 사실이 두
 * 자리에 있으면 다음 사람이 어느 쪽을 믿을지 고르게 된다.**
 */
export function bootedDistribution():
  { version: string; packages: Readonly<Record<string, string>> } | undefined {
  if (booted === null) return undefined
  const packages: Record<string, string> = {}
  for (const [name, value] of Object.entries(booted.versions)) {
    if (name !== 'pyodide') packages[name] = value
  }
  return { version: booted.version, packages }
}

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
   * 부르는 배포판. **파일이 말하는 것이다** — 재실행 대조가 준다(`ml/reproduce.ts`).
   *
   * 없거나 모양이 아니면 못 박은 것을 쓴다. 새 학습은 늘 이 자리가 비어 있다.
   */
  wanted?: string,
  /**
   * 띄우는 일 자체. **검사가 가짜를 넣으려고 있다** — 진짜는 27.3MB를 받으므로
   * 여기서 도는 것은 **상태의 순서와 실패의 모양**뿐이어야 한다.
   *
   * 앱은 이 인자를 안 준다 (`ml/engines/index.ts`가 `prepare` 하나만 등록한다).
   */
  boot: (onState?: (state: EngineState) => void, version?: string) => Promise<Boot> = bootPyodide,
): Promise<void> {
  if (booting !== null) {
    /**
     * **이미 떠 있다.** 그래도 상태는 알린다 — 화면이 이 run에서도 같은 순서를 본다.
     *
     * **부른 배포판이 달라도 다시 안 띄운다.** 워커 하나에 파이썬은 하나이고, 한 실험의
     * run들은 같은 세션에서 만들어져 같은 배포판을 말한다. 그래도 어긋날 수 있는데, 그때
     * 답은 **뜬 것을 파일에 적는 것**이다 — 부르는 쪽이 둘을 견주어 말한다
     * (`views/inspect/ReproducePanel.vue`).
     */
    onState?.('ready')
    await booting
    return
  }
  const asked = distributionVersion(wanted) ?? PYODIDE_VERSION
  onState?.('downloading')
  booting = attempt(boot, asked, onState)
  try {
    booted = await booting
  } catch (error) {
    // **실패를 기억하지 않는다.** 다음 학습은 다시 받아 본다.
    booting = null
    throw new ClientError('ENGINE_BOOT_FAILED', failureDetail(error))
  }
  onState?.('ready')
}

/**
 * 부른 배포판으로 띄우고, **안 되면 못 박은 것으로 한 번 더.**
 *
 * 원본이 옛 배포판을 영원히 서빙한다는 보장이 없고, 그때 교사에게 *"이 파일은 대조할 수
 * 없습니다"*라고 말하는 것은 **파일이 멀쩡한데 우리 사정으로 거절하는 것**이다. 다른
 * 배포판으로라도 돌리고 **그 사실을 말하는 편**이 낫다 (결정문의 넷째 조항).
 *
 * **못 박은 것을 부른 경우에는 다시 안 해 본다** — 같은 주소를 두 번 부르는 것뿐이다.
 */
async function attempt(
  boot: (onState?: (state: EngineState) => void, version?: string) => Promise<Boot>,
  asked: string,
  onState?: (state: EngineState) => void,
): Promise<Boot> {
  try {
    return await boot(onState, asked)
  } catch (error) {
    if (asked === PYODIDE_VERSION) throw error
    return await boot(onState, PYODIDE_VERSION)
  }
}

/** 테스트가 상태를 초기화할 때. 앱에서는 쓰지 않는다. */
export function resetPyodideRuntime(): void {
  booting = null
  booted = null
}
