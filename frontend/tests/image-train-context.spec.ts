// @vitest-environment jsdom
/**
 * **학습 화면 머리의 수는 학습이 세는 수다** (`views/train/ImageTrainContext.vue`, 0.35.2 경계 감사 C C-2).
 *
 * 사진 수는 학습과 같은 함수(`trainableRowsOf`)였는데 범주 수는 빈 범주까지 든 화면 목록(`imageCategories`)을 셌다. 빈 범주를
 * 만들거나 한 범주의 사진을 다 지우면 머리는 N, 학습은 N-1이었고, 그 차이는 결과가 나온 뒤에야 드러난다. 이 머리를 띄우는
 * 스펙이 없어 수를 하나 늘려도 아무것도 안 울었다. **군집은 클래스를 안 세므로 범주 줄이 없다**(코드 소유자, 0.35.3 최종 감사 기록).
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { addCategory, addImages, labeledCategoryCount } from '../src/project/images'
import type { TaskType } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'
import ImageTrainContext from '../src/views/train/ImageTrainContext.vue'
import { HARNESS_BACKBONE, imagePredictProject } from './fixtures/image-workers'

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

/** 개·고양이에 사진 한 장씩, 그리고 빈 범주 토끼. 과제 유형은 `taskType`이다. */
function twoFilledOneEmpty(taskType: TaskType): ProjectFile {
  const photo = (seed: string, category: string) => {
    const bytes = new TextEncoder().encode(`가짜jpg:${seed}`)
    return { hash: hashBytes(bytes), bytes, category }
  }
  const filled = addImages(imagePredictProject([]), [photo('a', '개'), photo('b', '고양이')], {
    canonicalSize: HARNESS_BACKBONE!.canonicalSize,
    now: '2026-10-08T00:00:00.000Z',
    format: 'webp',
  }).project
  const file = addCategory(filled, '토끼', '2026-10-08T00:00:00.000Z')
  return {
    ...file,
    document: { ...file.document, manifest: { ...file.document.manifest, taskType } },
  }
}

function header(file: ProjectFile) {
  useProjectStore().file = file
  return mount(
    { components: { ImageTrainContext }, template: '<dl><ImageTrainContext /></dl>' },
    { global: { plugins: [i18n] } },
  )
}

describe('학습 화면 머리의 범주 수', () => {
  it('빈 범주는 세지 않는다 — 학습이 세는 클래스 수와 같다', () => {
    const file = twoFilledOneEmpty('classification')
    expect(labeledCategoryCount(file)).toBe(2)

    const values = header(file)
      .findAll('dd')
      .map((dd) => dd.text())
    expect(values[1], 'the empty category is not a class').toBe(i18n.global.t('meta.countUnit', 2))
  })

  it('군집에서는 범주 줄이 없다 — 클래스를 안 센다', () => {
    const wrapper = header(twoFilledOneEmpty('clustering'))

    expect(wrapper.findAll('dd'), 'only the photo count stands').toHaveLength(1)
    expect(wrapper.text()).not.toContain(i18n.global.t('meta.image.categories'))
  })
})
