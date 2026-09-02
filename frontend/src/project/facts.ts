/**
 * 데이터 종류마다 "준비됐는가"를 답하는 자리.
 *
 * **`factsOf`가 표를 전제하고 있었다** — 타깃 열과 특성 열이다. 이미지에는 열이 없고,
 * 같은 질문에 범주와 사진이 답한다 (open-decisions.md "이미지에서 체크리스트 세 항목은
 * 무엇인가").
 *
 * **Vue가 없다.** 화면 등록부(`data/kinds.ts`)에 붙이면 사실을 뽑는 순수 함수의 검사가
 * 컴포넌트를 끌고 온다 (architecture.md §9.2.3의 스키마 등록부와 같은 사정).
 */

import { MIN_CLASSIFICATION_CATEGORIES } from '@/limits'
import type { ProjectFile } from '@/project/format'
import { labeledCategoryCount, readImages } from '@/project/images'
import { dataSettings, type DataType } from '@/project/schema'

/**
 * 데이터 쪽이 답하는 사실들. **`ProjectFacts`의 부분집합이고 이름이 같다.**
 *
 * 이름을 종류마다 가르지 않는 이유는, 가르면 같은 자리를 뜻하는 이름이 둘이 되고
 * 잠금표(`router/steps.ts`의 `STEPS.requires`)가 종류마다 갈리기 때문이다. 갈리는 것은
 * **문구뿐**이다.
 */
export interface DataFacts {
  readonly datasetReady: boolean
  readonly targetChosen: boolean
  readonly featuresChosen: boolean
}

/**
 * 종류별 판정.
 *
 * **`Record<DataType, …>`이라 종류를 더하는 사람은 칸을 채워야 한다.** 빠뜨리면
 * 컴파일이 깨진다 (architecture.md §9.3).
 */
export const DATA_FACTS: Readonly<Record<DataType, (file: ProjectFile) => DataFacts>> = {
  tabular: (file) => {
    const data = dataSettings('tabular', file.document.settings)
    return {
      // 참조와 본체는 함께 있고 함께 없다 (mlpx-spec.md §1). 본체를 보는 이유는
      // 화면이 알고 싶은 것이 "보여줄 표가 있는가"라서다.
      datasetReady: file.dataset !== undefined,
      targetChosen: data.target !== undefined,
      featuresChosen: data.features.length > 0,
    }
  },
  image: (file) => {
    return {
      datasetReady: readImages(file).length > 0,
      /**
       * **"갈릴 것이 없다"가 판정이다.** 범주가 하나면 분류가 성립하지 않는다 —
       * 층화가 갈리는 값에서만 뜻이 있는 것과 같은 모양이다
       * (open-decisions.md "이미지 프로젝트의 데이터 화면").
       *
       * **[학습하기]의 거절이 같은 것을 센다** (`ml/training-source.ts`의
       * `IMAGE_TOO_FEW_CATEGORIES`). 그래서 세는 함수도 그 수도 하나다 —
       * `labeledCategoryCount`와 `MIN_CLASSIFICATION_CATEGORIES`.
       *
       * **한때 유형 카드가 이것으로 잠겼고, 2026-09-03에 걷어냈다**
       * (architecture.md §10.5). 이 체크리스트는 **고른 유형**으로 좁혀지므로 군집을
       * 고르면 이 항목이 사라지는데, 카드는 **제 유형**으로 좁혀 그 항목을 요구했다 —
       * 잠금을 풀 방법이 화면에서 사라진 채로 잠겼다.
       *
       * **`_unlabeled`는 안 센다.** 범주가 아니라 상태이고, 그 사진들은 분류 학습에
       * 안 들어간다.
       */
      targetChosen: labeledCategoryCount(file) >= MIN_CLASSIFICATION_CATEGORIES,
      /**
       * **학생이 특성을 안 고른다. 백본이 만든다.** 그래서 `true`인 것이 아니라
       * **항목이 아니다** — 체크리스트에서 빠지는 것은 `router/steps.ts`의 종류 축이
       * 한다. 여기서 `false`를 주면 학습 단계에 영원히 못 들어간다.
       */
      featuresChosen: true,
    }
  },
}

/** 이 프로젝트의 종류가 답하는 사실들. */
export function dataFactsOf(file: ProjectFile): DataFacts {
  return DATA_FACTS[file.document.manifest.dataType](file)
}
