/**
 * `writeProject`를 바이트로 펴 주는 검사용 껍데기.
 *
 * **나가는 경로는 `Blob`이다** — 완성된 `Uint8Array`를 만들면 그 크기만큼이 자바스크립트
 * 힙에 그대로 앉기 때문이다 (`project/format.ts`의 `zipToBlob`,
 * open-decisions.md "상한은 누가 정했느냐로 갈리고, 우리 기기가 정한 것은 끌 수 있다" §4).
 *
 * 그런데 검사가 보려는 것은 대개 **왕복**이다 — 쓴 것을 다시 열어 같은지 본다. 그래서
 * 여기서만 전체를 펴고, 스펙은 예전처럼 바이트를 본다. **앱은 이 함수를 안 부른다.**
 */

import { writeProject, type ProjectFile, type WriteResult } from '../../src/project/format'

export interface WrittenBytes extends Omit<WriteResult, 'blob'> {
  bytes: Uint8Array
}

export async function writeProjectBytes(
  project: ProjectFile,
  portfolioMarkdown: string,
): Promise<WrittenBytes> {
  const { blob, ...rest } = await writeProject(project, portfolioMarkdown)
  return { ...rest, bytes: new Uint8Array(await blob.arrayBuffer()) }
}
