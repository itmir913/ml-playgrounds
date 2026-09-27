/**
 * **실행 중의 잠금 그물** — 검사가 띄운 화면에서, 잠금 속성이 **기본 부품 밖에서** 서면 그 검사를
 * 실패시킨다 (`open-decisions.md` 65, `architecture.md` §10.7).
 *
 * **글자 검사의 사각을 메운다.** `ui-rules.spec.ts`의 *"잠금 낱말은 기본 부품에만 있다"*는 글자를
 * 본다 — 이름을 실행 중에 조립하면(`'dis' + 'abled'`, `atob(…)`, 객체 키를 계산하기) 글자에 안
 * 남는다. 여기는 표기를 안 본다: **DOM에 실제로 잠금이 쓰이는 순간**을 잡는다 —
 * `disabled`·`readOnly`·`tabIndex`의 속성 쓰기, `disabled`·`readonly`·`inert`·`aria-disabled`·
 * `aria-readonly`·`tabindex`의 어트리뷰트 쓰기, `pointer-events-none`·`cursor-not-allowed` 클래스,
 * `pointer-events: none`·`cursor: not-allowed` 스타일.
 *
 * **누가 썼는지는 가상 노드가 말한다.** Vue는 개발 빌드에서 요소마다 자기를 만든 가상 노드를
 * 달아 두고(`__vnode`), 가상 노드는 **자기를 그린 부품**을 든다(`ctx`). 슬롯 내용은 그것을 그린
 * 부모가 든다 — 기본 부품의 슬롯에 넣은 요소도 부모의 것으로 센다. 그 부품의 이름이
 * `@/locks`의 `LOCK_PRIMITIVES`에 없으면 실패다.
 *
 * **못 보는 것** (`docs/rule-coverage.md`). 검사가 **그리지 않은** 상태, Vue 밖에서 손으로 만든 요소
 * (가상 노드가 없다 — 건너뛴다), 스타일시트의 규칙(jsdom은 CSS를 적용하지 않는다 — 글자 검사가
 * `<style>`과 `.css`를 본다).
 */

import { afterEach } from 'vitest'

/** jsdom이 아닌 스펙(노드 환경)에서는 할 일이 없다. DOM 부재는 이 표기 하나로 판정한다(CLAUDE.md §4). */
const HAS_DOM = typeof document !== 'undefined'

interface Written {
  readonly element: Element
  readonly what: string
}

const pending: Written[] = []
const found: string[] = []
let primitives: ReadonlySet<string> | null = null

/** 요소를 그린 부품의 이름. Vue 밖에서 만든 요소면 `null`이다. */
function ownerOf(element: Element): string | null {
  type Named = { __name?: string; name?: string }
  const vnode = (
    element as Element & {
      __vnode?: { type?: unknown; ctx?: { type?: Named } | null }
    }
  ).__vnode
  if (vnode === undefined) return null
  // **요소가 부품의 뿌리면 Vue가 그 부품의 가상 노드를 달기도 한다**(고정 자식을 되짚을 때) — 그때
  // 요소를 그린 것은 그 부품 자신이다. 잰 것: 사진 판의 `AppButton` 뿌리가 `<AppButton>` 노드를 달았다.
  if (typeof vnode.type === 'object' && vnode.type !== null) {
    const component = vnode.type as Named
    return component.__name ?? component.name ?? '(anonymous)'
  }
  const type = vnode.ctx?.type
  return type?.__name ?? type?.name ?? '(root)'
}

let flushing = false

function check(): void {
  flushing = false
  const names = primitives
  if (names === null) return
  for (const { element, what } of pending.splice(0)) {
    const owner = ownerOf(element)
    if (owner === null || names.has(owner)) continue
    found.push(`${owner}: ${what} on <${element.tagName.toLowerCase()}>`)
  }
}

/**
 * 적어 두고 **다음 마이크로태스크에** 본다. 처음 그릴 때 Vue는 속성을 먼저 쓰고 가상 노드를 나중에
 * 단다 — 그 자리에서 보면 누가 썼는지 아직 모른다.
 */
function note(element: Element, what: string): void {
  pending.push({ element, what })
  if (!flushing) {
    flushing = true
    queueMicrotask(check)
  }
}

const LOCK_CLASSES = /(?:^|\s)(?:pointer-events-none|cursor-not-allowed)(?:\s|$)/
const LOCK_ATTRIBUTES = new Set(['disabled', 'readonly', 'inert'])

function attributeLocks(name: string, value: string): boolean {
  const key = name.toLowerCase()
  if (LOCK_ATTRIBUTES.has(key)) return true
  if (key === 'aria-disabled' || key === 'aria-readonly') return value === 'true'
  if (key === 'tabindex') return value.trim() === '-1'
  if (key === 'class') return LOCK_CLASSES.test(value)
  if (key === 'style') return /pointer-events\s*:\s*none|cursor\s*:\s*not-allowed/i.test(value)
  return false
}

/** 속성 쓰기를 감싼다. 원래 쓰기는 그대로 한다 — 막지 않고 적는다. */
function wrapSetter(
  prototype: object | undefined,
  property: string,
  locks: (value: unknown) => boolean,
): void {
  if (prototype === undefined) return
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property)
  const set = descriptor?.set
  if (descriptor === undefined || set === undefined) return
  Object.defineProperty(prototype, property, {
    ...descriptor,
    set(this: unknown, value: unknown) {
      if (locks(value) && this instanceof Element) note(this, `${property} = ${String(value)}`)
      set.call(this, value)
    },
  })
}

function install(): void {
  const truthy = (value: unknown): boolean => value === true || value === ''
  for (const ctor of [
    globalThis.HTMLButtonElement,
    globalThis.HTMLInputElement,
    globalThis.HTMLSelectElement,
    globalThis.HTMLTextAreaElement,
    globalThis.HTMLFieldSetElement,
    globalThis.HTMLOptionElement,
    globalThis.HTMLOptGroupElement,
  ]) {
    wrapSetter(ctor?.prototype, 'disabled', truthy)
  }
  wrapSetter(globalThis.HTMLInputElement?.prototype, 'readOnly', truthy)
  wrapSetter(globalThis.HTMLTextAreaElement?.prototype, 'readOnly', truthy)
  wrapSetter(globalThis.HTMLElement?.prototype, 'inert', truthy)
  wrapSetter(globalThis.HTMLElement?.prototype, 'tabIndex', (value) => Number(value) === -1)
  wrapSetter(globalThis.Element?.prototype, 'className', (value) =>
    LOCK_CLASSES.test(String(value)),
  )

  const element = globalThis.Element.prototype
  const setAttribute = element.setAttribute
  element.setAttribute = function (this: Element, name: string, value: string): void {
    if (attributeLocks(name, String(value))) note(this, `${name}="${String(value)}"`)
    setAttribute.call(this, name, value)
  }
  const toggleAttribute = element.toggleAttribute
  element.toggleAttribute = function (this: Element, name: string, force?: boolean): boolean {
    const result = toggleAttribute.call(this, name, force)
    if (result && attributeLocks(name, '')) note(this, `toggle ${name}`)
    return result
  }

  const style = globalThis.CSSStyleDeclaration?.prototype
  const owners = new WeakMap<object, Element>()
  // 스타일 객체에서 요소로 거슬러 가는 길이 없어 **요소의 `style`을 읽을 때 짝을 적어 둔다.**
  const styleDescriptor = Object.getOwnPropertyDescriptor(globalThis.HTMLElement.prototype, 'style')
  const readStyle = styleDescriptor?.get
  if (styleDescriptor !== undefined && readStyle !== undefined) {
    Object.defineProperty(globalThis.HTMLElement.prototype, 'style', {
      ...styleDescriptor,
      get(this: HTMLElement) {
        const declaration = readStyle.call(this) as object
        owners.set(declaration, this)
        return declaration
      },
    })
  }
  const styleLocks = (name: string, value: unknown): boolean => {
    const key = name.toLowerCase().replace(/-/g, '')
    const text = String(value).trim().toLowerCase()
    return (
      (key === 'pointerevents' && text === 'none') || (key === 'cursor' && text === 'not-allowed')
    )
  }
  if (style !== undefined) {
    for (const property of ['pointerEvents', 'cursor']) {
      const descriptor = Object.getOwnPropertyDescriptor(style, property)
      const set = descriptor?.set
      if (descriptor === undefined || set === undefined) continue
      Object.defineProperty(style, property, {
        ...descriptor,
        set(this: object, value: unknown) {
          const owner = owners.get(this)
          if (owner !== undefined && styleLocks(property, value)) {
            note(owner, `style.${property} = ${String(value)}`)
          }
          set.call(this, value)
        },
      })
    }
    const setProperty = style.setProperty
    style.setProperty = function (this: CSSStyleDeclaration, name: string, value: string | null) {
      const owner = owners.get(this)
      if (owner !== undefined && styleLocks(name, value)) note(owner, `style ${name}: ${value}`)
      setProperty.call(this, name, value)
    }
    const cssText = Object.getOwnPropertyDescriptor(style, 'cssText')
    const setCss = cssText?.set
    if (cssText !== undefined && setCss !== undefined) {
      Object.defineProperty(style, 'cssText', {
        ...cssText,
        set(this: object, value: unknown) {
          const owner = owners.get(this)
          if (owner !== undefined && attributeLocks('style', String(value))) {
            note(owner, `style = ${String(value)}`)
          }
          setCss.call(this, value)
        },
      })
    }
  }
}

if (HAS_DOM) {
  // **부품 목록은 등록부에서 읽는다** — 이름을 여기 다시 적으면 두 벌이 된다. jsdom 스펙만 치르는
  // 값이다(화면을 띄우는 스펙은 어차피 등록부를 들인다).
  const { LOCK_PRIMITIVES } = await import('../../src/locks')
  primitives = new Set(
    LOCK_PRIMITIVES.map((one) => one.file.replace(/^.*\//, '').replace(/\.vue$/, '')),
  )
  install()

  afterEach(async () => {
    await Promise.resolve()
    check()
    const caught = found.splice(0)
    if (caught.length > 0) {
      throw new Error(
        `LOCK_OUTSIDE_PRIMITIVE: a lock was written by a component that src/locks.ts does not list as a primitive:\n${caught.join('\n')}`,
      )
    }
  })
}
