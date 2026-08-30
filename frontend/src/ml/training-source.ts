/**
 * 학습 화면이 "무엇을 학습에 넘길지"를 얻는 자리. **데이터 종류가 답한다.**
 *
 * 표는 정본을 파싱해서 그대로 넘기면 되지만, 이미지는 **먼저 임베딩을 뽑아야 한다** —
 * 백본 12.4MB를 받고 사진을 한 장씩 통과시키는 동안 화면이 할 말이 있어야 하고, 뽑은
 * 것은 프로젝트에 남아야 한다 (mlpx-spec.md §1.3). 그 차이를 학습 화면이 알면 거기에
 * `if (dataType === 'image')`가 생긴다.
 *
 * **Vue가 없다.** 화면 등록부(`data/kinds.ts`)에 붙이면 이 계층의 검사가 컴포넌트를
 * 끌고 온다 (`project/facts.ts`와 같은 사정).
 */

import { ClientError } from '@/errors'
import type { EngineState, RuntimeContext } from '@/ml/backend'
import { backboneFor } from '@/ml/backbones'
import { embedImages, type EmbedWorker } from '@/ml/embed/client'
import { spawnEmbedWorker } from '@/ml/embed/spawn'
import { imageTestDataset, imageTrainingSource, pendingEmbeddings } from '@/ml/images'
import type { Dataset } from '@/ml/preprocess'
import { trainableRowCount } from '@/ml/selection'
import { readDataset, readTestDataset } from '@/project/dataset'
import { addEmbeddings, readEmbeddings } from '@/project/embeddings'
import { IMAGE_UNLABELED, type ProjectFile } from '@/project/format'
import { readImages } from '@/project/images'
import {
  dataSettings,
  dataSnapshot,
  type DataType,
  type Experiment,
  tabularDataOf,
  type Settings,
  type TaskType,
} from '@/project/schema'

export interface TrainingSource {
  /**
   * 학습에 쓸 프로젝트. **들어온 것과 다를 수 있다** — 이미지는 여기서 뽑은 임베딩이
   * 붙는다. 부르는 쪽이 이것을 저장해야 다음 학습에서 다시 안 뽑는다.
   */
  readonly project: ProjectFile
  readonly dataset: Dataset
  readonly testDataset: Dataset | null
  /** 계산에 쓰는 설정. 언제나 표의 모양이다 (open-decisions.md). */
  readonly settings: Settings
  /** 파일에 남는 기록. 계산에 쓴 표가 아니다. */
  readonly snapshot: Experiment['settings']['data']
  /**
   * 표의 행 번호가 무엇이었는지. **표에는 없다** — 행이 곧 원본의 행이다.
   * 이미지는 사진 해시이고, 결과 화면이 그것으로 사진을 되찾는다.
   */
  readonly rowKeys?: readonly string[]
}

export interface TrainingSourceInput {
  readonly project: ProjectFile
  readonly taskType: TaskType
  /** 준비 단계가 넘어갈 때마다. 백본을 받는 동안 화면이 할 말이 여기서 나온다. */
  readonly onPrepare?: (state: EngineState, fraction?: number) => void
  /** 사진 하나가 끝날 때마다. 백분율은 받는 쪽이 만든다. */
  readonly onProgress?: (completed: number, total: number) => void
  /**
   * 임베딩 워커를 만드는 방법. **검사가 주입한다** — 기본은 진짜 워커다
   * (`ml/embed/spawn.ts`).
   */
  readonly createEmbedWorker?: () => EmbedWorker
}

/**
 * 종류별 준비 절차.
 *
 * **`Record<DataType, …>`이라 종류를 더하는 사람은 칸을 채워야 한다** — 빠뜨리면
 * 컴파일이 깨진다 (architecture.md §9.3).
 */
export const TRAINING_SOURCES: Readonly<
  Record<DataType, (input: TrainingSourceInput) => Promise<TrainingSource>>
> = {
  // **`async`인 것이 뜻을 갖는다.** 표는 기다릴 것이 없지만, 여기서 던지면 부르는 쪽이
  // `await`로 받는 실패와 그냥 던지는 실패를 둘 다 다뤄야 한다 — 한쪽을 빠뜨린다.
  tabular: async ({ project }) => {
    const dataset = readDataset(project)
    // 화면이 정본 없이 여기까지 오지 못한다. 그래도 던지는 이유는, 조용히 빈 표로
    // 학습하면 지표가 NaN인 채로 done이 되기 때문이다.
    if (!dataset) throw new ClientError('DATASET_EMPTY')
    return {
      project,
      dataset,
      testDataset: readTestDataset(project),
      settings: project.document.settings,
      // 표에서는 계산에 쓴 설정이 그대로 기록이다.
      snapshot: dataSnapshot('tabular', project.document.settings),
    }
  },

  image: async ({ project, taskType, onPrepare, onProgress, createEmbedWorker }) => {
    const { backboneId } = dataSettings('image', project.document.settings)
    const backbone = backboneFor(backboneId)
    // 등록부에 없는 백본을 가리키는 파일이다. 다시 뽑을 수도 없다.
    if (!backbone) throw new ClientError('BACKBONE_UNAVAILABLE')

    const known = readEmbeddings(project, backboneId, backbone.embeddingDim)
    const have = new Set(known.keys())

    /**
     * **훈련 사진과 테스트 사진을 함께 뽑는다.** 테스트 사진을 빼면 `provided`인 실험이
     * 채점할 것을 못 찾아 `TEST_DATASET_NO_USABLE_ROWS`로 선다 — 학생은 멀쩡한 사진을
     * 올리고 사진을 탓하는 문장을 본다 (R10 감사 A-1).
     *
     * **`provided`가 아니면 테스트 자리를 안 본다.** 사진이 남아 있을 수 없는 상태이고
     * (`clearTestImages`가 함께 뗀다), 군집화는 나누지 않아 채점할 자리가 없다.
     * 있지도 않을 것을 뽑으려 들면 그만큼 백본을 더 돌린다.
     */
    const scored =
      taskType !== 'clustering' && project.document.settings.split.method === 'provided'
    const pending = [
      ...pendingEmbeddings(project, have, 'data'),
      ...(scored ? pendingEmbeddings(project, have, 'test') : []),
    ]

    let filled = project
    if (pending.length > 0) {
      const { vectors, dim } = await embedImages(
        backbone.id,
        // 워커가 디코드한다. 메인에서 하면 화면이 멈춘다 (ml/embed/protocol.ts).
        pending.map((entry) => entry.bytes as Uint8Array<ArrayBuffer>),
        {
          createWorker: createEmbedWorker ?? spawnEmbedWorker,
          ...(onPrepare ? { onState: onPrepare } : {}),
          ...(onProgress ? { onProgress } : {}),
        },
      ).result

      // **벡터는 사진 순서대로 이어 붙은 하나의 배열이다** (ml/embed/protocol.ts).
      // 잘라서 해시에 다시 붙이는 자리가 여기이고, 순서가 어긋나면 **엉뚱한 사진의
      // 임베딩으로 학습하면서 아무 오류도 안 난다.**
      const fresh = new Map<string, Float32Array>()
      for (const [index, entry] of pending.entries()) {
        fresh.set(entry.hash, vectors.slice(index * dim, (index + 1) * dim))
      }
      for (const [hash, vector] of fresh) known.set(hash, vector)
      filled = addEmbeddings(project, backbone.id, fresh)
    }

    const source = imageTrainingSource(filled, known, backbone, taskType)
    return {
      project: filled,
      dataset: source.dataset,
      // **훈련 표와 같은 열 이름을 쓴다** (ml/images.ts). `provided`가 아니면 `null`이고
      // 그때는 splitRows가 아예 보지 않는다 (open-decisions.md "테스트용 zip").
      testDataset: scored ? imageTestDataset(filled, known, backbone, taskType) : null,
      settings: source.settings,
      snapshot: source.snapshot,
      rowKeys: source.hashes,
    }
  },
}

/**
 * 실행 방법 판정에 넘길 행 수. **종류마다 세는 것이 다르다.**
 *
 * 표는 전처리에서 빠질 행과 뽑기에서 빠질 행을 뺀 수다 — 파일의 행 수를 넘기면 학습이
 * 실제로 받아들일 데이터를 화면이 거부한다. 이미지는 **학습에 들어갈 사진 수**이고,
 * 분류에서는 라벨 붙은 것만이다(어댑터가 세는 것과 같아야 한다).
 */
export const TRAINING_ROW_COUNTS: Readonly<
  Record<DataType, (project: ProjectFile, taskType: TaskType | undefined) => number>
> = {
  tabular: (project) => {
    const dataset = readDataset(project)
    const data = tabularDataOf(project.document)
    if (!dataset) return 0
    if (!data) return dataset.rows.length
    return trainableRowCount(
      dataset,
      data.features,
      data.target,
      data.preprocessing.missing,
      project.document.settings.nSamples,
    )
  },
  image: (project, taskType) =>
    readImages(project).filter(
      (entry) => taskType === 'clustering' || entry.category !== IMAGE_UNLABELED,
    ).length,
}

/** 이 프로젝트의 종류가 세는 훈련 행 수. */
export function trainableRowsOf(project: ProjectFile, taskType: TaskType | undefined): number {
  return TRAINING_ROW_COUNTS[project.document.manifest.dataType](project, taskType)
}

/**
 * 학습 화면이 실행 방법 판정에 넘기는 것들.
 *
 * **컴포넌트 밖에 둔다** (`CLAUDE.md` §4). 화면 안의 computed로 두었을 때
 * `dataType: project.dataType ?? DEFAULT_DATA_TYPE`을 `DEFAULT_DATA_TYPE`으로 고정해도
 * 저장소 전체 2,347개가 초록이고 `vue-tsc`도 조용했다 (R13-3 감사 A-2). 타입이 필수로
 * 만들어 두어 **빠뜨릴 수는 없지만 틀린 값을 넣는 것은 아무도 안 봤다.**
 *
 * 그때 사진 프로젝트가 **표의 상한 칸**으로 재어진다 — 랜덤포레스트가 500장이 아니라
 * 5,000장까지 열리고(`MAX_IMAGE_COUNT`가 5,000이라 상한을 채운 프로젝트에서도 열린다),
 * 사유 코드가 `DATASET_TOO_LARGE_FOR_BROWSER`가 되어 **사진을 지워야 하는 학생이
 * "전처리에서 행을 줄이라"를 읽는다.**
 *
 * `serverStatus`는 아직 아는 곳이 없어 `unknown`이다 (`architecture.md` §7.3).
 */
export function runtimeContextFor(
  project: ProjectFile | null,
  /**
   * 프로젝트가 없을 때 쓸 종류. **화면이 준다** — 그 값은 판 등록부(`data/kinds.ts`)의
   * 첫 판이고, 거기는 비동기 컴포넌트를 들고 있어 ML 층이 임포트하면 화면이 이 층의
   * 모듈 그래프로 딸려 온다(`ui-rules.spec.ts`가 그걸 잡는다).
   *
   * **이 인자는 무해한 쪽이다.** 프로젝트가 없으면 이 화면은 빈 상태라 사유가 뜰 자리도
   * 없다. 위험한 쪽 — 열린 프로젝트의 종류를 쓰는가 — 은 아래 한 줄이고 검사가 문다.
   */
  fallbackDataType: DataType,
): RuntimeContext {
  return {
    serverStatus: 'unknown',
    engineStates: {},
    // **종류가 센다.** 표는 전처리와 뽑기에서 빠질 행을 뺀 수이고, 이미지는 학습에
    // 들어갈 사진 수다.
    // **과제 유형도 파일에서 뽑는다.** 화면이 넘기게 두었더니 그 인자가 검사 밖이었고,
    // 틀리면 군집화 이미지 프로젝트의 사진 수가 라벨 붙은 것만으로 줄어든다 —
    // 그러면 500장이 상한인 카드가 열린 채로 서고 학생이 누르면 700장으로 학습이 돈다
    // (R13-5 감사 A-6). **화면이 고를 수 없게 만든다** — 셋째 인자와 같은 판단이다.
    rowCount: project === null ? 0 : trainableRowsOf(project, project.document.manifest.taskType),
    dataType: project?.document.manifest.dataType ?? fallbackDataType,
  }
}

/** 이 프로젝트의 종류가 준비하는 학습 입력. */
export function trainingSourceOf(input: TrainingSourceInput): Promise<TrainingSource> {
  return TRAINING_SOURCES[input.project.document.manifest.dataType](input)
}
