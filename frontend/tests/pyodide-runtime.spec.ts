/**
 * **scikit-learn을 띄우는 경로의 규칙** (`src/ml/engines/pyodide-runtime.ts`).
 *
 * **여기서 진짜로 띄우지 않는다.** 27.3MB를 받는 일이라 검사가 돌릴 수 있는 것이 아니고,
 * 실물 확인은 브라우저에서 한다(`tools/bench.html`의 [sklearn 시동만]). 그래서 이 파일이
 * 보는 것은 셋이다 — **버전 못이 여러 곳에서 같은 말을 하는가**, **상태가 어떤 순서로
 * 흐르는가**, **실패가 어떤 모양인가**.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, beforeEach } from 'vitest'

import { isClientError } from '../src/errors'
import type { EngineState } from '../src/ml/backend'
import { ENGINES } from '../src/ml/engines'
import {
  PYODIDE_INDEX_URL,
  PYODIDE_PACKAGES,
  PYODIDE_VERSION,
  bootedDistribution,
  distributionVersion,
  indexUrlFor,
  prepare,
  resetPyodideRuntime,
  type Boot,
} from '../src/ml/engines/pyodide-runtime'
import { RUNTIMES as NOTICE_RUNTIMES } from '../scripts/notices'

const ROOT = join(__dirname, '..')

/** 아무것도 안 받고 성공한 척한다. 재는 것은 순서이지 시간이 아니다. */
const fakeBoot =
  (log: EngineState[]) =>
  async (onState?: (state: EngineState) => void, version = PYODIDE_VERSION): Promise<Boot> => {
    onState?.('downloaded')
    log.push('downloaded')
    return {
      parts: { core: 1, packages: 1, imports: 1, total: 3 },
      version,
      versions: { pyodide: version, 'scikit-learn': '1.8.0' },
    }
  }

/** 아무것도 안 받고 성공한 척한다. 버전만 세는 자리에서 쓴다. */
const bootOf = (version: string): Boot => ({
  parts: { core: 0, packages: 0, imports: 0, total: 0 },
  version,
  versions: { pyodide: version },
})

describe('버전 못은 한 말만 한다', () => {
  /**
   * **세 곳이 같은 배포판을 가리켜야 한다.** 갈리면 **우리는 A를 감시하고 학생은 B를
   * 받는다** — 감시 스크립트는 `.mjs`라 타입스크립트를 못 들여오고, 고지 목록은 vite
   * 설정이 무는 파일이라 `src/`를 못 들여온다. 둘 다 베낀 값이고, 베낀 값은 이런 검사가
   * 없으면 반드시 어긋난다 (`tests/backbones.spec.ts`가 백본에서 같은 일을 한다).
   */
  it('감시 스크립트가 같은 버전을 본다', () => {
    const script = readFileSync(join(ROOT, 'scripts', 'fetch-pyodide.mjs'), 'utf-8')
    const said = /const VERSION = '([^']+)'/.exec(script)?.[1]
    expect(said, 'fetch-pyodide.mjs no longer declares VERSION').toBeDefined()
    expect(said).toBe(PYODIDE_VERSION)
  })

  it('고지가 같은 버전을 적는다', () => {
    const said = NOTICE_RUNTIMES.map((one) => `${one.id} ${one.url}`).join(' ')
    expect(said).toContain(PYODIDE_VERSION)
    for (const runtime of NOTICE_RUNTIMES) {
      expect(runtime.url).toContain(`/v${PYODIDE_VERSION}/`)
    }
  })

  /**
   * **주소가 버전을 담는다.** 담지 않으면 못이 있어도 받는 것이 안 고정된다 — `latest`를
   * 가리키는 주소는 **어제 만든 학생 파일과 오늘 만든 파일이 다른 엔진으로 돌게** 한다.
   */
  it('받는 주소에 버전이 박혀 있다', () => {
    expect(PYODIDE_INDEX_URL).toContain(`/v${PYODIDE_VERSION}/`)
    expect(PYODIDE_INDEX_URL.endsWith('/')).toBe(true)
  })

  /** 부르는 것은 sklearn 하나다. 나머지는 Pyodide가 따라 붙인다(실측으로 확인). */
  it('부를 것이 sklearn 하나다', () => {
    expect([...PYODIDE_PACKAGES]).toEqual(['scikit-learn'])
  })
})

describe('준비가 흐르는 순서', () => {
  beforeEach(() => resetPyodideRuntime())

  /**
   * **`absent`는 안 흐른다.** 그건 *아직 아무 일도 안 일어난 것*이라 알릴 것이 없다.
   * 나머지 셋은 **받는 중 → 바이트는 왔다 → 쓸 수 있다**로, 학생이 보는 문장이 그 순서로
   * 바뀐다.
   */
  it('받는 중 · 받았다 · 준비됐다 순서로 알린다', async () => {
    const seen: EngineState[] = []
    await prepare((state) => seen.push(state), undefined, fakeBoot([]))
    expect(seen).toEqual(['downloading', 'downloaded', 'ready'])
  })

  /**
   * **두 번째부터는 다시 안 띄운다.** 실험 하나에 sklearn 모델이 셋이면 이 함수가 세 번
   * 불리는데, 그때마다 7.7초를 다시 내면 **모델 셋짜리 실험이 23초를 시동에만 쓴다.**
   */
  it('두 번째 부름은 다시 안 띄운다', async () => {
    let booted = 0
    const boot = async (): Promise<Boot> => {
      booted += 1
      return bootOf(PYODIDE_VERSION)
    }
    await prepare(undefined, undefined, boot)
    const seen: EngineState[] = []
    await prepare((state) => seen.push(state), undefined, boot)
    expect(booted).toBe(1)
    // **그래도 상태는 알린다** — 화면이 이 run에서도 같은 자리에 답을 본다.
    expect(seen).toEqual(['ready'])
  })

  /**
   * **실패는 코드로 나간다** (CLAUDE.md §1.4). 학교망이 CDN을 막는 것이 가장 흔한
   * 실패이고, 그 문장은 *"순수 JS로 학습해 주세요"*여야 한다.
   */
  it('못 띄우면 ENGINE_BOOT_FAILED다', async () => {
    // **안 던지면 아무것도 안 재고 초록이다** — `catch` 안에만 확인이 있어서다
    // (2026-09-19 R29 C-9). 셋은 위 `rejects` 하나와 아래 둘이다.
    expect.assertions(3)
    const boot = async (): Promise<Boot> => {
      throw new Error('net::ERR_BLOCKED_BY_CLIENT')
    }
    await expect(prepare(undefined, undefined, boot)).rejects.toThrow()
    try {
      await prepare(undefined, undefined, boot)
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('ENGINE_BOOT_FAILED')
    }
  })

  /**
   * **실패를 기억하지 않는다.** 회선이 잠깐 끊겼다고 그 워커가 영원히 못 쓰게 되면,
   * 학생은 *"아까는 되던 게 왜 안 되지"*를 겪고 새로고침밖에 할 것이 없다.
   */
  it('실패한 뒤에는 다시 띄워 본다', async () => {
    let tries = 0
    const boot = async (): Promise<Boot> => {
      tries += 1
      // **던지는 원문은 영어다** (`tests/ci-language.spec.ts`) — 실패 원문은 기술 정보로
      // 그대로 실려 나가고, 그 통로는 번역되지 않는다.
      if (tries === 1) throw new Error('first attempt fails')
      return bootOf(PYODIDE_VERSION)
    }
    await expect(prepare(undefined, undefined, boot)).rejects.toThrow()
    await prepare(undefined, undefined, boot)
    expect(tries).toBe(2)
  })
})

/**
 * **파일이 말하는 배포판을 받는다** (결정문의 넷째 조항).
 *
 * 이 값의 출처가 **학생 파일**이라는 것이 여기 있는 검사의 전부다 — `.mlpx`는 교사와
 * 학생이 서로 주고받는 것이 이 도구의 전제이고(CLAUDE.md §1.3), 이 문자열은 주소가 되어
 * `import()`에 들어간다. 그 코드는 Pyodide 안에서 `import js`로 IndexedDB와 `fetch`에 닿는다.
 */
describe('파일이 말하는 배포판을 받는다', () => {
  beforeEach(() => resetPyodideRuntime())

  it('숫자 셋이 아닌 것은 안 믿는다', () => {
    for (const junk of [
      '../../evil',
      'latest',
      '314.0.7/../../x',
      'https://evil.example/full/',
      '314.0',
      '314.0.7 ',
      '',
      undefined,
    ]) {
      expect(distributionVersion(junk), `${String(junk)} must not become a URL`).toBeNull()
    }
    expect(distributionVersion('314.0.7')).toBe('314.0.7')
    expect(distributionVersion('400.1.0')).toBe('400.1.0')
  })

  it('주소에 그 버전이 그대로 박힌다', () => {
    expect(indexUrlFor('400.1.0')).toBe('https://cdn.jsdelivr.net/pyodide/v400.1.0/full/')
  })

  it('부른 배포판이 띄우는 쪽까지 간다', async () => {
    const asked: (string | undefined)[] = []
    const boot = async (_onState?: (state: EngineState) => void, version?: string) => {
      asked.push(version)
      return bootOf(version ?? PYODIDE_VERSION)
    }
    await prepare(undefined, '400.1.0', boot)
    expect(asked).toEqual(['400.1.0'])
    expect(bootedDistribution()?.version).toBe('400.1.0')
  })

  it('못 믿을 문자열은 못 박은 것으로 바뀐다', async () => {
    const asked: (string | undefined)[] = []
    const boot = async (_onState?: (state: EngineState) => void, version?: string) => {
      asked.push(version)
      return bootOf(version ?? PYODIDE_VERSION)
    }
    await prepare(undefined, '../../evil', boot)
    expect(asked).toEqual([PYODIDE_VERSION])
  })

  /**
   * **원본이 옛 배포판을 영원히 서빙한다는 보장이 없다.** 그때 교사에게 *"이 파일은 대조할
   * 수 없습니다"*라고 말하는 것은 **파일이 멀쩡한데 우리 사정으로 거절하는 것**이다.
   */
  it('그 배포판이 없으면 못 박은 것으로 한 번 더 부른다', async () => {
    const asked: (string | undefined)[] = []
    const boot = async (_onState?: (state: EngineState) => void, version?: string) => {
      asked.push(version)
      if (version !== PYODIDE_VERSION) throw new Error('404 Not Found')
      return bootOf(PYODIDE_VERSION)
    }
    await prepare(undefined, '1.2.3', boot)
    expect(asked).toEqual(['1.2.3', PYODIDE_VERSION])
    // **부른 것이 아니라 뜬 것을 적는다.** 여기서 `1.2.3`을 적으면 파일이 거짓말을 한다.
    expect(bootedDistribution()?.version).toBe(PYODIDE_VERSION)
  })

  it('못 박은 것을 부른 경우에는 다시 안 해 본다', async () => {
    let tries = 0
    const boot = async (): Promise<Boot> => {
      tries += 1
      throw new Error('net::ERR_BLOCKED_BY_CLIENT')
    }
    await expect(prepare(undefined, PYODIDE_VERSION, boot)).rejects.toThrow()
    expect(tries).toBe(1)
  })

  /**
   * **한 사실이 두 자리에 있으면 다음 사람이 어느 쪽을 믿을지 고르게 된다.** 배포판 이름은
   * `version`이 갖고, 지도는 파이썬이 답한 것만 갖는다.
   */
  it('패키지 지도에 배포판 이름이 안 들어간다', async () => {
    await prepare(undefined, undefined, fakeBoot([]))
    const described = bootedDistribution()
    expect(described?.packages).toEqual({ 'scikit-learn': '1.8.0' })
    expect(described?.version).toBe(PYODIDE_VERSION)
  })

  it('안 띄웠으면 말할 것이 없다', () => {
    expect(bootedDistribution()).toBeUndefined()
  })
})

/**
 * **버전이 같아야 하는 엔진과, 받아 오면 되는 엔진.**
 *
 * 순수 JS의 `version`은 *우리 코드*의 판이라 다른 판을 흉내 낼 수 없고, sklearn의
 * `version`은 *받아 오는 배포판*의 이름이라 받으면 된다. **이 사실을 아는 코드는 등록부
 * 하나여야 한다** — 밖에서 `if (kind === 'pyodide-sklearn')`을 쓰면 그 조회가 흩어진다.
 */
describe('버전을 감당하는 방식이 엔진마다 다르다', () => {
  it('sklearn은 배포판 이름이면 받아 온다', () => {
    const sklearn = ENGINES.find((one) => one.runtimeId === 'pyodide-sklearn')
    expect(sklearn?.acceptsVersion?.('400.1.0')).toBe(true)
    expect(sklearn?.acceptsVersion?.('../../evil')).toBe(false)
    // **못 박은 것이 기본값이다** — 새 학습은 이것으로 돌고 파일에 이것이 적힌다.
    expect(sklearn?.engine.version).toBe(PYODIDE_VERSION)
  })

  it('순수 JS는 정확히 같아야 한다', () => {
    const mljs = ENGINES.find((one) => one.runtimeId === 'mljs')
    expect(mljs?.acceptsVersion).toBeUndefined()
    expect(mljs?.describe).toBeUndefined()
  })
})

/**
 * **무겁다고 선언한 엔진에는 띄우는 코드가 있어야 한다.**
 *
 * `RuntimeSpec.preparation`은 *"무엇이 드는가"*의 선언이고 `TrainingEngine.prepare`는 그것을
 * 실제로 하는 코드다. **어긋나는 두 모양이 다 나쁘다** — 선언만 있으면 학습이 준비 없이
 * 어댑터를 부르고(`ENGINE_NOT_READY`로 죽는다), 코드만 있으면 **화면이 27MB와 8초를
 * 예고하지 못한 채** 학생이 그것을 만난다.
 */
describe('선언과 코드가 짝이다', () => {
  it('무거운 브라우저 엔진에는 prepare가 있다', async () => {
    const { RUNTIMES } = await import('../src/ml/backend')
    const wrong: string[] = []
    for (const engine of ENGINES) {
      const runtime = RUNTIMES.find((one) => one.id === engine.runtimeId)
      if (runtime === undefined) {
        wrong.push(`${engine.runtimeId}: 등록부에 실행 방법이 없다`)
        continue
      }
      if ((runtime.preparation !== undefined) !== (engine.prepare !== undefined)) {
        wrong.push(
          `${engine.runtimeId}: preparation=${String(runtime.preparation !== undefined)} · prepare=${String(
            engine.prepare !== undefined,
          )}`,
        )
      }
    }
    expect(wrong).toEqual([])
  })
})
