/**
 * **앱이 필요할 때 받는 코드 조각을 못 받으면 `SCREEN_LOAD_FAILED`다** (open-decisions.md 86).
 *
 * 배포 뒤 열어 둔 옛 탭은 없어진 해시를 부르므로 다시 해도 같은 청크가 없다 — 할 일은 새로고침이다. 전에는
 * 라우트 화면만 그렇게 말했고, 화면 안의 지연 부품은 `UNEXPECTED_ERROR`("다시 시도"), 엑셀 파서는
 * `DATASET_PARSE_FAILED`("파일 형식을 확인"), 임베딩 워커의 TF.js는 `BACKBONE_UNAVAILABLE`("다시 시도")이었다.
 *
 * **청크를 못 받는 모양은 모듈 대역으로 만든다.** vitest는 대역 공장이 던진 것을 자기 문장으로 감싸므로, 대역의
 * 내보낸 이름을 읽는 순간 던지게 한다 — 받는 쪽에서는 같은 원문이 같은 자리(`await import` 바로 뒤)에서 난다.
 */
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClientError, errorMessageKey, isChunkLoadError, toMessage } from '../src/errors'
import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { handleEmbed } from '../src/ml/embed/handler'
import type { EmbedMessage } from '../src/ml/embed/protocol'
import { chooseBackend, type BackboneRunner } from '../src/ml/embed/runner'

/** 브라우저마다 동적 `import()`가 청크를 못 받았을 때 던지는 원문. */
const CHUNK_MESSAGES = {
  chromium:
    'Failed to fetch dynamically imported module: https://example.test/assets/Gone-1a2b3c.js',
  firefox: 'error loading dynamically imported module: https://example.test/assets/Gone-1a2b3c.js',
  safari: 'Importing a module script failed.',
  vitePreloadCss: 'Unable to preload CSS for https://example.test/assets/Gone-1a2b3c.css',
}

const gone = (message = CHUNK_MESSAGES.chromium): TypeError => new TypeError(message)

describe('청크 실패 판정', () => {
  it.each(Object.entries(CHUNK_MESSAGES))('%s의 원문을 청크 실패로 본다', (_browser, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('앞에 다른 글자가 붙어도 원문 안에 문구가 있으면 청크 실패로 본다', () => {
    expect(isChunkLoadError(new TypeError(`[vite] ${CHUNK_MESSAGES.chromium}`))).toBe(true)
  })

  it('이름이 ChunkLoadError인 오류도 청크 실패다', () => {
    const error = new Error('Loading chunk 7 failed.')
    error.name = 'ChunkLoadError'
    expect(isChunkLoadError(error)).toBe(true)
  })

  it('다른 실패는 청크 실패가 아니다', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isChunkLoadError(new Error('render exploded'))).toBe(false)
    expect(isChunkLoadError(new ClientError('DATASET_PARSE_FAILED'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })

  it('알림으로 가는 길이 청크 실패를 SCREEN_LOAD_FAILED로 바꾸고 원문을 싣는다', () => {
    expect(toMessage(gone())).toEqual({
      key: errorMessageKey('SCREEN_LOAD_FAILED'),
      params: { detail: CHUNK_MESSAGES.chromium },
    })
  })
})

// ---------------- 엑셀 파서 ----------------

async function workbookBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('S').addRows([
    ['x', 'y'],
    [1, 2],
  ])
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** 내보낸 이름을 읽는 순간 던지는 대역. */
function missingModule(names: readonly string[], error: Error): Record<string, unknown> {
  const module: Record<string, unknown> = {}
  for (const name of names) {
    Object.defineProperty(module, name, {
      enumerable: true,
      get() {
        throw error
      },
    })
  }
  return module
}

afterEach(() => {
  vi.doUnmock('exceljs')
  vi.doUnmock('xlsx')
  vi.resetModules()
})

describe('엑셀 파서 청크', { timeout: 20_000 }, () => {
  it('두 파서를 다 못 받으면 파일 탓이 아니라 SCREEN_LOAD_FAILED다', async () => {
    const bytes = await workbookBytes()
    vi.resetModules()
    vi.doMock('exceljs', () => missingModule(['Workbook'], gone()))
    vi.doMock('xlsx', () => missingModule(['read', 'utils'], gone(CHUNK_MESSAGES.firefox)))
    const { openXlsx } = await import('../src/data/xlsx')

    const failure = await openXlsx(bytes).catch((error: unknown) => error)

    // 모듈을 새로 들였으므로 `ClientError` 클래스도 새것이다 — `instanceof` 대신 모양으로 본다.
    expect(failure).toMatchObject({
      name: 'ClientError',
      code: 'SCREEN_LOAD_FAILED',
      params: { detail: CHUNK_MESSAGES.chromium },
    })
  })

  /**
   * **폴백이 대신 읽지 않는다** (open-decisions.md 86, 코드 소유자). SheetJS는 날짜를 다른 시간대로 읽어 조용히
   * 틀린다 — 청크를 못 받은 것은 알리고 멈춘다.
   */
  it('본진 청크만 못 받아도 폴백으로 읽지 않고 SCREEN_LOAD_FAILED다', async () => {
    const bytes = await workbookBytes()
    vi.resetModules()
    vi.doMock('exceljs', () => missingModule(['Workbook'], gone()))
    const { openXlsx } = await import('../src/data/xlsx')

    const failure = await openXlsx(bytes).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      name: 'ClientError',
      code: 'SCREEN_LOAD_FAILED',
      params: { detail: CHUNK_MESSAGES.chromium },
    })
  })

  it('본진을 받았는데 파일을 못 읽은 것은 지금처럼 폴백이 읽는다', async () => {
    const bytes = await workbookBytes()
    vi.resetModules()
    vi.doMock('exceljs', () => ({
      Workbook: class {
        xlsx = {
          load: () => {
            throw new TypeError('force the fallback')
          },
        }
      },
    }))
    const { openXlsx } = await import('../src/data/xlsx')

    const document = await openXlsx(bytes)

    expect(document.readSheet('S')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ])
  })
})

// ---------------- 임베딩 워커의 TF.js ----------------

describe('임베딩 워커의 TF.js 청크', () => {
  it('준비가 청크를 못 받으면 SCREEN_LOAD_FAILED로 내보낸다', async () => {
    const runner: BackboneRunner = {
      prepare: () => Promise.reject(gone()),
      embed: () => Promise.resolve(new Float32Array(0)),
      dispose: () => {},
    }
    const messages: EmbedMessage[] = []
    await handleEmbed(
      {
        type: 'embed',
        backboneId: DEFAULT_BACKBONE_ID,
        modelUrl: 'https://example.test/app/backbones/model.json',
        images: [],
      },
      (message) => messages.push(message),
      () => runner,
    )
    expect(messages).toEqual([
      { type: 'failed', code: 'SCREEN_LOAD_FAILED', params: { detail: CHUNK_MESSAGES.chromium } },
    ])
  })

  it('백엔드 청크를 전부 못 받으면 없는 백엔드가 아니라 청크 실패로 던진다', async () => {
    const failure = await chooseBackend(() => Promise.reject(gone())).catch(
      (error: unknown) => error,
    )
    expect(isChunkLoadError(failure)).toBe(true)
  })

  it('앞 백엔드의 청크만 못 받으면 지금처럼 다음 백엔드로 돈다', async () => {
    const chosen = await chooseBackend((backend) =>
      backend === 'webgpu' ? Promise.reject(gone()) : Promise.resolve(true),
    )
    expect(chosen).toBe('webgl')
  })

  it('청크가 아닌 실패뿐이면 쓸 수 있는 백엔드가 없다고 던진다', async () => {
    const failure = await chooseBackend((backend) =>
      backend === 'webgl' ? Promise.reject(new Error('no WebGL context')) : Promise.resolve(false),
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(isChunkLoadError(failure)).toBe(false)
  })
})
