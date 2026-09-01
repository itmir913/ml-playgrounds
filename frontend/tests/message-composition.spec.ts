/**
 * **문구 안에 문구를 넣는 자리** (`t('바깥', { 칸: t('안쪽') })`).
 *
 * 이 자리는 **양쪽 로케일 파일을 따로 읽으면 멀쩡해 보인다.** 합쳐야 드러난다 —
 * 실제로 `대표 사진 보기 (군집 {answer})`에 `{index}번 군집`이 들어가 보조기술
 * 사용자에게 **`대표 사진 보기 (군집 2번 군집)`**이 읽혔다 (2026-09-01 R17 감사 A-1).
 * 영어는 더 크게 어긋났다 — `See typical photos (cluster Cluster 2)`.
 *
 * **바로 앞 커밋이 만든 결함이다.** `aria-label`이 카드의 글자를 덮어써서 답이 아예
 * 안 들리던 것을 고치면서 답을 이름에 넣었는데, **그 답이 이미 완성된 문장이라는 것을
 * 안 봤다.** 그 커밋을 통째로 되돌려도(답을 다시 빼도) 2675개가 전부 초록이었다
 * (돌연변이 M4).
 *
 * **목록을 손으로 적지 않는다.** 소스에서 뽑는다 — 손 목록은 새 자리가 생길 때 안 는다.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { sourceFiles, withoutComments } from './fixtures/source'

const LOCALES: Record<string, unknown> = { ko, en }

/**
 * 바깥 문구의 칸에 **다른 문구가 들어가는** 자리들.
 *
 * 두 모양을 본다 — 칸 값이 곧바로 `t('...')`인 것과, **그것을 돌려주는 함수를 거치는
 * 것**이다. 뒤쪽이 이번에 터진 자리다(`cardAnswer`는 군집 모델에서
 * `t('results.clusterName')`을 돌려준다). 함수를 거치는 모양은 이름으로 알아볼 수밖에
 * 없어 여기 적는다 — **늘면 이 목록에 더한다.**
 */
const INDIRECT = ['cardAnswer']

interface Site {
  readonly file: string
  readonly outer: string
  readonly inner: string
}

function compositionSites(): Site[] {
  const indirect = INDIRECT.join('|')
  const pattern = new RegExp(
    String.raw`t\(\s*'([\w.]+)'\s*,\s*\{[^}]*?:\s*(?:t\(\s*'([\w.]+)'|(${indirect})\()`,
    'gs',
  )
  return sourceFiles('src').flatMap((file) => {
    const source = withoutComments(readFileSync(file, 'utf-8')).join('\n')
    return [...source.matchAll(pattern)].map((match) => ({
      file: file.replace(/\\/g, '/'),
      outer: match[1] ?? '',
      // 함수를 거치는 자리는 그 함수가 무엇을 돌려주는지를 여기서 안다.
      inner: match[2] ?? 'results.clusterName',
    }))
  })
}

function messageAt(locale: string, key: string): string {
  const found = key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null
      ? (node as Record<string, unknown>)[part]
      : undefined
  }, LOCALES[locale])
  if (typeof found !== 'string') throw new Error(`missing key ${key} in locale ${locale}`)
  return found
}

/**
 * 문구에서 **칸을 뺀 글자**의 낱말들.
 *
 * **한 글자는 안 센다.** 조사(`의`)와 단위(`번`)는 우연히 겹치는데 그것은 겹쳐 읽히는
 * 병이 아니다. 이 병이 만드는 것은 내용어이고, 한국어에서 두 글자 이상, 영어에서 세
 * 글자 이상이다.
 */
function words(message: string): Set<string> {
  const frame = message.replace(/\{[^}]*\}/g, ' ')
  return new Set(frame.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
}

describe('문구 안에 문구를 넣는 자리', () => {
  const sites = compositionSites()

  it('자리를 실제로 찾는다', () => {
    // 0개면 정규식이 썩은 것이지 규칙이 지켜진 게 아니다.
    expect(sites.length).toBeGreaterThanOrEqual(3)
    // **터졌던 자리는 이름으로 못 박는다.** 개수만 세면 다른 자리가 늘어난 것으로
    // 이 자리가 사라진 것이 가려진다.
    expect(sites.map((site) => site.outer)).toContain('predict.clusterEvidenceOpen')
  })

  it.each(Object.keys(LOCALES))('%s — 안쪽 낱말을 바깥이 다시 적지 않는다', (locale) => {
    const doubled = sites.flatMap((site) => {
      const shared = [...words(messageAt(locale, site.inner))].filter((word) =>
        words(messageAt(locale, site.outer)).has(word),
      )
      return shared.length === 0
        ? []
        : [`${site.file}: ${site.outer} ⊃ ${site.inner} — ${shared.join(', ')}`]
    })
    expect(doubled).toEqual([])
  })
})
