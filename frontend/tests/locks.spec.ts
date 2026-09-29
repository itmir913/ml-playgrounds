// @vitest-environment jsdom
/**
 * **잠금 등록부** (`src/locks.ts`, `open-decisions.md` 65, `architecture.md` §10.7).
 *
 * 여기서 재는 것은 **구조가 막는 것**이다 — 글자로 막는 것(잠금 낱말은 기본 부품에만)은
 * `ui-rules.spec.ts`의 *"잠금 낱말은 기본 부품에만 있다"*가, 실행 중의 DOM은
 * `tests/setup/lock-net.ts`가 본다.
 *
 * 1. **잠금 값은 흉내 낼 수 없다.** `as`는 타입을 통과시키지만 부품이 읽는 순간 던진다.
 * 2. **잠금과 거절은 같은 판정이다.** `lockFor`가 낸 이유와 `refusalFor`가 돌려준 이유가 같고,
 *    `useGate`는 두 길을 같은 재료 함수로 만든다.
 * 3. **칸마다 판정이 서 있다** — 잠그는 재료와 여는 재료가 둘 다 판정을 지난다.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h, nextTick, reactive, ref } from 'vue'

import AppButton from '../src/components/AppButton.vue'
import AppChoices from '../src/components/AppChoices.vue'
import AppInput from '../src/components/AppInput.vue'
import AppLockZone from '../src/components/AppLockZone.vue'
import AppPlainButton from '../src/components/AppPlainButton.vue'
import AppSelect from '../src/components/AppSelect.vue'
import {
  anyLock,
  forwardAttrs,
  isForwardedAttr,
  isLocked,
  issueBusyLock,
  LOCK_IDS,
  lockFor,
  lockingAttr,
  lockReasons,
  refusalFor,
  turnPage,
  useGate,
  type GateInput,
  type Lock,
  type LockId,
} from '../src/locks'
import { withSectionMoved } from '../src/project/portfolio'
import type { Portfolio } from '../src/project/schema'
import { NO_FACTS } from '../src/router/steps'

/**
 * 검사용 부품. **`defineComponent`를 안 쓴다** — 한 파일에 둘이 되면 `vue/one-component-per-file`이
 * 운다(`predict-lines.spec.ts`와 같은 이유). 맨 객체도 Vue가 부품으로 받는다.
 */
const probe = <T extends object>(options: T): T => options

/* ------------------------------------------------------------------ 1. 흉내 */

describe('잠금 값은 등록부만 만든다', () => {
  /** 타입을 속이는 길들. **전부 컴파일은 통과한다** — 그래서 막는 것은 실행 중의 표다. */
  const FORGED: readonly { readonly name: string; readonly value: Lock }[] = [
    { name: '{} as Lock', value: {} as Lock },
    { name: 'as never', value: true as never },
    { name: 'as unknown as Lock', value: 'locked' as unknown as Lock },
    {
      name: 'a frozen empty object like the real ones',
      value: Object.freeze(Object.create(null) as object) as Lock,
    },
    { name: 'an object carrying reasons', value: { reasons: ['BUSY'] } as unknown as Lock },
  ]

  for (const forged of FORGED) {
    it(`흉내 낸 값을 읽으면 던진다: ${forged.name}`, () => {
      expect(() => lockReasons(forged.value)).toThrow('LOCK_NOT_ISSUED')
      expect(() => isLocked(forged.value)).toThrow('LOCK_NOT_ISSUED')
      expect(() => anyLock(forged.value)).toThrow('LOCK_NOT_ISSUED')
    })
  }

  /**
   * **부품이 받는 순간 던진다** — 흉내 낸 잠금으로는 아무것도 잠글 수 없다. Vue는 그리는 중의
   * 오류를 개발 빌드에서 그대로 올린다.
   */
  const PRIMITIVES = [
    { name: 'AppButton', mountWith: (lock: Lock) => mount(AppButton, { props: { lock } }) },
    {
      name: 'AppPlainButton',
      mountWith: (lock: Lock) => mount(AppPlainButton, { props: { lock } }),
    },
    { name: 'AppInput', mountWith: (lock: Lock) => mount(AppInput, { props: { lock } }) },
    { name: 'AppSelect', mountWith: (lock: Lock) => mount(AppSelect, { props: { lock } }) },
    { name: 'AppLockZone', mountWith: (lock: Lock) => mount(AppLockZone, { props: { lock } }) },
    {
      name: 'AppChoices',
      mountWith: (lock: Lock) =>
        mount(AppChoices, {
          props: { label: 'x', items: [{ id: 'a', label: 'a', lock, reason: 'x' }] },
        }),
    },
  ]

  for (const primitive of PRIMITIVES) {
    it(`${primitive.name}은 흉내 낸 잠금을 받으면 던진다`, () => {
      expect(() => primitive.mountWith({} as Lock)).toThrow('LOCK_NOT_ISSUED')
    })
  }

  it('진짜 잠금은 그대로 잠근다 — 위가 아무것도 안 잠가서 초록인 것이 아니다', () => {
    const locked = issueBusyLock(true)
    expect(
      mount(AppButton, { props: { lock: locked } })
        .find('button')
        .attributes('disabled'),
    ).toBeDefined()
    expect(
      mount(AppInput, { props: { lock: locked } })
        .find('input')
        .attributes('disabled'),
    ).toBeDefined()
    expect(
      mount(AppInput, { props: { lock: locked, readable: true } })
        .find('input')
        .attributes('readonly'),
    ).toBeDefined()
    expect(
      mount(AppSelect, { props: { lock: locked } })
        .find('select')
        .attributes('disabled'),
    ).toBeDefined()
    expect(
      mount(AppLockZone, { props: { lock: locked } })
        .find('div')
        .attributes('inert'),
    ).toBeDefined()
    const open = issueBusyLock(false)
    expect(
      mount(AppButton, { props: { lock: open } })
        .find('button')
        .attributes('disabled'),
    ).toBeUndefined()
  })

  /** 반응형 상자에 넣어도 같은 값이다 — 얼린 객체는 Vue가 프록시로 감싸지 않는다. */
  it('반응형 상자를 지나도 잠금이다', () => {
    const lock = issueBusyLock(true)
    const box = reactive({ lock })
    const slot = ref(lock)
    expect(lockReasons(box.lock)).toEqual(['BUSY'])
    expect(lockReasons(slot.value)).toEqual(['BUSY'])
  })

  it('없는 잠금은 잠기지 않은 것이다', () => {
    expect(lockReasons(undefined)).toEqual([])
    expect(isLocked(undefined)).toBe(false)
  })

  /**
   * **등록부는 자기 속성만 판정으로 부른다** (구조 뒤 감사 A-2). `GATES['constructor']`는 `Object`라
   * 무엇을 넘기든 객체를 돌려주고, 그 객체가 이유 목록 행세를 해 **잠금이 발급됐다.** 캐스트는 타입을
   * 통과하므로 실행 중에 선다.
   */
  const PROTOTYPE_KEYS = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']
  for (const key of PROTOTYPE_KEYS) {
    it(`프로토타입 키로는 판정을 부를 수 없다: ${key}`, () => {
      expect(() => refusalFor(key as never, {} as never)).toThrow('LOCK_GATE_UNKNOWN')
      expect(() => lockFor(key as never, {} as never)).toThrow('LOCK_GATE_UNKNOWN')
      const gate = useGate(key as never, () => ({}) as never)
      expect(() => gate.lock.value).toThrow('LOCK_GATE_UNKNOWN')
      expect(() => gate.refuse()).toThrow('LOCK_GATE_UNKNOWN')
    })
  }

  it('잠금 여럿은 이유를 이어 붙인다', () => {
    const joined = anyLock(issueBusyLock(true), lockFor('pageFirst', { page: 0 }), undefined)
    expect(lockReasons(joined)).toEqual(['BUSY', 'FIRST_PAGE'])
    expect(isLocked(anyLock(issueBusyLock(false), undefined))).toBe(false)
  })
})

/* ------------------------------------------------------------------ 2. 잠금 = 거절 */

describe('잠금과 거절은 같은 판정이다', () => {
  it('useGate의 잠금·이유·거절이 같은 재료로 같은 답을 낸다', () => {
    const name = ref('')
    const gate = useGate('projectName', () => ({ name: name.value }))
    expect(lockReasons(gate.lock.value)).toEqual(['NAME_MISSING'])
    expect(gate.reasons.value).toEqual(['NAME_MISSING'])
    expect(gate.refuse()).toEqual(['NAME_MISSING'])

    name.value = '꽃'
    expect(lockReasons(gate.lock.value)).toEqual([])
    expect(gate.reasons.value).toEqual([])
    expect(gate.refuse()).toEqual([])
  })

  /**
   * **거절은 그 순간의 재료로 다시 본다** — 잠금을 계산해 둔 뒤 재료가 바뀌었으면 거절은 새 재료를
   * 본다. 동작이 캐시된 잠금을 믿으면 잠금이 늦게 갱신되는 틈에 조용히 지나간다.
   */
  it('거절은 계산해 둔 잠금이 아니라 지금 재료를 본다', () => {
    const name = ref('꽃')
    const gate = useGate('projectName', () => ({ name: name.value }))
    expect(isLocked(gate.lock.value)).toBe(false)
    name.value = ''
    expect(gate.refuse()).toEqual(['NAME_MISSING'])
  })
})

/* ------------------------------------------------------------------ 3. 칸마다 */

/**
 * 칸마다 **잠그는 재료와 여는 재료**. 판정 함수 자체의 경우는 각자의 스펙이 본다
 * (`selection.spec.ts`·`reproduce.spec.ts`·`steps.spec.ts`·`chart-dialog.spec.ts` 등). 여기서 보는 것은
 * **등록부가 그 함수를 실제로 부르는가**다 — 칸의 줄을 빈 배열로 바꾸면 여기가 운다.
 */
const CASES: {
  readonly [Id in LockId]?: { readonly locked: GateInput<Id>; readonly open: GateInput<Id> }
} = {
  train: {
    locked: { taskType: 'classification', chosen: [] },
    open: { taskType: 'classification', chosen: [{ algorithm: 'decision_tree' }] },
  },
  chosenModel: {
    locked: { row: { algorithm: 'linear_regression' }, taskType: 'classification' },
    open: { row: { algorithm: 'linear_regression' }, taskType: 'regression' },
  },
  featureRole: {
    locked: {
      column: {
        summary: { name: 'a', kind: 'numeric', missing: 0, unique: 2 },
        role: 'target',
        featureChosen: true,
      } as unknown as GateInput<'featureRole'>['column'],
    },
    open: {
      column: {
        summary: { name: 'a', kind: 'numeric', missing: 0, unique: 2 },
        role: 'feature',
        featureChosen: true,
        featureIssue: 'FEATURE_HAS_MISSING',
      } as unknown as GateInput<'featureRole'>['column'],
    },
  },
  sampling: {
    locked: { taskType: 'classification', target: undefined },
    open: { taskType: 'clustering', target: undefined },
  },
  histogramBins: { locked: { draft: 0, max: 50 }, open: { draft: 10, max: 50 } },
  histogramAuto: { locked: { auto: true }, open: { auto: false } },
  projectName: { locked: { name: '   ' }, open: { name: '꽃' } },
  categoryName: {
    locked: { from: '', value: '_숨김', categories: [] },
    open: { from: '', value: '개', categories: ['고양이'] },
  },
  imagePredict: {
    locked: { photos: 1, models: 0, visible: 0, usable: 0 },
    open: { photos: 1, models: 1, visible: 1, usable: 1 },
  },
  tabularPredict: {
    locked: { models: 2, visible: 2, usable: 0 },
    open: { models: 2, visible: 1, usable: 1 },
  },
  reproduceComparing: { locked: { comparingOther: true }, open: { comparingOther: false } },
  projectHome: { locked: { projectOpen: false }, open: { projectOpen: true } },
  step: {
    locked: {
      step: 'train',
      projectOpen: true,
      facts: NO_FACTS,
      taskType: undefined,
      dataType: 'tabular',
    },
    open: {
      step: 'data',
      projectOpen: true,
      facts: NO_FACTS,
      taskType: undefined,
      dataType: 'tabular',
    },
  },
  pageFirst: { locked: { page: 0 }, open: { page: 1 } },
  pageLast: { locked: { page: 2, pages: 3 }, open: { page: 1, pages: 3 } },
  sectionTop: { locked: { index: 0 }, open: { index: 1 } },
  sectionBottom: { locked: { index: 2, count: 3 }, open: { index: 1, count: 3 } },
}

describe('칸마다 판정이 서 있다', () => {
  for (const [id, sample] of Object.entries(CASES) as [LockId, { locked: never; open: never }][]) {
    it(`${id}: 잠그는 재료에서 잠기고 여는 재료에서 열린다`, () => {
      expect(refusalFor(id, sample.locked)).not.toEqual([])
      expect(lockReasons(lockFor(id, sample.locked))).toEqual(refusalFor(id, sample.locked))
      expect(refusalFor(id, sample.open)).toEqual([])
      expect(isLocked(lockFor(id, sample.open))).toBe(false)
    })
  }

  /**
   * 표에 없는 칸은 **화면을 띄우는 스펙이 그 판정을 지난다** — 재료가 판정 함수의 결과를 통째로
   * 요구해서(모델 축·층화·대조·차트 도구) 여기서 손으로 세우면 판정을 다시 쓰는 셈이다.
   */
  it('등록부의 칸이 전부 어딘가에서 재진다', () => {
    const elsewhere = new Set<LockId>([
      'addModel', // option-cascade.spec.ts 의 [Add] past the lock, selection.spec.ts 의 modelAxes
      'modelCard', // task-type-trap.spec.ts, selection.spec.ts
      'reproduce', // reproduce.spec.ts 의 대조를 막는 이유, inspect-reproduce-live.spec.ts
      'stratifyTabular', // option-cascade.spec.ts, selection.spec.ts
      'stratifyImage', // image-prep-stratify.spec.ts, selection.spec.ts
      'chartTool', // chart-dialog.spec.ts
    ])
    const missing = LOCK_IDS.filter((id) => !(id in CASES) && !elsewhere.has(id))
    expect(missing).toEqual([])
  })
})

/* ------------------------------------------------------------------ 누르면 이유 */

describe('누를 수 있게 잠근 단추는 누르면 이유를 준다', () => {
  it('announce면 잠긴 채 눌려 refused를 내고 click은 안 낸다', async () => {
    const wrapper = mount(AppPlainButton, {
      props: { lock: lockFor('pageFirst', { page: 0 }), announce: true },
      slots: { default: '이전' },
    })
    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(button.attributes('aria-disabled')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('refused')).toEqual([[['FIRST_PAGE']]])
    expect(wrapper.emitted('click')).toBeUndefined()
  })

  it('잠기지 않았으면 click만 낸다', async () => {
    const wrapper = mount(AppPlainButton, {
      props: { lock: lockFor('pageFirst', { page: 1 }), announce: true },
    })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
    expect(wrapper.emitted('refused')).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ 쪽 넘기기 */

describe('쪽 넘기기는 누르는 쪽에서도 멈춘다', () => {
  it('처음과 끝에서는 그 자리에 서고, 쪽 수 안으로 당긴다', () => {
    expect(turnPage(0, -1, 3)).toBe(0)
    expect(turnPage(2, 1, 3)).toBe(2)
    expect(turnPage(1, -1, 3)).toBe(0)
    expect(turnPage(1, 1, 3)).toBe(2)
    // 쪽이 줄어 밖에 선 채 눌렀다 — 안으로 당긴다.
    expect(turnPage(5, -1, 3)).toBe(2)
    expect(turnPage(0, 1, 0)).toBe(0)
  })
})

/* ------------------------------------------------------------------ 순서 옮기기 */

/**
 * **순서 옮기기는 잠금과 같은 판정으로 멈춘다** (#31, `architecture.md` §10.7). 판정이 두 벌이면
 * 한쪽만 고쳐지는 날 **잠기지 않았는데 눌러도 조용한** 단추가 된다(결정문 60) — 그래서 판정을 재지
 * 않고 **잠금과 동작이 같이 움직이는지**를 잰다. 판정 하나를 바꾸면 둘이 함께 바뀌어 여기는 초록이고,
 * 한쪽만 바꾸면 운다.
 */
describe('순서 옮기기는 잠금과 같은 판정으로 멈춘다', () => {
  const withSections = (count: number): Portfolio => ({
    template: {
      sections: Array.from({ length: count }, (_, index) => ({
        id: `s${index}`,
        title: `${index}`,
      })),
    },
    answerFormat: 'plain-v1',
    answers: {},
    attachments: {},
  })

  it('잠긴 쪽은 안 옮겨지고, 안 잠긴 쪽은 반드시 옮겨진다', () => {
    for (const count of [1, 2, 3, 5]) {
      const before = withSections(count)
      for (let index = 0; index < count; index += 1) {
        const id = `s${index}`
        const up = refusalFor('sectionTop', { index })
        const down = refusalFor('sectionBottom', { index, count })
        const movedUp = withSectionMoved(before, id, -1)
        const movedDown = withSectionMoved(before, id, 1)
        const where = `${index} of ${count}`
        expect(movedUp === before, `up ${where}`).toBe(up.length > 0)
        expect(movedDown === before, `down ${where}`).toBe(down.length > 0)
        if (up.length === 0) {
          expect(movedUp.template.sections.map((one) => one.id)[index - 1], where).toBe(id)
        }
        if (down.length === 0) {
          expect(movedDown.template.sections.map((one) => one.id)[index + 1], where).toBe(id)
        }
      }
    }
  })
})

/* ------------------------------------------------------------------ 넘겨받는 속성 */

/**
 * **기본 부품은 넘겨받은 잠금을 뿌리에 흘리지 않는다** (구조 뒤 감사 A-3). 전에는 부품이 Vue의
 * 속성 전달로 받은 것을 그대로 뿌리에 붙여서, 화면이 **부품의 이름으로** 잠갔다 — 실행 중 그물은
 * 요소를 그린 부품(기본 부품)을 보고 통과시켰다. 이제 부품은 허락된 것만 건네고, 그물은 받은 것
 * 자체를 운다.
 */
describe('기본 부품은 넘겨받은 잠금을 흘리지 않는다', () => {
  const net = (): string[] =>
    (globalThis as unknown as { __lockNet: { take: () => string[] } }).__lockNet.take()

  const TRIES: readonly {
    readonly name: string
    readonly render: () => ReturnType<typeof h>
    readonly selector: string
    /** 넘긴 잠금이 요소에 섰는가. 부품 자신의 잠금 모양(`disabled:` 변종 등)은 세지 않는다. */
    readonly leaked: (element: Element) => boolean
  }[] = [
    {
      name: 'AppButton + assembled disabled',
      render: () => h(AppButton, { ['dis' + 'abled']: true }, () => 'x'),
      selector: 'button',
      leaked: (element) => element.hasAttribute('dis' + 'abled'),
    },
    {
      name: 'AppButton + assembled class',
      render: () => h(AppButton, { class: 'pointer-' + 'events-none' }, () => 'x'),
      selector: 'button',
      leaked: (element) => element.classList.contains('pointer-' + 'events-none'),
    },
    {
      name: 'AppInput + assembled aria state',
      render: () => h(AppInput, { ['aria-' + 'dis' + 'abled']: 'true' }),
      selector: 'input',
      leaked: (element) => element.hasAttribute('aria-' + 'dis' + 'abled'),
    },
    {
      name: 'AppPlainButton + tabindex -1',
      render: () => h(AppPlainButton, { ['tab' + 'index']: -1 }, () => 'x'),
      selector: 'button',
      leaked: (element) => element.hasAttribute('tab' + 'index'),
    },
    {
      name: 'AppSelect + assembled read-only',
      render: () => h(AppSelect, { ['read' + 'only']: true }),
      selector: 'select',
      leaked: (element) => element.hasAttribute('read' + 'only'),
    },
    {
      name: 'AppLockZone + assembled style',
      render: () => h(AppLockZone, { style: { ['pointer' + 'Events']: 'none' } }),
      selector: 'div',
      leaked: (element) => lockingAttr('style', element.getAttribute('style') ?? ''),
    },
  ]

  for (const attempt of TRIES) {
    it(`흘리지 않고, 그물이 운다: ${attempt.name}`, async () => {
      const Wrapper = probe({ render: attempt.render })
      const wrapper = mount(Wrapper)
      await nextTick()
      expect(attempt.leaked(wrapper.find(attempt.selector).element)).toBe(false)
      expect(net().join('\n')).toMatch(/received a lock attribute/)
      wrapper.unmount()
    })
  }

  it('허락된 속성은 그대로 건넨다 — 위가 아무것도 안 건네서 초록인 것이 아니다', async () => {
    const wrapper = mount(
      probe({
        render: () =>
          h(AppButton, { class: 'w-full', 'aria-pressed': 'true', 'data-x': '1' }, () => 'x'),
      }),
    )
    await nextTick()
    const button = wrapper.find('button')
    expect(button.classes()).toContain('w-full')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.attributes('data-x')).toBe('1')
    expect(net()).toEqual([])
  })

  it('허락 목록 밖의 속성은 건네지 않고, 그물이 운다 — 조용히 버리지 않는다', async () => {
    const wrapper = mount(probe({ render: () => h(AppButton, { autofocus: true }) }))
    await nextTick()
    expect(wrapper.find('button').attributes('autofocus')).toBeUndefined()
    expect(net().join('\n')).toMatch(/does not forward: autofocus/)
    wrapper.unmount()
  })

  /**
   * **`aria-hidden`은 건네지 않는다** (0.30.0 배포 승인 감사 C-4). 단추를 스크린리더에서 지우면 그
   * 학생에게는 잠긴 것과 같다. 뺄 때 기본 부품에 넘기는 화면은 없었다.
   */
  it('aria-hidden은 건네지 않고, 그물이 운다', async () => {
    const wrapper = mount(probe({ render: () => h(AppButton, { 'aria-hidden': 'true' }) }))
    await nextTick()
    expect(wrapper.find('button').attributes('aria-hidden')).toBeUndefined()
    expect(net().join('\n')).toMatch(/does not forward: aria-hidden/)
    wrapper.unmount()
    expect(isForwardedAttr('ariaHidden', true)).toBe(false)
    expect(isForwardedAttr('aria-label', 'x')).toBe(true)
  })

  /**
   * **숨기는 속성은 건네지 않는다** (0.30.0 최종 승인 감사 C-5, 코드 소유자). 숨긴 단추는 학생에게 잠긴
   * 단추와 같다. `aria-hidden`과 같은 모양이다 — 건네지 않고 그물이 운다. 뺄 때 기본 부품에 숨김을 넘기는
   * 화면은 없었다(2026-09-27에 셌다).
   */
  const HIDINGS: readonly (readonly [string, Record<string, unknown>])[] = [
    ['class hidden', { class: 'w-full hidden' }],
    ['class with a variant', { class: 'md:hidden' }],
    ['class with importance', { class: '!invisible' }],
    ['class with a trailing importance', { class: 'hidden!' }],
    ['class object', { class: { 'max-md:hidden': true } }],
    ['class array', { class: ['a', 'collapse'] }],
    ['style string', { style: 'display: none' }],
    ['style object', { style: { visibility: 'hidden' } }],
    ['type hidden', { type: 'hidden' }],
    // **토큰 하나로 판정되는 숨김** (#32, 결정문 65 "#32에서 더한 것"). 눈에서 지우는 것도 숨김이다.
    ['class sr-only', { class: 'w-full sr-only' }],
    ['class opacity-0 with a variant', { class: 'sm:opacity-0' }],
    ['class scale-0 with importance', { class: '!scale-0' }],
    ['class scale-x-0', { class: { 'scale-x-0': true } }],
    ['class scale-y-0', { class: ['a', 'scale-y-0'] }],
    ['style opacity string', { style: 'opacity: 0' }],
    ['style opacity object', { style: { opacity: 0 } }],
  ]

  /** 위 표본의 숨김 낱말. 건네졌으면 뿌리에 이 중 하나가 남는다. */
  const HIDING_LEFT =
    /(?:^|[\s:!])(?:hidden|invisible|collapse|sr-only|opacity-0|scale-(?:[xy]-)?0)(?:$|[\s!])/

  for (const [name, attrs] of HIDINGS) {
    it(`숨기는 속성은 건네지 않고, 그물이 운다: ${name}`, async () => {
      const wrapper = mount(probe({ render: () => h(AppInput, attrs) }))
      await nextTick()
      const input = wrapper.find('input')
      expect(input.attributes('class') ?? '').not.toMatch(HIDING_LEFT)
      expect(input.attributes('type')).not.toBe('hidden')
      expect(input.attributes('style') ?? '').not.toMatch(/display|visibility|opacity/)
      expect(net().join('\n')).toMatch(/does not forward: (?:class|style|type)/)
      wrapper.unmount()
    })
  }

  it('숨김이 아닌 것은 건넨다 — 위가 아무것도 안 건네서 초록인 것이 아니다', () => {
    expect(isForwardedAttr('class', 'overflow-hidden w-full')).toBe(true)
    expect(isForwardedAttr('class', { hidden: false, 'w-full': true })).toBe(true)
    expect(isForwardedAttr('style', { display: 'flex' })).toBe(true)
    expect(isForwardedAttr('type', 'checkbox')).toBe(true)
    expect(isForwardedAttr('class', 'md:hidden')).toBe(false)
    expect(isForwardedAttr('type', 'HIDDEN')).toBe(false)
    // 되살리는 것·흐리게만 하는 것·크기를 바꾸는 것은 숨김이 아니다.
    expect(isForwardedAttr('class', 'focus:not-sr-only')).toBe(true)
    expect(isForwardedAttr('class', 'opacity-50 hover:opacity-100 scale-100 scale-x-50')).toBe(true)
    expect(isForwardedAttr('style', 'opacity: 0.5')).toBe(true)
    expect(isForwardedAttr('style', { opacity: 0.05 })).toBe(true)
    expect(isForwardedAttr('style', 'opacity: .5; --ring-opacity: 1')).toBe(true)
    // 이름 끝이 `opacity`인 다른 속성은 제 요소를 투명하게 하지 않는다.
    expect(isForwardedAttr('style', { '--ring-opacity': 0 })).toBe(true)
    expect(isForwardedAttr('style', { opacity: 'var(--fade)' })).toBe(true)
    expect(isForwardedAttr('style', 'opacity: 0%')).toBe(false)
    expect(isForwardedAttr('style', 'opacity:0!important')).toBe(false)
  })

  /**
   * **토큰 하나로 판정 못 하는 숨김은 사각이다** (결정문 65 "#32에서 더한 것"). 크기 0은 넘침이 보이면
   * 안 숨고, 제 크기만큼 미는 것은 화면 안에 남을 수 있다 — 조합을 봐야 하는데 조합은 부품이 모르는
   * 부모의 배치에 걸린다. **알려진 사각으로 초록에 고정한다** — 막기로 정하면 이 검사가 먼저 바뀐다.
   */
  it('조합으로만 숨는 것은 건넨다 — 알려진 사각', () => {
    expect(isForwardedAttr('class', 'size-0 overflow-hidden')).toBe(true)
    expect(isForwardedAttr('class', 'w-0 h-0')).toBe(true)
    expect(isForwardedAttr('class', 'absolute -translate-x-full')).toBe(true)
    expect(isForwardedAttr('class', 'translate-y-full')).toBe(true)
  })

  it('판정은 대소문자·변종·중요도를 가리지 않는다', () => {
    expect(lockingAttr('ariaDisabled', 'true')).toBe(true)
    expect(lockingAttr('aria-disabled', 'false')).toBe(false)
    expect(lockingAttr('class', 'md:pointer-events-none')).toBe(true)
    expect(lockingAttr('class', 'pointer-events-none!')).toBe(true)
    expect(lockingAttr('class', { 'hover:cursor-not-allowed': true })).toBe(true)
    expect(lockingAttr('class', { 'cursor-not-allowed': false })).toBe(false)
    expect(lockingAttr('style', { pointerEvents: 'none' })).toBe(true)
    expect(isForwardedAttr('aria-readonly', 'false')).toBe(false)
    expect(forwardAttrs({ class: 'a', disabled: true, onClick: () => 1 })).toEqual({
      class: 'a',
      onClick: expect.any(Function),
    })
  })
})
