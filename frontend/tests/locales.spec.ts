// @vitest-environment jsdom
// 양식 출처 등록부를 통해 `i18n.ts`에 닿고, 그 파일에 DOM 부재 가드가 있다.
// 밝히지 않으면 그 가드의 대체 경로를 검사하게 된다 (ui-rules.spec.ts).
/**
 * 로케일 파일 사이의 계약.
 *
 * 키 집합이 같아야 하고, 각 문장의 보간 변수도 같아야 한다.
 * 번역하다 {limitMb} 하나를 빠뜨리면 사용자는 숫자 없는 문장을 보게 된다.
 * CI 스크립트가 errors.py까지 포함해 같은 검사를 하지만, 개발 중에 즉시 잡히도록 여기도 둔다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CLIENT_ERROR_CODES,
  CLIENT_WARNING_CODES,
  ENTRY_HASH_STATUSES,
  FILE_HASH_STATUSES,
  REPRODUCTION_STATUSES,
  SHARED_ERROR_CODES,
  errorMessageKey,
} from '../src/errors'
import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { ALGORITHMS } from '../src/ml/algorithms'
import { ENGINE_STATES, RUNTIMES, TRAINING_LOCATIONS, UNAVAILABLE_REASONS } from '../src/ml/backend'
import { parametersFor } from '../src/ml/hyperparams'
import { metricsOf } from '../src/ml/metrics'
import { PER_CLASS_METRICS } from '../src/ml/results'
import { COLUMN_KINDS } from '../src/ml/preprocess'
import { FEATURE_NOTES, requiredTargetKind } from '../src/ml/selection'
import { EXPORT_STATES } from '../src/project/export-state'
import { TEMPLATE_SOURCES } from '../src/project/portfolio-sources'
import {
  CATEGORICAL_ENCODINGS,
  DATA_TYPES,
  MISSING_STRATEGIES,
  MODEL_OMISSION_REASONS,
  SCALING_METHODS,
  TASK_TYPES,
} from '../src/project/schema'
import {
  isStepUnlocked,
  KIND_SPECIFIC_STEP_TEXT,
  NO_FACTS,
  STEP_IDS,
  stepTasks,
  type StepId,
  type StepTextSlot,
} from '../src/router/steps'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      flat.set(path, value)
    } else {
      for (const [nested, nestedValue] of flatten(value, path)) {
        flat.set(nested, nestedValue)
      }
    }
  }
  return flat
}

/**
 * 문장 안의 보간 변수 이름들. **중복은 지운다.**
 *
 * 복수 규칙(`|`)이 있는 문장은 같은 변수가 형태마다 한 번씩 나온다 -
 * 영어는 "{count} project | {count} projects"로 둘, 한국어는 하나다. 세는 방식으로
 * 비교하면 **규칙대로 쓴 문장이 실패한다** (docs/i18n.md 규칙 4).
 * 여기서 보려는 것은 "번역하다 변수를 빠뜨렸는가"이므로 이름의 집합이면 충분하다.
 */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ''))].sort()
}

const english = flatten(en as Tree)
const korean = flatten(ko as Tree)

/** vitest는 vite.config.ts가 있는 곳에서 돈다. cwd가 frontend/ 다. */
const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

/**
 * 실제로 실어 보내는 언어들. **`src/i18n.ts`에서 가져오지 않는다** — 그 모듈은 화면
 * 환경(navigator·document)에 닿아서, 이 스펙이 node 환경인 채로는 못 읽는다. 그리고
 * 여기서 물어야 하는 것은 "실린 언어마다 이름이 있는가"이므로 파일 목록이 곧 답이다.
 */
const LOCALE_TAGS = readdirSync(join(SRC, 'locales'))
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => entry.replace(/\.json$/, ''))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry) ? [path] : []
  })
}

describe('로케일 파일', () => {
  it('키 집합이 완전히 같다', () => {
    expect([...korean.keys()].sort()).toEqual([...english.keys()].sort())
  })

  it('값의 앞뒤에 공백이 없다', () => {
    // **화면에서는 안 보이고 diff에서도 안 보인다.** 실제로 문장 끝에 공백 하나가
    // 딸려 들어왔다 (2026-08-13). 붙여 쓰는 자리(배지·버튼)에서는 칸이 한 칸 어긋나고,
    // 두 언어 중 한쪽에만 있으면 아무도 그 차이를 못 찾는다.
    const ragged = [...english.entries(), ...korean.entries()]
      .filter(([, value]) => value !== value.trim())
      .map(([key]) => key)
    expect([...new Set(ragged)]).toEqual([])
  })

  it('모든 값이 비어 있지 않다', () => {
    for (const [key, value] of [...english, ...korean]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('같은 키의 보간 변수가 같다', () => {
    for (const [key, message] of english) {
      expect(placeholders(korean.get(key) ?? ''), key).toEqual(placeholders(message))
    }
  })

  it('필요한 네임스페이스가 모두 있다', () => {
    for (const namespace of [
      'errors',
      'stages',
      'fileHash',
      'entryHash',
      'reproduction',
      'engineState',
      'modelOmission',
      'portfolio',
      'language',
      'client',
      'steps',
      'taskTypes',
      'common',
      'algorithms',
      'runtimes',
      'hyperparams',
      'missingStrategy',
      'scalingMethod',
      'categoricalEncoding',
      'preprocess',
      'train',
    ]) {
      expect([...english.keys()].some((key) => key.startsWith(`${namespace}.`))).toBe(true)
    }
  })
})

describe('프런트엔드 전용 코드', () => {
  it('코드마다 문장이 있다', () => {
    // 경고도 같은 네임스페이스를 쓴다 - client.*가 가리키는 것은 "실패"가 아니라
    // "프런트엔드가 만든 코드"다 (errors.ts의 CLIENT_WARNING_CODES).
    for (const code of [...CLIENT_ERROR_CODES, ...CLIENT_WARNING_CODES]) {
      expect(english.has(`client.${code}`), code).toBe(true)
      expect(korean.has(`client.${code}`), code).toBe(true)
    }
  })

  /**
   * **`docs/error-codes.md`가 코드를 하나도 안 빠뜨렸는가.**
   *
   * 그 문서는 "학생이 할 일이 다르니 코드를 나눈다"를 설명하는 자리라, 새 코드가 가장
   * 들어가야 할 곳이 거기다. 그런데 코드↔문서 대조를 아무도 안 봐서 실제로 하나가
   * 빠졌다 (`SAMPLE_STRATIFY_IMPOSSIBLE`, 2026-08-12 감사 B-4). **검사가 없으면 다음에도
   * 또 빠진다.**
   *
   * **문장이 아니라 등장 여부만 본다.** 설명이 맞는지는 기계가 모르고, 여기서 문구까지
   * 요구하면 문서를 고칠 때마다 검사가 운다.
   */
  it('에러 코드 문서에 빠진 코드가 없다', () => {
    const doc = readFileSync(join(process.cwd(), '..', 'docs', 'error-codes.md'), 'utf-8')
    const missing = [...CLIENT_ERROR_CODES, ...CLIENT_WARNING_CODES].filter(
      (code) => !doc.includes(code),
    )
    expect(missing).toEqual([])
  })

  it('client.* 에 쓰이지 않는 키가 없다', () => {
    const declared = new Set<string>([...CLIENT_ERROR_CODES, ...CLIENT_WARNING_CODES])
    const used = [...english.keys()]
      .filter((key) => key.startsWith('client.'))
      .map((key) => key.slice('client.'.length))
    expect(used.filter((key) => !declared.has(key))).toEqual([])
  })

  it('선택 불가 이유가 전부 코드 목록 안에 있다', () => {
    // errors.ts가 클라이언트 코드의 단일 출처다. ml/backend.ts가 따로 늘어나면 안 된다.
    const declared = new Set<string>(CLIENT_ERROR_CODES)
    for (const reason of UNAVAILABLE_REASONS) {
      expect(declared.has(reason), reason).toBe(true)
    }
  })

  it('공유 코드는 errors.* 에서 찾는다', () => {
    // 백엔드가 정의한 코드다. client.* 에 복제하면 같은 문장이 두 곳에 생기고
    // 번역이 갈라진다. 단일 출처는 backend/app/errors.py다.
    for (const code of SHARED_ERROR_CODES) {
      expect(errorMessageKey(code), code).toBe(`errors.${code}`)
      expect(english.has(`errors.${code}`), code).toBe(true)
      expect(korean.has(`errors.${code}`), code).toBe(true)
      expect(english.has(`client.${code}`), code).toBe(false)
    }
  })

  it('클라이언트 전용 코드는 client.* 에서 찾는다', () => {
    for (const code of CLIENT_ERROR_CODES) {
      expect(errorMessageKey(code), code).toBe(`client.${code}`)
    }
  })

  it('무결성 어휘가 로케일과 양방향으로 일치한다', () => {
    // 확인이 전부 브라우저에서 끝나므로 백엔드 errors.py에 이 어휘가 없다.
    // check_locales.py가 못 보는 자리라 여기서 강제한다.
    const pairs = [
      ['fileHash', FILE_HASH_STATUSES],
      ['entryHash', ENTRY_HASH_STATUSES],
      ['reproduction', REPRODUCTION_STATUSES],
      ['engineState', ENGINE_STATES],
      ['modelOmission', MODEL_OMISSION_REASONS],
    ] as const

    for (const [namespace, codes] of pairs) {
      for (const code of codes) {
        expect(english.has(`${namespace}.${code}`), code).toBe(true)
        expect(korean.has(`${namespace}.${code}`), code).toBe(true)
      }
      const declared = new Set<string>(codes)
      const used = [...english.keys()]
        .filter((key) => key.startsWith(`${namespace}.`))
        .map((key) => key.slice(namespace.length + 1))
      expect(used.filter((key) => !declared.has(key))).toEqual([])
    }
  })

  it('무결성 문구에 보증으로 읽히는 낱말을 쓰지 않는다', () => {
    // mlpx-spec.md 7.3. 도구가 보증할 수 있는 것보다 강한 말을 쓰면
    // 교사가 허술한 탐지기를 신뢰하게 된다.
    const integrityKeys = [...english.keys()].filter(
      (key) => key.startsWith('fileHash.') || key.startsWith('entryHash.'),
    )
    for (const key of integrityKeys) {
      expect(english.get(key)?.toLowerCase(), key).not.toContain('verified')
    }
  })

  it('전처리 설정의 어휘가 로케일과 양방향으로 일치한다', () => {
    // 전처리 화면이 이 배열들을 그대로 돌며 선택지를 그린다. 여기가 비면 화면에
    // 로케일 키가 그대로 뜨고, 남으면 아무도 못 보는 문장이 두 언어에 산다.
    const pairs = [
      ['missingStrategy', MISSING_STRATEGIES],
      ['scalingMethod', SCALING_METHODS],
      ['categoricalEncoding', CATEGORICAL_ENCODINGS],
    ] as const

    /**
     * **스케일링 기준을 읽는 말은 `none`에만 없다** — 안 하는데 기준이 있을 수 없다.
     * 열 표가 그 이름으로 부르므로 나머지 셋에는 반드시 있어야 한다.
     */
    for (const method of SCALING_METHODS) {
      expect(english.has(`scalingBasis.${method}`), method).toBe(method !== 'none')
      expect(korean.has(`scalingBasis.${method}`), method).toBe(method !== 'none')
    }

    for (const [namespace, codes] of pairs) {
      for (const code of codes) {
        expect(english.has(`${namespace}.${code}`), code).toBe(true)
        expect(korean.has(`${namespace}.${code}`), code).toBe(true)
      }
      const declared = new Set<string>(codes)
      const used = [...english.keys()]
        .filter((key) => key.startsWith(`${namespace}.`))
        .map((key) => key.slice(namespace.length + 1))
      expect(used.filter((key) => !declared.has(key))).toEqual([])
    }
  })

  it('특성 참고 문구마다 문장이 있다', () => {
    // 화면이 이 값으로 키를 조립한다 (`ColumnPicker`). **`FEATURE_NOTES`를 늘리는 사람이
    // 문장도 함께 넣게 한다** - 빠지면 열 옆에 키 문자열이 그대로 뜬다.
    //
    // **표 아래에 있다** (docs/i18n.md 규칙 10). "문자 값이 든 열"은 열이 있어야 하는 말이다.
    for (const note of FEATURE_NOTES) {
      expect(english.has(`preprocess.tabular.${note}`), note).toBe(true)
      expect(korean.has(`preprocess.tabular.${note}`), note).toBe(true)
    }
  })

  /**
   * 화면에 이름이 뜨는 지표 전부. **두 곳에서 온다** — 실험 표의 지표(`METRIC_DISPLAY`)와
   * 범주별 표의 열(`PER_CLASS_METRICS`)이다. 뒤엣것은 실험 표에 없는 이름을 셋 갖는다.
   */
  function metricNames(): Set<string> {
    const names = new Set<string>(PER_CLASS_METRICS)
    for (const taskType of TASK_TYPES) {
      for (const display of metricsOf(taskType)) names.add(display.label ?? display.name)
    }
    return names
  }

  it('지표마다 이름과 설명이 있다', () => {
    // 결과 화면이 `metrics.${이름}`으로 조립한다. 지표를 늘리는 사람이 문구도 함께 넣게 한다.
    // **화면 이름은 label이 있으면 label이다** (`f1Macro` -> `f1`, docs/copy.md).
    const names = metricNames()
    expect(names.size).toBeGreaterThan(0)

    for (const name of names) {
      expect(english.has(`metrics.${name}`), name).toBe(true)
      expect(korean.has(`metrics.${name}`), name).toBe(true)
      expect(english.has(`metricHelp.${name}`), name).toBe(true)
      expect(korean.has(`metricHelp.${name}`), name).toBe(true)
    }

    // 남는 이름도 없어야 한다 - 지표를 빼면 문장이 남는다.
    for (const namespace of ['metrics', 'metricHelp'] as const) {
      const used = [...english.keys()]
        .filter((key) => key.startsWith(`${namespace}.`))
        .map((key) => key.slice(namespace.length + 1))
      // `support`는 지표가 아니라 범주별 표의 열이라 metricHelp에만 있다.
      expect(used.filter((key) => !names.has(key) && key !== 'support')).toEqual([])
    }
  })

  it('수식은 있는 지표의 것만 있다', () => {
    // **수식은 선택이다** — 회귀 지표는 한 줄에 안 들어가서 안 넣었고, 화면이 `te()`로
    // 있는지 보고 그린다. 그러므로 "모두 있다"가 아니라 **남는 것이 없다**를 본다.
    const names = metricNames()
    const used = [...english.keys()]
      .filter((key) => key.startsWith('metricFormula.'))
      .map((key) => key.slice('metricFormula.'.length).split('.')[0] ?? '')
    expect([...new Set(used)].filter((name) => !names.has(name))).toEqual([])
  })

  it('열 자료형·내보내기 상태·언어·데이터 종류마다 이름이 있다', () => {
    // 넷 다 화면이 값으로 키를 조립하는 자리다. 값을 늘리는 사람이 문구를 함께 넣게 한다.
    // **포트폴리오 문항은 여기 없다.** 문구가 로케일을 떠나 `public/`의 프리셋 파일로
    // 갔다 - 쓴 사람의 말이라 애초에 번역 대상이 아니다 (mlpx-spec.md §8.5).
    const pairs = [
      ['columnKind', COLUMN_KINDS],
      ['save', EXPORT_STATES],
      ['language', LOCALE_TAGS],
      ['dataTypes', DATA_TYPES],
      ['portfolio.source', TEMPLATE_SOURCES.map((source) => source.id)],
    ] as const

    for (const [namespace, codes] of pairs) {
      for (const code of codes) {
        expect(english.has(`${namespace}.${code}`), code).toBe(true)
        expect(korean.has(`${namespace}.${code}`), code).toBe(true)
      }
    }
  })

  it('등록부의 모델과 실행 방법마다 이름이 있다', () => {
    // **이름은 두 벌이고 서로 독립이다** (open-decisions.md "무엇을 학습할 수 있는지는
    // 서버가 알려준다"). 화면의 "결정 트리 / 순수 JS"는 합친 이름이 아니라 두 번 조회해
    // 조립한 것이다. 그래서 검사도 둘로 나뉜다.
    for (const algorithm of ALGORITHMS) {
      expect(english.has(`algorithms.${algorithm.id}`), algorithm.id).toBe(true)
      expect(korean.has(`algorithms.${algorithm.id}`), algorithm.id).toBe(true)
    }
    for (const runtime of RUNTIMES) {
      expect(english.has(`runtimes.${runtime.id}`), runtime.id).toBe(true)
      expect(korean.has(`runtimes.${runtime.id}`), runtime.id).toBe(true)
    }

    const declared = new Set<string>(ALGORITHMS.map((algorithm) => algorithm.id))
    const used = [...english.keys()]
      .filter((key) => key.startsWith('algorithms.'))
      .map((key) => key.slice('algorithms.'.length))
    expect(used.filter((key) => !declared.has(key))).toEqual([])
  })

  it('손잡이마다 이름이 있다', () => {
    // 서술을 늘리는 사람이 문구를 함께 넣게 만든다. 빠지면 화면에 `maxDepth`가 뜬다.
    const names = new Set<string>()
    for (const runtime of RUNTIMES) {
      for (const algorithm of ALGORITHMS) {
        for (const spec of parametersFor(runtime.id, algorithm.id)) names.add(spec.name)
      }
    }
    expect(names.size).toBeGreaterThan(0)

    for (const name of names) {
      expect(english.has(`hyperparams.${name}`), name).toBe(true)
      expect(korean.has(`hyperparams.${name}`), name).toBe(true)
    }
    const used = [...english.keys()]
      .filter((key) => key.startsWith('hyperparams.'))
      .map((key) => key.slice('hyperparams.'.length))
    expect(used.filter((key) => !names.has(key))).toEqual([])
  })

  it('타깃 자료형을 요구하는 유형마다 그 이유를 적을 자리가 있다', () => {
    // 요구가 있으면 어떤 열의 타깃 칸이 꺼진다. 이유 없이 회색이면 학생에게 고장으로
    // 보인다 - 요구를 하나 더 만드는 사람이 문장도 함께 넣게 한다.
    //
    // **표 아래에 있다** (docs/i18n.md 규칙 10). 요구하는 것이 "타깃 **열**의 자료형"이라
    // 열이 없는 종류에는 이 문장이 성립하지 않는다.
    for (const taskType of TASK_TYPES) {
      const required = requiredTargetKind(taskType)
      if (!required) continue
      expect(english.has(`preprocess.tabular.targetRule.${required.code}`), taskType).toBe(true)
      expect(korean.has(`preprocess.tabular.targetRule.${required.code}`), taskType).toBe(true)
    }
  })

  it('실행 위치마다 이름이 있다', () => {
    for (const location of TRAINING_LOCATIONS) {
      expect(english.has(`execution.${location}`), location).toBe(true)
      expect(korean.has(`execution.${location}`), location).toBe(true)
    }
  })

  it('과제 유형마다 이름이 있고 남는 것이 없다', () => {
    for (const taskType of TASK_TYPES) {
      expect(english.has(`taskTypes.${taskType}`), taskType).toBe(true)
      expect(korean.has(`taskTypes.${taskType}`), taskType).toBe(true)
    }
    const declared = new Set<string>(TASK_TYPES)
    const used = [...english.keys()]
      .filter((key) => key.startsWith('taskTypes.'))
      .map((key) => key.slice('taskTypes.'.length))
    expect(used.filter((key) => !declared.has(key))).toEqual([])
  })

  it('단계마다 탭에 쓸 이름이 있다', () => {
    // 탭바가 STEP_IDS를 그대로 돈다. 여기가 비면 화면에 키가 그대로 뜬다.
    for (const step of STEP_IDS) {
      expect(english.has(`steps.${step}.label`), step).toBe(true)
      expect(korean.has(`steps.${step}.label`), step).toBe(true)
    }
  })

  /**
   * **종류가 갖는 자리는 공통 자리에 없어야 한다** (docs/i18n.md 규칙 10). 여기 문장이
   * 하나 되살아나면 그것이 다시 기본값이 되고, 종류를 더하는 사람이 자기 문장을
   * 빠뜨려도 화면이 멀쩡해 보인다 — `kinds.spec`은 종류가 **선언했는지**만 보므로
   * 그 상태를 못 잡는다. 두 검사가 같은 배열 하나를 본다.
   */
  const kindSpecific = (step: StepId, slot: StepTextSlot): boolean =>
    KIND_SPECIFIC_STEP_TEXT.some((entry) => entry.step === step && entry.slot === slot)

  it('잠기는 단계에는 왜 못 가는지가 있다', () => {
    // 이유 없이 회색으로 죽어 있는 것은 학생에게 고장으로 보인다 (architecture.md §7.3).
    // data와 portfolio는 잠기지 않으므로 이유가 없는 것이 맞다.
    for (const step of STEP_IDS) {
      const locks = !isStepUnlocked(step, NO_FACTS) && !kindSpecific(step, 'locked')
      expect(english.has(`steps.${step}.locked`), step).toBe(locks)
      expect(korean.has(`steps.${step}.locked`), step).toBe(locks)
    }
  })

  it('단계마다 무엇을 하는 곳인지가 있다', () => {
    // 작업 공간 머리가 이걸 쓴다 (architecture.md §8.9).
    for (const step of STEP_IDS) {
      const shared = !kindSpecific(step, 'purpose')
      expect(english.has(`steps.${step}.purpose`), step).toBe(shared)
      expect(korean.has(`steps.${step}.purpose`), step).toBe(shared)
    }
  })

  it('체크리스트 항목마다 문구가 있다 - 어느 기계학습 유형에서든', () => {
    // 여기가 비면 화면에 로케일 키가 그대로 뜬다.
    //
    // **유형을 전부 돈다.** 항목의 집합이 유형마다 다르므로(steps.ts의
    // FACTS_NOT_IN_TASK) 하나만 보면 다른 유형에서만 뜨는 항목을 놓친다. 지금은
    // 군집화가 빼기만 하지만 더하는 유형이 생기면 그때 이 검사가 잡는다.
    for (const taskType of TASK_TYPES) {
      for (const step of STEP_IDS) {
        for (const task of stepTasks(step, NO_FACTS, taskType)) {
          expect(english.has(`tasks.${task.key}`), `${taskType}.${task.key}`).toBe(true)
          expect(korean.has(`tasks.${task.key}`), `${taskType}.${task.key}`).toBe(true)
        }
      }
    }
  })

  it('steps에 단계가 아닌 키가 없다', () => {
    const declared = new Set<string>(STEP_IDS)
    const used = [...english.keys()]
      .filter((key) => key.startsWith('steps.'))
      .map((key) => key.slice('steps.'.length).split('.')[0] ?? '')
    expect([...new Set(used)].filter((key) => !declared.has(key))).toEqual([])
  })
})

describe('화면이 부르는 키가 로케일에 있다', () => {
  /** 정규식 안에 그대로 못 적는다 - 이 파일 자신이 검사 대상이라 조립 자리로 읽힌다. */
  const BACKTICK = String.fromCharCode(96)

  /**
   * **키를 옮기면 참조가 남는다.** 실제로 겪었다 — `preprocess.*`의 모델 쪽 문구를
   * `train.*`으로 옮겼는데 `ModelPicker`가 옛 키를 계속 불러서 화면에 `preprocess.tuning`이
   * 그대로 떴다. 위의 네임스페이스 검사는 "그 네임스페이스에 키가 하나라도 있는가"만
   * 보므로 이걸 못 잡는다.
   *
   * **정적으로 적힌 키만 본다.** `t(\`errors.${code}\`)` 같은 동적 조립은 여기서 확인할
   * 수 없고, 그쪽은 등록부와 로케일을 짝지어 보는 위의 검사들이 맡는다.
   */
  function staticKeys(source: string): string[] {
    // t('a.b') / $t("a.b"). 점이 하나라도 있어야 네임스페이스가 있는 키다.
    return [...source.matchAll(/\$?\bt\(\s*['"]([\w.-]*\.[\w.-]+)['"]/g)].map(
      (match) => match[1] ?? '',
    )
  }

  it('검사기가 정적 키만 골라낸다', () => {
    expect(staticKeys("t('train.tuning')")).toEqual(['train.tuning'])
    expect(staticKeys('t(`errors.${code}`)')).toEqual([])
    // 점이 없는 것은 네임스페이스가 아니다.
    expect(staticKeys("format('a')")).toEqual([])
  })

  it('지금 화면이 부르는 키가 전부 있다', () => {
    const missing: string[] = []
    for (const path of sourceFiles(SRC)) {
      for (const key of staticKeys(readFileSync(path, 'utf-8'))) {
        if (!english.has(key)) missing.push(`${path.slice(SRC.length + 1)}  ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  /**
   * **이름을 조립해 부르는 자리의 앞부분.** `t(`preprocess.${note}`)`처럼 뒤가 값으로
   * 채워지는 호출에서 **앞의 네임스페이스만** 본다.
   *
   * **여기가 잡는 것은 네임스페이스가 통째로 사라진 것뿐이다.** 이 검사만으로 부족하다는
   * 것을 실제로 확인했다 (2026-08-12) — `preprocess.notEncodable`을 `preprocess.tabular.*`로
   * 내리고 `ColumnPicker`의 조립 자리를 안 고쳤을 때, 앞부분 `preprocess.`에 다른 키가
   * 남아 있어서 **이 검사는 조용했다.** 그 자리를 잡는 것은 값 목록과 로케일을 짝지어
   * 보는 검사다 (위의 `FEATURE_NOTES`처럼).
   *
   * 그래도 두는 이유는, 네임스페이스를 통째로 옮기는 일이 지금 실제로 벌어지고 있고
   * 그때는 조립 자리가 소리 없이 빈 곳을 가리키기 때문이다.
   *
   * **뒤는 못 본다.** 값이 무엇이 될지는 여기서 모른다.
   */
  function dynamicPrefixes(source: string): string[] {
    const pattern = new RegExp(
      String.raw`\$?\bt\(\s*` + BACKTICK + String.raw`([\w.-]*\.)\$\{`,
      'g',
    )
    return [...source.matchAll(pattern)].map((match) => match[1] ?? '')
  }

  it('검사기가 조립 자리의 앞부분을 골라낸다', () => {
    expect(dynamicPrefixes('t(`errors.${code}`)')).toEqual(['errors.'])
    expect(dynamicPrefixes('t(`preprocess.tabular.${note}`)')).toEqual(['preprocess.tabular.'])
    // 앞이 통째로 값이면 볼 것이 없다.
    expect(dynamicPrefixes('t(`${key}`)')).toEqual([])
  })

  it('조립해 부르는 자리의 네임스페이스가 비어 있지 않다', () => {
    const keys = [...english.keys()]
    const empty: string[] = []
    for (const path of sourceFiles(SRC)) {
      for (const prefix of dynamicPrefixes(readFileSync(path, 'utf-8'))) {
        if (!keys.some((key) => key.startsWith(prefix))) {
          empty.push(`${path.slice(SRC.length + 1)}  ${prefix}`)
        }
      }
    }
    expect(empty).toEqual([])
  })

  /**
   * **아직 화면이 없는 기능의 어휘.** 여기 있는 것은 "안 쓰이는 것이 정상"이라는 선언이고,
   * 목록에 없는데 안 불리면 아래 검사가 실패한다.
   *
   * **지우지 않고 남기는 이유는 문구가 이미 정해졌기 때문이다.** 무결성 확인 화면과
   * 백엔드 큐는 어휘를 먼저 못 박아 둔 자리라(`docs/architecture.md`), 화면을 만들 때
   * 다시 짓게 하면 같은 것을 두 번 정하게 된다.
   *
   * **화면을 붙이는 사람이 여기서 자기 줄을 지운다.** 안 지워도 아무 일이 안 일어나는
   * 것이 이 목록의 유일한 약점이라, 줄마다 언제 지울 수 있는지를 적어 둔다.
   */
  const NOT_ON_SCREEN_YET: readonly string[] = [
    // 백엔드 큐의 단계. 자가호스팅 백엔드가 서면 상태 표시줄이 부른다.
    'stages.',
    // 무결성 확인과 재실행 대조. 교사용 확인 화면이 V7이다 (roadmap.md).
    'fileHash.',
    'entryHash.',
    'reproduction.',
    // 모델이 파일에 안 담긴 사유. 지금은 담긴 개수만 말하고 사유는 아무 데도 안 뜬다.
    'modelOmission.',
    // 나누기 방식의 이름. 요약이 아직 이 축을 안 보인다.
    'splitMethod.',
    // 프로젝트 정보 화면의 제목. 지금은 대화상자 안에 항목만 있다.
    'identity.title',
    // 포트폴리오 제출 상태. 게시글 모양이 정해지면 쓴다 (open-decisions.md #23).
    'project.done',
    'project.locked',
  ]

  /**
   * **아무 데서도 안 불리는 문장을 두지 않는다** (docs/i18n.md의 CI 목록).
   *
   * 위의 "부르는 키가 다 있는가"와 **반대 방향**이다. 화면이 바뀌면 참조만 사라지고
   * 문장은 두 언어에 그대로 남는다 — 실제로 15개가 그렇게 남아 있었고(2026-08-12에
   * 지웠다), 그중에는 **화면 설계가 바뀌어 못 쓰게 된 문장**과 **한 번도 안 쓰인
   * 문장**이 섞여 있었다. 아무도 못 보는데 번역 감사와 새 언어 추가에는 짐이 된다.
   */
  /**
   * 따옴표 안에 통째로 적힌 것 전부. **`t()` 안만 보면 안 된다** — 등록부가 키를 값으로
   * 들고 있고(`kinds.ts`의 `labelKey`·`stepText`), 토스트도 코드가 키를 넘긴다.
   * 키가 아닌 문자열(`'data.csv'`)은 로케일에 없으므로 저절로 걸러진다.
   */
  function literalKeys(source: string): string[] {
    return [...source.matchAll(/['"`]([A-Za-z][\w-]*(?:\.[\w-]+)+)['"`]/g)].map(
      (match) => match[1] ?? '',
    )
  }

  /**
   * 이름을 조립하는 자리의 앞부분 — **`t()` 안이 아닌 것까지 본다.** 키를 만들어
   * 돌려주는 함수가 있다(`ml/results.ts`의 `whereTrainedKeyOf`, `project/portfolio.ts`).
   * 그것까지 세지 않으면 멀쩡히 쓰이는 문장이 "안 불린다"로 잡힌다.
   */
  function builtPrefixes(source: string): string[] {
    const pattern = new RegExp(BACKTICK + String.raw`([A-Za-z][\w.-]*\.)\$\{`, 'g')
    return [...source.matchAll(pattern)].map((match) => match[1] ?? '')
  }

  it('아무 데서도 안 불리는 키가 없다', () => {
    const used = new Set<string>()
    const prefixes: string[] = [...NOT_ON_SCREEN_YET]
    for (const path of sourceFiles(SRC)) {
      const source = readFileSync(path, 'utf-8')
      for (const key of literalKeys(source)) used.add(key)
      prefixes.push(...builtPrefixes(source))
    }

    const orphans = [...english.keys()].filter(
      (key) => !used.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
    )
    expect(orphans).toEqual([])
  })

  /**
   * **키를 조립해도 되는 자리.** 여기 적힌 앞부분만 조립할 수 있고, 다른 것이 새로
   * 생기면 아래 검사가 실패한다.
   *
   * **조립 자체가 나쁜 것이 아니다.** 값이 닫힌 집합이고 그 집합을 로케일과 짝지어 보는
   * 검사가 있으면, 값이 늘 때 문구가 빠진 것을 그 검사가 잡는다. 위험한 것은 **짝이
   * 없는 조립**이다 — 뒷부분이 실행 중 값이라 정적으로는 아무것도 확인할 수 없고,
   * 화면에는 키 문자열이 그대로 뜬다.
   *
   * **그 일이 실제로 일어났다** (2026-08-13). `steps.`는 세 자리를 다 짝지어 봤는데
   * 그중 둘을 종류 아래로 옮기면서 짝을 지웠고, 조립하는 코드는 그대로 남았다.
   * 그래서 목록을 **선언**으로 만든다 — 조립을 늘리는 사람이 짝도 함께 만들게.
   *
   * 각 줄 옆의 검사가 그 자리의 짝이다.
   */
  const PAIRED_PREFIXES: readonly string[] = [
    'algorithms.', // 등록부의 모델과 실행 방법마다 이름이 있다
    'runtimes.', //   〃
    'hyperparams.', // 손잡이마다 이름이 있다
    'taskTypes.', // 과제 유형마다 이름이 있고 남는 것이 없다
    'tasks.', // 체크리스트 항목마다 문구가 있다
    'steps.', // 단계마다 탭에 쓸 이름이 있다 (label만 조립한다 - ui-rules가 나머지를 막는다)
    'errors.', // 공유 코드는 errors.* 에서 찾는다
    'client.', // 클라이언트 전용 코드는 client.* 에서 찾는다
    'execution.', // 실행 위치마다 이름이 있다
    'engineState.', // 무결성 어휘가 로케일과 양방향으로 일치한다
    'missingStrategy.', // 전처리 설정의 어휘가 로케일과 양방향으로 일치한다
    'scalingMethod.', //   〃
    'scalingBasis.', // 스케일링 방식마다 기준을 읽는 말이 있다 (none만 없다)
    'categoricalEncoding.', //   〃
    'columnKind.', // 열 자료형·내보내기 상태·언어·포트폴리오 문항마다 이름이 있다
    'save.', //   〃
    'language.', //   〃
    'dataTypes.', //   〃
    'portfolio.source.', // 양식 출처마다 이름이 있다
    'portfolio.preset.', // 지원 언어마다 내장 양식 파일이 있다 (portfolio-preset.spec.ts)
    'metrics.', // 지표마다 이름과 설명이 있다
    'metricHelp.', //   〃
    'metricFormula.', // 수식은 있는 지표의 것만 있다
    'preprocess.tabular.', // 특성 참고 문구마다 문장이 있다 + 타깃 자료형 이유
    'preprocess.tabular.targetRule.', //   〃
  ]

  it('조립해 부르는 자리마다 짝이 있다', () => {
    const namespaces = new Set([...english.keys()].map((key) => key.split('.')[0] ?? ''))
    const composed = new Set<string>()
    for (const path of sourceFiles(SRC)) {
      for (const prefix of builtPrefixes(readFileSync(path, 'utf-8'))) {
        // 로케일 키가 아닌 것도 같은 모양이다 (`runs.experiments.${i}`는 파일 안 경로다).
        if (namespaces.has(prefix.split('.')[0] ?? '')) composed.add(prefix)
      }
    }
    expect(composed.size).toBeGreaterThan(0)
    expect([...composed].filter((prefix) => !PAIRED_PREFIXES.includes(prefix))).toEqual([])
  })
})

/**
 * **두 언어가 나란히 말하는가.**
 *
 * 키 집합도 보간 변수도 같은데 **뜻만 갈릴 수 있다.** 실제로 갈렸다 - 사진 준비
 * 문구가 키 둘로 나뉘어 있었고, 한국어는 글자까지 같은데 영어만 `Preparing` /
 * `Preparing photos`로 갈려 있었다(2026-08-13에 키 하나로 합쳤다). **두 문장이 파일의
 * 다른 구역에 떨어져 있으면 사람은 못 본다** - 나란히 놓는 것이 검사가 할 일이다.
 *
 * 한 언어에서 같은 문장이 다른 언어에서 갈리면 둘 중 하나다. **한쪽만 고쳤거나**,
 * 애초에 다른 뜻인데 한 언어가 우연히 같은 말을 쓰는 것이다(`하지 않음`이 스케일링과
 * 인코딩 양쪽에 있는 것처럼). 뒤쪽은 정당하므로 목록에 적어 두고, **적는 행위가 곧
 * 두 언어를 나란히 읽었다는 기록이다.**
 */
/**
 * 문구가 버튼을 이름으로 부르는 자리 — `값을 입력하고 [예측하기]를 누르면`.
 *
 * **버튼 이름이 바뀌면 이 인용이 조용히 거짓말이 된다.** 화면에는 없는 버튼을 누르라고
 * 말하게 되는데, 로케일 검사도 타입도 이것을 못 본다 — 실제로 영어 쪽이 있지도 않은
 * `[Clean up the data]`를 가리키고 있었다(2026-08-14).
 */
function quotedLabels(strings: ReadonlyMap<string, string>): [string, string][] {
  const found: [string, string][] = []
  for (const [key, text] of strings) {
    for (const match of text.matchAll(/\[([^[\]]+)\]/g)) {
      const quoted = match[1]
      if (quoted !== undefined) found.push([key, quoted])
    }
  }
  return found
}

describe('버튼을 이름으로 부르는 문구', () => {
  it('검사기가 없는 이름을 잡는다', () => {
    const strings = new Map([
      ['a', '[없는 버튼]을 누르세요.'],
      ['b', '있는 버튼'],
    ])
    const labels = new Set([...strings.values()])
    expect(quotedLabels(strings).filter(([, name]) => !labels.has(name))).toEqual([
      ['a', '없는 버튼'],
    ])
  })

  it('검사기가 대괄호가 없는 문구는 안 본다', () => {
    expect(quotedLabels(new Map([['a', '누르세요.']]))).toEqual([])
  })

  for (const [locale, strings] of [
    ['ko', korean],
    ['en', english],
  ] as const) {
    it(`${locale}이 부르는 이름이 전부 로케일에 있다`, () => {
      const labels = new Set([...strings.values()])
      expect(quotedLabels(strings).filter(([, name]) => !labels.has(name))).toEqual([])
    })
  }
})

describe('두 언어가 나란히 말한다', () => {
  /**
   * `same`에서 값이 같은데 `other`에서는 갈리는 키 묶음들.
   *
   * 값이 하나뿐인 키는 비교할 짝이 없으므로 보지 않는다.
   */
  function divergentTwins(
    same: Map<string, string>,
    other: Map<string, string>,
  ): readonly (readonly string[])[] {
    const byValue = new Map<string, string[]>()
    for (const [key, value] of same) {
      byValue.set(value, [...(byValue.get(value) ?? []), key])
    }
    return [...byValue.values()]
      .filter((keys) => keys.length > 1)
      .filter((keys) => new Set(keys.map((key) => other.get(key))).size > 1)
      .map((keys) => [...keys].sort())
      .sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''))
  }

  function fingerprint(keys: readonly string[]): string {
    return [...keys].sort().join(' + ')
  }

  /**
   * 갈려도 되는 묶음. **줄마다 왜 갈리는지가 있어야 한다.**
   *
   * 아래 `죽은 줄이 없다`가 이 목록을 지켜본다 - 문구를 고쳐서 더 이상 안 갈리는 줄은
   * 검사가 지우라고 말한다. 그래야 목록이 "예전에 한 번 봐줬다"의 무덤이 되지 않는다.
   */
  const ALLOWED: readonly (readonly string[])[] = [
    // 한국어는 세는 것을 앞 문장이 말해서 `{count}개` 하나로 되지만, 영어는 단위 낱말이
    // 붙고 복수형이 갈린다.
    ['meta.countUnit', 'preprocess.tabular.summaryFeatureUnit'],
    // 한국어는 세는 것마다 단위가 다르다(`개`·`번`·`장`). 영어는 이름을 배지가 말하므로
    // 값 쪽에 붙일 낱말이 없어 셋 다 숫자만 남는다.
    ['meta.countUnit', 'meta.image.countUnit', 'results.experimentCount'],
    // 한국어의 `장`은 세는 단위라 이름 옆에서도 붙지만, 영어의 `photos`는 이름 그
    // 자체라 배지가 이미 말한 낱말이 된다. 혼자 서는 배지는 낱말이 있어야 하고
    // (`1001 photos`), 이름 옆의 값은 숫자만 남아야 한다 (`Photos 1001`).
    ['meta.image.count', 'meta.image.countUnit'],
    // 프로젝트와 포트폴리오 문항은 영구히 없애는 것(Delete)이고 파일은 떼는 것
    // (Remove)이다. 한국어는 셋 다 `지우기`로 굳어 있다.
    ['portfolio.removeConfirm', 'predict.tabular.fileRemove', 'projects.delete'],
    // 레일의 단계 이름에는 줄바꿈 자리를 심어 두었다(`StepRail`). 같은 낱말이지만
    // 글자가 다르다.
    ['preprocess.tabular.effect', 'steps.preprocess.label'],
    // 영어 `None`이 셋을 덮는다. 한국어는 `하지 않음`(전처리를 안 한다)과
    // `없음`(값이 없다)이 다른 말이다.
    ['categoricalEncoding.none', 'meta.none', 'scalingMethod.none'],
    // 체크리스트 항목만 `~하기`다. 영어는 항목도 버튼도 명령형이라 같아진다.
    ['data.image.add', 'predict.image.add', 'tasks.image.datasetReady'],
    // 병기는 그 화면에서 처음 마주치는 자리에만 붙는다(docs/copy.md §2). 영어에는
    // 병기가 없으므로 짝이 하나로 모인다.
    ['meta.tabular.target', 'preprocess.tabular.roleTarget'],
    ['meta.taskType', 'train.taskTitle'],
    // 한국어에 복수 표시가 없어 한 낱말로 모인다. 결과 화면의 배지는 **개수를 세는
    // 자리**(`Experiments 3`)라 복수이고, 예측 필터의 축 이름은 **무엇으로 거르는지**를
    // 가리키는 자리라 옆의 `Model`과 같이 단수다.
    ['predict.filterExperiments', 'results.experiment'],
    // 담은 모델과 예측할 사진에서는 `빼기`, 불러온 파일은 `지우기`다.
    ['predict.image.remove', 'predict.tabular.fileRemove', 'train.removeModel'],
  ]

  const allowed = new Set(ALLOWED.map(fingerprint))

  const twins = [...divergentTwins(korean, english), ...divergentTwins(english, korean)]

  it('검사기가 한쪽만 고쳐진 묶음을 잡는다', () => {
    const same = new Map([
      ['a', '사진 준비 중'],
      ['b', '사진 준비 중'],
    ])
    const other = new Map([
      ['a', 'Preparing'],
      ['b', 'Preparing photos'],
    ])
    expect(divergentTwins(same, other)).toEqual([['a', 'b']])
  })

  it('검사기가 양쪽 다 같은 묶음은 안 잡는다', () => {
    const same = new Map([
      ['a', '완료'],
      ['b', '완료'],
    ])
    const other = new Map([
      ['a', 'Done'],
      ['b', 'Done'],
    ])
    expect(divergentTwins(same, other)).toEqual([])
  })

  it('검사기가 짝 없는 키는 안 본다 - 비교할 것이 없다', () => {
    const same = new Map([
      ['a', '하나'],
      ['b', '둘'],
    ])
    const other = new Map([
      ['a', 'One'],
      ['b', 'Two'],
    ])
    expect(divergentTwins(same, other)).toEqual([])
  })

  it('허용 목록 밖에서 갈리는 묶음이 없다', () => {
    const unexpected = twins.filter((keys) => !allowed.has(fingerprint(keys)))
    expect(unexpected).toEqual([])
  })

  it('허용 목록에 죽은 줄이 없다', () => {
    const live = new Set(twins.map(fingerprint))
    expect(ALLOWED.map(fingerprint).filter((entry) => !live.has(entry))).toEqual([])
  })
})

/**
 * **번역이 빠진 값이 없다.**
 *
 * 키를 새로 만들 때 두 파일에 같은 문장을 넣어 두고 한쪽을 나중에 고치려다 잊는다.
 * 키 집합 검사도 보간 변수 검사도 이것을 못 본다 - 값이 멀쩡히 들어 있기 때문이다.
 * 실제로 `project.done`과 `project.locked`가 한국어 파일에서 `Done`·`Locked`인 채로
 * 남아 있었다. **아직 화면에 안 뜨는 문장이라 아무도 못 봤다.**
 */
describe('번역이 빠진 값이 없다', () => {
  /** 자리표시자와 기호만으로 이루어진 값. 번역할 낱말이 애초에 없다. */
  function hasWords(message: string): boolean {
    return /[A-Za-z]/.test(message.replaceAll(/\{\w+\}/g, ''))
  }

  const HANGUL = /[가-힣]/

  /** 그 언어의 글자가 없어도 되는 자리. **줄마다 왜인지 적는다.** */
  const NOT_TRANSLATED: readonly string[] = [
    // 제품 이름. 언어를 가리지 않는다.
    'app.name',
    // 언어 이름은 그 언어로 적는다 - 한국어 화면에서도 English를 찾을 수 있어야 한다.
    'language.en',
    'language.ko',
  ]

  it('한국어 값에 한글이 있다', () => {
    const missing = [...korean]
      .filter(([key]) => !NOT_TRANSLATED.includes(key))
      .filter(([, value]) => hasWords(value) && !HANGUL.test(value))
      .map(([key]) => key)
    expect(missing).toEqual([])
  })

  it('영어 값에 한글이 없다', () => {
    const leftover = [...english]
      .filter(([key]) => !NOT_TRANSLATED.includes(key))
      .filter(([, value]) => HANGUL.test(value))
      .map(([key]) => key)
    expect(leftover).toEqual([])
  })

  it('검사기가 기호와 자리표시자만 남은 값은 안 잡는다', () => {
    expect(hasWords('{min} ~ {max}')).toBe(false)
    expect(hasWords('{algorithm} · {runtime}')).toBe(false)
    expect(hasWords('Done')).toBe(true)
  })
})
