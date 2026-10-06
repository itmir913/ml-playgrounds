/**
 * **압축 파일 엔트리 이름의 규칙이 한 벌인가** (`data/archive-entries.ts`).
 *
 * 사진 zip 업로드와 `.mlpx` 읽기가 부스러기 목록과 이름 맞추기를 따로 갖고 있었고, 업로드에만
 * `desktop.ini`가 빠져 있었다(2026-09-28 감사 G G-2). 여기는 **같은 잡음 표를 두 입구로 돌린다** —
 * 한쪽이 공통 모듈을 버리고 제 목록을 다시 들이면 그 줄이 운다.
 *
 * 두 입구가 **일부러 다른 것**(빈 파일·한 겹 벗기기의 증인)은 표에 없다. 이유는 각 입구의
 * 주석에 있다.
 */

import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { ARCHIVE_NOISE_NAMES, isNoiseName, normalizeEntryName } from '../src/data/archive-entries'
import { imageEntryPath } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { readImageZip } from '../src/data/image/upload'
import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { IMAGE_DATA_DIR, readProject, type ProjectFile } from '../src/project/format'
import { FORMAT_VERSION, PROJECT_KIND_ML } from '../src/project/schema'
import { writeProjectBytes } from './fixtures/write'

/** 범주 폴더 `개` 안에 둘 부스러기 — 목록 전부와 맥의 두 모양. */
const NOISE_IN_FOLDER: readonly string[] = [...ARCHIVE_NOISE_NAMES, '._1.jpg', '__MACOSX/._1.jpg']

function imageProject(): ProjectFile {
  const bytes = new TextEncoder().encode('가짜webp:a')
  const path = imageEntryPath('data', hashBytes(bytes), '개', CANONICAL_FORMATS.webp)
  return {
    document: {
      manifest: {
        formatVersion: FORMAT_VERSION,
        appVersion: '0.0.0',
        projectId: '3f9a1b2c-4d5e-4f60-8a1b-2c3d4e5f6071',
        name: '개',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        kind: PROJECT_KIND_ML,
        dataType: 'image',
        locale: 'ko',
      },
      settings: {
        data: {
          dataset: { path: IMAGE_DATA_DIR, canonicalSize: 224, format: 'webp', quality: 0.65 },
          categories: ['개'],
          backboneId: DEFAULT_BACKBONE_ID,
        },
        split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
        runtime: 'mljs',
        selectedAlgorithms: [],
        hyperparameters: {},
      },
      runs: { experiments: [] },
      portfolio: {
        template: { sections: [] },
        answerFormat: 'plain-v1',
        answers: {},
        attachments: {},
      },
    },
    models: new Map(),
    images: new Map([[path, bytes]]),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

describe('두 입구가 같은 잡음 표로 돈다', () => {
  for (const noise of NOISE_IN_FOLDER) {
    it(`사진 zip 업로드가 버린다: 개/${noise}`, async () => {
      const items = await readImageZip(
        zipSync({ '개/1.jpg': new Uint8Array([1]), [`개/${noise}`]: new Uint8Array([2]) }),
        { labels: 'inferred' },
      )
      expect(items.map((item) => item.path)).toEqual(['개/1.jpg'])
    })

    it(`.mlpx 읽기가 대조와 사진 수집 전에 버린다: dataset/data/개/${noise}`, async () => {
      const before = imageProject()
      const { bytes } = await writeProjectBytes(before, '# p')
      const files = { ...unzipSync(bytes), [`${IMAGE_DATA_DIR}개/${noise}`]: new Uint8Array([2]) }
      const { project, integrity } = await readProject(zipSync(files))

      expect(integrity.status).toBe('UNCHANGED')
      expect([...project.images.keys()]).toEqual([...before.images.keys()])
    })
  }
})

describe('이름 맞추기', () => {
  it('구분자는 /로, 글자는 NFC로 모은다', () => {
    expect(normalizeEntryName('개\\1.jpg')).toBe('개/1.jpg')
    expect(normalizeEntryName('강아지'.normalize('NFD'))).toBe('강아지')
  })

  it('구분자가 \\여도 부스러기다', () => {
    expect(isNoiseName('__MACOSX\\개\\._1.jpg')).toBe(true)
    expect(isNoiseName('개\\desktop.ini')).toBe(true)
    expect(isNoiseName('개\\1.jpg')).toBe(false)
  })
})
