/**
 * **압축 파일이나 폴더로 테스트 데이터를 받는 자리의 판정.**
 *
 * 규칙은 `open-decisions.md` "테스트용 zip (`split.method = 'provided'`)"이 갖는다.
 * 여기 있는 것은 그 규칙을 **화면 밖의 순수 함수**로 옮긴 것뿐이다 — 잠기는 것에는
 * gate 함수가 하나 있고 **boolean이 아니라 이유를 돌려준다** (CLAUDE.md §2).
 *
 * **관용적으로 받지 않는다.** 모르는 범주는 채점할 수 없고, 빠진 범주는 재현율이
 * 정의되지 않는다 — "고양이 정확도"가 빈칸인 결과 화면은 학생에게 설명이 안 된다.
 * **예측 가능하게 거부한다**("상위 버전 파일은 거부한다"와 같은 태도다).
 */

import { splitsData } from '@/ml/selection'
import { IMAGE_UNLABELED } from '@/project/format'
import type { TaskType } from '@/project/schema'

export interface TestSetBlock {
  readonly code:
    | 'TEST_IMAGES_NEED_CATEGORIES'
    | 'TEST_IMAGES_CATEGORY_MISSING'
    | 'TEST_IMAGES_CATEGORY_UNKNOWN'
    | 'TEST_IMAGES_UNLABELED'
  readonly params?: Record<string, string | number>
}

/**
 * 올린 테스트용 사진이 **실제로 채점에 쓰이는가.**
 *
 * **군집화는 나누지 않는다** (architecture.md §3.6) — 그러면 올린 사진이 아무 데도 안
 * 쓰이는데, 화면은 "N장으로 채점합니다"라고 말하고 있었다. 표 경로는 같은 상황에서
 * 참을 말한다(요약 카드의 `summaryClustering`), 그래서 **같은 상황에서 두 화면이 다른
 * 말을 했다.**
 *
 * **판정이 화면 밖에 있는 이유는 규칙이다** — 화면에서 과제 유형을 직접 비교하지 않는다
 * (CLAUDE.md §2, `ui-rules.spec.ts`). 표의 요약 카드가 `facts.isClustering`을 받아 쓰는
 * 것과 같은 모양이다.
 *
 * **아직 안 골랐으면 `true`다.** 유형은 학습 화면에서 고르므로 전처리에서는 비어 있는
 * 것이 정상이고, 그때 "안 쓰인다"고 말하면 고르지도 않은 것을 단정하게 된다.
 */
export function scoresWithTestImages(taskType: TaskType | undefined): boolean {
  // **사실은 하나다** — 나누지 않는 유형이면 올린 사진도 쓰이지 않는다. 그 판정을
  // 여기 한 번 더 적으면 표 판과 갈린다 (`ml/selection.ts`의 `splitsData`).
  return splitsData(taskType)
}

/**
 * 지금 이 프로젝트가 테스트용 사진을 받을 수 있는가. **자리 자체의 잠금이다.**
 *
 * **범주가 서기 전에는 잠긴다** — 대조할 목록이 없으면 어떤 사진도 판정할 수 없고,
 * 그 상태에서 열어 두면 학생은 올린 뒤에야 거절당한다. 순서가 강제되는 자리다.
 */
export function testSetBlockFor(categories: readonly string[]): TestSetBlock | null {
  return categories.length === 0 ? { code: 'TEST_IMAGES_NEED_CATEGORIES' } : null
}

/**
 * 올린 사진을 받아도 되는가.
 *
 * **집합이 정확히 같아야 한다.** 어긋난 방향마다 코드를 나눈다 — 빠진 범주는 "그 폴더를
 * 채워라"이고 모르는 범주는 "그 폴더를 빼라"라 **학생이 할 일이 다르다**(`errors.ts`가
 * 코드를 나누는 기준이 그것이다). 뭉치면 고칠 수 있는 것을 못 고친다.
 *
 * **어긋난 이름은 문장 끝 괄호로 간다** (CLAUDE.md §3 규칙 4) — 개수만 말하면 학생이
 * 어느 폴더를 고쳐야 하는지 모른다.
 *
 * @param categories 프로젝트의 범주. `settings.data.categories`가 갖는 순서다.
 * @param uploaded   올린 사진에서 읽어낸 범주. 폴더 이름이 그대로 온다.
 */
export function testZipBlockFor(
  categories: readonly string[],
  uploaded: readonly string[],
): TestSetBlock | null {
  const block = testSetBlockFor(categories)
  if (block) return block

  const found = new Set(uploaded)

  // **폴더 없는 사진이 섞이면 채점이 성립하지 않는다.** 정답이 없기 때문이고, 그래서
  // 어긋난 범주보다 먼저 본다 — 이쪽은 "폴더로 묶어라"이고 저쪽은 "이름을 맞춰라"라
  // 학생이 할 일이 다르다.
  if (found.has(IMAGE_UNLABELED)) return { code: 'TEST_IMAGES_UNLABELED' }

  // **빠진 쪽을 먼저 본다.** 둘 다 어긋난 사진에서 학생이 먼저 할 일은 없는 폴더를
  // 만드는 것이고, 모르는 폴더는 그 과정에서 함께 정리되는 경우가 많다.
  const missing = categories.filter((category) => !found.has(category))
  if (missing.length > 0) {
    return { code: 'TEST_IMAGES_CATEGORY_MISSING', params: { categories: missing.join(', ') } }
  }

  const known = new Set(categories)
  const unknown = [...found].filter((category) => !known.has(category))
  if (unknown.length > 0) {
    return { code: 'TEST_IMAGES_CATEGORY_UNKNOWN', params: { categories: unknown.join(', ') } }
  }

  return null
}
