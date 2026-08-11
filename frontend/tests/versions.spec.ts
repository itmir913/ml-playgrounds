/**
 * **버전은 여기서 잠긴다.**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **이 파일이 빨개졌다면, 이 파일을 고치는 것은 거의 확실히 답이 아니다.**
 *
 * 코드 소유자가 **명시적으로 "버전을 올려라"라고 지시하지 않았다면**, 아래 숫자를
 * 새 값에 맞추지 마라. 빨개진 원인은 십중팔구 **버전을 올린 그 변경**이고, 되돌릴
 * 것은 이 파일이 아니라 그쪽이다. 도구가 스스로 기대값을 고치면 잠금은 잠금이
 * 아니게 되고, **그 순간 이 파일은 있으나 마나 한 것이 된다.**
 *
 * 실제로 한 번 일어났다 — `MLJS_ENGINE.version`이 2026-08-05에 `d22eb2e`에서
 * 1에서 2로 올라갔다. 문서 커밋 없이 구현 커밋 안에서 올라갔고, 코드 소유자는
 * 엔진·스키마 버전을 배포 전까지 1로 두고 있었으므로 **지시한 적이 없는 변경이었다.**
 * 그 값은 이제 되돌리지 않는다(실제로 숫자가 달라진 사실을 가리키므로) — 대신
 * 여기에 못을 박아 같은 일이 다시 없게 한다.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **왜 배포 전에는 안 올리는가.** 버전이 하는 일은 **옛 파일과 새 파일을 가르는 것**
 * 인데, 아직 밖에 나간 파일이 하나도 없다(`tests/schema-version.spec.ts`의
 * `RELEASED`가 `false`다). 가를 대상이 없으면 숫자는 뜻을 못 갖는다. 형식이 바뀌어
 * 기존 테스트 프로젝트가 안 맞게 되면 **마이그레이션을 설계하지 말고 그 `.mlpx`를
 * 지운다** — 코드 소유자의 방식이다.
 *
 * **배포 직후 규칙이 뒤집힌다.** `RELEASED`를 `true`로 뒤집는 순간부터 숫자가 움직일
 * 수 있으면 반드시 올려야 하고, **그때 이 파일을 함께 고친다.** 그 시점은 로드맵 V7,
 * 실물 `.mlpx` 감사 뒤다.
 */

import { describe, expect, it } from 'vitest'

import { ENGINES } from '../src/ml/engines'
import { SUPPORTED_MODEL_FORMATS } from '../src/ml/models'
import { FORMAT_VERSION } from '../src/project/schema'
import { DB_VERSION } from '../src/project/storage'

/**
 * 학습 엔진의 버전. `run.engine`에 그대로 들어가고 재실행 대조가 이 값으로 엔진을 가린다.
 *
 * `mljs`가 `'2'`인 사연은 파일 머리말에 있다. 나머지는 전부 `'1'`이고 그대로 둔다.
 */
const PINNED_ENGINES: Readonly<Record<string, string>> = {
  mljs: '2',
  'pyodide-sklearn': '1',
}

/**
 * 담긴 모델을 읽는 형식들. **계열마다 v1로 시작하고 배포 전에는 안 오른다.**
 *
 * `mlpx-linear`만 v1과 v2가 함께 있다 — 로지스틱 회귀가 절편을 갖게 되면서 늘었고
 * (`1610477`), **문서 커밋이 앞에 있어 승인된 변경이다**(`a94a23e`). v1은 그때 담긴
 * 파일을 읽으려고 남아 있다.
 */
const PINNED_FORMATS: readonly string[] = [
  'mlpx-kmeans-v1',
  'mlpx-linear-regression-v1',
  'mlpx-linear-v1',
  'mlpx-linear-v2',
  'mlpx-naive-bayes-v1',
  'mlpx-reference-v1',
  'mlpx-svm-v1',
  'mlpx-tree-v1',
]

/** 잠금이 잘못 통과하지 않게, 무엇을 세고 있는지부터 확인한다. */
describe('잠글 대상이 실제로 있다', () => {
  it('엔진과 형식을 등록부에서 읽어 온다 - 빈 배열이면 아래가 전부 헛돈다', () => {
    expect(ENGINES.length).toBeGreaterThan(0)
    expect(SUPPORTED_MODEL_FORMATS.length).toBeGreaterThan(0)
  })
})

describe('배포 전까지 버전은 움직이지 않는다', () => {
  it('`.mlpx`의 formatVersion은 1이다', () => {
    // 올리라는 지시를 받지 않았다면 이 숫자가 아니라 올린 쪽을 되돌려라.
    expect(FORMAT_VERSION).toBe(1)
  })

  it('IndexedDB 스키마 버전은 2다', () => {
    /**
     * **이것만 성격이 다르다.** 공개 포맷이 아니라 **브라우저에 이미 살아 있는 DB의
     * 마이그레이션 카운터**다. 낮추면 `idb`가 `VersionError`로 여는 것 자체를 거부하므로,
     * 되돌리려면 **쓰던 사람이 저마다 브라우저의 DB를 지워야 한다.** 못 할 일은 아니지만
     * 얻는 것이 없어서 **2로 둔다고 코드 소유자가 정했다 (2026-08-11).** 저장소를 만들던
     * 2026-08-04에 오브젝트 스토어가 늘면서 1에서 2가 됐고, 그 뒤로 안 움직였다.
     *
     * 여기가 빨개졌다면 스토어를 더했거나 인덱스를 바꿨다는 뜻이다. **그 변경이
     * 정말 필요한지부터 코드 소유자에게 물어라.**
     */
    expect(DB_VERSION).toBe(2)
  })

  it('등록된 엔진의 버전이 전부 잠긴 값이다', () => {
    const moved = ENGINES.map((entry) => entry.engine)
      .filter(({ kind, version }) => version !== (PINNED_ENGINES[kind] ?? '1'))
      .map(
        ({ kind, version }) =>
          `${kind}: ${version} (잠긴 값은 ${PINNED_ENGINES[kind] ?? "새 엔진이므로 '1'"})`,
      )
    expect(moved).toEqual([])
  })

  it('잠근 엔진이 사라지거나 이름이 바뀌지 않았다', () => {
    const kinds = ENGINES.map((entry) => entry.engine.kind)
    expect(Object.keys(PINNED_ENGINES).filter((kind) => !kinds.includes(kind))).toEqual([])
  })

  it('잠근 모델 형식이 전부 그대로 등록돼 있다', () => {
    const missing = PINNED_FORMATS.filter((format) => !SUPPORTED_MODEL_FORMATS.includes(format))
    expect(missing).toEqual([])
  })

  it('새로 생긴 모델 형식은 v1이다', () => {
    /**
     * 새 계열이 v1로 등장하는 것은 정상이라 여기를 안 건드려도 통과한다 — V4의 이미지
     * 모델이 그렇게 온다. **막는 것은 기존 계열이 v2, v3로 오르는 것**이다.
     */
    const bumped = SUPPORTED_MODEL_FORMATS.filter(
      (format) => !PINNED_FORMATS.includes(format) && !format.endsWith('-v1'),
    )
    expect(bumped).toEqual([])
  })
})
