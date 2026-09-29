/**
 * **무작위로 만든 프로젝트가 `.mlpx`를 왕복하는가** — 프로퍼티 기반 검사.
 *
 * 손으로 고른 표본은 고른 사람이 떠올린 모양만 본다. 여기서는 씨앗 하나로 프로젝트를 짓고
 * (표·사진·실패한 run·담지 못한 모델·첨부·임베딩·학생 정보·긴 이름·온갖 글자의 범주), 쓰고 →
 * 읽고 → 다시 쓴다. 다른 OS가 다시 압축한 모양(NFD·한 겹 감싸기·`\` 구분자)도 같은 씨앗으로 본다.
 *
 * **이 검사가 처음 잡은 것** — 글자가 전부 0xFF 이하인 범주(`Größe`)가 한글 범주 옆에 있으면
 * 우리가 쓴 파일을 다시 열었을 때 범주 이름이 바뀌고 무결성이 "고쳐졌음"이 됐다
 * (`format.ts`의 `rekeyByRecordedPaths`, mlpx-spec.md §10).
 *
 * **씨앗은 고정이다.** 실패하면 그 씨앗 번호로 다시 돈다 — 무작위가 날마다 달라지면 초록이
 * 증거가 못 된다.
 */

import 'fake-indexeddb/auto'

import { unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'

import { imageEntryPath, isValidCategoryName } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { embeddingPath } from '../src/project/embeddings'
import {
  IMAGE_DATA_DIR,
  IMAGE_PREDICT_DIR,
  IMAGE_TEST_DIR,
  readProject,
  readProjectMeta,
  type ProjectFile,
} from '../src/project/format'
import { withIdentity } from '../src/project/identity'
import { FORMAT_VERSION, PROJECT_KIND_ML } from '../src/project/schema'
import { closeStorage, loadProject, saveProject } from '../src/project/storage'
import { resetDatabase } from './fixtures/database'
import { experiment, projectFile, run } from './fixtures/project'
import { writeProjectBytes } from './fixtures/write'

beforeEach(async () => {
  closeStorage()
  await resetDatabase()
})

/** 씨앗 하나로 도는 난수(mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 이름을 짓는 조각. **코드 포인트로 적는다** — 결합 문자·NBSP·NFD 자모를 소스에 날것으로 두면
 * 보이지 않는다. 라틴-1 글자(0x80~0xFF)를 일부러 많이 넣는다: 되살리기가 그 모양을 옛 인코딩의
 * 바이트로 오해한다.
 */
const PIECES: readonly string[] = [
  'a',
  'Z',
  '0',
  ' ',
  '-',
  '_',
  '%',
  '#',
  '&',
  "'",
  '~',
  '(',
  ')',
  '!',
  '@',
  '+',
  '=',
  ',',
  ';',
  '[',
  ']',
  '{',
  '}',
  '.',
  'con',
  'README',
  '개',
  '고양이',
  '한글',
  '中',
  [0x1100, 0x1161], // NFD 가
  [0x1112, 0x1161, 0x11ab], // NFD 한
  [0x3131], // ㄱ
  [0x65, 0x301], // e + 결합 악센트
  [0xe9], // é
  [0xc3], // Ã
  [0xa9], // ©
  [0xb7], // ·
  [0xd7], // ×
  [0xbd], // ½
  [0xdf], // ß
  [0xb0], // °
  [0xb2], // ²
  [0xf6], // ö
  [0xfc], // ü
  [0xc4], // Ä
  [0xf1], // ñ
  [0xbf], // ¿
  [0xa1], // ¡
  [0xa0], // NBSP
  [0x3a9], // Ω
  [0x1f600], // 이모지
  [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467], // 이모지 가족(ZWJ)
].map((piece) => (typeof piece === 'string' ? piece : String.fromCodePoint(...piece)))

function textOf(random: () => number, max = 6): string {
  const count = 1 + Math.floor(random() * max)
  let out = ''
  for (let index = 0; index < count; index += 1) {
    out += PIECES[Math.floor(random() * PIECES.length)]
  }
  return out
}

/** 범주 이름. 화면이 받는 규칙(`isValidCategoryName`)을 지나는 것만 쓴다 — 업로드는 NFC로 모은다. */
function categoryOf(random: () => number): string {
  for (;;) {
    const name = textOf(random, 4).normalize('NFC')
    if (isValidCategoryName(name)) return name
  }
}

const imageRef = (path: string) => ({ path, canonicalSize: 224, format: 'webp', quality: 0.65 })

function imageProject(random: () => number): ProjectFile {
  const categories = [
    ...new Set(Array.from({ length: 1 + Math.floor(random() * 4) }, () => categoryOf(random))),
  ]
  const images = new Map<string, Uint8Array>()
  const embeddings = new Map<string, Uint8Array>()
  let serial = 0
  const put = (role: 'data' | 'test' | 'predict', category: string | undefined): void => {
    const bytes = new TextEncoder().encode(`photo-${serial++}-${random()}`)
    const hash = hashBytes(bytes)
    images.set(imageEntryPath(role, hash, category, CANONICAL_FORMATS.webp), bytes)
    if (random() < 0.5) {
      embeddings.set(embeddingPath(DEFAULT_BACKBONE_ID, hash), Uint8Array.from([1, 2, 3, 4]))
    }
  }
  for (const category of categories) {
    put('data', category)
    put('data', category)
  }
  if (random() < 0.3) put('data', undefined)
  const hasTest = random() < 0.5
  if (hasTest) for (const category of categories) put('test', category)
  const hasPredict = random() < 0.5
  if (hasPredict) put('predict', undefined)

  const sections = Array.from({ length: Math.floor(random() * 3) }, (_unused, index) => ({
    id: `s${index}`,
    title: textOf(random),
  }))
  const answers = Object.fromEntries(
    sections.map((section) => [section.id, `${textOf(random)}\r\n  ${textOf(random)}\t`]),
  )
  const attachments = new Map<string, Uint8Array>()
  const attached: Record<string, string[]> = {}
  if (sections.length > 0 && random() < 0.5) {
    attachments.set('portfolio/attachments/1.webp', Uint8Array.from([9, 9]))
    attached[sections[0]!.id] = ['portfolio/attachments/1.webp']
  }

  return {
    document: {
      manifest: {
        formatVersion: FORMAT_VERSION,
        appVersion: '0.0.0',
        projectId: '3f9a1b2c-4d5e-4f60-8a1b-2c3d4e5f6071',
        name: textOf(random, 20),
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        kind: PROJECT_KIND_ML,
        dataType: 'image',
        locale: 'ko',
      },
      settings: {
        data: {
          dataset: imageRef(IMAGE_DATA_DIR),
          ...(hasTest ? { testDataset: imageRef(IMAGE_TEST_DIR) } : {}),
          ...(hasPredict ? { predictDataset: imageRef(IMAGE_PREDICT_DIR) } : {}),
          categories,
          backboneId: DEFAULT_BACKBONE_ID,
        },
        split: {
          method: hasTest ? 'provided' : 'holdout',
          testSize: 0.2,
          stratify: true,
          randomState: 42,
        },
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: { experiments: [] },
      portfolio: {
        template: { sections },
        answerFormat: 'plain-v1',
        answers,
        attachments: attached,
      },
    },
    models: new Map(),
    images,
    attachments,
    embeddings,
  } as ProjectFile
}

function tabularProject(random: () => number): ProjectFile {
  const base = projectFile()
  const failed = run('run-2', {
    status: 'failed',
    metrics: undefined,
    model: undefined,
    failure: { code: 'TRAINING_FAILED', params: { detail: textOf(random, 30) } },
  } as never)
  const omitted = run('run-3', { model: undefined, modelOmitted: 'tooLarge' })
  const document = withIdentity(
    {
      ...base.document,
      runs: { experiments: [experiment('experiment-1', [run('run-1'), failed, omitted])] },
      settings: {
        ...base.document.settings,
        data: {
          ...base.document.settings.data,
          features: [textOf(random), textOf(random)],
          target: textOf(random),
        },
      },
    },
    {
      name: textOf(random, 40),
      studentId: textOf(random, 5),
      studentName: textOf(random, 5),
    },
    '2026-08-12T00:00:00.000Z',
  )
  return { ...base, document }
}

function projectOf(seed: number): ProjectFile {
  const random = seeded(seed)
  return random() < 0.6 ? imageProject(random) : tabularProject(random)
}

/** 엔트리 이름 → 내용 해시. zip 시각은 안 본다 — 쓸 때마다 다르다. */
function entryHashes(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, content]) => [name, hashBytes(content)]),
  )
}

/**
 * 다른 도구가 다시 압축한 모양. 비트마다 하나 — NFD(맥), 한 겹 감싸기(탐색기에서 폴더째),
 * `\` 구분자(Windows PowerShell 5.1). 감싸는 폴더는 ASCII와 한글을 번갈아 쓴다 — 한글이면
 * 모든 이름에 0xFF를 넘는 글자가 생겨 되살리기가 아예 안 돈다.
 */
function rezipped(bytes: Uint8Array, how: number): Uint8Array {
  const wrapper = how & 8 ? '제출' : 'submit'
  const out: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(unzipSync(bytes))) {
    let path = name
    if (how & 1) path = path.normalize('NFD')
    if (how & 2) path = `${wrapper}/${path}`
    if (how & 4) path = path.replaceAll('/', '\\')
    out[path] = content
  }
  return zipSync(out, { level: 6 })
}

const SEEDS = Array.from({ length: 150 }, (_unused, index) => index)

describe('무작위 프로젝트가 .mlpx를 왕복한다', () => {
  it.each(SEEDS)('씨앗 %i — 쓰고 읽고 다시 쓴다', async (seed) => {
    const before = projectOf(seed)
    const first = await writeProjectBytes(before, '# md')
    const { project, integrity } = await readProject(first.bytes)

    expect(integrity.status, 'integrity of our own file').toBe('UNCHANGED')
    // 키 순서는 스키마가 다시 세운다 — 뜻이 같은지를 본다.
    expect(JSON.parse(JSON.stringify(project.document))).toEqual(
      JSON.parse(JSON.stringify(before.document)),
    )
    expect([...project.images.keys()].sort()).toEqual([...before.images.keys()].sort())
    expect([...project.embeddings.keys()].sort()).toEqual([...before.embeddings.keys()].sort())
    expect([...project.attachments.keys()].sort()).toEqual([...before.attachments.keys()].sort())
    expect(await readProjectMeta(first.bytes)).toEqual(project.document)

    // 한 번 읽은 뒤로는 바이트까지 멈춰 있다.
    const second = await writeProjectBytes(project, '# md')
    const again = await readProject(second.bytes)
    expect(again.integrity.status, 'integrity after one round trip').toBe('UNCHANGED')
    const third = await writeProjectBytes(again.project, '# md')
    expect(entryHashes(third.bytes)).toEqual(entryHashes(second.bytes))
    expect(Object.keys(entryHashes(second.bytes)).sort()).toEqual(
      Object.keys(entryHashes(first.bytes)).sort(),
    )
  })

  /**
   * 파일을 연 학생이 실제로 여는 것은 **브라우저 저장소의 사본이다** (`WelcomeView`의 `openFile` →
   * `saveProject` → 스토어의 `open` → `loadProject`). 그 사본으로 다시 내보낸 파일이 파일에서 곧장
   * 쓴 것과 같아야 한다.
   */
  it.each(SEEDS)('씨앗 %i — 브라우저 저장소를 지나 다시 내보내도 같다', async (seed) => {
    const { bytes } = await writeProjectBytes(projectOf(seed), '# md')
    const { project: opened } = await readProject(bytes)
    await saveProject(opened, { imported: true })
    const stored = await loadProject(opened.document.manifest.projectId)
    expect(stored).not.toBeNull()

    const fromFile = await writeProjectBytes(opened, '# md')
    const fromStore = await writeProjectBytes(stored!, '# md')
    expect(entryHashes(fromStore.bytes)).toEqual(entryHashes(fromFile.bytes))
  })

  it.each(SEEDS)('씨앗 %i — 다른 도구가 다시 압축해도 같게 열린다', async (seed) => {
    const { bytes } = await writeProjectBytes(projectOf(seed), '# md')
    const direct = await readProject(bytes)
    const how = seed % 16
    const other = rezipped(bytes, how)
    const { project, integrity } = await readProject(other)

    expect(integrity.status, `integrity after rezip ${how}`).toBe('UNCHANGED')
    expect(project.document).toEqual(direct.project.document)
    expect([...project.images.keys()].sort()).toEqual([...direct.project.images.keys()].sort())
    expect([...project.embeddings.keys()].sort()).toEqual(
      [...direct.project.embeddings.keys()].sort(),
    )
    expect(await readProjectMeta(other)).toEqual(direct.project.document)
  })
})
