// @vitest-environment jsdom
/**
 * **이미지 군집 결과 판이 어느 표를 다시 짓는가** (2026-09-02 R24 B-5).
 *
 * 계산은 `ml/image-clusters.ts`가 하고 `image-clusters.spec.ts`가 잰다. **여기서 재는
 * 것은 그 앞의 한 줄** — 판이 학습 때와 같은 표를 다시 지을 때 유형을 무엇으로 부르는가.
 *
 * `'clustering'` 대신 `'classification'`을 부르면 **라벨 없는 사진이 격자에서 빠진다.**
 * 예외도 안 나고 군집 번호도 그대로라 화면은 멀쩡해 보이는데, 학생이 올린 사진 중
 * 범주를 안 붙인 것만 조용히 사라진다 — 그리고 군집은 **애초에 라벨을 안 보는** 학습이라
 * 그 사진들이야말로 이 화면의 주인공이다.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { DEFAULT_BACKBONE_ID, backboneFor } from '../src/ml/backbones'
import { imageTrainingSource } from '../src/ml/images'
import type { PanelInput } from '../src/ml/metric-panels'
import { KMEANS_FORMAT } from '../src/ml/models'
import { fitPreprocessor } from '../src/ml/preprocess'
import { newProjectDocument } from '../src/project/create'
import { addEmbeddings } from '../src/project/embeddings'
import { IMAGE_UNLABELED, type ProjectFile } from '../src/project/format'
import { addImages, readImages } from '../src/project/images'
import type { Experiment } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'
import ImageClusterPanel from '../src/views/results/panels/ImageClusterPanel.vue'
import { run } from './fixtures/project'

const BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)!
const DIM = BACKBONE.embeddingDim
const NOW = '2026-09-02T09:00:00.000Z'

/** 사진 셋 — 라벨 둘, 라벨 없는 것 하나. **셋째가 이 검사의 전부다.** */
const PHOTOS = [
  { seed: 'a', category: '개' },
  { seed: 'b', category: '고양이' },
  { seed: 'c', category: IMAGE_UNLABELED },
] as const

function imageProject(): ProjectFile {
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
  )
  const empty: ProjectFile = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  const seated = addImages(
    empty,
    PHOTOS.map((item) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${item.seed}`)
      return { hash: hashBytes(bytes), bytes, category: item.category }
    }),
    { canonicalSize: BACKBONE.canonicalSize, now: NOW, format: 'webp' },
  ).project

  // 사진마다 벡터 하나. **값은 군집이 갈리게만 둔다** — 앞 둘은 0 쪽, 마지막은 10 쪽이다.
  return addEmbeddings(seated, DEFAULT_BACKBONE_ID, vectorsOf(seated))
}

/** 사진마다의 벡터. 라벨 없는 셋째만 멀리 둔다. */
function vectorsOf(project: ProjectFile): Map<string, Float32Array> {
  return new Map(
    readImages(project).map((entry, index) => [
      entry.hash,
      new Float32Array(DIM).fill(index === 2 ? 10 : 0),
    ]),
  )
}

function clusteringExperiment(project: ProjectFile): Experiment {
  const source = imageTrainingSource(project, vectorsOf(project), BACKBONE, 'clustering')
  return {
    id: 'experiment-1',
    startedAt: NOW,
    settings: {
      taskType: 'clustering',
      runtime: 'mljs',
      selectedAlgorithms: [{ algorithm: 'k_means', runtime: 'mljs' }],
      data: {
        categories: ['개', '고양이'],
        backboneId: DEFAULT_BACKBONE_ID,
        categoryCounts: [1, 1],
        unlabeledCount: 1,
      },
      split: { method: 'holdout', testSize: 0.2, stratify: false, randomState: 42 },
      trainIndices: source.dataset.rows.map((_, index) => index),
      testIndices: [],
    },
    preprocessor: { format: 'mlpx-preprocess-v1', path: 'model/preprocessor-experiment-1.json' },
    runs: [
      run('run-1', {
        // 등록부의 id다 (`ml/algorithms.ts`). `kmeans`로 적으면 판이 id를 읽는 날 이 검사만 다른 세계를 잰다.
        algorithm: 'k_means',
        model: {
          format: KMEANS_FORMAT,
          path: 'model/run-1.json',
          includesPreprocessing: false,
          sizeBytes: 128,
        },
      }),
    ],
  } as unknown as Experiment
}

/** 중심점 둘 — 0 근처와 10 근처. 앞 둘이 한 군집, 라벨 없는 것이 다른 군집이다. */
function kmeansBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: KMEANS_FORMAT,
      featureCount: DIM,
      k: 2,
      centroids: [new Array(DIM).fill(0), new Array(DIM).fill(10)],
    }),
  )
}

beforeEach(async () => {
  setActivePinia(createPinia())
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  await setLocale('ko')
})

describe('R24 B-5: the image cluster panel rebuilds the clustering table', () => {
  it('every photo is placed, including the ones with no class', () => {
    const project = imageProject()
    useProjectStore().file = project
    const experiment = clusteringExperiment(project)
    const source = imageTrainingSource(project, vectorsOf(project), BACKBONE, 'clustering')
    const preprocessor = fitPreprocessor(
      source.dataset,
      source.dataset.rows.map((_, index) => index),
      source.dataset.columns,
      { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' },
    )
    const input: PanelInput = {
      run: experiment.runs[0]!,
      experiment,
      dataset: null,
      preprocessor,
      modelBytes: kmeansBytes(),
    }

    const wrapper = mount(ImageClusterPanel, { props: { input }, global: { plugins: [i18n] } })
    const groups = (wrapper.vm as unknown as { groups: { hashes: string[] }[] | null }).groups

    expect(groups).not.toBeNull()
    // **셋 다 있다.** 분류로 지으면 라벨 없는 한 장이 빠져 둘이 된다.
    expect(groups?.flatMap((group) => group.hashes)).toHaveLength(PHOTOS.length)
    // 라벨 없는 사진이 실제로 다른 군집에 앉았다 — 격자에 그려지는 것이 이것이다.
    expect(groups?.map((group) => group.hashes.length)).toEqual([2, 1])
  })
})
