/**
 * IndexedDB - 브라우저가 저장소다 (CLAUDE.md 1.2).
 *
 * 서버가 없어도 학생은 자기 프로젝트를 갖고 있어야 한다. 그래서 문서·데이터셋·모델이
 * 전부 여기에 남는다.
 *
 * **store를 셋으로 나눈 이유는 목록 화면 때문이다.** 프로젝트 목록을 뽑을 때마다
 * 수십 MB짜리 데이터셋이 딸려오면 저사양 PC에서 목록이 뜨는 데만 몇 초가 걸린다.
 * projects에는 문서와 요약만 두고, 무거운 바이트는 datasets/models에 따로 둔다.
 *
 * 언어 선택 저장은 실패해도 삼키지만 **프로젝트 저장 실패는 삼키지 않는다.**
 * 학생의 작업물이 날아가는 일이라 화면이 반드시 알아야 한다.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { ClientError } from '../errors'
import { hashBytes } from '../hash'
import { BYTES_PER_MB, STORAGE_SAFETY_FACTOR } from '../limits'
import type { ProjectFile } from './format'
import type { ProjectDocument, TaskType } from './schema'

export const DB_NAME = 'ml-playgrounds'
export const DB_VERSION = 2

const PREFERENCES_STORE = 'preferences'
const PROJECTS_STORE = 'projects'
const DATASETS_STORE = 'datasets'
const MODELS_STORE = 'models'
const UPDATED_AT_INDEX = 'updatedAt'
const LOCALE_KEY = 'locale'

interface ProjectRecord {
  projectId: string
  document: ProjectDocument
  /** 정렬용. document.manifest 안에도 있지만 인덱스를 걸려면 위로 올려야 한다. */
  updatedAt: string
  /** 데이터셋 + 모델의 합계. 목록에서 바이트를 읽지 않고 용량을 보여주기 위한 것. */
  sizeBytes: number
}

interface DatasetRecord {
  projectId: string
  bytes: Uint8Array
  /**
   * 가져오기 시점에 계산한 해시를 함께 들고 있는다.
   *
   * 안 두면 프로젝트를 열 때마다 데이터셋을 다시 해싱하게 된다 - 목록에서 프로젝트를
   * 고를 때마다 저사양 PC가 수백 ms씩 멈춘다.
   */
  hash?: string
}

interface ModelRecord {
  projectId: string
  path: string
  bytes: Uint8Array
}

interface PlaygroundDB extends DBSchema {
  [PREFERENCES_STORE]: { key: string; value: string }
  [PROJECTS_STORE]: { key: string; value: ProjectRecord; indexes: { updatedAt: string } }
  [DATASETS_STORE]: { key: string; value: DatasetRecord }
  [MODELS_STORE]: { key: [string, string]; value: ModelRecord }
}

/** 목록 화면이 쓰는 요약. 문서 전체를 열지 않는다. */
export interface ProjectSummary {
  projectId: string
  name: string
  taskType: TaskType
  updatedAt: string
  sizeBytes: number
}

let connection: Promise<IDBPDatabase<PlaygroundDB>> | null = null

function db(): Promise<IDBPDatabase<PlaygroundDB>> {
  connection ??= openDB<PlaygroundDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // 버전을 올려도 기존 store는 건드리지 않는다. 없는 것만 만든다.
      if (!database.objectStoreNames.contains(PREFERENCES_STORE)) {
        database.createObjectStore(PREFERENCES_STORE)
      }
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        const projects = database.createObjectStore(PROJECTS_STORE, { keyPath: 'projectId' })
        projects.createIndex(UPDATED_AT_INDEX, 'updatedAt')
      }
      if (!database.objectStoreNames.contains(DATASETS_STORE)) {
        database.createObjectStore(DATASETS_STORE, { keyPath: 'projectId' })
      }
      if (!database.objectStoreNames.contains(MODELS_STORE)) {
        database.createObjectStore(MODELS_STORE, { keyPath: ['projectId', 'path'] })
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

/** 한 프로젝트의 모델 전체를 가리키는 키 범위. 배열은 어떤 문자열보다 뒤에 온다. */
function modelKeyRange(projectId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId], [projectId, []])
}

function totalBytes(project: ProjectFile): number {
  let total = project.dataset?.bytes.length ?? 0
  for (const bytes of project.models.values()) total += bytes.length
  return total
}

/**
 * 쓰기 전에 여유 공간을 확인한다.
 *
 * estimate()가 없는 브라우저에서는 검사를 건너뛴다. 그때는 실제 쓰기에서 나는
 * QuotaExceededError가 같은 코드로 바뀐다.
 */
async function ensureRoom(bytes: number): Promise<void> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  const quota = estimate?.quota ?? 0
  if (quota === 0) return

  const available = quota - (estimate?.usage ?? 0)
  // 브라우저가 보고하는 여유 공간은 근사값이고 인덱스가 차지하는 몫도 있다.
  const required = bytes * STORAGE_SAFETY_FACTOR
  if (available < required) {
    throw new ClientError('STORAGE_QUOTA_EXCEEDED', {
      requiredMb: Math.ceil(required / BYTES_PER_MB),
      availableMb: Math.max(0, Math.floor(available / BYTES_PER_MB)),
    })
  }
}

function asStorageError(error: unknown): unknown {
  const name = error instanceof Error ? error.name : ''
  if (name === 'QuotaExceededError') {
    // 사전 검사를 통과했어도 실제로 모자랄 수 있다. 같은 코드로 모은다.
    return new ClientError('STORAGE_QUOTA_EXCEEDED', { requiredMb: 0, availableMb: 0 })
  }
  return error
}

/**
 * 프로젝트를 통째로 저장한다. 있으면 덮어쓴다.
 *
 * **한 트랜잭션에서 모델을 전부 지우고 새로 넣는다.** 데이터셋을 바꾸면 기존 묶음을
 * 지우는데(mlpx-spec.md 5.2), 중간에 끊겨서 "새 데이터 + 옛 모델"이 남으면
 * 참조형 모델이 엉뚱한 행을 가리켜 **조용히 틀린 예측**을 한다.
 */
export async function saveProject(project: ProjectFile): Promise<void> {
  const size = totalBytes(project)
  await ensureRoom(size)

  const projectId = project.document.manifest.projectId
  try {
    const database = await db()
    const transaction = database.transaction(
      [PROJECTS_STORE, DATASETS_STORE, MODELS_STORE],
      'readwrite',
    )

    await transaction.objectStore(PROJECTS_STORE).put({
      projectId,
      document: project.document,
      updatedAt: project.document.manifest.updatedAt,
      sizeBytes: size,
    })
    // 데이터셋이 없는 프로젝트가 정상이다. 그때는 **남아 있던 레코드를 지운다** -
    // 데이터를 바꾸는 도중의 상태가 옛 표와 새 설정으로 남으면 안 된다.
    const datasets = transaction.objectStore(DATASETS_STORE)
    if (project.dataset === undefined) {
      await datasets.delete(projectId)
    } else {
      await datasets.put({
        projectId,
        bytes: project.dataset.bytes,
        hash: project.dataset.hash,
      })
    }

    const models = transaction.objectStore(MODELS_STORE)
    await models.delete(modelKeyRange(projectId))
    for (const [path, bytes] of project.models) {
      await models.put({ projectId, path, bytes })
    }

    await transaction.done
  } catch (error) {
    throw asStorageError(error)
  }
}

/** 프로젝트를 읽는다. 없으면 null. */
export async function loadProject(projectId: string): Promise<ProjectFile | null> {
  const database = await db()
  const transaction = database.transaction([PROJECTS_STORE, DATASETS_STORE, MODELS_STORE])

  const record = await transaction.objectStore(PROJECTS_STORE).get(projectId)
  if (!record) return null

  // 문서가 데이터셋을 가리키면 본체가 있어야 한다. 둘은 함께 있고 함께 없다
  // (mlpx-spec.md §1). 어긋난 것은 우리가 고칠 수 없으므로 없는 것으로 다룬다.
  const dataset = await transaction.objectStore(DATASETS_STORE).get(projectId)
  const wanted = record.document.settings.dataset !== undefined
  if (wanted !== (dataset !== undefined)) return null

  const stored = await transaction.objectStore(MODELS_STORE).getAll(modelKeyRange(projectId))
  const models = new Map<string, Uint8Array>()
  for (const model of stored) {
    models.set(model.path, model.bytes)
  }

  return {
    document: record.document,
    // hash가 없는 것은 이 필드가 생기기 전에 저장된 레코드다. 그때만 계산한다.
    dataset:
      dataset === undefined
        ? undefined
        : { bytes: dataset.bytes, hash: dataset.hash ?? hashBytes(dataset.bytes) },
    models,
  }
}

/** 최근에 손댄 것부터 나열한다. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const records = await (await db()).getAllFromIndex(PROJECTS_STORE, UPDATED_AT_INDEX)
  return records.reverse().map((record) => ({
    projectId: record.projectId,
    name: record.document.manifest.name,
    taskType: record.document.manifest.taskType,
    updatedAt: record.updatedAt,
    sizeBytes: record.sizeBytes,
  }))
}

/** 프로젝트와 딸린 것을 전부 지운다. */
export async function deleteProject(projectId: string): Promise<void> {
  const database = await db()
  const transaction = database.transaction(
    [PROJECTS_STORE, DATASETS_STORE, MODELS_STORE],
    'readwrite',
  )
  await transaction.objectStore(PROJECTS_STORE).delete(projectId)
  await transaction.objectStore(DATASETS_STORE).delete(projectId)
  await transaction.objectStore(MODELS_STORE).delete(modelKeyRange(projectId))
  await transaction.done
}

/**
 * 열려 있는 연결을 닫는다.
 *
 * 실제로 닫아야 한다. 참조만 버리면 연결이 살아 있어서 버전 업그레이드와
 * deleteDatabase가 blocked 상태로 멈춘다.
 */
export function closeStorage(): void {
  const pending = connection
  connection = null
  void pending?.then((database) => database.close()).catch(() => undefined)
}
