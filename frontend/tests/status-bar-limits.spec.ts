// @vitest-environment jsdom
/**
 * 상태 표시줄의 **상한 해제 팝오버** (`components/AppStatusBar.vue`).
 *
 * **문구가 상태를 안 보고 있었다** (2026-09-01, 사용자). 켠 뒤에도 *"해제하면 … 수
 * 있습니다"*라고 적었는데, **이미 해제한 사람에게 가정법으로 말하는 것**이라 그 줄만
 * 화면과 어긋났다. 로케일 검사는 이것을 못 본다 — 키도 문장도 멀쩡하고, 틀린 것은
 * **어느 상태에서 어느 키를 고르는가**이기 때문이다.
 *
 * 그래서 여기서는 **두 상태를 실제로 그려 견준다.**
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import AppStatusBar from '../src/components/AppStatusBar.vue'
import { i18n, setLocale } from '../src/i18n'
import { applyLimitsOff } from '../src/limits-switch'
import type { DataType } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'
import { emptyProjectFile } from './fixtures/project'

/**
 * 팝오버를 열고 그 안의 글을 돌려준다. 트리거는 상한 아이콘이 든 단추다.
 *
 * **패널은 `body`로 옮겨 뜬다**(`AppPopover`의 `Teleport`). 그래서 컴포넌트의 글이
 * 아니라 문서의 글을 본다 — 처음에 `view.text()`를 봤다가 빈 손으로 통과할 뻔했다.
 */
/** 마운트한 것들. **끝나면 걷어낸다** — 안 그러면 `document` 리스너가 호출마다 쌓인다. */
const mounted: { unmount: () => void }[] = []

afterEach(() => {
  // **`document.body`를 비우는 것으로는 부족하다** (2026-09-01 감사 C-3). 인스턴스와
  // `pointerdown`·`keydown`·`scroll` 캡처가 남아, 순서가 조금만 바뀌면 다음 호출이
  // **옛 패널을 집는다.**
  for (const view of mounted.splice(0)) view.unmount()
  document.body.innerHTML = ''
})

async function panelText(off: boolean): Promise<string> {
  applyLimitsOff(off)
  document.body.innerHTML = ''
  const view = mount(AppStatusBar, { global: { plugins: [i18n] }, attachTo: document.body })
  mounted.push(view)
  /**
   * **이름으로 찾되 두 이름을 다 받는다** (2026-09-01 감사 B-4). 해제 상태의 접근 가능한
   * 이름에 **상태가 들어갔기 때문이다** — `aria-label`이 안의 글자를 덮어쓰므로, 그 이름이
   * 상태를 안 말하면 보조기술 사용자는 해제된 것을 모른다.
   */
  const names = [i18n.global.t('shell.limits'), i18n.global.t('shell.limitsOpenName')]
  const trigger = view
    .findAll('button')
    .find((one) => names.includes(one.attributes('aria-label') ?? ''))
  expect(trigger, 'the limits trigger must exist').toBeDefined()
  await trigger!.trigger('click')
  const panel = document.querySelector('.popover-panel')
  expect(panel, 'the popover must open').not.toBeNull()
  return panel?.textContent ?? ''
}

/**
 * **`setLocale`이 여기서 보장하는 것은 하나뿐이다** (2026-09-01 감사 C-1) — 로케일이
 * **정해져 있다는 것.** 아래 단언은 전부 `i18n.global.t(...)`로 기대값을 만들므로 어느
 * 언어든 자기 자신과 맞는다. 이 검사가 잡는 것은 **어느 상태에서 어느 키를 고르는가**이고,
 * 그건 스펙 머리말이 선언한 목적 그대로다. **말이 옳은지는 `locales.spec.ts`가 본다.**
 */
beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

afterEach(() => applyLimitsOff(false))

describe('상한 팝오버는 상태마다 다른 말을 한다', () => {
  it('켜기 전에는 앞으로 무슨 일이 날지 말한다', async () => {
    const text = await panelText(false)
    expect(text).toContain(i18n.global.t('shell.limitsApplied'))
    expect(text).toContain(i18n.global.t('shell.limitsRisk'))
    expect(text).not.toContain(i18n.global.t('shell.limitsRiskOn'))
  })

  /**
   * **가정법이 남아 있으면 안 된다.** 이 검사가 막는 것이 정확히 그 한 줄이다 —
   * 켠 사람에게 *"해제하면"*은 이미 지난 이야기다.
   */
  it('켠 뒤에는 지금 무슨 일이 날 수 있는지 말한다', async () => {
    const text = await panelText(true)
    expect(text).toContain(i18n.global.t('shell.limitsReleased'))
    expect(text).toContain(i18n.global.t('shell.limitsRiskOn'))
    expect(text).not.toContain(i18n.global.t('shell.limitsRisk'))
  })

  /** 어느 상태에서도 빠지면 안 되는 줄. 이 설정이 어디까지 미치는지는 늘 말한다. */
  it('기기에만 저장된다는 말은 두 상태에 다 있다', async () => {
    expect(await panelText(false)).toContain(i18n.global.t('shell.limitsDevice'))
    expect(await panelText(true)).toContain(i18n.global.t('shell.limitsDevice'))
  })

  /**
   * **두 상태가 같은 글이면 그 자리는 상태를 안 보는 것이다.** 위 검사들이 키를 하나씩
   * 짚는다면, 이것은 **앞으로 늘어날 줄까지** 함께 본다.
   */
  it('두 상태의 글이 서로 다르다', async () => {
    expect(await panelText(false)).not.toBe(await panelText(true))
  })
})

/**
 * **예상 시간 줄이 프로젝트의 종류를 본다** (2026-09-01 R17 감사 A-2).
 *
 * 조각은 둘 다 검사를 갖고 있었다 — `estimate.spec.ts`가 `hasEstimates`를 재고 이
 * 파일이 팝오버를 쟀다. **그런데 그 둘을 잇는 것이 하나도 없어서**, 조건을 통째로
 * 뒤집어 사진과 표를 뒤바꿔 말하게 해도 **2675개가 전부 초록이었다**(돌연변이 M3).
 * 사진 학생은 *"학습 화면의 예상 시간이 말해 줍니다"*를 읽고 그 화면에 가서 **모든
 * 줄이 `알 수 없음`인 것**을 본다. 이 저장소가 R10에서 이미 이름 붙인 병이다.
 */
describe('예상 시간 줄이 데이터 종류를 본다', () => {
  async function estimateLine(dataType: DataType | undefined): Promise<string> {
    const store = useProjectStore()
    if (dataType === undefined) store.file = null
    else {
      const file = emptyProjectFile()
      file.document.manifest.dataType = dataType
      store.file = file
    }
    return panelText(true)
  }

  it('사진도 학습 화면을 가리킨다', async () => {
    expect(await estimateLine('image')).toContain(i18n.global.t('shell.limitsEstimate'))
  })

  it('표는 학습 화면을 가리킨다', async () => {
    expect(await estimateLine('tabular')).toContain(i18n.global.t('shell.limitsEstimate'))
  })

  /** 프로젝트가 없으면 아직 무엇을 학습할지도 안 정해졌다. 표 쪽 문장이 맞다. */
  it('프로젝트가 없으면 표 쪽으로 말한다', async () => {
    expect(await estimateLine(undefined)).toContain(i18n.global.t('shell.limitsEstimate'))
  })

  /**
   * **이제 종류마다 같은 말을 한다** (2026-09-03).
   *
   * 여기 있던 검사는 *"사진과 표의 글이 서로 다르다"*였고, 주석에 **"등록부가 사진
   * 기준표를 채우는 날 이 검사가 빨개지고, 그때 지울 것은 검사가 아니라 갈림 자체다"**라고
   * 적혀 있었다. 그날이 와서 그대로 했다 — 사진 인공신경망의 기준표가 채워졌고, 갈림과
   * 사진 전용 문구를 함께 지웠다.
   *
   * **남은 문장 하나가 그 자리를 덮는다**: *"아직 측정하지 않은 조합은 그 예상도 나오지
   * 않습니다."* 안 잰 칸은 종류가 아니라 **조합**마다 있다.
   */
  it('종류가 문구를 가르지 않는다 - 갈림을 지웠다', async () => {
    expect(await estimateLine('image')).toBe(await estimateLine('tabular'))
  })
})

/**
 * **해제 상태가 보조기술에도 간다** (2026-09-01 감사 B-4).
 *
 * `aria-label`은 **안의 글자를 덮어쓴다.** 그래서 `이 기기의 상한` 하나만 달아 두었을
 * 때는 화면에 `상한 해제됨`이 보이는데도 **스크린 리더는 그 상태를 한 번도 말하지
 * 않았다.** 색과 글자로만 말하는 셈이라, 그 글자를 붙인 근거(§8.18)와 정면으로 어긋났다.
 */
describe('상한 칩의 이름이 상태를 말한다', () => {
  async function triggerLabel(off: boolean): Promise<string> {
    applyLimitsOff(off)
    document.body.innerHTML = ''
    const view = mount(AppStatusBar, { global: { plugins: [i18n] }, attachTo: document.body })
    mounted.push(view)
    const names = [i18n.global.t('shell.limits'), i18n.global.t('shell.limitsOpenName')]
    const trigger = view
      .findAll('button')
      .find((one) => names.includes(one.attributes('aria-label') ?? ''))
    return trigger?.attributes('aria-label') ?? ''
  }

  it('켜기 전에는 무엇인지만 말한다', async () => {
    expect(await triggerLabel(false)).toBe(i18n.global.t('shell.limits'))
  })

  it('켠 뒤에는 이름이 해제됐다고 말한다', async () => {
    const label = await triggerLabel(true)
    expect(label).toBe(i18n.global.t('shell.limitsOpenName'))
    expect(label).not.toBe(i18n.global.t('shell.limits'))
  })
})

/**
 * **두 문장이 서로의 부분이 아니어야 위 검사가 성립한다** (2026-09-01 감사 C-2).
 *
 * 판 전체를 `toContain`/`not.toContain`으로 훑으므로, `limitsRiskOn`에서 **앞 두 글자만
 * 떨어져 나가면** 그것이 `limitsRisk`의 부분 문자열이 되고 **코드가 옳은데도 빨개진다.**
 * 기대는 옳고 도구가 자리를 안 보는 것이라, 그 전제를 여기서 한 줄로 못 박는다.
 */
describe('두 위험 문장이 서로의 부분이 아니다', () => {
  for (const tag of ['ko', 'en'] as const) {
    it(`${tag}에서 서로를 안 품는다`, async () => {
      await setLocale(tag)
      const risk = i18n.global.t('shell.limitsRisk')
      const riskOn = i18n.global.t('shell.limitsRiskOn')
      expect(risk).not.toContain(riskOn)
      expect(riskOn).not.toContain(risk)
      await setLocale('ko')
    })
  }
})
