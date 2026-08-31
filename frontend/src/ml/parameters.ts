/**
 * 모델이 배운 값을 표로 세운다 (`open-decisions.md` "모델이 무엇을 배웠는지 화면이
 * 보여준다").
 *
 * **여기서 숫자를 만들지 않는다.** 파일에 있는 값을 이름과 짝지어 줄로 세우는 것이
 * 전부다 — 계수를 합치지도, 부호를 뒤집지도, 로그를 되돌리지도 않는다. 그렇게 정한
 * 이유는 **보여주는 숫자가 전부 sklearn과 대조되고 있어야 하기 때문**이고, 우리가
 * 변환을 하나 넣는 순간 그 변환은 아무도 안 본 계산이 된다.
 *
 * **그래서 여기 없는 것들이 있다.** 트리 계열의 특성 중요도(가져다 쓸 구현이 없고
 * `ml-random-forest`의 것은 sklearn과 다른 식이라 음수가 나온다), 수렴 반복 수(수렴한
 * run은 그 값을 안 담는다), SVM·KNN·K-평균(대조가 없거나 대응이 없다). 근거는 결정문에
 * 있다.
 *
 * **어느 형식이 무엇을 보여주는지는 이 파일이 안다. 화면은 모른다** (§9.1).
 */

import type { Experiment } from '../project/schema'
import {
  LINEAR_REGRESSION_FORMAT,
  LINEAR_V2_FORMAT,
  NAIVE_BAYES_FORMAT,
  parseLinearRegression,
  parseLinearV2,
  parseNaiveBayes,
} from './models'
import type { Preprocessor } from './preprocess'

/**
 * 표 하나의 종류. **로케일 키가 여기서 나온다** — 머리글도 설명도 종류마다 다르고,
 * 화면이 형식 이름으로 문구를 고르면 §9.1이 막으려던 분기가 화면에 생긴다.
 */
export type ParameterKind = 'coefficients' | 'means' | 'variances'

/**
 * 종류마다의 표 제목 키. **화면에서 종류 이름을 이어 붙이지 않는다** — 그렇게 부르면
 * CI의 정적 `t()` 검사가 그 키를 못 보고, 짝 검사가 접두사째로 예외를 요구한다
 * (`ml/clusters.ts`의 `clusterSummaryLeadKey`와 같은 자리). 그래서 키를 통째로 적어 두고
 * `tests/parameters.spec.ts`가 세 키가 두 로케일에 다 있는지 본다.
 */
export const PARAMETER_TITLE_KEYS: Readonly<Record<ParameterKind, string>> = {
  coefficients: 'results.parametersCoefficients',
  means: 'results.parametersMeans',
  variances: 'results.parametersVariances',
}

export interface ParameterRow {
  /** 클래스 이름. **회귀는 클래스가 없어 `null`이다.** */
  readonly label: string | null
  /** 특성 순서 그대로. `featureNames`와 자리가 같다. */
  readonly values: readonly number[]
  /** 절편. **평균·분산 표에는 없다.** */
  readonly intercept: number | null
}

export interface ParameterSection {
  readonly kind: ParameterKind
  readonly rows: readonly ParameterRow[]
}

export interface ParameterTable {
  /** 전처리기가 붙인 이름 그대로다. 원핫이면 열 하나가 여럿으로 늘어나 있다. */
  readonly featureNames: readonly string[]
  readonly sections: readonly ParameterSection[]
  /**
   * 스케일링을 켠 채로 배운 모델인가.
   *
   * **꺼져 있으면 계수의 크기를 견줄 수 없다** — 단위가 큰 열의 계수가 작게 나오고,
   * 그건 그 특성이 덜 중요해서가 아니다. 화면이 그 사실을 말할지가 여기서 갈린다.
   */
  readonly scaled: boolean
}

/**
 * 스케일링을 켠 채로 배웠는가.
 *
 * **`settings.data`는 데이터 종류마다 모양이 다른 합집합이라** 필드가 있는지부터 본다.
 * **못 읽으면 안 켠 것으로 본다** — 화면이 그때 "크기를 견주지 말라"를 말하게 되고,
 * 그쪽이 안전한 침묵이다. 반대로 잘못 짚으면 학생이 못 믿을 크기를 견준다.
 */
function isScaled(settings: Experiment['settings']): boolean {
  const data: unknown = settings.data
  if (typeof data !== 'object' || data === null || !('preprocessing' in data)) return false
  const preprocessing: unknown = (data as { preprocessing: unknown }).preprocessing
  if (typeof preprocessing !== 'object' || preprocessing === null) return false
  const scaling: unknown = (preprocessing as { scaling?: unknown }).scaling
  return typeof scaling === 'string' && scaling !== 'none'
}

/** 클래스마다 한 줄. 가중치와 절편이 같은 순서라는 것은 파서가 이미 확인했다. */
function classRows(
  classes: readonly string[],
  rows: readonly ArrayLike<number>[],
  intercepts: ArrayLike<number> | null,
): ParameterRow[] {
  return rows.map((row, index) => ({
    label: classes[index] ?? null,
    values: Array.from(row),
    intercept: intercepts ? (intercepts[index] ?? null) : null,
  }))
}

function sectionsOf(format: string, file: unknown, classes: string[]): ParameterSection[] {
  if (format === LINEAR_REGRESSION_FORMAT) {
    const model = parseLinearRegression(file)
    return [
      {
        kind: 'coefficients',
        rows: [{ label: null, values: [...model.coefficients], intercept: model.intercept }],
      },
    ]
  }

  if (format === LINEAR_V2_FORMAT) {
    const model = parseLinearV2(file)
    classes.push(...model.classes)
    // **이진도 두 줄 그대로다.** sklearn처럼 한 줄로 접으려면 두 배 하는 계산이 생기고,
    // 그 계산은 대조 밖에 있다 (mlpx-spec.md 5.4.1, 결정문 "화면이 정하는 것 셋").
    return [{ kind: 'coefficients', rows: classRows(model.classes, model.rows, model.intercepts) }]
  }

  const model = parseNaiveBayes(file)
  classes.push(...model.classes)
  return [
    { kind: 'means', rows: classRows(model.classes, model.means, null) },
    { kind: 'variances', rows: classRows(model.classes, model.variances, null) },
  ]
}

/** 이 형식이 배운 값을 보여줄 수 있는가. **등록부의 `hasData`가 이것으로 판정한다.** */
export function showsParameters(format: string | undefined): boolean {
  return (
    format === LINEAR_REGRESSION_FORMAT ||
    format === LINEAR_V2_FORMAT ||
    format === NAIVE_BAYES_FORMAT
  )
}

/**
 * 표를 세운다. **하나라도 안 맞으면 `null`이고, 그때 화면은 아무것도 안 그린다**
 * (§9.2 "없는 것을 이름으로 말하지 않는다").
 *
 * 여기 오는 실패는 남이 편집한 파일이거나 전처리기가 안 담긴 파일이다 — 이름 없이
 * 숫자만 늘어놓으면 **몇 번째 계수가 어느 열인지 학생이 알 수 없다.**
 */
export function parameterTableFor(
  format: string | undefined,
  bytes: Uint8Array | undefined,
  preprocessor: Preprocessor | null | undefined,
  settings: Experiment['settings'],
): ParameterTable | null {
  if (!format || !showsParameters(format) || !bytes || !preprocessor) return null

  try {
    const classes: string[] = []
    const sections = sectionsOf(format, JSON.parse(new TextDecoder().decode(bytes)), classes)
    // **이름과 값의 자리가 어긋나면 그리지 않는다.** 길이가 다른 것은 다른 전처리기로
    // 배운 모델이고, 그대로 그리면 엉뚱한 열에 계수가 붙는다.
    const width = sections[0]?.rows[0]?.values.length ?? 0
    if (preprocessor.featureNames.length !== width) return null

    return {
      featureNames: [...preprocessor.featureNames],
      sections,
      scaled: isScaled(settings),
    }
  } catch {
    return null
  }
}
