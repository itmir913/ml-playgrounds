/**
 * 사진 꾸러미 읽기 (`data/image/upload.ts`).
 *
 * **규칙 하나하나가 교실에서 실제로 나오는 zip의 모양이다** (open-decisions.md
 * "zip 읽기 규칙 다섯"). 여기가 틀리면 사진이 다른 라벨로 학습되고, 화면에는 아무것도
 * 안 보인 채 정확도만 낮게 나온다 — 학생이 원인을 찾을 수 있는 종류가 아니다.
 */

import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { readImageFiles, readImageZip, summarizeUpload } from '../src/data/image/upload'
import { isClientError } from '../src/errors'
import { IMAGE_UNLABELED } from '../src/project/format'

/** 내용은 아무 바이트나 좋다. 여기서 보는 것은 구조뿐이고 굽는 것은 워커다. */
function makeZip(paths: readonly string[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const path of paths) entries[path] = new Uint8Array([1, 2, 3])
  return zipSync(entries)
}

async function categoriesOf(paths: readonly string[]): Promise<readonly string[]> {
  const items = await readImageZip(makeZip(paths))
  return items.map((item) => item.category)
}

describe('사진 꾸러미의 구조가 라벨이다', () => {
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
  it('한 겹 감싸진 꾸러미는 벗긴다', async () => {
    expect(await categoriesOf(['사진/개/1.jpg', '사진/고양이/2.jpg'])).toEqual(['개', '고양이'])
  })

  /**
   * **감싼 폴더와 범주 폴더는 겉보기가 같다.** 벗긴 뒤에 폴더가 안 남으면 그건 범주가
   * 하나뿐인 정상적인 꾸러미이지 감싸진 것이 아니다.
   */
  it('범주가 하나뿐인 꾸러미를 감싼 것으로 오해하지 않는다', async () => {
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
    const items = await readImageZip(makeZip(['1.jpg', '2.jpg']), '강아지')
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
    )
    expect(items.map((item) => item.path)).toEqual(['개/1.jpg', '고양이/2.jpg'])
  })

  /**
   * 부스러기를 먼저 버려야 `__MACOSX/`가 "루트의 폴더"로 세어지지 않는다. 순서가
   * 뒤집히면 감싸진 꾸러미가 폴더 둘로 보여 안 벗겨진다.
   */
  it('부스러기 때문에 감싼 겹을 못 벗기는 일이 없다', async () => {
    expect(await categoriesOf(['__MACOSX/._사진', '사진/개/1.jpg', '사진/고양이/2.jpg'])).toEqual([
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
    const items = await readImageZip(makeZip(['개/1.jpg', '고양이/1.jpg']))
    expect(new Set(items.map((item) => item.path)).size).toBe(2)
    expect(items.map((item) => item.file.name)).toEqual(items.map((item) => item.path))
  })
})

describe('받지 않는 꾸러미', () => {
  it('zip이 아니면 거부한다', async () => {
    const error = await readImageZip(new Uint8Array([0, 1, 2, 3])).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_ZIP_INVALID')
  })

  /** "0장을 받았습니다"로 조용히 끝내면 학생은 올린 줄 안다. */
  it('부스러기만 든 꾸러미는 사진이 없다고 말한다', async () => {
    const error = await readImageZip(makeZip(['__MACOSX/._x', '.DS_Store'])).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_ZIP_NO_IMAGES')
  })

  /**
   * **다듬어서 받지 않는다.** 다듬으면 서로 다른 폴더 둘이 한 범주로 합쳐질 수 있고,
   * 그건 라벨이 조용히 바뀌는 것이다.
   */
  it('범주로 쓸 수 없는 폴더 이름은 이름을 대며 거부한다', async () => {
    const error = await readImageZip(makeZip(['_숨김/1.jpg', '개/2.jpg'])).catch(
      (reason: unknown) => reason,
    )
    expect(isClientError(error) && error.code).toBe('IMAGE_CATEGORY_NAME_INVALID')
    expect(isClientError(error) && error.params).toEqual({ name: '_숨김' })
  })

  /** `_unlabeled`는 우리가 쓰는 이름이라 예외다. 내보낸 꾸러미를 다시 올리는 길이다. */
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
    const items = readImageFiles([pick('사진/개/1.jpg'), pick('사진/고양이/2.jpg')])
    expect(items.map((item) => item.category)).toEqual(['개', '고양이'])
    // 여기서도 워커에 넘길 이름이 경로여야 한다.
    expect(items.map((item) => item.file.name)).toEqual(['개/1.jpg', '고양이/2.jpg'])
  })

  it('구조 없이 파일만 고르면 떨어뜨린 자리로 간다', () => {
    const loose = new File([new Uint8Array([1])], '1.jpg')
    expect(readImageFiles([loose], '강아지').map((item) => item.category)).toEqual(['강아지'])
  })

  it('부스러기는 여기서도 버린다', () => {
    const items = readImageFiles([pick('개/1.jpg'), pick('개/.DS_Store')])
    expect(items.map((item) => item.path)).toEqual(['개/1.jpg'])
  })
})

describe('굽기 전에 보여줄 요약', () => {
  it('범주마다 장수를 센다', async () => {
    const items = await readImageZip(makeZip(['개/1.jpg', '개/2.jpg', '고양이/3.jpg']))
    expect(summarizeUpload(items)).toEqual([
      { category: '개', count: 2 },
      { category: '고양이', count: 1 },
    ])
  })

  /** 범주가 아니라 상태다. 사이에 섞여 있으면 학생이 범주 하나로 읽는다. */
  it('라벨 없음은 맨 뒤다', async () => {
    const items = await readImageZip(makeZip(['1.jpg', '개/2.jpg', '하늘/3.jpg']))
    expect(summarizeUpload(items).map((one) => one.category)).toEqual([
      '개',
      '하늘',
      IMAGE_UNLABELED,
    ])
  })
})
