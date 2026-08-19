/**
 * **어휘와 `formatVersion`이 함께 움직이는지 검사한다.**
 *
 * 규칙이 배포 전후로 정반대다 (mlpx-spec.md §9).
 *
 * | | 어휘를 바꾸면 | 버전을 올리면 |
 * |---|---|---|
 * | 배포 전 | 지문만 고친다 | **실패한다** — 올릴 이유가 없다 |
 * | 배포 뒤 | **실패한다** — 버전을 올려야 한다 | 새 지문과 마이그레이션을 요구한다 |
 *
 * 이 파일이 없으면 두 방향 모두 사람의 기억에 달린다. **배포 뒤에 어휘를 바꾸고 버전을
 * 안 올리는 것이 특히 위험하다** — 신버전이 만든 파일을 구버전 앱이 조용히 열어서
 * `z.enum`이 모르는 값을 만나고, 학생은 "파일이 손상됐습니다"를 본다. 그때 파일은
 * 멀쩡하다.
 *
 * **지문은 버전마다 한 줄씩 쌓인다.** 한 번 배포된 버전의 줄은 역사이므로 고치지 마라.
 * 그 줄이 있어야 "v1은 무엇이었나"에 답할 수 있고, 마이그레이션 함수가 무엇을 받는지도
 * 거기서 나온다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles } from './fixtures/source'

import { SOURCE_ENCODINGS } from '../src/data/encoding'
import { CANONICAL_FORMAT_IDS } from '../src/data/image/formats'
import { TRAINING_LOCATIONS } from '../src/ml/backend'
import { MIGRATIONS } from '../src/project/migrate'
import {
  CATEGORICAL_ENCODINGS,
  DATA_TYPES,
  FORMAT_VERSION,
  MISSING_STRATEGIES,
  MODEL_OMISSION_REASONS,
  PORTFOLIO_ANSWER_FORMATS,
  RUN_STATUSES,
  SCALING_METHODS,
  SPLIT_METHODS,
  TASK_TYPES,
} from '../src/project/schema'

/**
 * **배포 선을 넘었다** (2026-08-15). 스키마 최종 감사에서 어휘 열둘에 빠진 값도, 이름이
 * 잘못 굳는 값도 없다는 판정을 받고 뒤집었다.
 *
 * **아래 지문 표의 `1:` 줄은 이제 역사다 — 고치지 마라.** 어휘를 바꾸려면 `FORMAT_VERSION`을
 * 올리고, 새 버전의 지문을 더하고, `migrate.ts`에 변환 함수를 붙인다. 어휘가 늘면 구버전
 * 앱이 못 여는 파일이 생기는데, 그것이 의도한 동작이다.
 */
const RELEASED = true

/**
 * 스키마가 `z.enum`으로 막는 어휘 전부. **키 이름은 소스의 상수 이름과 같아야 한다** —
 * 아래 "빠뜨린 어휘가 없다"가 소스를 훑어 대조하기 때문이다.
 */
const CURRENT: Readonly<Record<string, readonly string[]>> = {
  TASK_TYPES,
  DATA_TYPES,
  MISSING_STRATEGIES,
  SCALING_METHODS,
  CATEGORICAL_ENCODINGS,
  SPLIT_METHODS,
  RUN_STATUSES,
  MODEL_OMISSION_REASONS,
  PORTFOLIO_ANSWER_FORMATS,
  SOURCE_ENCODINGS,
  TRAINING_LOCATIONS,
  CANONICAL_FORMAT_IDS,
}

/**
 * 버전마다 그 버전의 어휘.
 *
 * **배포된 버전의 줄은 절대 고치지 마라.** 고치는 순간 이 검사는 아무것도 안 지킨다 —
 * 무엇과 비교해야 하는지를 잃기 때문이다.
 */
const VOCABULARY_BY_VERSION: Readonly<Record<number, Readonly<Record<string, readonly string[]>>>> =
  {
    1: {
      TASK_TYPES: ['classification', 'regression', 'clustering'],
      DATA_TYPES: ['tabular', 'image'],
      MISSING_STRATEGIES: ['none', 'drop', 'mean', 'median', 'mostFrequent', 'zero'],
      SCALING_METHODS: ['none', 'standard', 'minmax', 'robust'],
      CATEGORICAL_ENCODINGS: ['none', 'onehot', 'ordinal'],
      SPLIT_METHODS: ['holdout', 'provided'],
      RUN_STATUSES: ['done', 'failed'],
      MODEL_OMISSION_REASONS: ['overBudget', 'tooLarge', 'engineUnsupported'],
      SOURCE_ENCODINGS: ['utf-8', 'cp949', 'utf-16le', 'utf-16be'],
      TRAINING_LOCATIONS: ['browser', 'server'],
      CANONICAL_FORMAT_IDS: ['webp', 'jpeg'],
      PORTFOLIO_ANSWER_FORMATS: ['plain-v1'],
    },
    /**
     * **v1과 글자 하나 다르지 않다. 그게 맞다** (2026-08-19).
     *
     * v2가 바꾼 것은 백본 id이고 `backboneId`는 `z.string()`이라 §10의 "어휘"가 아니다.
     * **그래도 버전이 오른 이유는 지키는 대상이 다르기 때문이다** — 어휘가 아니라 **같은
     * 문자열이 뜻하는 좌표계**다. 구버전 앱이 새 파일을 조용히 열면 옛 범위로 벡터를
     * 뽑는다 (mlpx-spec.md §9.1).
     *
     * 그래서 아래 "지금 어휘가 기록과 같다"는 v2에서 아무것도 새로 안 막는다. 이 줄이
     * 하는 일은 **다음 사람이 v2의 어휘를 물었을 때 답하는 것**이다.
     */
    2: {
      TASK_TYPES: ['classification', 'regression', 'clustering'],
      DATA_TYPES: ['tabular', 'image'],
      MISSING_STRATEGIES: ['none', 'drop', 'mean', 'median', 'mostFrequent', 'zero'],
      SCALING_METHODS: ['none', 'standard', 'minmax', 'robust'],
      CATEGORICAL_ENCODINGS: ['none', 'onehot', 'ordinal'],
      SPLIT_METHODS: ['holdout', 'provided'],
      RUN_STATUSES: ['done', 'failed'],
      MODEL_OMISSION_REASONS: ['overBudget', 'tooLarge', 'engineUnsupported'],
      SOURCE_ENCODINGS: ['utf-8', 'cp949', 'utf-16le', 'utf-16be'],
      TRAINING_LOCATIONS: ['browser', 'server'],
      CANONICAL_FORMAT_IDS: ['webp', 'jpeg'],
      PORTFOLIO_ANSWER_FORMATS: ['plain-v1'],
    },
  }

const recorded = VOCABULARY_BY_VERSION[FORMAT_VERSION]

describe('어휘와 버전', () => {
  it('지금 버전의 어휘가 기록돼 있다', () => {
    expect(
      recorded,
      `formatVersion ${FORMAT_VERSION}의 지문이 없다. VOCABULARY_BY_VERSION에 추가하라.`,
    ).toBeDefined()
  })

  it('지금 어휘가 기록과 같다', () => {
    // 실패했을 때 무엇을 해야 하는지가 배포 여부에 따라 정반대다.
    const guidance = RELEASED
      ? [
          '**배포 뒤다. 버전을 올려라.**',
          '1. FORMAT_VERSION을 하나 올린다',
          '2. VOCABULARY_BY_VERSION에 새 버전의 지문을 추가한다 (옛 줄은 고치지 마라)',
          '3. project/migrate.ts에 마이그레이션 함수를 추가한다',
          '어휘가 늘어나면 구버전 앱이 못 여는 파일이 생긴다. 그게 의도한 동작이다.',
        ].join('\n')
      : [
          '**아직 배포 전이다. 지문만 고쳐라.**',
          'VOCABULARY_BY_VERSION의 이 버전 줄을 지금 어휘로 맞춘다.',
          '**FORMAT_VERSION은 올리지 마라** — 밖에 나간 파일이 없어 지킬 호환성이 없다.',
        ].join('\n')

    expect(CURRENT, guidance).toEqual(recorded)
  })

  /**
   * **손으로 적은 목록은 새 어휘를 놓친다.** `z.enum`이 하나 늘어도 위 표에 안 적으면
   * 아무 검사도 안 걸린다. 그래서 소스를 직접 본다.
   *
   * **`src/` 전체를 훑는다.** 한때 `project/schema.ts` 한 파일만 읽으면서 제목은
   * "소스의 z.enum을 전부 훑는다"고 말했다 (R9 감사 B-4).
   *
   * **못 보는 것을 밝혀 둔다 — 배열 리터럴로 적은 어휘.** 정규식이 잡는 것은 이름 있는
   * 상수뿐이다. 지금 그런 자리가 하나 있는데(`ml/preprocess.ts`의
   * `z.enum(['numeric', 'categorical'])`) **그것은 `formatVersion`의 어휘가 아니다** —
   * 전처리기 파일의 어휘는 `mlpx-preprocess-v1`이라는 형식 이름이 진다. 어휘를 이름 있는
   * 상수로 두는 것이 이 저장소의 관행이고, 그 관행을 어기면 여기가 못 본다.
   */
  it('빠뜨린 어휘가 없다 - src의 이름 있는 z.enum을 전부 훑는다', () => {
    const used = sourceFiles(join(process.cwd(), 'src')).flatMap((path) =>
      [...readFileSync(path, 'utf-8').matchAll(/z\.enum\(\s*([A-Z][A-Z0-9_]*)\s*\)/g)].map(
        (match) => match[1] ?? '',
      ),
    )

    expect(used.length, '소스에서 z.enum을 하나도 못 찾았다. 정규식이 낡았다.').toBeGreaterThan(0)
    expect(
      [...new Set(used)].filter((name) => !(name in CURRENT)).sort(),
      '스키마가 막는 어휘인데 지문에 없다. CURRENT와 VOCABULARY_BY_VERSION에 함께 추가하라.',
    ).toEqual([])
  })
})

describe('배포 전에는 버전이 안 올라간다', () => {
  it.skipIf(RELEASED)('formatVersion이 1이다', () => {
    // **이 검사가 이 파일의 절반이다.** 배포 전에 버전을 올리는 것은 아무도 안 겪을
    // 상황을 위해 변환 함수와 왕복 테스트를 영구히 지고 가는 일이다 (mlpx-spec.md §9).
    // 어휘를 바꿨다면 위의 지문만 고치면 된다.
    expect(FORMAT_VERSION, '배포 전에는 버전을 올리지 않는다. 어휘를 바꿨다면 지문만 고쳐라.').toBe(
      1,
    )
  })

  it.skipIf(RELEASED)('지문이 한 벌뿐이다 - 역사가 아직 없다', () => {
    expect(Object.keys(VOCABULARY_BY_VERSION)).toEqual(['1'])
  })
})

describe('배포 뒤에는 역사가 남는다', () => {
  it.skipIf(!RELEASED)('1부터 지금 버전까지 지문이 전부 있다', () => {
    // 마이그레이션 함수가 무엇을 받는지는 그 버전의 지문에서 나온다. 빠지면 옛 파일을
    // 어떤 규칙으로 해석해야 하는지 알 방법이 없다.
    const missing = []
    for (let version = 1; version <= FORMAT_VERSION; version += 1) {
      if (!VOCABULARY_BY_VERSION[version]) missing.push(version)
    }
    expect(missing).toEqual([])
  })

  it.skipIf(!RELEASED)('지금 버전보다 낮은 모든 버전에 마이그레이션이 있다', () => {
    // migrate.spec.ts도 같은 것을 보지만 여기서 한 번 더 본다 - 버전을 올리는 사람이
    // 이 파일을 고치게 되므로, 잊었을 때 걸리는 자리가 여기여야 한다.
    const missing = []
    for (let version = 1; version < FORMAT_VERSION; version += 1) {
      if (!MIGRATIONS[version]) missing.push(version)
    }
    expect(missing, '버전을 올렸으면 그 버전으로 가는 마이그레이션도 있어야 한다.').toEqual([])
  })
})
