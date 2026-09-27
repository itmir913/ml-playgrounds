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
import { reactive, ref } from 'vue'

import AppButton from '../src/components/AppButton.vue'
import AppChoices from '../src/components/AppChoices.vue'
import AppInput from '../src/components/AppInput.vue'
import AppLockZone from '../src/components/AppLockZone.vue'
import AppPlainButton from '../src/components/AppPlainButton.vue'
import AppSelect from '../src/components/AppSelect.vue'
import {
  anyLock,
  isLocked,
  issueBusyLock,
  LOCK_IDS,
  lockFor,
  lockReasons,
  refusalFor,
  useGate,
  type GateInput,
  type Lock,
  type LockId,
} from '../src/locks'
import { NO_FACTS } from '../src/router/steps'

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
        mount(AppChoices, { props: { label: 'x', items: [{ id: 'a', label: 'a', lock }] } }),
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
