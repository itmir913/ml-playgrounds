/**
 * 사진 압축 파일 읽기 (`data/image/upload.ts`).
 *
 * **규칙 하나하나가 교실에서 실제로 나오는 zip의 모양이다** (open-decisions.md
 * "zip 읽기 규칙 다섯"). 여기가 틀리면 사진이 다른 라벨로 학습되고, 화면에는 아무것도
 * 안 보인 채 정확도만 낮게 나온다 — 학생이 원인을 찾을 수 있는 종류가 아니다.
 */

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { unzipSync, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * **브라우저가 싣는 빌드를 쓴다** (`esm/browser.js`). vitest는 node 조건으로 풀어 `worker_threads`
 * 빌드를 주는데, 그쪽은 아래 *"워커를 띄우지 않는다"*가 가짜로 바꾸는 전역 `Worker`를 안 지나서
 * 그 검사가 아무것도 안 잰다(`format.spec.ts`의 같은 mock과 같은 이유).
 */
vi.mock('fflate', async () => await import('../node_modules/fflate/esm/browser.js'))

import { sourceFiles, withoutComments } from './fixtures/source'

import {
  IMAGE_ACCEPT,
  readImageFiles,
  readImageZip,
  summarizeUpload,
  ZIP_EXTENSION,
} from '../src/data/image/upload'
import { isClientError } from '../src/errors'
import { IMAGE_ZIP_SLICE_BYTES } from '../src/limits'
import { IMAGE_UNLABELED } from '../src/project/format'

/** 내용은 아무 바이트나 좋다. 여기서 보는 것은 구조뿐이고 굽는 것은 워커다. */
function makeZip(paths: readonly string[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const path of paths) entries[path] = new Uint8Array([1, 2, 3])
  return zipSync(entries)
}

/** 데이터 화면의 읽기 — 최상위 폴더가 범주다. 아래 *"라벨을 읽지 않으면"*만 `'none'`을 쓴다. */
const INFERRED = { labels: 'inferred' } as const
const NONE = { labels: 'none' } as const

async function categoriesOf(paths: readonly string[]): Promise<readonly string[]> {
  const items = await readImageZip(makeZip(paths), INFERRED)
  return items.map((item) => item.category)
}

describe('사진 압축 파일의 구조가 라벨이다', () => {
  it('루트 바로 아래 폴더가 범주다', async () => {
    expect(await categoriesOf(['개/1.jpg', '개/2.jpg', '고양이/3.jpg'])).toEqual([
      '개',
      '개',
      '고양이',
    ])
  })

  /**
   * **윈도우 탐색기에서 폴더를 우클릭해 압축하면 반드시 이 모양이다.** 교실에서 가장
   * 흔한 zip이라, 여기서 막히면 학생이 아는 방법이 통째로 막힌다.
   */
  it('한 겹 감싸진 압축 파일은 벗긴다', async () => {
    expect(await categoriesOf(['사진/개/1.jpg', '사진/고양이/2.jpg'])).toEqual(['개', '고양이'])
  })

  /**
   * **감싼 폴더와 범주 폴더는 겉보기가 같다.** 벗긴 뒤에 폴더가 안 남으면 그건 범주가
   * 하나뿐인 정상적인 압축 파일이지 감싸진 것이 아니다.
   */
  it('범주가 하나뿐인 압축 파일을 감싼 것으로 오해하지 않는다', async () => {
    expect(await categoriesOf(['개/1.jpg', '개/2.jpg'])).toEqual(['개', '개'])
  })

  it('두 겹 이상은 한 번만 벗긴다 - 나머지는 최상위로 흡수된다', async () => {
    expect(await categoriesOf(['사진/개/산책/1.jpg', '사진/고양이/2.jpg'])).toEqual([
      '개',
      '고양이',
    ])
  })

  /**
   * `ImageFolder`와 `image_dataset_from_directory`가 재귀로 훑고 최상위를 클래스로
   * 삼는다. 여기서 거부하면 **우리가 파이썬보다 까다로워진다.**
   */
  it('더 깊은 중첩을 거부하지 않는다', async () => {
    expect(await categoriesOf(['개/1.jpg', '고양이/산책/봄/2.jpg'])).toEqual(['개', '고양이'])
  })

  /**
   * **여기는 구조만 보고는 답이 없다.** `사진/개/1.jpg`(감싼 것)와 `개/산책/1.jpg`
   * (범주 하나에 하위 폴더)는 **모양이 정확히 같다.** 흔한 쪽을 고른 것이고
   * (윈도우 우클릭 압축), 그래서 규칙 다섯째가 **굽기 전에 읽은 결과를 확인시킨다** —
   * 조용히 틀릴 수 있는 유일한 자리라 화면이 그걸 시끄럽게 만든다.
   */
  it('범주가 하나인데 하위 폴더가 있으면 그 하위가 범주로 읽힌다 - 화면이 확인시킨다', async () => {
    expect(await categoriesOf(['개/산책/1.jpg', '개/실내/2.jpg'])).toEqual(['산책', '실내'])
  })

  it('폴더 없이 놓인 사진은 떨어뜨린 자리로 간다', async () => {
    const items = await readImageZip(makeZip(['1.jpg', '2.jpg']), {
      labels: 'inferred',
      fallbackCategory: '강아지',
    })
    expect(items.map((item) => item.category)).toEqual(['강아지', '강아지'])
  })

  it('떨어뜨린 자리를 안 정하면 라벨 없음이다', async () => {
    expect(await categoriesOf(['1.jpg'])).toEqual([IMAGE_UNLABELED])
  })

  /**
   * **맥에서 압축하면 `__MACOSX/`가 반드시 생긴다.** 그걸 폴더로 읽으면 학생이 만들지
   * 않은 범주가 하나 뜨고, 학생은 무엇을 잘못했는지 찾게 된다.
   */
  it('압축 프로그램이 넣는 부스러기는 조용히 버린다', async () => {
    const items = await readImageZip(
      makeZip([
        '__MACOSX/._개',
        '개/1.jpg',
        '개/.DS_Store',
        '개/Thumbs.db',
        '고양이/2.jpg',
        '고양이/._2.jpg',
      ]),
      INFERRED,
    )
    expect(items.map((item) => item.path)).toEqual(['개/1.jpg', '고양이/2.jpg'])
  })

  /**
   * 부스러기를 먼저 버려야 `__MACOSX/`가 "루트의 폴더"로 세어지지 않는다. 순서가
   * 뒤집히면 감싸진 압축 파일이 폴더 둘로 보여 안 벗겨진다.
   */
  it('부스러기 때문에 감싼 겹을 못 벗기는 일이 없다', async () => {
    expect(await categoriesOf(['__MACOSX/._사진', '사진/개/1.jpg', '사진/고양이/2.jpg'])).toEqual([
      '개',
      '고양이',
    ])
  })

  /**
   * **윈도가 폴더를 들여다본 자리에 남기는 `desktop.ini`** (2026-09-28 감사 G G-2). 업로드의
   * 부스러기 목록에만 빠져 있어 범주 안에 있으면 사진 한 장으로 세어졌다.
   */
  it('범주 안의 desktop.ini는 사진이 아니다', async () => {
    const items = await readImageZip(
      makeZip(['개/1.jpg', '개/desktop.ini', '고양이/2.jpg']),
      INFERRED,
    )
    expect(items.map((item) => item.path)).toEqual(['개/1.jpg', '고양이/2.jpg'])
    expect(summarizeUpload(items)).toEqual([
      { category: '개', count: 1 },
      { category: '고양이', count: 1 },
    ])
  })

  /** 루트에 있으면 한 겹 벗기기를 막아 **범주 둘이 감싼 폴더 이름 하나로 합쳐졌다.** */
  it('루트의 desktop.ini가 감싼 겹 벗기기를 막지 않는다', async () => {
    expect(await categoriesOf(['desktop.ini', '사진/개/1.jpg', '사진/고양이/2.jpg'])).toEqual([
      '개',
      '고양이',
    ])
  })

  /**
   * **굽는 워커는 이름으로만 대답한다** (`CanonicalImage.sourceName`). 파일 이름을
   * 그대로 두면 `개/1.jpg`와 `고양이/1.jpg`가 같은 열쇠가 되어 **한쪽 라벨이 다른 쪽을
   * 덮는다.** 화면에는 아무것도 안 보인다.
   */
  it('경로가 라벨의 열쇠다 - 파일 이름이 겹쳐도 섞이지 않는다', async () => {
    const items = await readImageZip(makeZip(['개/1.jpg', '고양이/1.jpg']), INFERRED)
    expect(new Set(items.map((item) => item.path)).size).toBe(2)
    expect(items.map((item) => item.file.name)).toEqual(items.map((item) => item.path))
  })
})

describe('받지 않는 압축 파일', () => {
  it('zip이 아니면 거부한다', async () => {
    const error = await readImageZip(new Uint8Array([0, 1, 2, 3]), INFERRED).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_ZIP_INVALID')
  })

  /** "0장을 받았습니다"로 조용히 끝내면 학생은 올린 줄 안다. */
  it('부스러기만 든 압축 파일은 사진이 없다고 말한다', async () => {
    const error = await readImageZip(makeZip(['__MACOSX/._x', '.DS_Store']), INFERRED).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_ZIP_NO_IMAGES')
  })

  /**
   * **다듬어서 받지 않는다.** 다듬으면 서로 다른 폴더 둘이 한 범주로 합쳐질 수 있고,
   * 그건 라벨이 조용히 바뀌는 것이다.
   */
  it('범주로 쓸 수 없는 폴더 이름은 이름을 대며 거부한다', async () => {
    const error = await readImageZip(makeZip(['_숨김/1.jpg', '개/2.jpg']), INFERRED).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_CATEGORY_NAME_INVALID')
    expect(isClientError(error) && error.params).toEqual({ name: '_숨김' })
  })

  /** `_unlabeled`는 우리가 쓰는 이름이라 예외다. 내보낸 압축 파일을 다시 올리는 길이다. */
  it('라벨 없음 폴더는 그대로 받는다', async () => {
    expect(await categoriesOf([`${IMAGE_UNLABELED}/1.jpg`, '개/2.jpg'])).toEqual([
      IMAGE_UNLABELED,
      '개',
    ])
  })
})

describe('파일과 폴더로 고른 경우', () => {
  function pick(path: string): File {
    const file = new File([new Uint8Array([1])], path.split('/').pop() ?? path)
    Object.defineProperty(file, 'webkitRelativePath', { value: path })
    return file
  }

  it('폴더를 통째로 고르면 구조가 라벨이 된다', () => {
    const items = readImageFiles([pick('사진/개/1.jpg'), pick('사진/고양이/2.jpg')], INFERRED)
    expect(items.map((item) => item.category)).toEqual(['개', '고양이'])
    // 여기서도 워커에 넘길 이름이 경로여야 한다.
    expect(items.map((item) => item.file.name)).toEqual(['개/1.jpg', '고양이/2.jpg'])
  })

  it('구조 없이 파일만 고르면 떨어뜨린 자리로 간다', () => {
    const loose = new File([new Uint8Array([1])], '1.jpg')
    expect(
      readImageFiles([loose], { labels: 'inferred', fallbackCategory: '강아지' }).map(
        (item) => item.category,
      ),
    ).toEqual(['강아지'])
  })

  it('부스러기는 여기서도 버린다', () => {
    const items = readImageFiles([pick('개/1.jpg'), pick('개/.DS_Store')], INFERRED)
    expect(items.map((item) => item.path)).toEqual(['개/1.jpg'])
  })
})

describe('굽기 전에 보여줄 요약', () => {
  it('범주마다 장수를 센다', async () => {
    const items = await readImageZip(makeZip(['개/1.jpg', '개/2.jpg', '고양이/3.jpg']), INFERRED)
    expect(summarizeUpload(items)).toEqual([
      { category: '개', count: 2 },
      { category: '고양이', count: 1 },
    ])
  })

  /** 범주가 아니라 상태다. 사이에 섞여 있으면 학생이 범주 하나로 읽는다. */
  it('라벨 없음은 맨 뒤다', async () => {
    const items = await readImageZip(makeZip(['1.jpg', '개/2.jpg', '하늘/3.jpg']), INFERRED)
    expect(summarizeUpload(items).map((one) => one.category)).toEqual([
      '개',
      '하늘',
      IMAGE_UNLABELED,
    ])
  })
})

/**
 * **압축 파일이 준 경로를 입구에서 한 번만 우리 규칙으로 맞춘다** (V11 R1 감사 B-6·B-8).
 *
 * 둘 다 실물 교실에서 오는 모양이다 — 맥이 만든 zip은 한글 이름을 NFD(자모 분해)로 넣고,
 * zip 규격이 `/`를 요구하는데도 `\\`로 만드는 도구가 있다.
 */
describe('압축 파일이 준 경로를 우리 규칙으로 맞춘다', () => {
  /** NFD로 쓴 `강아지`. 코드 포인트가 일곱이고 화면에는 똑같이 보인다. */
  const NFD = '강아지'.normalize('NFD')

  it('정규화만 다른 폴더는 한 범주다', async () => {
    expect(NFD).not.toBe('강아지')
    const items = await readImageZip(makeZip(['강아지/1.jpg', `${NFD}/2.jpg`]), INFERRED)
    expect(summarizeUpload(items)).toEqual([{ category: '강아지', count: 2 }])
  })

  /**
   * NFD로는 같은 이름이 두 배로 세어져, 51자 이상의 한글 범주가 든 맥 zip이
   * `IMAGE_CATEGORY_NAME_INVALID`로 **통째로** 거부됐다.
   */
  it('길이도 정규화한 뒤에 잰다', async () => {
    const long = '가'.repeat(60)
    const items = await readImageZip(makeZip([`${long.normalize('NFD')}/1.jpg`]), INFERRED)
    expect(items.map((item) => item.category)).toEqual([long])
  })

  it('역슬래시로 만든 압축 파일도 폴더를 읽는다', async () => {
    const items = await readImageZip(makeZip(['개\\1.jpg', '개\\2.jpg', '고양이\\3.jpg']), INFERRED)
    expect(summarizeUpload(items)).toEqual([
      { category: '개', count: 2 },
      { category: '고양이', count: 1 },
    ])
  })

  it('역슬래시로 온 부스러기도 버린다', async () => {
    const items = await readImageZip(makeZip(['개\\1.jpg', '__MACOSX\\개\\._1.jpg']), INFERRED)
    expect(items.map((item) => item.path)).toEqual(['개/1.jpg'])
  })

  it('폴더 고르기 쪽 입구도 같은 규칙이다', () => {
    const pickNfd = (path: string): File => {
      const file = new File([new Uint8Array([1])], path.slice(path.lastIndexOf('/') + 1))
      Object.defineProperty(file, 'webkitRelativePath', { value: path })
      return file
    }
    const items = readImageFiles([pickNfd('강아지/1.jpg'), pickNfd(`${NFD}/2.jpg`)], INFERRED)
    expect(summarizeUpload(items)).toEqual([{ category: '강아지', count: 2 }])
  })
})

/**
 * **라벨을 읽지 않으면** (`upload.ts`의 `ImageLabels`, #38 결정 7). 예측 화면의 읽기다.
 *
 * 예측에는 라벨이 없는데 폴더 이름을 범주로 읽어 검사해서, **쓰지도 않는 이름 때문에** zip이
 * 통째로 거절됐다. 바뀌는 것은 범주를 다는 규칙 하나 — 경로를 다루는 나머지는 `'inferred'`와
 * 한 벌이고 `path`가 굽기 결과를 되찾는 유일한 열쇠로 남는다.
 */
describe('라벨을 읽지 않으면', () => {
  const NFD = '강아지'.normalize('NFD')

  function pick(path: string): File {
    const file = new File([new Uint8Array([1])], path.slice(path.lastIndexOf('/') + 1))
    Object.defineProperty(file, 'webkitRelativePath', { value: path })
    return file
  }

  it('범주 규칙에 안 맞는 폴더 이름도 받고 전부 라벨 없음이다 - zip', async () => {
    const items = await readImageZip(makeZip(['_x/1.png', 'a./2.png', '3.png']), NONE)
    expect(items.map((item) => item.category)).toEqual([
      IMAGE_UNLABELED,
      IMAGE_UNLABELED,
      IMAGE_UNLABELED,
    ])
    expect(items.map((item) => item.path)).toEqual(['_x/1.png', 'a./2.png', '3.png'])
  })

  it('범주 규칙에 안 맞는 폴더 이름도 받고 전부 라벨 없음이다 - 폴더 선택', () => {
    const items = readImageFiles([pick('사진/_x/1.png'), pick('사진/a./2.png')], NONE)
    expect(items.map((item) => item.category)).toEqual([IMAGE_UNLABELED, IMAGE_UNLABELED])
    expect(items.map((item) => item.file.name)).toEqual(['_x/1.png', 'a./2.png'])
  })

  it('같은 이름이 다른 폴더에 있어도 경로가 열쇠로 남는다', async () => {
    const items = await readImageZip(makeZip(['a/1.png', 'b/1.png']), NONE)
    expect(new Set(items.map((item) => item.path)).size).toBe(2)
    expect(items.map((item) => item.file.name)).toEqual(items.map((item) => item.path))
  })

  /** 부스러기 버리기·정규화(NFD·역슬래시)·한 겹 벗기기가 같은 경로를 낸다. */
  it('경로는 라벨을 읽을 때와 한 벌이다 - zip', async () => {
    const zip = makeZip([
      '__MACOSX/._개',
      'desktop.ini',
      '사진/강아지/1.jpg',
      `사진/${NFD}/2.jpg`,
      '사진\\고양이\\3.jpg',
      '사진/고양이/.DS_Store',
    ])
    const inferred = await readImageZip(zip, INFERRED)
    const none = await readImageZip(zip, NONE)
    expect(none.map((item) => item.path)).toEqual(inferred.map((item) => item.path))
    expect(none.map((item) => item.path)).toEqual(['강아지/1.jpg', '강아지/2.jpg', '고양이/3.jpg'])
  })

  it('경로는 라벨을 읽을 때와 한 벌이다 - 폴더 선택', () => {
    const files = [pick('사진/강아지/1.jpg'), pick(`사진/${NFD}/2.jpg`), pick('사진/개/.DS_Store')]
    const inferred = readImageFiles(files, INFERRED)
    const none = readImageFiles(files, NONE)
    expect(none.map((item) => item.path)).toEqual(inferred.map((item) => item.path))
    expect(none.map((item) => item.file.name)).toEqual(['강아지/1.jpg', '강아지/2.jpg'])
  })

  it('부스러기만 든 압축 파일은 여기서도 사진이 없다고 말한다', async () => {
    const error = await readImageZip(makeZip(['__MACOSX/._x', '.DS_Store']), NONE).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_ZIP_NO_IMAGES')
  })
})

/**
 * **고를 수 있는 것과 열 수 있는 것이 같아야 한다** (R10 감사 C-4).
 *
 * 받는 자리의 `accept`와 "이게 압축 파일인가"를 가르는 판정이 갈리면, **고를 수는 있는데
 * 안 열리는 파일**이 생긴다. 상수를 하나로 모은 이유가 그것인데 아무도 안 물고 있었다 —
 * 인라인으로 되돌려도 저장소가 초록이었다.
 */
describe('압축 파일을 가르는 값이 하나다', () => {
  it('받는 자리가 그 확장자를 받는다', () => {
    expect(IMAGE_ACCEPT).toContain(ZIP_EXTENSION)
  })

  /**
   * 화면의 판정은 `name.toLowerCase().endsWith(ZIP_EXTENSION)`이다
   * (`views/preprocess/ImagePrepPanel.vue`·`views/data/ImagePanel.vue`). 상수 자체가
   * 소문자가 아니면 그 판정이 **어떤 파일도 압축 파일로 안 본다.**
   */
  it('상수가 소문자다 - 판정이 소문자로 내려서 견준다', () => {
    expect(ZIP_EXTENSION).toBe(ZIP_EXTENSION.toLowerCase())
    expect('사진모음.ZIP'.toLowerCase().endsWith(ZIP_EXTENSION)).toBe(true)
  })

  /**
   * **상수가 있어도 아무도 안 쓰면 뜻이 없다** (R11 감사 C-5). 위 둘은 상수의 성질만
   * 물어서, 화면이 상수를 버리고 `.zip`을 도로 박아 넣어도 저장소가 초록이었다 —
   * 상수를 만든 이유가 바로 그 되돌림을 막는 것이었는데.
   *
   * **선언한 자리 하나는 빼고 본다.** 거기가 그 글자가 있어야 할 유일한 자리다.
   */
  it('확장자를 손으로 적은 자리가 없다', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src'))
      .filter((path) => !path.endsWith(join('data', 'image', 'upload.ts')))
      .flatMap((path) =>
        withoutComments(readFileSync(path, 'utf-8'))
          .map((line, index) => ({ line, at: index + 1, path }))
          .filter((row) => /['"`]\.zip['"`]/i.test(row.line))
          .map((row) => `${relative(process.cwd(), row.path)}:${row.at}`),
      )
    expect(offenders, 'writes the extension instead of ZIP_EXTENSION').toEqual([])
  })
})

/**
 * **사진 zip을 읽는 길은 워커를 띄우지 않는다** (2026-09-28 감사 G G-3, open-decisions.md 68의
 * 판례).
 *
 * fflate의 비동기 `unzip`은 비압축 512KB 이상이고 압축률이 0.8 이하인 deflate 엔트리를 `blob:`
 * 워커로 넘긴다. 무압축 BMP가 든 zip이 그 모양이고, 워커가 막히면 날것의 오류가, 답이 없으면
 * **끝나지 않는 읽기**가 났다(진행 잠금이 안 풀린다).
 */
describe('워커를 띄우지 않는다', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 무압축 24비트 BMP 한 장 — 헤더와 그라데이션 화소. deflate가 잘 누른다. */
  function bmp(width: number, height: number): Uint8Array {
    const row = Math.ceil((width * 3) / 4) * 4
    const bytes = new Uint8Array(54 + row * height)
    const view = new DataView(bytes.buffer)
    bytes.set([0x42, 0x4d])
    view.setUint32(2, bytes.length, true)
    view.setUint32(10, 54, true)
    view.setUint32(14, 40, true)
    view.setInt32(18, width, true)
    view.setInt32(22, height, true)
    view.setUint16(26, 1, true)
    view.setUint16(28, 24, true)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = 54 + y * row + x * 3
        bytes.set([x & 0xff, y & 0xff, (x + y) & 0xff], at)
      }
    }
    return bytes
  }

  /** fflate가 워커로 넘기는 조건 (`esm/browser.js`의 `unzip`) — 검사의 전제다. */
  function wouldSpawn(zip: Uint8Array, name: string): boolean {
    let found = false
    unzipSync(zip, {
      filter: (file) => {
        if (file.name === name) {
          found =
            file.compression === 8 &&
            file.originalSize >= 524_288 &&
            file.size <= 0.8 * file.originalSize
        }
        return false
      },
    })
    return found
  }

  it('무압축 BMP가 든 zip도 워커 없이 읽는다', async () => {
    const zip = zipSync({ '개/a.bmp': bmp(640, 480), '고양이/b.bmp': bmp(640, 480) }, { level: 6 })
    expect(wouldSpawn(zip, '개/a.bmp'), 'fixture must take the worker path').toBe(true)
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('reading a photo zip must not spawn a worker')
        }
      },
    )

    const items = await readImageZip(zip, INFERRED)
    expect(summarizeUpload(items)).toEqual([
      { category: '개', count: 1 },
      { category: '고양이', count: 1 },
    ])
    expect(items[0]?.file.size).toBe(bmp(640, 480).length)
  })

  /**
   * **조각으로 풀어도 한 번에 푼 것과 같다** (`upload.ts`의 `unzipEntries`, `IMAGE_ZIP_SLICE_BYTES`).
   * 이름 되살리기·부스러기·한 겹 벗기기는 **전체 목록**을 보고 정하므로, 조각 경계가 그 판정을
   * 흔들면 라벨이 바뀐다. 감싼 폴더와 루트의 부스러기가 조각 여럿에 걸치게 둔다.
   */
  it('조각으로 풀어도 한 번에 푼 것과 같다', async () => {
    const photos: Record<string, Uint8Array> = {}
    const count = Math.ceil((IMAGE_ZIP_SLICE_BYTES * 3) / bmp(640, 480).length)
    for (let i = 0; i < count; i++) {
      photos[`사진/${i % 2 === 0 ? '개' : '고양이'}/${i}.bmp`] = bmp(640, 480)
    }
    const zip = zipSync({ 'desktop.ini': new Uint8Array([1]), ...photos }, { level: 6 })
    const ticks = vi.spyOn(globalThis, 'setTimeout')

    const items = await readImageZip(zip, INFERRED)
    expect(ticks.mock.calls.length, 'must yield between slices').toBeGreaterThanOrEqual(3)
    ticks.mockRestore()
    expect(items.map((item) => item.path)).toEqual(
      Object.keys(photos).map((path) => path.slice('사진/'.length)),
    )
    expect(items.map((item) => item.file.size)).toEqual(
      Object.values(photos).map((bytes) => bytes.length),
    )
  })

  /**
   * **워커를 쓰는 fflate API를 src가 들이지 않는다.** 위 검사는 사진 zip 하나의 길만 보므로,
   * 다른 자리가 비동기 API를 새로 들이면 못 본다. 쓰는 것은 `*Sync`와 흘려 담기(`Zip`·
   * `ZipPassThrough`)뿐이다 — `format.ts`의 `zipToBlob`·`unzipEntries`가 그 판단의 자리다.
   */
  it('src가 워커를 쓰는 fflate API를 들이지 않는다', () => {
    const workerApis = new Set([
      'zip',
      'unzip',
      'deflate',
      'inflate',
      'gzip',
      'gunzip',
      'zlib',
      'unzlib',
      'compress',
      'decompress',
    ])
    const offenders = sourceFiles(join(process.cwd(), 'src')).flatMap((path) => {
      const text = withoutComments(readFileSync(path, 'utf-8')).join('\n')
      return [
        ...text.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]fflate(?:\/[^'"]*)?['"]/g),
      ]
        .flatMap((match) =>
          (match[1] ?? '')
            .split(',')
            .map(
              (part) =>
                part
                  .trim()
                  .replace(/^type\s+/, '')
                  .split(/\s+as\s+/)[0] ?? '',
            )
            .filter((name) => workerApis.has(name) || name.startsWith('Async')),
        )
        .map((name) => `${relative(process.cwd(), path)}: ${name}`)
    })
    expect(offenders, 'imports a worker-backed fflate API').toEqual([])
  })
})
