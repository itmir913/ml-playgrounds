/**
 * **실행 중의 잠금 그물** — 검사가 띄운 화면에서, 잠금 속성이 **기본 부품 밖에서** 서면 그 검사를
 * 실패시킨다 (`open-decisions.md` 65, `architecture.md` §10.7).
 *
 * **글자 검사의 사각을 메운다.** `ui-rules.spec.ts`의 *"잠금 낱말은 기본 부품에만 있다"*는 글자를
 * 본다 — 이름을 실행 중에 조립하면(`'dis' + 'abled'`, `atob(…)`, 객체 키를 계산하기) 글자에 안
 * 남는다. 여기는 표기를 안 본다: **DOM에 실제로 선 잠금**을 본다.
 *
 * **어떤 쓰기든 본다** (구조 뒤 감사 B-1). 처음에는 쓰는 함수 몇 개(`setAttribute`·`disabled` 대입
 * 등)를 감쌌고, `classList.add`·`setAttributeNS`·`style['pointer-events']`·`attributes.setNamedItem`·
 * `innerHTML`·`v-html`이 그 옆으로 지나갔다. 이제 **길을 세지 않는다** — `MutationObserver`가 속성과
 * 자식의 변화를 전부 받고, 받은 요소의 **지금 속성**을 `@/locks`의 `lockingAttr`로 판정한다. 그리고
 * 검사가 끝날 때 그 화면의 요소를 **한 번 더 통째로 훑는다** — 관찰자가 붙기 전에 선 것도 여기서 걸린다.
 *
 * **관찰하는 뿌리.** `document` 하나로는 모자라다 — `@vue/test-utils`의 `mount()`는 문서에 안 붙인
 * `<div>`에 그린다. 그래서 Vue가 앱을 그릇에 앉히는 순간(`__vue_app__`을 쓰는 순간)을 받아 그 그릇도
 * 관찰하고 이미 그려진 것을 훑는다.
 *
 * **누가 썼는지는 가상 노드가 말한다.** Vue는 개발 빌드에서 요소마다 자기를 만든 가상 노드를
 * 달아 두고(`__vnode`), 가상 노드는 **자기를 그린 부품**을 든다(`ctx`). 슬롯 내용은 그것을 그린
 * 부모가 든다. **가상 노드가 없는 요소**(`innerHTML`·`v-html`로 들어온 것)는 **가장 가까운 조상의
 * 가상 노드**가 주인이다 — 그 부품이 그 글을 부었다. 주인은 **전체 경로**(`__file`)로 `@/locks`의
 * `LOCK_PRIMITIVES`와 견준다(구조 뒤 감사 C-2) — 이름만 견주면 다른 폴더의 같은 이름이 지나간다.
 *
 * **기본 부품이 받은 속성도 본다** (구조 뒤 감사 A-3). 부품은 `inheritAttrs: false`라 넘겨받은
 * 잠금을 뿌리에 흘리지 않지만, **받았다는 것 자체가 부품 밖의 잠금 시도다** — 그리고 부품이 건네지
 * 못한 속성(`FORWARDED_ATTRS` 밖)을 조용히 버리는 것도 여기서 운다.
 *
 * **못 보는 것** (`docs/rule-coverage.md`). 검사가 **그리지 않은** 상태, **기본 부품의 요소에 밖에서
 * 쓴 것**(`ref`로 부품의 `$el`을 얻어 속성을 쓰면 주인은 부품이다), 관찰 사이에 섰다 사라진 잠금
 * (검사 끝의 훑기 전에 걷힌 것), 스타일시트의 규칙(jsdom은 CSS를 적용하지 않는다 — 글자 검사가
 * `<style>`과 `.css`를 본다), Vue 밖에서 만들어 어느 가상 노드 아래에도 안 붙인 요소.
 */

import { afterEach } from 'vitest'

/** jsdom이 아닌 스펙(노드 환경)에서는 할 일이 없다. DOM 부재는 이 표기 하나로 판정한다(CLAUDE.md §4). */
const HAS_DOM = typeof document !== 'undefined'

interface Named {
  readonly __name?: string
  readonly name?: string
  readonly __file?: string
}

interface Instance {
  readonly type: Named
  readonly attrs: Readonly<Record<string, unknown>>
  readonly parent: Instance | null
}

interface VueElement extends Element {
  readonly __vnode?: { readonly type?: unknown; readonly ctx?: { readonly type?: Named } | null }
  readonly __vueParentComponent?: Instance | null
}

/** 등록부에서 읽는 것. jsdom 스펙만 치르는 값이다. */
interface Registry {
  readonly primitives: ReadonlySet<string>
  readonly lockingAttr: (name: string, value: unknown) => boolean
  readonly isForwardedAttr: (name: string, value: unknown) => boolean
}

let registry: Registry | null = null
const found = new Set<string>()
const roots = new Set<Node>()
let observer: MutationObserver | null = null

/** `src/` 아래 경로(구분자 `/`). 우리 파일이 아니면 `null`이다. */
function sourcePath(file: string | undefined): string | null {
  if (file === undefined) return null
  const normal = file.replace(/\\/g, '/')
  const at = normal.lastIndexOf('/src/')
  return at < 0 ? null : normal.slice(at + '/src/'.length)
}

/** 부품의 이름표 — 실패 문장에 쓴다. 경로가 있으면 경로다. */
function labelOf(type: Named | undefined): string {
  if (type === undefined) return '(root)'
  return sourcePath(type.__file) ?? type.__name ?? type.name ?? '(anonymous)'
}

function isPrimitive(type: Named | undefined): boolean {
  const path = sourcePath(type?.__file)
  return path !== null && registry !== null && registry.primitives.has(path)
}

/**
 * 요소를 그린 부품. 가상 노드가 없으면 **가장 가까운 조상의 것**이다. 끝내 없으면 `undefined` —
 * Vue 밖에서 만든 요소다.
 */
function ownerOf(element: Element): { readonly type: Named | undefined } | undefined {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const vnode = (node as VueElement).__vnode
    if (vnode === undefined) continue
    // **요소가 부품의 뿌리면 Vue가 그 부품의 가상 노드를 달기도 한다**(고정 자식을 되짚을 때) — 그때
    // 요소를 그린 것은 그 부품 자신이다. 잰 것: 사진 판의 `AppButton` 뿌리가 `<AppButton>` 노드를 달았다.
    if (typeof vnode.type === 'object' && vnode.type !== null) return { type: vnode.type as Named }
    return { type: vnode.ctx?.type ?? undefined }
  }
  return undefined
}

/** 요소 하나의 속성과, 그 요소 위의 기본 부품이 받은 속성을 본다. */
function inspect(element: Element, seen: Set<Instance>): void {
  const names = registry
  if (names === null) return
  for (const attribute of Array.from(element.attributes)) {
    if (!names.lockingAttr(attribute.name, attribute.value)) continue
    const owner = ownerOf(element)
    if (owner === undefined || isPrimitive(owner.type)) continue
    found.add(
      `${labelOf(owner.type)}: ${attribute.name}="${attribute.value}" on <${element.tagName.toLowerCase()}>`,
    )
  }
  for (
    let instance = (element as VueElement).__vueParentComponent ?? null;
    instance !== null && !seen.has(instance);
    instance = instance.parent
  ) {
    seen.add(instance)
    if (!isPrimitive(instance.type)) continue
    for (const [key, value] of Object.entries(instance.attrs)) {
      if (names.lockingAttr(key, value)) {
        found.add(`${labelOf(instance.type)} received a lock attribute: ${key}=${String(value)}`)
      } else if (!names.isForwardedAttr(key, value)) {
        found.add(`${labelOf(instance.type)} received an attribute it does not forward: ${key}`)
      }
    }
  }
}

/** 요소와 그 아래 전부. */
function inspectTree(node: Node, seen: Set<Instance>): void {
  if (node instanceof Element) inspect(node, seen)
  if (node instanceof Element || node instanceof Document || node instanceof DocumentFragment) {
    for (const element of Array.from(node.querySelectorAll('*'))) inspect(element, seen)
  }
}

function handle(records: readonly MutationRecord[]): void {
  const seen = new Set<Instance>()
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof Element) {
      inspect(record.target, seen)
    }
    for (const added of Array.from(record.addedNodes)) inspectTree(added, seen)
  }
}

function watchRoot(root: Node): void {
  if (observer === null || roots.has(root)) return
  roots.add(root)
  observer.observe(root, { attributes: true, childList: true, subtree: true })
  inspectTree(root, new Set())
}

/**
 * Vue가 앱을 그릇에 앉히는 순간. **`__vue_app__`을 쓰는 순간을 받는다** — 그릇이 문서 밖에 있어도
 * 여기서 관찰을 붙인다. 값은 그 요소 자신의 속성으로 둔다(Vue가 떼어 낼 때 `delete`가 먹게).
 */
function catchAppContainers(): void {
  Object.defineProperty(Element.prototype, '__vue_app__', {
    configurable: true,
    set(this: Element, app: unknown) {
      Object.defineProperty(this, '__vue_app__', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: app,
      })
      watchRoot(this)
    },
    get(): undefined {
      return undefined
    },
  })
}

/**
 * **jsdom에 없는 반영 속성을 채운다.** 브라우저에서는 `el.inert = true`·`el.ariaDisabled = 'true'`가
 * 속성으로 서서 잠그는데 jsdom은 그 셋을 모른다 — 그대로 두면 이 길로 건 잠금이 검사에서만 조용하다.
 * 브라우저처럼 속성에 반영해 관찰자가 보게 한다.
 */
function reflectMissing(): void {
  const define = (prototype: object, property: string, attribute: string, flag: boolean): void => {
    if (property in prototype) return
    Object.defineProperty(prototype, property, {
      configurable: true,
      get(this: Element) {
        return flag ? this.hasAttribute(attribute) : this.getAttribute(attribute)
      },
      set(this: Element, value: unknown) {
        if (flag) this.toggleAttribute(attribute, Boolean(value))
        else if (value === null || value === undefined) this.removeAttribute(attribute)
        else this.setAttribute(attribute, String(value))
      },
    })
  }
  define(HTMLElement.prototype, 'inert', 'inert', true)
  define(Element.prototype, 'ariaDisabled', 'aria-disabled', false)
  define(Element.prototype, 'ariaReadOnly', 'aria-readonly', false)
}

/** 모은 것을 넘기고 비운다. 쌓인 관찰 기록을 먼저 처리하고, 관찰하던 화면을 통째로 한 번 훑는다. */
function take(): string[] {
  if (observer !== null) handle(observer.takeRecords())
  const seen = new Set<Instance>()
  for (const root of roots) inspectTree(root, seen)
  const caught = [...found]
  found.clear()
  return caught
}

/** 검사 사이에 관찰을 새로 건다. 지난 검사의 그릇을 붙들지 않는다. */
function reset(): void {
  observer?.disconnect()
  roots.clear()
  watchRoot(document)
}

if (HAS_DOM) {
  // **부품 목록과 판정은 등록부에서 읽는다** — 여기 다시 적으면 두 벌이 된다. jsdom 스펙만 치르는
  // 값이다(화면을 띄우는 스펙은 어차피 등록부를 들인다).
  const { LOCK_PRIMITIVES, lockingAttr, isForwardedAttr } = await import('../../src/locks')
  registry = {
    primitives: new Set(LOCK_PRIMITIVES.map((one) => one.file)),
    lockingAttr,
    isForwardedAttr,
  }
  observer = new MutationObserver(handle)
  reflectMissing()
  catchAppContainers()
  watchRoot(document)

  /**
   * 그물을 검사하는 스펙이 부른다(`lock-net.spec.ts`). 넘긴 것은 비워지므로 그 검사는 이 그물에
   * 걸려 실패하지 않는다.
   */
  ;(globalThis as { __lockNet?: { take: () => string[] } }).__lockNet = { take }

  afterEach(async () => {
    await Promise.resolve()
    const caught = take()
    reset()
    if (caught.length > 0) {
      throw new Error(
        `LOCK_OUTSIDE_PRIMITIVE: a lock was written by a component that src/locks.ts does not list as a primitive, or a primitive was handed a lock:\n${caught.join('\n')}`,
      )
    }
  })
}
