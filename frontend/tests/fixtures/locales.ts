/**
 * **실어 보내는 로케일 전부를 한 벌로 준다.**
 *
 * 검사들이 `en.json`·`ko.json`을 직접 import해 쌍으로만 보던 때는 **새 언어가 그대로
 * 뚫렸다** (`docs/cases/i18n.md`) — 세 번째 파일은 어느 검사에도 안 들어갔다. 그래서 목록을
 * 손으로 적지 않고 `src/locales/`의 `*.json`을 읽는다. 언어를 늘리면 그 파일 하나로 이
 * 픽스처를 쓰는 검사들이 새 언어를 함께 본다.
 *
 * **`src/i18n.ts`에서 가져오지 않는다** — 그 모듈은 화면 환경(navigator·document)에 닿아서
 * node 환경의 스펙이 못 읽는다. 그리고 물어야 하는 것은 "실린 파일마다"이므로 파일 목록이 곧 답이다.
 * 그 목록이 `SUPPORTED_LOCALES`와 같다는 것은 `i18n.spec.ts`가 본다.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const LOCALES_DIR = resolve(__dirname, '..', '..', 'src', 'locales')

/** 점으로 이은 키 → 문장. 가지(객체)는 펴고 잎(문자열)만 남긴다. */
export function flattenMessages(tree: unknown, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>()
  if (tree === null || typeof tree !== 'object') return flat
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') {
      flat.set(path, value)
    } else {
      for (const [nested, leaf] of flattenMessages(value, path)) flat.set(nested, leaf)
    }
  }
  return flat
}

/** 로케일 태그들. 파일 이름에서 `.json`을 뗀 것이다. */
export const LOCALE_TAGS: readonly string[] = readdirSync(LOCALES_DIR)
  .filter((entry) => entry.endsWith('.json'))
  .map((entry) => entry.replace(/\.json$/, ''))
  .sort()

/** 로케일 태그 → 원래 모양의 트리. 키를 따라 내려가는 검사가 쓴다. */
export const LOCALE_TREES: ReadonlyMap<string, unknown> = new Map(
  LOCALE_TAGS.map((tag) => [
    tag,
    JSON.parse(readFileSync(join(LOCALES_DIR, `${tag}.json`), 'utf-8')) as unknown,
  ]),
)

/** 로케일 태그 → 편 문장들. */
export const LOCALE_MESSAGES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map(
  [...LOCALE_TREES].map(([tag, tree]) => [tag, flattenMessages(tree)]),
)

/** 한 로케일의 편 문장들. 없는 태그면 던진다 — 조용히 빈 것을 주면 검사가 아무것도 안 잰다. */
export function messagesOf(tag: string): ReadonlyMap<string, string> {
  const messages = LOCALE_MESSAGES.get(tag)
  if (!messages) throw new Error(`no locale file for ${tag}`)
  return messages
}
