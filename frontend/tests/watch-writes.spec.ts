// @vitest-environment jsdom
/**
 * **감시자 안에서 앱이 스스로 쓰는 것을 실행 중에 막는다 — 어디까지 닿는가** (`open-decisions.md` 65 ④).
 *
 * 한 옵션이 다른 옵션을 무의미하게 만들 때 앱이 그 값을 끄거나 옮기는 모양은 거의 언제나 **감시자가
 * 값을 보고 쓰는 것**이다(결정문 55). 그래서 글자를 세지 않고 **쓰는 순간**을 막는다 —
 * `stores/project.ts`의 `save`·`update`·`file`과 `useWork`의 `start`(잠그는 일)가 Vue의 감시자 표지
 * (`getCurrentWatcher`)를 보고 던진다. 예외는 `@/locks`의 `WATCH_WRITES`에 적힌 이름뿐이다.
 *
 * **이 파일은 닿는 범위를 잰다.** 막는 것만이 아니라 **못 막는 것도 초록으로 적어 둔다** — 그 줄이
 * 빨개지면 누군가 범위를 넓혔거나(그러면 문서를 고친다) Vue가 표지의 뜻을 바꾼 것이다.
 *
 * 잰 것 (Vue 3.5, 2026-09-27):
 * - **막는다**: `watch` 콜백의 동기 구간(흐름 `pre`·`post`·`sync` 셋 다), `watchEffect` 몸의 동기 구간,
 *   콜백 안에서 **동기로 부른 함수**가 쓰는 것, `project.file = …` 직접 쓰기, 등록되지 않은 이름.
 * - **못 막는다**: 콜백 안의 `await` 뒤, `queueMicrotask`·`setTimeout`·`nextTick().then`으로 미룬 쓰기,
 *   `computed` 안의 쓰기(부작용), 파일 객체를 제자리에서 고치는 것. Vue는 콜백이 돌아오는 순간 표지를
 *   내린다 — 뒤로 미룬 일은 감시자에서 왔다는 것을 아무것도 모른다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { computed, nextTick, ref, watch, watchEffect } from 'vue'

import { useWork } from '../src/composables/useWork'
import type { ProjectFile } from '../src/project/format'
import { useProjectStore } from '../src/stores/project'
import { projectFile } from './fixtures/project'

beforeEach(() => {
  setActivePinia(createPinia())
})

/** 이름만 바꾼 새 파일. 같은 값을 다시 쓰면 아무 일도 없으므로 매번 새것이다. */
function renamed(file: ProjectFile, name: string): ProjectFile {
  return {
    ...file,
    document: { ...file.document, manifest: { ...file.document.manifest, name } },
  }
}

/** 감시자 콜백 안에서 던진 것을 받는다. Vue가 콜백 오류를 삼키지 않게 콜백 안에서 잡는다. */
function catching(write: () => void): () => unknown {
  let caught: unknown = null
  return () => {
    try {
      write()
    } catch (error) {
      caught = error
    }
    return caught
  }
}

const settle = async (): Promise<void> => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('감시자 안의 프로젝트 쓰기', () => {
  for (const flush of ['pre', 'post', 'sync'] as const) {
    it(`watch(flush: ${flush}) 콜백의 동기 쓰기는 던진다`, async () => {
      const project = useProjectStore()
      project.update(projectFile())
      const trigger = ref(0)
      let result: unknown = null
      const attempt = catching(() => project.update((live) => renamed(live, 'watched')))
      watch(
        trigger,
        () => {
          result = attempt()
        },
        { flush },
      )
      trigger.value += 1
      await settle()
      expect(String(result)).toContain('PROJECT_WRITE_IN_WATCHER')
      expect(project.name).not.toBe('watched')
    })
  }

  it('watchEffect 몸의 동기 쓰기는 던진다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    let result: unknown = null
    const attempt = catching(() => project.update((live) => renamed(live, 'effect')))
    watchEffect(() => {
      if (trigger.value > 0) result = attempt()
    })
    trigger.value += 1
    await settle()
    expect(String(result)).toContain('PROJECT_WRITE_IN_WATCHER')
  })

  it('save도 file에 직접 쓰는 것도 던진다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    const results: unknown[] = []
    // **`save`는 비동기라 던진 것이 거절된 약속으로 온다** — 판정은 동기 구간(감시자 표지가 선 동안)에
    // 끝난다. 받지 않으면 처리 안 된 거절로 검사 전체가 운다(그것도 시끄러운 실패다).
    let saving: Promise<void> = Promise.resolve()
    const direct = catching(() => {
      const current = project.file
      if (current) project.file = renamed(current, 'direct')
    })
    watch(trigger, () => {
      saving = project.save((live) => renamed(live, 'saved'))
      // 받을 자리를 곧바로 단다 — 아래에서 기다리기 전에 거절이 먼저 온다.
      saving.catch(() => undefined)
      results.push(direct())
    })
    trigger.value += 1
    await settle()
    await expect(saving).rejects.toThrow('PROJECT_WRITE_IN_WATCHER')
    expect(results.map(String)).toEqual([expect.stringContaining('PROJECT_WRITE_IN_WATCHER')])
    expect(project.name).not.toBe('saved')
    expect(project.name).not.toBe('direct')
  })

  it('콜백이 동기로 부른 함수의 쓰기도 던진다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    function helper(): void {
      project.update((live) => renamed(live, 'helper'))
    }
    const trigger = ref(0)
    let result: unknown = null
    const attempt = catching(helper)
    watch(trigger, () => {
      result = attempt()
    })
    trigger.value += 1
    await settle()
    expect(String(result)).toContain('PROJECT_WRITE_IN_WATCHER')
  })

  it('등록된 이름을 넘기면 지나간다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    let result: unknown = 'not run'
    const attempt = catching(() =>
      project.update((live) => renamed(live, 'registered'), 'predictPage'),
    )
    watch(trigger, () => {
      result = attempt()
    })
    trigger.value += 1
    await settle()
    expect(result).toBeNull()
    expect(project.name).toBe('registered')
  })

  it('등록되지 않은 이름은 던진다 — 캐스트로 이름을 지어내도', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    let result: unknown = null
    const attempt = catching(() =>
      project.update((live) => renamed(live, 'forged'), 'notRegistered' as never),
    )
    watch(trigger, () => {
      result = attempt()
    })
    trigger.value += 1
    await settle()
    expect(String(result)).toContain('PROJECT_WRITE_IN_WATCHER')
  })

  it('감시자 밖에서는 그대로 쓴다', () => {
    const project = useProjectStore()
    project.update(projectFile())
    project.update((live) => renamed(live, 'outside'))
    expect(project.name).toBe('outside')
  })
})

/**
 * **못 막는 것.** 이 줄들이 초록인 것이 사각의 증거다 — `docs/rule-coverage.md`와
 * `architecture.md` §10.7이 같은 말을 적는다.
 */
describe('닿지 않는 곳 (알려진 사각)', () => {
  it('콜백 안의 await 뒤 쓰기는 못 막는다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    let result: unknown = 'not run'
    watch(trigger, async () => {
      await Promise.resolve()
      result = catching(() => project.update((live) => renamed(live, 'after-await')))()
    })
    trigger.value += 1
    await settle()
    expect(result).toBeNull()
    expect(project.name).toBe('after-await')
  })

  it('마이크로태스크·타이머로 미룬 쓰기는 못 막는다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    watch(trigger, () => {
      queueMicrotask(() => project.update((live) => renamed(live, 'microtask')))
      setTimeout(() => project.update((live) => renamed(live, 'timeout')), 0)
    })
    trigger.value += 1
    await settle()
    await settle()
    expect(project.name).toBe('timeout')
  })

  it('computed 안의 쓰기(부작용)는 못 막는다', () => {
    const project = useProjectStore()
    project.update(projectFile())
    const sneaky = computed(() => {
      project.update((live) => renamed(live, 'computed'))
      return 1
    })
    expect(sneaky.value).toBe(1)
    expect(project.name).toBe('computed')
  })
})

describe('감시자 안에서 잠그는 일을 시작하기', () => {
  /**
   * **조건을 "진행 중"으로 바꿔 넣는 길이다** — 조건이 참이면 일을 잡고 거짓이면 놓으면, 그 조건이
   * 진행 중의 잠금으로 버튼을 잠근다. 먼저 만든 그물의 감사가 찾은 옆길(진행 중 깃발에 감시자로 조건
   * 넣기)의 이 구조판이다.
   */
  it('막는 일은 던진다', async () => {
    const work = useWork()
    const trigger = ref(0)
    let result: unknown = null
    watch(trigger, () => {
      result = catching(() => work.start())()
    })
    trigger.value += 1
    await settle()
    expect(String(result)).toContain('WORK_IN_WATCHER')
    expect(work.busy.value).toBe(false)
  })

  it('막지 않는 일은 지나간다 — 잠금을 만들지 않는다', async () => {
    const work = useWork()
    const trigger = ref(0)
    let result: unknown = 'not run'
    watch(trigger, () => {
      result = catching(() => work.start({ blocks: false }).done())()
    })
    trigger.value += 1
    await settle()
    expect(result).toBeNull()
  })

  it('등록된 이름을 넘기면 막는 일도 지나간다', async () => {
    const work = useWork()
    const trigger = ref(0)
    let busy = false
    watch(trigger, () => {
      const job = work.start({ watch: 'batchPage' })
      busy = work.busy.value
      job.done()
    })
    trigger.value += 1
    await settle()
    expect(busy).toBe(true)
  })
})
