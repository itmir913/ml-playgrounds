/**
 * **이미지 KNN이 학습 뒤 더한 사진 때문에 꺼지지 않는다** (open-decisions.md 111, mlpx-spec.md §5.1).
 *
 * 분류 실험의 스냅샷이 행마다의 열쇠(`rowKeys`)를 들고, 되세울 때 `trainIndices`의 열쇠만 지금
 * 사진에서 찾는다. 여기서 재는 것은 셋이다.
 *
 * 1. **답이 같다** — 사진을 더해도, 훈련에 안 쓴 사진을 고쳐도 학습 때와 같은 답이다.
 * 2. **훈련 사진이 바뀌면 거부한다** — 지우거나 범주를 옮기면 `MODEL_TRAINING_DATA_CHANGED`.
 * 3. **과거 파일이 그대로 돈다** — 열쇠가 없는 실험은 장수·`rowsHash`로 본다.
 *
 * **진짜 입구로 짓는다** (계획 감사 1판 C-5·2판 C-3). 사진을 `addImages`로 앉히고 임베딩을
 * `addEmbeddings`로 붙인 뒤 `trainingSourceOf` → `runExperiment`(mljs KNN) → `applyExperiment` →
 * `.mlpx` 쓰기·읽기를 지난 파일에서 예측한다. 워커의 구조화 복제는 이 경로에 없다 — 열쇠는
 * 문자열 하나라 복제가 바꿀 것이 없다(사람 확인).
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import { runExperiment } from '../src/ml/experiment'
import {
  embeddingColumns,
  IMAGE_LABEL_COLUMN,
  imageLoadContext,
  imageTrainingRows,
  readRowKeys,
  rowKeyOf,
  rowKeysOf,
  rowsHashOf,
} from '../src/ml/images'
import { loadModel } from '../src/ml/models'
import { readPreprocessors } from '../src/ml/predict'
import { targetValues, transform } from '../src/ml/preprocess'
import { trainingSourceOf, type TrainingSource } from '../src/ml/training-source'
import { applyExperiment } from '../src/project/attach'
import { newProjectDocument } from '../src/project/create'
import { addEmbeddings, readEmbeddings } from '../src/project/embeddings'
import { readProject, writeProject, type ProjectFile } from '../src/project/format'
import {
  addImages,
  moveImages,
  readImages,
  removeImages,
  renameCategory,
} from '../src/project/images'
import { dataSnapshot, type Experiment, type TaskType } from '../src/project/schema'
import { withSampling, withSelectedAlgorithms } from '../src/project/settings'

const NOW = '2026-10-08T09:00:00.000Z'
const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
const DIM = BACKBONE.embeddingDim
const PER_CATEGORY = 10

/** 첫 칸 하나만 켠 벡터. 개는 0..9, 고양이는 20..29에 선다 — 질의 하나로 동점을 만들 수 있다. */
function vectorAt(position: number): Float32Array {
  const vector = new Float32Array(DIM)
  vector[0] = position
  return vector
}

interface Photo {
  readonly bytes: Uint8Array
  readonly hash: string
  readonly category: string
  readonly position: number
}

function photo(seed: string, category: string, position: number): Photo {
  const bytes = new TextEncoder().encode(`row-keys:${seed}`)
  return { bytes, hash: hashBytes(bytes), category, position }
}

const TRAINING: readonly Photo[] = [
  ...Array.from({ length: PER_CATEGORY }, (_, index) => photo(`dog-${index}`, '개', index)),
  ...Array.from({ length: PER_CATEGORY }, (_, index) =>
    photo(`cat-${index}`, '고양이', 20 + index),
  ),
]

/** 사진을 앉히고 임베딩까지 붙인다 — `embed`가 거짓이면 막 올린 사진처럼 벡터가 없다. */
function placed(project: ProjectFile, photos: readonly Photo[], embed = true): ProjectFile {
  const added = addImages(
    project,
    photos.map(({ bytes, hash, category }) => ({ bytes, hash, category })),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
  ).project
  if (!embed) return added
  return addEmbeddings(
    added,
    BACKBONE.id,
    new Map(photos.map((one) => [one.hash, vectorAt(one.position)])),
  )
}

function emptyProject(nSamples?: number): ProjectFile {
  const created = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-10-08T08:00:00.000Z',
      randomState: 42,
    },
  )
  const selected = withSelectedAlgorithms(created, [{ algorithm: 'knn', runtime: 'mljs' }], NOW)
  return {
    document: withSampling(selected, nSamples, NOW),
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

async function roundTrip(project: ProjectFile): Promise<ProjectFile> {
  const { blob } = await writeProject(project, '# x\n')
  return (await readProject(new Uint8Array(await blob.arrayBuffer()))).project
}

interface Trained {
  /** 학습하고 `.mlpx`로 한 번 쓰고 읽은 파일. */
  readonly project: ProjectFile
  readonly source: TrainingSource
  readonly experiment: Experiment
}

async function train(
  project: ProjectFile,
  taskType: TaskType = 'classification',
): Promise<Trained> {
  const source = await trainingSourceOf({ project, taskType })
  const result = await runExperiment({
    dataset: source.dataset,
    testDataset: source.testDataset,
    taskType,
    dataType: 'image',
    settings: source.settings,
    context: {
      serverStatus: 'unavailable',
      limitsOff: false,
      rowCount: source.dataset.rows.length,
      dataType: 'image',
    },
    snapshot: source.snapshot,
  })
  const reopened = await roundTrip(applyExperiment(source.project, result, NOW))
  const experiment = reopened.document.runs.experiments.at(-1)
  if (!experiment) throw new Error('no experiment was recorded')
  return { project: reopened, source, experiment }
}

/** 질의 — 훈련 점 위, 두 점 사이(거리 동점), 두 무리 사이. */
const QUERIES = [0, 4.5, 9, 14.5, 15, 20, 24.5, 29, 40]

/** 지금 파일로 KNN을 읽어 질의에 답한다. 못 세우면 그 코드를 돌려준다. */
function answers(project: ProjectFile, experiment: Experiment = lastOf(project)): unknown {
  const run = experiment.runs.find((one) => one.model !== undefined)
  const path = run?.model?.path
  const bytes = path === undefined ? undefined : project.models.get(path)
  const preprocessor = readPreprocessors(project.document, project.models).get(experiment.id)
  if (!run?.model || !bytes || !preprocessor) throw new Error('the KNN model was not saved')

  const vectors = readEmbeddings(project, BACKBONE.id, DIM)
  const rows = imageTrainingRows(
    project,
    experiment,
    preprocessor,
    BACKBONE,
    vectors,
    experiment.settings.taskType,
  )
  try {
    const context = imageLoadContext(run.model.format, () => rows)
    const queries = {
      columns: embeddingColumns(DIM),
      rows: QUERIES.map((position) => Array.from(vectorAt(position), (value) => String(value))),
    }
    const features = transform(
      preprocessor,
      queries,
      QUERIES.map((_, index) => index),
      'onehot',
    )
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return loadModel(payload, context)(features)
  } catch (error) {
    if (isClientError(error)) return error.code
    throw error
  }
}

function lastOf(project: ProjectFile): Experiment {
  const experiment = project.document.runs.experiments.at(-1)
  if (!experiment) throw new Error('no experiment')
  return experiment
}

/** 표의 행 번호 -> 사진. 학습 때의 표다. */
function photoAt(trained: Trained, row: number): Photo {
  const hash = trained.source.rowHashes?.[row]
  const found = TRAINING.find((one) => one.hash === hash)
  if (!found) throw new Error(`row ${row} has no photo`)
  return found
}

function trainPhoto(trained: Trained): Photo {
  const row = trained.experiment.settings.trainIndices[0]
  if (row === undefined) throw new Error('no training rows')
  return photoAt(trained, row)
}

function testPhoto(trained: Trained): Photo {
  const row = trained.experiment.settings.testIndices[0]
  if (row === undefined) throw new Error('no test rows')
  return photoAt(trained, row)
}

/** 열쇠만 고친 실험. 스냅샷 밖은 그대로다. */
function withRowKeys(experiment: Experiment, rowKeys: string | undefined): Experiment {
  const data = { ...(experiment.settings.data as Record<string, unknown>) }
  if (rowKeys === undefined) delete data.rowKeys
  else data.rowKeys = rowKeys
  return {
    ...experiment,
    settings: { ...experiment.settings, data: data as Experiment['settings']['data'] },
  }
}

describe('열쇠를 적는다', () => {
  it('분류 실험의 스냅샷에 표의 행마다 하나씩 적힌다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const { rowKeys } = dataSnapshot('image', trained.experiment.settings)
    const hashes = trained.source.rowHashes ?? []
    expect(hashes).toHaveLength(TRAINING.length)
    expect(readRowKeys(rowKeys ?? '')).toEqual(
      hashes.map((hash) => rowKeyOf(TRAINING.find((one) => one.hash === hash)!.category, hash)),
    )
  })

  /** 군집에는 행이 필요한 모델이 없다(KNN은 `clustering: false`). 쓸 곳 없는 53KB를 안 적는다. */
  it('군집 실험에는 적지 않는다', async () => {
    const source = await trainingSourceOf({
      project: placed(emptyProject(), TRAINING),
      taskType: 'clustering',
    })
    expect(source.snapshot).not.toHaveProperty('rowKeys')
  })
})

describe('사진을 더해도 답이 같다', () => {
  it('라벨 붙은 사진을 더한다 — 벡터가 있든 없든', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const before = answers(trained.project)
    expect(Array.isArray(before), `trained model must answer: ${String(before)}`).toBe(true)

    const embedded = placed(trained.project, [
      photo('dog-new', '개', 15),
      photo('cat-new', '고양이', 14),
    ])
    expect(answers(embedded)).toEqual(before)

    const fresh = placed(trained.project, [photo('dog-raw', '개', 3)], false)
    expect(answers(fresh)).toEqual(before)
  })

  /**
   * **열쇠가 없으면 같은 편집이 거부된다** — 위 검사가 열쇠 덕에 통과한다는 대조다. 열쇠
   * 경로를 끄는 돌연변이에서 위가 울어야 한다.
   */
  it('같은 편집을 열쇠 없는 실험에서 하면 거부된다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const older = withRowKeys(trained.experiment, undefined)
    const more = placed(trained.project, [photo('dog-new', '개', 15)])
    expect(answers(more, older)).toBe('MODEL_TRAINING_DATA_CHANGED')
  })

  it('표본 뽑기(nSamples)를 켠 실험도 같다', async () => {
    const trained = await train(placed(emptyProject(12), TRAINING))
    expect(trained.experiment.settings.trainIndices.length).toBeLessThan(TRAINING.length)
    const before = answers(trained.project)
    expect(Array.isArray(before)).toBe(true)
    expect(answers(placed(trained.project, [photo('dog-new', '개', 15)]))).toEqual(before)
  })

  it('라벨 없는 사진을 더한다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const before = answers(trained.project)
    expect(answers(placed(trained.project, [photo('loose', '_unlabeled', 5)]))).toEqual(before)
  })
})

/** 결정 2 — 모델이 안 쓴 사진이다 (open-decisions.md 111, 계획 감사 1판 B-1). */
describe('훈련에 안 쓴 사진은 바뀌어도 예측한다', () => {
  it('테스트 몫 사진을 지운다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const before = answers(trained.project)
    const removed = removeImages(trained.project, [testPhoto(trained).hash], NOW)
    expect(answers(removed)).toEqual(before)
  })

  it('테스트 몫 사진의 범주를 옮긴다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const before = answers(trained.project)
    const target = testPhoto(trained)
    const moved = moveImages(
      trained.project,
      [target.hash],
      target.category === '개' ? '고양이' : '개',
      NOW,
    )
    expect(answers(moved)).toEqual(before)
  })
})

/** 결정 1 — 학습 때와 다른 모델이 되므로 거부한다 (open-decisions.md 111, 코드 소유자). */
describe('훈련에 쓴 사진이 바뀌면 거부한다', () => {
  it('훈련 사진을 지운다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const removed = removeImages(trained.project, [trainPhoto(trained).hash], NOW)
    expect(answers(removed)).toBe('MODEL_TRAINING_DATA_CHANGED')
  })

  it('훈련 사진의 범주를 옮긴다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const target = trainPhoto(trained)
    const moved = moveImages(
      trained.project,
      [target.hash],
      target.category === '개' ? '고양이' : '개',
      NOW,
    )
    expect(answers(moved)).toBe('MODEL_TRAINING_DATA_CHANGED')
  })

  it('훈련 사진 둘의 범주를 맞바꾼다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const rows = trained.experiment.settings.trainIndices.map((row) => photoAt(trained, row))
    const dog = rows.find((one) => one.category === '개')!
    const cat = rows.find((one) => one.category === '고양이')!
    const swapped = moveImages(
      moveImages(trained.project, [dog.hash], '고양이', NOW),
      [cat.hash],
      '개',
      NOW,
    )
    expect(answers(swapped)).toBe('MODEL_TRAINING_DATA_CHANGED')
  })

  it('훈련 사진이 든 범주의 이름을 바꾼다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    expect(answers(renameCategory(trained.project, '개', '강아지', NOW))).toBe(
      'MODEL_TRAINING_DATA_CHANGED',
    )
  })
})

describe('깨진 열쇠는 그 모델 하나만 끈다', () => {
  /**
   * 고친 열쇠를 **진짜 열쇠에서** 짓는다. 빈 문자열이나 짧은 값으로 재면 번호가 열쇠 수를
   * 넘어 다른 가드가 먼저 거부하고, 재려던 가드는 빠져도 초록이다.
   */
  for (const [name, tamper] of [
    ['base64가 아니다', () => 'not base64 !!'],
    // 열쇠는 다 맞고 꼬리에 1바이트가 더 붙었다 — 길이 가드만이 이것을 거부한다.
    ['8바이트로 안 나뉜다', (real: string) => btoa(`${atob(real)}\u0000`)],
    ['훈련 번호가 열쇠 수를 넘는다', (real: string) => btoa(atob(real).slice(0, 8))],
  ] as const) {
    it(name, async () => {
      const trained = await train(placed(emptyProject(), TRAINING))
      const real = dataSnapshot('image', trained.experiment.settings).rowKeys ?? ''
      const broken = withRowKeys(trained.experiment, tamper(real))
      expect(answers(trained.project, broken)).toBe('MODEL_TRAINING_DATA_CHANGED')
    })
  }

  /** 같은 사진이 같은 범주에 두 형식으로 앉으면 열쇠가 겹친다. 조용히 고르지 않는다. */
  it('지금 사진에서 열쇠가 겹친다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const target = trainPhoto(trained)
    const entry = readImages(trained.project, 'data').find((one) => one.hash === target.hash)!
    const images = new Map(trained.project.images)
    images.set(entry.path.replace(/\.webp$/, '.jpg'), entry.bytes)
    expect(answers({ ...trained.project, images })).toBe('MODEL_TRAINING_DATA_CHANGED')
  })

  it('파일은 열린다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const experiments = trained.project.document.runs.experiments.map((one) =>
      withRowKeys(one, 'not base64 !!'),
    )
    const tampered: ProjectFile = {
      ...trained.project,
      document: {
        ...trained.project.document,
        runs: { ...trained.project.document.runs, experiments },
      },
    }
    const reopened = await roundTrip(tampered)
    expect(answers(reopened)).toBe('MODEL_TRAINING_DATA_CHANGED')
  })
})

/** **과거 파일** — 이 필드가 생기기 전의 실험은 열쇠가 없다. 사진이 그대로면 지금처럼 예측한다. */
describe('열쇠가 없는 실험', () => {
  it('파일을 쓰고 읽어도 열리고, 사진이 그대로면 같은 답이다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const before = answers(trained.project)
    const experiments = trained.project.document.runs.experiments.map((one) =>
      withRowKeys(one, undefined),
    )
    const older = await roundTrip({
      ...trained.project,
      document: {
        ...trained.project.document,
        runs: { ...trained.project.document.runs, experiments },
      },
    })
    expect(dataSnapshot('image', lastOf(older).settings).rowKeys).toBeUndefined()
    expect(answers(older)).toEqual(before)
  })
})

/**
 * **공식을 값으로 못 박는다** (코드 감사 C-1). 다른 검사는 기대값을 `rowKeyOf`·`rowsHashOf` 자신으로
 * 계산하므로, 공식이 바뀌어도 전부 초록이고 그 앞에 학습한 모든 KNN이 거부된다. 값은 파이썬
 * `hashlib`로 따로 계산해 맞춘 것이다 — 이 값이 바뀌면 포맷 규격(mlpx-spec.md §5.1)이 바뀐 것이다.
 */
describe('열쇠와 지문의 공식', () => {
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)

  it('rowKeyOf', () => {
    expect(rowKeyOf('개', A)).toBe('908ead0469f9b2cd')
    expect(rowKeyOf('고양이', B)).toBe('033a5c8d93f8f1e4')
  })

  it('rowKeysOf', () => {
    expect(rowKeysOf({ hashes: [A, B], rowCategories: ['개', '고양이'] })).toBe(
      'kI6tBGn5ss0DOlyNk/jx5A==',
    )
  })

  it('rowsHashOf', () => {
    expect(rowsHashOf([A, B])).toBe(
      '5e9ae866add9a85d69c3481d059bb9f158a39e5670ba11f95112fc409630894e',
    )
  })
})

/**
 * **되세운 행이 학습 때의 표와 행마다 같다** (코드 감사 C-1).
 *
 * 위의 *"답이 같다"* 검사는 이 데이터가 너무 잘 갈려서, 행의 특성이나 라벨이 한 칸 밀려도 k=5
 * 다수결이 같아 초록이었다 — 이 파일의 주석이 경고하는 *"이웃이 한 장씩 밀린 채로 답만 멀쩡히"*
 * 그 모양이다. 그래서 답이 아니라 행 자체를 학습 때의 표(`trained.source.dataset`)와 대조한다.
 */
describe('되세운 훈련 행', () => {
  function expectSameRows(trained: Trained, project: ProjectFile, experiment: Experiment): void {
    const preprocessor = readPreprocessors(project.document, project.models).get(experiment.id)!
    const rows = imageTrainingRows(
      project,
      experiment,
      preprocessor,
      BACKBONE,
      readEmbeddings(project, BACKBONE.id, DIM),
      'classification',
    )
    const { trainIndices } = experiment.settings
    const table = trained.source.dataset
    expect(rows?.indices).toEqual(trainIndices)
    expect(rows?.target).toEqual(targetValues(table, trainIndices, IMAGE_LABEL_COLUMN))
    expect(rows?.features).toEqual(transform(preprocessor, table, trainIndices, 'onehot'))
  }

  it('열쇠가 있으면 사진을 더해도 학습 때의 행 그대로다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const more = placed(trained.project, [
      photo('dog-new', '개', 15),
      photo('cat-new', '고양이', 14),
    ])
    expectSameRows(trained, more, trained.experiment)
  })

  it('열쇠가 없는 실험도 사진이 그대로면 학습 때의 행 그대로다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    expectSameRows(trained, trained.project, withRowKeys(trained.experiment, undefined))
  })
})

/**
 * **열쇠 경로의 가드 둘** (코드 감사 C-2). `image-training.spec.ts`의 같은 가드 검사는 열쇠가 없는
 * 스냅샷으로 지어 옛 경로만 지나간다 — 여기서는 진짜 입구로 학습해 열쇠가 적힌 실험으로 잰다.
 */
describe('열쇠가 있어도 거부하는 것', () => {
  it('훈련 사진 하나의 벡터가 없다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const experiment = trained.experiment
    expect(dataSnapshot('image', experiment.settings).rowKeys).toBeDefined()
    const preprocessor = readPreprocessors(trained.project.document, trained.project.models).get(
      experiment.id,
    )!
    const vectors = readEmbeddings(trained.project, BACKBONE.id, DIM)
    vectors.delete(trainPhoto(trained).hash)
    expect(
      imageTrainingRows(
        trained.project,
        experiment,
        preprocessor,
        BACKBONE,
        vectors,
        'classification',
      ),
    ).toBeNull()
  })

  it('학습 때와 백본이 다르다', async () => {
    const trained = await train(placed(emptyProject(), TRAINING))
    const data = { ...(trained.experiment.settings.data as Record<string, unknown>) }
    data.backboneId = 'another-backbone'
    const other: Experiment = {
      ...trained.experiment,
      settings: { ...trained.experiment.settings, data: data as Experiment['settings']['data'] },
    }
    expect(answers(trained.project, other)).toBe('MODEL_TRAINING_DATA_CHANGED')
  })
})

describe('열쇠의 인코딩', () => {
  function sourceOf(count: number) {
    const hashes = Array.from({ length: count }, (_, index) =>
      hashBytes(new Uint8Array([index % 256, index >> 8])),
    )
    return { hashes, rowCategories: hashes.map((_, index) => (index % 2 === 0 ? '개' : '고양이')) }
  }

  it('왕복이 무손실이고 길이가 장당 8바이트다', () => {
    const source = sourceOf(7)
    const text = rowKeysOf(source)
    expect(text).toHaveLength(Math.ceil((7 * 8) / 3) * 4)
    expect(readRowKeys(text)).toEqual(
      source.hashes.map((hash, index) => rowKeyOf(source.rowCategories[index]!, hash)),
    )
  })

  /** 상한 5,000장에서 한 실험의 크기 — 결정문의 "약 53KB"가 이 값이다. */
  it('5,000장이면 53,336자다', () => {
    expect(rowKeysOf(sourceOf(5000))).toHaveLength(53_336)
  })

  /** 상한을 끄면 엔트리 천장(약 32,000장)까지 간다. 인자로 펼치면 여기서 콜 스택이 넘쳤다. */
  it('상한을 끈 규모(33,000장)에서도 던지지 않는다', () => {
    const text = rowKeysOf(sourceOf(33_000))
    expect(readRowKeys(text)).toHaveLength(33_000)
  })
})
