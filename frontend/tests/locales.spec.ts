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
import { FEATURE_NOTES, requiredTargetKind } from '../src/ml/selection'
import {
  CATEGORICAL_ENCODINGS,
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
  const kindSpecific = (step: StepId, slot: 'purpose' | 'locked'): boolean =>
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
})
