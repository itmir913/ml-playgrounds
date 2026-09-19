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
  prepare,
  resetPyodideRuntime,
  type Boot,
} from '../src/ml/engines/pyodide-runtime'
import { RUNTIMES as NOTICE_RUNTIMES } from '../scripts/notices'

const ROOT = join(__dirname, '..')

/** 아무것도 안 받고 성공한 척한다. 재는 것은 순서이지 시간이 아니다. */
const fakeBoot =
  (log: EngineState[]) =>
  async (onState?: (state: EngineState) => void): Promise<Boot> => {
    onState?.('downloaded')
    log.push('downloaded')
    return {
      parts: { core: 1, packages: 1, imports: 1, total: 3 },
      versions: { 'scikit-learn': '1.8.0' },
    }
  }

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
    await prepare((state) => seen.push(state), fakeBoot([]))
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
      return { parts: { core: 0, packages: 0, imports: 0, total: 0 }, versions: {} }
    }
    await prepare(undefined, boot)
    const seen: EngineState[] = []
    await prepare((state) => seen.push(state), boot)
    expect(booted).toBe(1)
    // **그래도 상태는 알린다** — 화면이 이 run에서도 같은 자리에 답을 본다.
    expect(seen).toEqual(['ready'])
  })

  /**
   * **실패는 코드로 나간다** (CLAUDE.md §1.4). 학교망이 CDN을 막는 것이 가장 흔한
   * 실패이고, 그 문장은 *"순수 JS로 학습해 주세요"*여야 한다.
   */
  it('못 띄우면 ENGINE_BOOT_FAILED다', async () => {
    const boot = async (): Promise<Boot> => {
      throw new Error('net::ERR_BLOCKED_BY_CLIENT')
    }
    await expect(prepare(undefined, boot)).rejects.toThrow()
    try {
      await prepare(undefined, boot)
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
      return { parts: { core: 0, packages: 0, imports: 0, total: 0 }, versions: {} }
    }
    await expect(prepare(undefined, boot)).rejects.toThrow()
    await prepare(undefined, boot)
    expect(tries).toBe(2)
  })
})

/**
 * **무겁다고 선언한 엔진에는 띄우는 코드가 있어야 한다.**
 *
 * `RuntimeSpec.needsPreparation`은 *"무겁다"*는 선언이고 `TrainingEngine.prepare`는 그것을
 * 실제로 하는 코드다. **어긋나는 두 모양이 다 나쁘다** — 선언만 있으면 학습이 준비 없이
 * 어댑터를 부르고(`ENGINE_NOT_READY`로 죽는다), 코드만 있으면 화면이 그 시간을 예고하지
 * 못한다.
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
      if (runtime.needsPreparation !== (engine.prepare !== undefined)) {
        wrong.push(
          `${engine.runtimeId}: needsPreparation=${String(runtime.needsPreparation)} · prepare=${String(
            engine.prepare !== undefined,
          )}`,
        )
      }
    }
    expect(wrong).toEqual([])
  })
})
