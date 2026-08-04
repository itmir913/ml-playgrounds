/**
 * IndexedDB - 브라우저가 저장소다 (CLAUDE.md 1.2).
 *
 * 지금 다루는 것은 사용자 설정뿐이다.
 * 프로젝트 자동 저장/불러오기/목록은 .mlproj 포맷 작업에서 이 파일에 붙인다.
 */

import { openDB, type IDBPDatabase } from 'idb'

export const DB_NAME = 'ml-playgrounds'
export const DB_VERSION = 1

const PREFERENCES_STORE = 'preferences'
const LOCALE_KEY = 'locale'

let connection: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  connection ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(PREFERENCES_STORE)) {
        database.createObjectStore(PREFERENCES_STORE)
      }
    },
  })
  return connection
}

/**
 * 저장된 언어 선택을 읽는다. 없거나 읽을 수 없으면 null.
 *
 * 사생활 보호 모드처럼 IndexedDB를 쓸 수 없는 환경에서도 앱은 떠야 한다.
 * 저장소 실패가 화면을 막는 일이 없도록 여기서 삼킨다.
 */
export async function readPreferredLocale(): Promise<string | null> {
  try {
    const value: unknown = await (await db()).get(PREFERENCES_STORE, LOCALE_KEY)
    return typeof value === 'string' ? value : null
  } catch {
    // 저장소를 못 쓰면 기본 언어로 동작한다.
    return null
  }
}

/** 언어 선택을 저장한다. 실패해도 화면 동작을 막지 않는다. */
export async function writePreferredLocale(locale: string): Promise<void> {
  try {
    await (await db()).put(PREFERENCES_STORE, locale, LOCALE_KEY)
  } catch {
    // 저장에 실패해도 이번 세션의 선택은 이미 화면에 반영돼 있다.
  }
}

/** 테스트가 매번 깨끗한 연결에서 시작할 수 있게 한다. */
export function closeStorage(): void {
  connection = null
}
