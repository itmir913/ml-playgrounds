// @vitest-environment jsdom
// 훅이 다루는 것이 DOM 노드의 네이티브 checked라 실제 요소가 있어야 한다.
/**
 * 확인 모달이 걸린 라디오 그룹의 되돌리기 (`composables/useRadioGroupGuard.ts`,
 * `architecture.md` §8.15).
 *
 * **이 훅은 어떤 스펙에서도 안 불렸다** (R14-2 감사 A-4). `ui-rules.spec.ts`가 지키던
 * 것은 화면에 `register(`라고 **적혀 있는가**였고, 훅 안이 정반대로 동작해도 초록이었다.
 * 실제로 `resync`의 비교를 뒤집어도 저장소 전체가 조용했다.
 *
 * 그때 학생이 보는 것: 파일을 떼겠냐는 모달에서 [취소]를 눌렀는데 **고르지 않은 것들이
 * 전부 켜지고 고른 것만 꺼진다.**
 */

import { describe, expect, it } from 'vitest'

import { useRadioGroupGuard } from '../src/composables/useRadioGroupGuard'

/** 같은 이름으로 묶인 라디오들. 브라우저가 그룹째 `checked`를 옮기는 그 단위다. */
function group(values: readonly string[], checked: string, name = 'split') {
  return values.map((value) => {
    const el = document.createElement('input')
    el.type = 'radio'
    el.name = name
    el.value = value
    el.checked = value === checked
    document.body.append(el)
    return el
  })
}

/** 이름이 서로 다른 라디오들. 배타 규칙이 안 걸려 훅이 만진 것만 남는다. */
function loose(values: readonly string[], checked: string) {
  return values.map(
    (value, index) => group([value], checked === value ? value : '', `loose-${index}`)[0]!,
  )
}

const stateOf = (nodes: readonly HTMLInputElement[]) => nodes.map((one) => one.checked)

describe('그룹째 되돌린다', () => {
  it('실제 값 하나만 켜고 나머지는 전부 끈다', () => {
    const guard = useRadioGroupGuard<string>()
    const nodes = group(['holdout', 'provided'], 'provided')
    guard.register('holdout')(nodes[0])
    guard.register('provided')(nodes[1])

    // 브라우저는 클릭한 순간 이미 그룹 전체를 옮겨 둔 뒤다. 취소하면 여기로 온다.
    guard.resync('holdout')

    expect(stateOf(nodes)).toEqual([true, false])
  })

  it('셋 이상이어도 하나만 켠다 - 옵션 수가 늘어도 훅을 안 고친다', () => {
    const guard = useRadioGroupGuard<string>()
    const nodes = group(['a', 'b', 'c'], 'c')
    nodes.forEach((el, index) => guard.register(['a', 'b', 'c'][index]!)(el))

    guard.resync('b')

    expect(stateOf(nodes)).toEqual([false, true, false])
  })

  /**
   * **이름을 갈라 둔다.** 같은 그룹이면 브라우저(와 jsdom)가 배타 규칙으로 나머지를
   * 스스로 꺼서, 훅이 만졌는지 브라우저가 만졌는지 구분이 안 된다.
   */
  it('사라진 라디오는 등록에서 빠진다 - v-if로 없어진 노드를 붙들지 않는다', () => {
    const guard = useRadioGroupGuard<string>()
    const nodes = loose(['a', 'b'], 'a')
    guard.register('a')(nodes[0])
    guard.register('b')(nodes[1])

    // Vue는 요소가 사라질 때 같은 ref에 null을 준다.
    guard.register('b')(null)
    nodes[1]!.checked = true

    guard.resync('a')

    expect(stateOf(nodes), '등록이 지워진 것은 안 건드린다').toEqual([true, true])
  })

  it('아무것도 등록 안 됐으면 아무 일도 안 일어난다', () => {
    const guard = useRadioGroupGuard<string>()
    const nodes = group(['a', 'b'], 'b')

    expect(() => guard.resync('a')).not.toThrow()
    expect(stateOf(nodes)).toEqual([false, true])
  })
})
