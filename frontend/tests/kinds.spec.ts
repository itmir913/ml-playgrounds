// @vitest-environment jsdom
/**
 * 데이터 종류 등록부 (`data/kinds.ts`).
 *
 * **jsdom이 필요한 것은 등록부가 판을 지연 로딩으로 들고 있어서다** — 그 줄을 따라가면
 * `components/StepActionBar.vue`에 닿고, 거기에 DOM 부재 분기가 있어서 node 환경에서는
 * **죽는 대신 조용히 대체 경로를 검사하게** 된다.
 *
 * (한때 근거를 "임베딩 클라이언트"라고 적어 두었는데 `src/ml/embed/` 어디에도 가드가
 * 없다 — 가드가 있는 소스는 저장소에 일곱이고 `src/ml/` 아래는 하나도 없다. 근거가
 * 틀리면 다음 사람이 그쪽 가드를 지우면서 이 선언도 지운다. R9 감사 B-3.)
 *
 * **열쇠형 등록부다** (architecture.md §9.2) — 종류 하나에 줄 하나다. 축을 선언하는
 * 등록부(알고리즘·지표 패널)와 달리 타입이 "줄이 빠졌다"를 못 잡는다. 그래서 검사가 본다.
 */

import { describe, expect, it } from 'vitest'

import {
  dataKindFor,
  lockedSentence,
  lockedTextFor,
  stepTextKey,
  SUPPORTED_DATA_TYPES,
} from '../src/data/kinds'
import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { DATA_TYPES } from '../src/project/schema'
import { KIND_SPECIFIC_STEP_TEXT } from '../src/router/steps'

describe('데이터 종류 등록부', () => {
  it('열쇠가 겹치지 않는다', () => {
    // 겹치면 `dataKindFor`가 조용히 첫 줄만 쓴다. 뒷줄은 존재하지 않는 것이 된다.
    expect(new Set(SUPPORTED_DATA_TYPES).size).toBe(SUPPORTED_DATA_TYPES.length)
  })

  it('어휘에 있는데 판이 없는 종류는 화면이 "아직 못 다룬다"고 말한다', () => {
    // 어휘와 등록부는 따로 늘 수 있다 - 어휘를 먼저 늘리는 순간과 판이 생기는 순간
    // 사이가 있다. 그 사이가 던지는 상태가 되면 안 된다.
    for (const dataType of DATA_TYPES) {
      const kind = dataKindFor(dataType)
      if (kind === undefined) continue
      expect(kind.dataType, dataType).toBe(dataType)
      expect(kind.accept, dataType).not.toBe('')
    }
    expect(dataKindFor('그런 종류 없음')).toBeUndefined()
  })

  /**
   * **트립와이어가 여기 있었다.** "종류를 늘리는 사람은 `PreprocessView`와 `TrainView`의
   * 머리 문맥을 판으로 옮겨라"였고, 2026-08-12에 이미지를 등록하면서 실제로 옮겼다 —
   * 그 둘은 이제 `DataKind.prepContext`·`trainContext`가 갖는다. 할 일이 끝났으므로
   * 검사도 지웠다 (트립와이어는 통과가 목적이 아니라 멈추는 것이 목적이다).
   *
   * 대신 **판이 선언해야 할 칸을 빠뜨렸는지는 타입이 잡는다** — `DataKind`의 필드가
   * 전부 필수라 줄을 더하는 사람이 넷을 다 채워야 한다.
   */
  it('등록된 종류마다 화면이 다 있다', () => {
    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      expect(kind?.panel, dataType).toBeDefined()
      expect(kind?.prepPanel, dataType).toBeDefined()
      expect(kind?.prepContext, dataType).toBeDefined()
      expect(kind?.trainContext, dataType).toBeDefined()
      expect(kind?.predictPanel, dataType).toBeDefined()
      // 요약이 빠지면 그 종류의 프로젝트가 "무엇인지"를 아무 데서도 안 말한다.
      expect(kind?.summaryRows, dataType).toBeDefined()
      // 문구가 빠지면 새 프로젝트 대화상자에 이름 없는 칸이 뜬다.
      expect(kind?.labelKey, dataType).toMatch(/^dataTypes\./)
    }
  })

  /**
   * **표도 예외가 아니다** (docs/i18n.md 규칙 10). 전에는 표가 기본값을 쓰고 이미지만
   * 덮었는데, 그러면 **다음에 들어오는 종류가 아무것도 안 써도 화면이 멀쩡해 보인다** —
   * 조용히 표의 말을 하면서. `Partial`이라 타입은 못 잡는 자리다.
   */
  it('모든 종류가 종류를 가리는 단계 문구를 스스로 갖는다', () => {
    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      for (const { step, slot } of KIND_SPECIFIC_STEP_TEXT) {
        expect(
          stepTextKey(kind, step, slot),
          `${dataType}가 ${step}.${slot}의 문장을 안 갖는다 - 기본값이 없는 자리다`,
        ).not.toBe(`steps.${step}.${slot}`)
      }
    }
  })

  /**
   * **등록부가 가리키는 문장이 실제로 있는가.**
   *
   * 이 자리는 다른 어떤 검사도 안 본다. 로케일의 "안 불리는 키" 검사는 `stepTextKey`의
   * 기본값(`steps.${step}.${slot}`)을 조립 자리로 읽어 **`steps.` 아래 전부를 쓰인
   * 것으로 친다** — 그래서 오타 하나면 화면에 키 문자열이 그대로 뜨는데 관문은 초록이다.
   * 실제로 문구를 `steps.{단계}.{종류}` 아래로 옮긴 뒤 오타를 넣어 확인했다.
   */
  it('등록부가 가리키는 문구가 두 언어에 다 있다', () => {
    const value = (locale: object, key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => {
        return typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined
      }, locale)

    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      // 등록부가 키로 들고 있는 것 전부 — 단계 문구, 종류 이름, 준비 진행 문구.
      const named: [string, string][] = [
        ['labelKey', kind?.labelKey ?? ''],
        ...(kind?.preparingKey === undefined ? [] : [['preparingKey', kind.preparingKey]]),
        ...Object.entries(kind?.engineStateKeys ?? {}).map(([state, key]) => [
          `engineStateKeys.${state}`,
          key,
        ]),
        ...Object.entries(kind?.stepText ?? {}).flatMap(([step, slots]) =>
          Object.entries(slots).map(([slot, key]) => [`${step}.${slot}`, key]),
        ),
      ] as [string, string][]

      for (const [where, key] of named) {
        expect(typeof value(ko, key), `ko에 ${key}가 없다 (${dataType} ${where})`).toBe('string')
        expect(typeof value(en, key), `en에 ${key}가 없다 (${dataType} ${where})`).toBe('string')
      }
    }
  })

  /**
   * **종류를 모를 때의 기본값은 막다른 길이다. 그러니 화면이 그것을 부르면 안 된다.**
   *
   * `stepTextKey(undefined, ...)`는 `steps.{단계}.{자리}`를 준다. 종류마다 갈리는
   * 자리에는 그 열쇠를 **일부러 안 두었다** — 공통 자리에 문장을 두면 표의 말이 이미지
   * 화면에 뜨고, 그 사실이 컴파일에서도 검사에서도 안 드러난다 (`KIND_SPECIFIC_STEP_TEXT`).
   *
   * **그래서 화면은 종류를 모르는 동안 그 문장을 안 그린다** — `PreprocessView`·
   * `PredictView`·`ProjectHomeView`가 `kind`로 잠근다. 그 잠금이 풀리면 학생이 화면에서
   * `steps.preprocess.emptyReason`이라는 글자를 본다 (2026-08-29에 실제로 그랬다).
   *
   * **이 검사는 전제를 잠근다.** 누군가 "없는 열쇠니까 만들면 되지"로 고치면 여기가
   * 빨개진다 — 그건 고친 것이 아니라 종류를 안 가리는 문장을 되살리는 것이다.
   * **못 보는 것: 화면에서 잠금이 빠지는 것** — 그건 사람이 본다.
   */
  it('종류를 모를 때의 기본값 열쇠는 로케일에 없다', () => {
    const value = (locale: object, key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => {
        return typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined
      }, locale)

    for (const { step, slot } of KIND_SPECIFIC_STEP_TEXT) {
      const fallback = stepTextKey(undefined, step, slot)
      expect(fallback, `${step}.${slot}`).toBe(`steps.${step}.${slot}`)
      expect(value(ko, fallback), `ko에 ${fallback}이 있으면 안 된다`).toBeUndefined()
      expect(value(en, fallback), `en에 ${fallback}이 있으면 안 된다`).toBeUndefined()
    }
  })

  /**
   * **준비가 있는 종류는 문구 두 벌을 다 갖는다.** 세는 단계(`preparingKey`)만 있고
   * 그전 단계가 없으면, 화면이 공통 어휘로 떨어져 "준비되지 않음"이라고만 말한다 —
   * 무엇이 준비되지 않았는지가 없다. 학생이 이 화면에서 가장 오래 기다리는 자리다.
   */
  it('준비 문구는 두 벌이 함께 선다', () => {
    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      expect(kind?.engineStateKeys === undefined, dataType).toBe(kind?.preparingKey === undefined)
    }
  })

  /** 나머지는 종류를 안 가린다. 덮어쓰면 공통 문장이 종류 수만큼 복제되기 시작한다. */
  it('가리지 않는 단계 문구는 덮어쓰지 않는다', () => {
    const specific = new Set(KIND_SPECIFIC_STEP_TEXT.map(({ step, slot }) => `${step}.${slot}`))
    for (const dataType of SUPPORTED_DATA_TYPES) {
      const kind = dataKindFor(dataType)
      for (const [step, slots] of Object.entries(kind?.stepText ?? {})) {
        for (const slot of Object.keys(slots)) {
          expect(specific, `${dataType}의 ${step}.${slot}은 갈릴 이유가 없다`).toContain(
            `${step}.${slot}`,
          )
        }
      }
    }
  })
})

/**
 * 잠긴 줄의 문장 (`lockedSentence`).
 *
 * **자리표시자를 채우는 두 줄이 화면 둘에 똑같이 복사돼 있었고 아무도 안 태웠다**
 * (2026-08-31 검증 감사 C-3). 안 넘기면 `vue-i18n`이 빈 문자열로 그려서 예외도 안 나고
 * 키도 안 뜨고 **막는 일의 이름만 조용히 사라진다** — `ml/selection.ts`의 `columnNote`가
 * 같은 병으로 A였다.
 *
 * `task`는 값이 아니라 **또 다른 로케일 키**라 한 번 더 번역해서 넣는다.
 */
describe('잠긴 줄에 세울 문장', () => {
  /** 키를 그대로 돌려주되 자리표시자를 실제로 채운다. 진짜 `t()`가 하는 일이다. */
  const translate = (key: string, params?: Record<string, string>) =>
    params === undefined ? key : `${key}(${Object.values(params).join(',')})`

  it('자리표시자가 있으면 채운다', () => {
    const text = { key: 'tasks.lockedBy', params: { task: 'tasks.pickTarget' } }
    expect(lockedSentence(text, translate)).toBe('tasks.lockedBy(tasks.pickTarget)')
  })

  it('넣는 값도 한 번 더 번역한다 - 그것도 키다', () => {
    const seen: string[] = []
    lockedSentence({ key: 'tasks.lockedBy', params: { task: 'tasks.pickTarget' } }, (key) => {
      seen.push(key)
      return key
    })
    expect(seen).toContain('tasks.pickTarget')
  })

  it('자리표시자가 없으면 그냥 그 문장이다', () => {
    expect(lockedSentence({ key: 'steps.train.locked' }, translate)).toBe('steps.train.locked')
  })

  it('막는 일이 있는 잠금은 그 이름을 데려간다', () => {
    const text = lockedTextFor(dataKindFor('tabular'), 'train', ['targetChosen'], 'tabular')
    // 등록부가 손으로 쓴 문장을 안 갖고 있으면 막는 일의 이름을 댄다.
    if (text.params === undefined) return
    expect(lockedSentence(text, translate)).toContain(text.params.task)
  })
})
