/**
 * 백본이 뽑아 둔 임베딩이 프로젝트에 앉는 자리 (mlpx-spec.md §1.3).
 *
 * **경로가 모든 것을 말한다** — `embeddings/{백본id}/{사진해시}.bin`. 그래서 "이 벡터가
 * 어느 백본에서 어느 사진을 보고 나왔나"를 어디에도 따로 적지 않는다. 백본이 바뀌면
 * 맞는 디렉터리가 없고, 없으면 다시 뽑는다.
 *
 * **파생물이다.** 지워도 프로젝트는 그대로이고, 없으면 학습할 때 다시 만들어진다.
 * 그래서 `settings`에 참조가 없고 "함께 있고 함께 없다"도 여기엔 해당하지 않는다.
 */

import { DIR, type ProjectFile } from '@/project/format'

/** 임베딩 한 장이 갖는 확장자. */
const EXTENSION = '.bin'

/** 이 사진의 이 백본 임베딩이 앉는 zip 경로. */
export function embeddingPath(backboneId: string, hash: string): string {
  return `${DIR.embeddings}${backboneId}/${hash}${EXTENSION}`
}

/**
 * 벡터를 파일에 담는 모양으로 바꾼다. **리틀엔디언 float32다** (mlpx-spec.md §1.3).
 *
 * `Float32Array`의 바이트를 그대로 쓰지 않고 `DataView`로 쓰는 이유는, 그대로 쓰면
 * **그 기기의 엔디언이 파일에 새겨지기** 때문이다. 지금 쓰는 기기가 전부 리틀엔디언이라
 * 어긋나도 아무 데서도 안 터지고, 빅엔디언 기기에서 열었을 때 **숫자가 조용히 뒤집힌
 * 채로 학습된다.**
 */
export function encodeVector(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * 4)
  const view = new DataView(bytes.buffer)
  for (const [index, value] of vector.entries()) view.setFloat32(index * 4, value, true)
  return bytes
}

/**
 * 파일에 담긴 것을 벡터로 되돌린다. **길이가 안 맞으면 `null`이다.**
 *
 * 길이는 백본 등록부가 말한다(`embeddingDim`). 안 맞는 것은 깨진 파일이거나 다른 백본의
 * 것이고, 어느 쪽이든 할 일은 다시 뽑는 것뿐이라 **그 사진만 없는 것으로 본다** —
 * 여기서 던지면 파일 하나가 통째로 안 열린다.
 */
export function decodeVector(bytes: Uint8Array, dim: number): Float32Array | null {
  if (bytes.length !== dim * 4) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vector = new Float32Array(dim)
  for (let index = 0; index < dim; index += 1) vector[index] = view.getFloat32(index * 4, true)
  return vector
}

/**
 * 이 백본으로 이미 뽑아 둔 것들. **해시 -> 벡터.**
 *
 * 길이가 안 맞는 것은 빼고 준다 — 부르는 쪽에서 보면 "아직 안 뽑은 사진"과 같고,
 * 그게 맞다. 둘을 나눠 봐야 할 일이 같다.
 */
export function readEmbeddings(
  project: ProjectFile | null,
  backboneId: string,
  dim: number,
): Map<string, Float32Array> {
  const prefix = `${DIR.embeddings}${backboneId}/`
  const found = new Map<string, Float32Array>()
  if (!project) return found
  for (const [path, bytes] of project.embeddings) {
    if (!path.startsWith(prefix) || !path.endsWith(EXTENSION)) continue
    const vector = decodeVector(bytes, dim)
    if (vector === null) continue
    found.set(path.slice(prefix.length, path.length - EXTENSION.length), vector)
  }
  return found
}

/**
 * 뽑은 것을 프로젝트에 앉힌다. **`updatedAt`을 안 찍는다.**
 *
 * 학생이 무엇을 바꾼 것이 아니라 우리가 계산을 캐시한 것이라, 이것 때문에 "마지막 수정"이
 * 움직이면 파일을 받은 교사가 학생이 뭔가 한 줄로 읽는다.
 */
export function addEmbeddings(
  project: ProjectFile,
  backboneId: string,
  vectors: ReadonlyMap<string, Float32Array>,
): ProjectFile {
  const embeddings = new Map(project.embeddings)
  for (const [hash, vector] of vectors) {
    embeddings.set(embeddingPath(backboneId, hash), encodeVector(vector))
  }
  return { ...project, embeddings }
}

/**
 * 이 사진들의 임베딩을 뺀다. **사진을 지울 때 함께 부른다.**
 *
 * 안 지우면 파일이 지운 사진 수만큼 계속 자란다. 저장할 때도 짝 없는 것을 버리지만
 * (`writeProject`), 그건 마지막 그물이지 여기를 대신하지 않는다 — IndexedDB에는
 * 그대로 남는다.
 */
export function removeEmbeddings(project: ProjectFile, hashes: readonly string[]): ProjectFile {
  const removing = new Set(hashes)
  const embeddings = new Map(project.embeddings)
  for (const path of project.embeddings.keys()) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (removing.has(name.slice(0, name.length - EXTENSION.length))) embeddings.delete(path)
  }
  return { ...project, embeddings }
}
