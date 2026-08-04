/**
 * 학습 결과를 **파일 안의 자리에 앉힌다.** 묶음과 파일 계층이 만나는 유일한 자리다.
 *
 * ml/batch.ts는 모델을 만들되 어디에 놓일지 모르고, project/format.ts는 자리를 알되
 * 모델이 어디서 왔는지 모른다. 둘을 서로 알게 하면 의존이 양방향이 되므로 여기서 잇는다.
 *
 * **경로를 정하는 것이 이 파일이다.** 학습 쪽에서 경로를 적어 두면 아직 없는 파일을
 * 가리키는 참조가 생기고, 저장이 실패하면 문서가 자기 자신에 대해 거짓말을 하게 된다.
 *
 * 여기서 붙인 참조가 최종은 아니다. 크기 예산이 남아 있고(mlpx-spec.md 4.2), 예산에서
 * 밀린 모델은 project/format.ts가 저장하면서 다시 떼어낸다. 이 파일이 하는 것은
 * **후보를 온전한 모양으로 만드는 것**까지다.
 */

import { interpreterFor, type ModelFile } from '../ml/models'
import { DIR } from './format'
import type { Batch, Run } from './schema'

export interface AttachedBatch {
  /** 경로와 크기가 채워진 묶음. runs.json에 그대로 들어간다. */
  batch: Batch
  /** zip 경로 -> 내용. ProjectFile.models에 합친다. */
  entries: Map<string, Uint8Array>
}

/**
 * 모델과 전처리기는 **들여쓰기 없이** 담는다.
 *
 * 사람이 열어 볼 것은 manifest·settings·runs이지 나무 5천 개의 노드 배열이 아니다.
 * 들여쓰기를 넣으면 숫자 하나가 한 줄씩 차지해서 크기가 몇 배로 뛰고, 그 크기가 그대로
 * 개별 상한과 합계 예산에 부딪힌다 (mlpx-spec.md 4.2). 보고 싶으면 정렬해서 보면 된다.
 */
function encodeCompact(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

/**
 * 묶음 하나가 만든 것들을 zip 엔트리로 만들고, 문서에 참조를 붙인다.
 *
 * 전처리기는 항상 담는다 - 자체 JSON 모델은 그것 없이는 예측할 수 없으므로
 * 그 묶음 모델 전체의 전제다 (mlpx-spec.md 5).
 */
export function attachBatchFiles(
  batch: Batch,
  preprocessor: { readonly format: string },
  models: ReadonlyMap<string, ModelFile>,
): AttachedBatch {
  const entries = new Map<string, Uint8Array>()

  const preprocessorPath = `${DIR.model}preprocessor-${batch.id}.json`
  entries.set(preprocessorPath, encodeCompact(preprocessor))

  const runs = batch.runs.map((run) => attach(run, models.get(run.id), entries))

  return {
    batch: {
      ...batch,
      preprocessor: { format: preprocessor.format, path: preprocessorPath },
      runs,
    },
    entries,
  }
}

function attach(run: Run, model: ModelFile | undefined, entries: Map<string, Uint8Array>): Run {
  // **모르는 형식이면 담지 않는다.** 우리 직렬화기가 낸 것이므로 정상 경로에서는 나오지
  // 않지만, 나온다면 그건 해석기 없는 모델을 파일에 넣는다는 뜻이다 - 학생은 열어서
  // 예측할 수 없는 무게만 얻는다. 저장을 실패시키지는 않는다 (mlpx-spec.md 4.2).
  const interpreter = model ? interpreterFor(model.format) : undefined
  if (!model || !interpreter) {
    if (run.status !== 'done' || run.modelOmitted !== undefined) return run
    return { ...run, modelOmitted: 'engineUnsupported' }
  }

  const path = `${DIR.model}${run.id}.json`
  const bytes = encodeCompact(model)
  entries.set(path, bytes)

  const attached: Run = {
    ...run,
    model: {
      format: model.format,
      path,
      includesPreprocessing: interpreter.includesPreprocessing,
      sizeBytes: bytes.length,
    },
  }
  // 모델이 붙었으므로 사유는 지운다. 남겨 두면 담긴 모델 옆에 "담지 못했습니다"가 뜬다.
  delete attached.modelOmitted
  return attached
}
