/**
 * 학습 화면의 **준비 단계도 도는 것으로 치는가** (2026-09-02 R20 A-3).
 *
 * 이미지 학습에는 백본 12.4MB를 받는 준비 단계가 있고, 그동안 `training.running`은
 * 거짓이다. 그 신호만 보던 때 **축이 열려 있었고 나가기도 안 막혔다** — 학생이 그 사이에
 * 모델을 빼면 준비가 끝나며 되돌아갔고, 나가면 닫힌 스토어에 옛 프로젝트가 되살아났다.
 * *"학습 중에 나가면 결과가 없다"*는 대화상자의 문장은 **준비 중에도 참이다.**
 *
 * **여기서 보는 것은 셋이 같은 신호를 보는가이다.** 신호가 갈리면 축은 잠기는데 나가기는
 * 안 막히는 식으로 **화면이 절반만 도는 것으로 친다.**
 *
 * **이것은 모양 검사다.** 여기서 지키는 것은 **"세 자리가 하나의 계산을 본다"까지**이고,
 * 실제로 막히는지와 **언제부터 막히는지**는 `train-preparing-live.spec.ts`가 화면을 띄워
 * 잰다. 그 둘이 갈린 자리가 R21 B-1이었다 — 신호는 하나로 맞았는데 늦게 켜졌다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutComments } from './fixtures/source'

const SOURCE = readFileSync(join(process.cwd(), 'src', 'views', 'TrainView.vue'), 'utf-8')
const CODE = withoutComments(SOURCE).join('\n')

/** `const working = computed(...)`의 몸. 못 찾으면 빈 문자열이 아니라 실패다. */
function workingBody(code: string): string {
  const found = /const working = computed\(([\s\S]*?)\)\n/.exec(code)
  return found?.[1] ?? ''
}

/** 나가기 가드(`onBeforeRouteLeave`)의 몸. */
function leaveGuard(code: string): string {
  const found = /onBeforeRouteLeave\(\(to\) => \{([\s\S]*?)\n\}\)/.exec(code)
  return found?.[1] ?? ''
}

/** 모델 축을 감싼 칸의 여는 태그. `inert`가 여기 붙는다. */
function axesAttributes(code: string): string {
  const found = /<div\n\s+class="min-w-0 transition-opacity[\s\S]*?>/.exec(code)
  return found?.[0] ?? ''
}

describe('준비 단계도 도는 것으로 친다', () => {
  it('신호 하나가 학습과 준비를 둘 다 본다', () => {
    const body = workingBody(CODE)
    expect(body).not.toBe('')
    expect(body).toContain('training.running.value')
    expect(body).toContain('preparing.value')
    // **누른 순간부터다.** `preparing`은 워커의 첫 마디에서야 켜져 창이 남는다 (R21 B-1).
    expect(body).toContain('starting.value')
  })

  it('나가기 가드가 그 신호를 본다', () => {
    const guard = leaveGuard(CODE)
    expect(guard).not.toBe('')
    expect(guard).toContain('working.value')
    // **`training.running`을 직접 보면 준비 중에 그냥 나간다.**
    expect(guard).not.toContain('training.running')
  })

  it('모델 축의 잠금이 같은 신호를 본다', () => {
    const attributes = axesAttributes(CODE)
    expect(attributes).not.toBe('')
    expect(attributes).toContain(':inert="working"')
    expect(attributes).not.toContain('training.running')
  })

  /**
   * **검사기를 검사한다.** 위 셋은 정규식이 아무것도 못 찾아도 빈 문자열끼리 견주면
   * 통과할 수 있는 모양이라, 못 찾는 경우를 실패로 만들어 두었는지 여기서 확인한다.
   */
  it('자리를 못 찾으면 빈 문자열을 돌려준다 - 위 셋이 그것을 실패로 친다', () => {
    expect(workingBody('아무것도 없는 소스')).toBe('')
    expect(leaveGuard('아무것도 없는 소스')).toBe('')
    expect(axesAttributes('아무것도 없는 소스')).toBe('')
  })

  /**
   * 준비를 끊는 손잡이는 여기 있는지만 본다 — **끊는 것이 실제로 되는지는**
   * `training-source.spec.ts`의 "준비를 끊는 손잡이"가 잰다.
   */
  it('떠날 때 준비를 끊는다', () => {
    expect(CODE).toContain('onHandle:')
    const found = /onBeforeUnmount\(\(\) => \{([\s\S]*?)\n\}\)/.exec(CODE)
    expect(found?.[1] ?? '').toContain('preparingHandle?.cancel()')
  })
})
