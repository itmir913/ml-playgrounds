/**
 * 학습 결과를 **파일 안의 자리에 앉힌다.** 실험과 파일 계층이 만나는 유일한 자리다.
 *
 * ml/experiment.ts는 모델을 만들되 어디에 놓일지 모르고, project/format.ts는 자리를 알되
 * 모델이 어디서 왔는지 모른다. 둘을 서로 알게 하면 의존이 양방향이 되므로 여기서 잇는다.
 *
 * **경로를 정하는 것이 이 파일이다.** 학습 쪽에서 경로를 적어 두면 아직 없는 파일을
 * 가리키는 참조가 생기고, 저장이 실패하면 문서가 자기 자신에 대해 거짓말을 하게 된다.
 *
 * 여기서 붙인 참조가 최종은 아니다. 크기 예산이 남아 있고(mlpx-spec.md 4.2), 예산에서
 * 밀린 모델은 project/format.ts가 저장하면서 다시 떼어낸다. 이 파일이 하는 것은
 * **후보를 온전한 모양으로 만드는 것**까지다.
 */

import { changedSince, type ExperimentResult } from '../ml/experiment'
import { interpreterFor, type ModelFile } from '../ml/models'
import { DIR, type ProjectFile } from './format'
import type { Experiment, Run } from './schema'
import { succeeded } from '../ml/results'

export interface AttachedExperiment {
  /** 경로와 크기가 채워진 실험. runs.json에 그대로 들어간다. */
  experiment: Experiment
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
 * 실험 하나가 만든 것들을 zip 엔트리로 만들고, 문서에 참조를 붙인다.
 *
 * 전처리기는 항상 담는다 - 자체 JSON 모델은 그것 없이는 예측할 수 없으므로
 * 그 실험 모델 전체의 전제다 (mlpx-spec.md 5).
 */
export function attachExperimentFiles(
  experiment: Experiment,
  preprocessor: { readonly format: string },
  models: ReadonlyMap<string, ModelFile>,
): AttachedExperiment {
  const entries = new Map<string, Uint8Array>()

  const preprocessorPath = `${DIR.model}preprocessor-${experiment.id}.json`
  entries.set(preprocessorPath, encodeCompact(preprocessor))

  const runs = experiment.runs.map((run) => attach(run, models.get(run.id), entries))

  return {
    experiment: {
      ...experiment,
      preprocessor: { format: preprocessor.format, path: preprocessorPath },
      runs,
    },
    entries,
  }
}

/**
 * 끝난 실험 하나를 프로젝트에 앉힌다. **[학습하기]가 끝나면 부르는 것이 이것 하나다.**
 *
 * **덧붙이기만 한다.** 학습이 지난 실험을 지우지 않는다 - 결과 화면이 순위표가 아니라 **변경
 * 이력**이고(architecture.md §8.9), 지난 실험이 없으면 `changed`가 가리킬 것이 없어진다.
 * 지우는 것은 학생이 고른 실험 하나를 아래 `removeExperiment`로 지울 때뿐이다(open-decisions.md 66).
 *
 * `manifest.updatedAt`을 찍는 것은 `project/settings.ts`와 같은 규칙이다. 저장은 여기서
 * 하지 않는다 - 부르는 쪽이 스토어에 넘기고 자동 저장이 받는다.
 */
export function applyExperiment(
  file: ProjectFile,
  result: ExperimentResult,
  now: string,
): ProjectFile {
  const attached = attachExperimentFiles(result.experiment, result.preprocessor, result.models)

  return {
    ...file,
    document: {
      ...file.document,
      manifest: { ...file.document.manifest, updatedAt: now },
      runs: {
        ...file.document.runs,
        experiments: [...file.document.runs.experiments, attached.experiment],
      },
    },
    // 새 엔트리가 뒤에 온다. 경로에 실험 id와 run id가 들어 있어 부딪히지 않지만,
    // 부딪힌다면 방금 학습한 것이 맞다.
    models: new Map([...file.models, ...attached.entries]),
  }
}

function attach(run: Run, model: ModelFile | undefined, entries: Map<string, Uint8Array>): Run {
  // **모르는 형식이면 담지 않는다.** 우리 직렬화기가 낸 것이므로 정상 경로에서는 나오지
  // 않지만, 나온다면 그건 해석기 없는 모델을 파일에 넣는다는 뜻이다 - 학생은 열어서
  // 예측할 수 없는 무게만 얻는다. 저장을 실패시키지는 않는다 (mlpx-spec.md 4.2).
  const interpreter = model ? interpreterFor(model.format) : undefined
  if (!model || !interpreter) {
    if (!succeeded(run) || run.modelOmitted !== undefined) return run
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

/**
 * 실험 하나를 **통째로** 지운다 (open-decisions.md 66). 기록, 딸린 run의 모델 파일 전부, 전처리기
 * 파일을 한 값에서 뺀다 — 가리킬 대상 없는 id도, 기록 없는 모델 파일도 남지 않는다. 지웠다는 표시는
 * 남기지 않는다.
 *
 * **모델 경로는 문서에 적힌 것을 쓴다** (`run.model.path`, `experiment.preprocessor.path`). 경로를
 * 여기서 다시 지으면 짓는 규칙이 바뀐 날 옛 파일의 모델이 고아로 남는다.
 *
 * **바로 뒤 실험의 `changed`를 새 직전에 대해 다시 잰다.** 결과 화면은 `changed`를 파일 순서의
 * 바로 앞 실험과 짝짓는다(`views/ResultsView.vue`) — 옛 직전에 대해 잰 경로를 새 직전의 값으로
 * 읽으면 바뀐 것이 틀리게 보인다. 맨 앞이 되면 `changed`를 뺀다(첫 실험에는 직전이 없다).
 * 판정은 학습이 쓰는 `changedSince` 하나다.
 *
 * **이 실험이 가리키는 것만 뺀다.** 이미 있던 고아(경로 기록 없이 남은 옛 모델 엔트리)는 이 함수의
 * 몫이 아니다 — `writeProject`가 쓰면서 떨군다(`project/format.ts`).
 *
 * 모르는 id면 받은 값을 그대로 돌려준다. 저장은 부르는 쪽이 `save`로 한다.
 */
export function removeExperiment(
  file: ProjectFile,
  experimentId: string,
  now: string,
): ProjectFile {
  const experiments = file.document.runs.experiments
  const index = experiments.findIndex((experiment) => experiment.id === experimentId)
  const removed = experiments[index]
  if (removed === undefined) return file

  const paths = new Set<string>()
  if (removed.preprocessor !== undefined) paths.add(removed.preprocessor.path)
  for (const run of removed.runs) {
    if (run.model !== undefined) paths.add(run.model.path)
  }

  const kept = experiments.filter((experiment) => experiment.id !== experimentId)
  const next = kept[index]
  if (next !== undefined) kept[index] = rejudged(next, kept[index - 1])

  return {
    ...file,
    document: {
      ...file.document,
      manifest: { ...file.document.manifest, updatedAt: now },
      runs: { ...file.document.runs, experiments: kept },
    },
    models: new Map([...file.models].filter(([path]) => !paths.has(path))),
  }
}

/** 직전이 바뀐 실험의 `changed`. 직전이 없으면 뺀다 — 빈 배열은 "아무것도 안 바꿨다"라는 다른 뜻이다. */
function rejudged(experiment: Experiment, previous: Experiment | undefined): Experiment {
  if (previous !== undefined) {
    return { ...experiment, changed: changedSince(previous, experiment.settings, experiment.runs) }
  }
  const first: Experiment = { ...experiment }
  delete first.changed
  return first
}
