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
 *
 * **화면이 뜨는 동안**(결정문 65 "구조 뒤 감사에서 더한 것")의 잰 범위는 아래 *"화면이 뜨는 동안의
 * 프로젝트 쓰기"* 머리말이 적는다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  computed,
  h,
  nextTick,
  onBeforeMount,
  onBeforeUnmount,
  onBeforeUpdate,
  onMounted,
  onUnmounted,
  onUpdated,
  ref,
  watch,
  watchEffect,
  withDirectives,
} from 'vue'

import { useWork } from '../src/composables/useWork'
import type { ProjectFile } from '../src/project/format'
import { useProjectStore } from '../src/stores/project'
import { projectFile } from './fixtures/project'

/**
 * 검사용 부품. **`defineComponent`를 안 쓴다** — 한 파일에 둘이 되면 `vue/one-component-per-file`이
 * 운다(`predict-lines.spec.ts`와 같은 이유). 맨 객체도 Vue가 부품으로 받는다.
 */
const probe = <T extends object>(options: T): T => options

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
    // **새 이름을 더하라고 말한다** (구조 뒤 감사 A-1) — 이름은 파일에 묶여 있어 빌려 쓰면
    // `ui-rules.spec.ts`가 운다. 오류가 "있는 이름을 넘겨라"로 읽히면 그 길로 보낸다.
    expect(String(result)).toContain('add a new entry')
    expect(String(result)).toContain('do not reuse')
  })

  it('프로토타입 키는 등록된 이름이 아니다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const trigger = ref(0)
    let result: unknown = null
    const attempt = catching(() =>
      project.update((live) => renamed(live, 'forged'), 'constructor' as never),
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

/**
 * **화면이 뜨는 동안의 쓰기** (결정문 65 "구조 뒤 감사에서 더한 것"). *"화면에 들어오면 앱이 옵션을
 * 되돌리는"* 모양은 감시자가 아니라 `onMounted`에서 나온다. Vue가 부품을 세우거나 고쳐 그리는 동안
 * 세우는 표지(`getCurrentInstance`)를 본다(`@/locks`의 `appWriteSite`).
 *
 * 잰 것 (Vue 3.5, 2026-09-27):
 * - **막는다**: `setup` 몸, 수명주기 훅 일곱(`onBeforeMount`·`onMounted`·`onBeforeUpdate`·`onUpdated`·
 *   `onBeforeUnmount`·`onUnmounted` 그리고 그리기 함수 자체), 그리기 중에 처음 계산되는 `computed`의
 *   쓰기, 막는 작업 시작(`useWork().start()`).
 * - **못 막는다**: 훅 안의 `await` 뒤, 훅이 `nextTick`·타이머로 미룬 쓰기, 사용자 지시자의 훅
 *   (`mounted` 등 — Vue가 표지를 안 세운다), 이벤트 리스너(학생의 동작이라 일부러 안 본다), 라우터
 *   가드(같은 이유 — 이 스펙은 라우터를 안 태운다, `docs/rule-coverage.md`가 적는다).
 */
describe('화면이 뜨는 동안의 프로젝트 쓰기', () => {
  /** 한 자리에서 쓰기를 해 보고 던진 것을 모은다. */
  function attempt(place: (write: () => void) => { setup?: () => void; render?: boolean }): {
    results: unknown[]
    mountIt: () => ReturnType<typeof mount>
  } {
    const project = useProjectStore()
    project.update(projectFile())
    const results: unknown[] = []
    const write = (): void => {
      results.push(catching(() => project.update((live) => renamed(live, 'lifecycle')))())
    }
    const where = place(write)
    const Probe = probe({
      setup() {
        where.setup?.()
        const tick = ref(0)
        return () => {
          if (where.render === true) write()
          return h('button', { onClick: () => (tick.value += 1) }, String(tick.value))
        }
      },
    })
    return { results, mountIt: () => mount(Probe) }
  }

  const PLACES: readonly {
    readonly name: string
    readonly place: (write: () => void) => { setup?: () => void; render?: boolean }
  }[] = [
    { name: 'setup', place: (write) => ({ setup: write }) },
    { name: 'onBeforeMount', place: (write) => ({ setup: () => onBeforeMount(write) }) },
    { name: 'onMounted', place: (write) => ({ setup: () => onMounted(write) }) },
    { name: 'render', place: () => ({ render: true }) },
  ]

  for (const { name, place } of PLACES) {
    it(`${name}의 동기 쓰기는 던진다`, async () => {
      const { results, mountIt } = attempt(place)
      const wrapper = mountIt()
      await settle()
      expect(results.length).toBeGreaterThan(0)
      expect(results.map(String)).toEqual(
        results.map(() => expect.stringContaining('PROJECT_WRITE_IN_LIFECYCLE')),
      )
      expect(useProjectStore().name).not.toBe('lifecycle')
      wrapper.unmount()
    })
  }

  it('고쳐 그리는 훅(onBeforeUpdate·onUpdated)과 떠나는 훅(onBeforeUnmount·onUnmounted)도 던진다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    const results: unknown[] = []
    const write = (): void => {
      results.push(catching(() => project.update((live) => renamed(live, 'lifecycle')))())
    }
    const Probe = probe({
      setup() {
        onBeforeUpdate(write)
        onUpdated(write)
        onBeforeUnmount(write)
        onUnmounted(write)
        const tick = ref(0)
        return () => h('button', { onClick: () => (tick.value += 1) }, String(tick.value))
      },
    })
    const wrapper = mount(Probe)
    await wrapper.find('button').trigger('click')
    await settle()
    wrapper.unmount()
    expect(results).toHaveLength(4)
    expect(results.map(String)).toEqual(
      results.map(() => expect.stringContaining('PROJECT_WRITE_IN_LIFECYCLE')),
    )
  })

  it('그리기 중에 처음 계산되는 computed의 쓰기도 던진다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    let result: unknown = 'not run'
    const Probe = probe({
      setup() {
        const sneaky = computed(() => {
          result = catching(() => project.update((live) => renamed(live, 'computed-render')))()
          return 1
        })
        return () => h('span', String(sneaky.value))
      },
    })
    const wrapper = mount(Probe)
    await settle()
    expect(String(result)).toContain('PROJECT_WRITE_IN_LIFECYCLE')
    wrapper.unmount()
  })

  it('막는 작업을 시작하는 것도 던진다', async () => {
    let result: unknown = 'not run'
    const Probe = probe({
      setup() {
        const work = useWork()
        onMounted(() => {
          result = catching(() => work.start())()
        })
        return () => h('span')
      },
    })
    const wrapper = mount(Probe)
    await settle()
    expect(String(result)).toContain('WORK_IN_LIFECYCLE')
    wrapper.unmount()
  })

  it('이벤트 리스너는 학생의 동작이라 지나간다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    let result: unknown = 'not run'
    const Probe = probe({
      setup() {
        return () =>
          h(
            'button',
            {
              onClick: () => {
                result = catching(() => project.update((live) => renamed(live, 'clicked')))()
              },
            },
            'x',
          )
      },
    })
    const wrapper = mount(Probe)
    await wrapper.find('button').trigger('click')
    expect(result).toBeNull()
    expect(project.name).toBe('clicked')
    wrapper.unmount()
  })

  it('등록된 이름을 넘기면 지나간다', async () => {
    const project = useProjectStore()
    project.update(projectFile())
    let result: unknown = 'not run'
    const Probe = probe({
      setup() {
        onMounted(() => {
          result = catching(() =>
            project.update((live) => renamed(live, 'registered'), 'predictPage'),
          )()
        })
        return () => h('span')
      },
    })
    const wrapper = mount(Probe)
    await settle()
    expect(result).toBeNull()
    expect(project.name).toBe('registered')
    wrapper.unmount()
  })

  describe('닿지 않는 곳 (알려진 사각)', () => {
    it('훅 안의 await 뒤, nextTick·타이머로 미룬 쓰기는 못 막는다', async () => {
      const project = useProjectStore()
      project.update(projectFile())
      const results: unknown[] = []
      const Probe = probe({
        setup() {
          onMounted(async () => {
            await Promise.resolve()
            results.push(catching(() => project.update((live) => renamed(live, 'await')))())
            void nextTick(() => {
              results.push(catching(() => project.update((live) => renamed(live, 'tick')))())
            })
          })
          return () => h('span')
        },
      })
      const wrapper = mount(Probe)
      await settle()
      await settle()
      expect(results).toEqual([null, null])
      expect(project.name).toBe('tick')
      wrapper.unmount()
    })

    it('사용자 지시자의 훅은 못 막는다', async () => {
      const project = useProjectStore()
      project.update(projectFile())
      let result: unknown = 'not run'
      const directive = {
        mounted: (): void => {
          result = catching(() => project.update((live) => renamed(live, 'directive')))()
        },
      }
      const Probe = probe({
        setup() {
          return () => withDirectives(h('span'), [[directive]])
        },
      })
      const wrapper = mount(Probe)
      await settle()
      expect(result).toBeNull()
      expect(project.name).toBe('directive')
      wrapper.unmount()
    })
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
