<script setup lang="ts">
/**
 * 추가한 모델들. **(모델, 실행 방법) 쌍으로 쌓인다** (mlpx-spec.md §3).
 *
 * 체크박스 목록이 아닌 이유는 **같은 모델을 실행 방법만 바꿔 여러 번 담을 수 있어야
 * 하기 때문이다.** "순수 JS 결정 트리 + scikit-learn 결정 트리"를 한 실험에 나란히 놓고
 * 숫자가 왜 다른지 보는 것이 이 도구가 줄 수 있는 가장 좋은 수업 장면인데, 체크박스로는
 * 그 줄이 하나밖에 안 생긴다.
 *
 * **손잡이 서술은 `ml/hyperparams.ts`에서 온다.** 엔진 본체를 거치지 않는다 — 그러면
 * ml.js가 통째로 첫 화면 번들에 딸려 온다(`engines/mljs-params.ts`). 그리고 서술은
 * **줄마다의 실행 방법**으로 찾는다. ml.js는 `maxDepth`, sklearn은 `max_depth`라
 * 어휘가 다르므로 줄이 다르면 손잡이도 다르다.
 *
 * **학습이 도는 동안에는 이 목록이 상태판이 된다** (§8.17). 줄마다 대기·학습 중·완료·실패를
 * 보인다 — 끝난 개수만으로는 **어느 모델이 오래 걸리는지 알 수 없고**, 그러면 학생이 모델을
 * 하나씩 빼 가며 범인을 찾게 된다. 상태는 워커가 말한 것만 쓴다(`ml/training-status.ts`).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import { outOfRange, parametersFor, type HyperparameterSpec } from '@/ml/hyperparams'
import type { ChosenModel } from '@/ml/selection'
import type { Estimate } from '@/ml/estimate'
import type { ModelStatus } from '@/ml/training-status'
import type { Settings } from '@/project/schema'

const props = defineProps<{
  chosen: readonly ChosenModel[]
  values: Settings['hyperparameters']
  /**
   * 줄마다의 상태. **자리가 `chosen`과 같다.** 학습이 안 돌면 비어 있고, 그때는 아무
   * 줄에도 상태가 안 붙는다.
   */
  statuses: readonly ModelStatus[]
  /**
   * 줄마다의 학습 예상 시간. **자리가 `chosen`과 같다** (`ml/estimate.ts`).
   *
   * 누르기 **전에** 알아야 하는 값이라 결과 화면이 아니라 여기 있다. 학생이 알아야 하는
   * 것은 "몇 초인가"가 아니라 **"지금 눌러도 되는 일인가"**다.
   */
  estimates: readonly Estimate[]
  /** 학습이 도는 중인가. 도는 동안에는 이 목록을 못 고친다 (TrainView의 같은 판단). */
  running: boolean
}>()

const emit = defineEmits<{
  remove: [index: number]
  setParam: [algorithm: string, runtime: string, name: string, value: number | undefined]
}>()

const { t } = useI18n()

function specsOf(row: ChosenModel): readonly HyperparameterSpec[] {
  return parametersFor(row.runtime, row.algorithm)
}

/**
 * 상태마다의 색과 문구 (§8.17). **표 하나로 둔다** — 템플릿에서 조건을 조립하면 상태가
 * 하나 늘 때마다 마크업이 길어지고 그 조건을 아무도 안 본다 (§10.1).
 *
 * **색만으로 말하지 않는다.** 테두리 색은 훑을 때 먼저 보이는 것이고, 무엇인지 말하는
 * 것은 언제나 글자다 — 색각 이상이 있는 학생과 흑백으로 인쇄한 교사에게 색은 아무 말도
 * 안 한다.
 */
const STATUS_TONE: Readonly<Record<ModelStatus, { accent: string; badge: string; key: string }>> = {
  waiting: {
    accent: 'border-l-line-strong',
    badge: 'bg-surface-sunken text-ink-soft',
    key: 'train.modelWaiting',
  },
  running: {
    accent: 'border-l-brand',
    badge: 'bg-brand-soft text-ink',
    key: 'train.modelRunning',
  },
  done: {
    accent: 'border-l-positive',
    badge: 'bg-positive-soft text-ink',
    key: 'train.modelDone',
  },
  failed: {
    accent: 'border-l-danger',
    badge: 'bg-danger-soft text-ink',
    key: 'train.modelFailed',
  },
}

/**
 * 이 줄의 상태. **없으면 null이다** — 학습이 안 도는 동안이거나, 목록과 보고가 어긋난
 * 경우다. 없는 것을 `대기`로 지어내지 않는다: 안 도는 목록의 모든 줄에 `대기`가 붙으면
 * 그건 상태가 아니라 장식이다.
 */
const rows = computed(() =>
  props.chosen.map((row, index) => {
    const status = props.statuses[index]
    // **범위를 벗어난 손잡이를 줄마다 한 번만 센다.** 템플릿에서 부르면 손잡이 칸마다
    // `outOfRange` 전체가 다시 돈다 — 모델이 스물이면 곱해진다 (V11 R5 C-3).
    return {
      row,
      index,
      tone: status ? STATUS_TONE[status] : null,
      outOfRangeNames: violated(row),
      estimateText: estimateTextOf(props.estimates[index] ?? { kind: 'unknown' }),
    }
  }),
)

/**
 * 예상 시간을 문장으로. **키를 조립하지 않는다** — 종류 이름을 키 뒤에 이어 붙이면
 * 어느 키가 실제로 불리는지 검사가 못 세고, 안 불리는 키가 남아도 아무도 모른다
 * (`locales.spec.ts`의 짝 규칙).
 *
 * **짧아도 빈칸으로 두지 않는다.** 빈칸이면 "빠른 것"과 "못 재는 것"이 화면에서 같은
 * 모양이 되고, 학생은 그 자리를 보고 어느 쪽인지 알 수 없다.
 */
function estimateTextOf(estimate: Estimate): string {
  if (estimate.kind === 'unknown') return t('train.estimateUnknown')
  const key = estimate.kind === 'minutes' ? 'train.estimate.minutes' : 'train.estimate.seconds'
  return t(key, { value: estimate.value })
}

/**
 * 칸에 보일 값. **저장된 값이 없으면 기본값을 보여준다.**
 *
 * 빈 칸으로 두면 학생은 자기 모델이 무엇으로 도는지 알 수 없다. 파일에는 여전히
 * 아무것도 안 적힌다 — 손대야 적힌다.
 */
function valueOf(row: ChosenModel, spec: HyperparameterSpec): number {
  const stored = props.values[row.algorithm]?.[row.runtime]?.[spec.name]
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : spec.default
}

/** 지금 눈금 밖인 손잡이들. 학습이 거부하는 것과 같은 함수로 판정한다. */
function violated(row: ChosenModel): ReadonlySet<string> {
  const specs = specsOf(row)
  const values = Object.fromEntries(specs.map((spec) => [spec.name, valueOf(row, spec)]))
  return new Set(outOfRange(specs, values).map((violation) => violation.name))
}

/**
 * 칸을 고친 결과를 올려보낸다.
 *
 * 비우면 `undefined`다 — "기본값으로 돌려 달라"는 뜻이고, 빈 값을 적어 두면 파일에는
 * 값이 있는데 엔진은 기본값으로 도는 상태가 된다.
 *
 * **정수 자리는 여기서 반올림한다.** 학습 직전에 확정하면 화면에 2.5가 떠 있는 채로
 * 3으로 돌게 되고, 학생이 보는 값과 도는 값이 갈린다.
 */
/**
 * **칸을 저장된 값으로 다시 쓴다** (`architecture.md` §8.15.1).
 *
 * 여기는 값을 그대로 올려보내지 않고 **고쳐서** 올려보낸다 — 빈 칸은 기본값으로
 * 되돌리고, 정수 눈금이면 반올림한다. 그래서 저장된 값과 칸의 값이 갈릴 수 있다.
 * `3.7`을 치면 파일에는 `4`가 들어가는데 칸에는 `3.7`이 남아 있었고, 학생이 다시
 * 손대기 전까지 화면이 계속 거짓말했다 — **숫자 칸에는 "한 번 더 누르면 맞아진다"가
 * 없다** (2026-08-12 감사 B-3이 표본 뽑기에서 같은 결함을 잡았고, 검사를 넓히자
 * 이 자리가 함께 나왔다).
 */
function onParam(row: ChosenModel, spec: HyperparameterSpec, event: Event): void {
  const input = event.target as HTMLInputElement
  const raw = input.value.trim()
  if (raw === '') {
    emit('setParam', row.algorithm, row.runtime, spec.name, undefined)
    // 비우면 기본값으로 돌아간다. 그 값을 칸이 보여야 학생이 무엇이 먹히는지 안다.
    input.value = String(valueOf(row, spec))
    return
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    input.value = String(valueOf(row, spec))
    return
  }
  const next = spec.integer ? Math.round(value) : value
  emit('setParam', row.algorithm, row.runtime, spec.name, next)
  input.value = String(next)
}
</script>

<template>
  <!--
    **왼쪽 축과 같은 리듬으로 선다.** 축은 `제목 + mt-1.5`인데 여기만 간격이 달라서
    두 열의 머리가 어긋나 보였다. 안쪽 여백도 위아래·좌우가 같아야 한다 — 한쪽만
    좁으면 칸이 기울어 보인다.
  -->
  <div class="min-w-0">
    <h3 class="font-bold text-ink-soft">{{ t('train.chosenTitle') }}</h3>

    <!--
      **제목 바로 아래다.** 목록 끝에 두었더니 추가한 모델이 많을 때 세는 말이 화면 밖으로
      나가, 정작 몇 개인지 궁금한 순간에 안 보였다. 왼쪽 축의 `제목 + 힌트`와도 같은
      리듬이 된다(`AppChoices`).
    -->
    <p class="mt-1.5 text-ink-soft">
      {{
        props.chosen.length === 0
          ? t('train.noModelChosen')
          : t('train.modelSummary', props.chosen.length)
      }}
    </p>

    <ul
      v-if="props.chosen.length > 0"
      class="mt-1.5 flex flex-col rounded-panel border border-line"
    >
      <!--
        **왼쪽 굵은 선이 상태다** (§8.17). 학습이 안 도는 동안에도 두께는 그대로 두고
        색만 투명하게 한다 — 도는 순간 선이 생기면 목록 전체가 4px 밀린다.
      -->
      <li
        v-for="{ row, index, tone, outOfRangeNames, estimateText } in rows"
        :key="`${row.algorithm}:${row.runtime}:${index}`"
        class="min-w-0 border-l-4 p-3"
        :class="[
          index > 0 ? 'border-t border-line' : '',
          tone ? tone.accent : 'border-l-transparent',
        ]"
      >
        <!--
          **[빼기]는 줄의 오른쪽 위에 못 박힌다.** 이름·학습할 곳·상태와 같은 줄에서
          접히게 두면, 좁은 칸에서 셋이 두 줄이 되는 순간 버튼만 아래로 떨어져 나가
          **모델 이름 밑에 혼자 놓인다** - 무엇을 빼는 버튼인지가 그때 흐려진다.
          그래서 바깥은 안 접히는 두 칸(글자 / 버튼)이고, 접히는 것은 왼쪽 안에서다.
        -->
        <!--
          **글자의 기준선으로 맞춘다.** 이름·예상 시간·[제거]가 서로 다른 상자에
          들어 있는데(하나는 두 줄짜리 칸, 하나는 맨 글자, 하나는 안쪽 여백과 테두리를
          가진 버튼) `items-start`로 맞추면 **상자의 위끝**이 맞고 글자는 안 맞는다.
          `items-baseline`은 상자가 아니라 글자를 맞춘다.
        -->
        <div class="flex items-baseline gap-x-3">
          <!--
            **실행 방법은 이름 아래로 내린다.** 고르는 순간에 읽는 값이 아니라 이미 고른
            값이고, 이름과 같은 줄에 두면 좁은 칸에서 예상 시간까지 셋이 접힌다.
          -->
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="font-bold">{{ t(`algorithms.${row.algorithm}`) }}</span>

              <span v-if="tone" class="rounded-field px-2 py-0.5" :class="tone.badge">
                {{ t(tone.key) }}
              </span>
            </div>

            <p class="mt-1 text-ink-soft">{{ t(`runtimes.${row.runtime}`) }}</p>
          </div>

          <!--
            **예상 시간은 [제거] 왼편에 못 박힌다.** 모델 이름 옆에 두었더니 이름 길이가
            줄마다 달라 숫자가 들쑥날쑥해 보였다 — 훑을 때 알고 싶은 것이 "어느 것이 오래
            걸리나"인데, 그러려면 숫자가 한 줄로 서야 한다.

            **학습이 도는 동안에는 안 보인다.** 그때 말할 것은 예상이 아니라 지금 무엇이
            도는가이고, 그건 이름 옆의 상태가 말한다 — 둘이 나란히 있으면 끝난 줄에도
            "약 3분"이 남는다.
          -->
          <span v-if="!props.running" class="shrink-0 text-ink-soft">{{ estimateText }}</span>

          <!--
            **세로 여백을 되당기지 않는다.** 전에는 `-my-2.5`로 버튼의 `py-2.5`를
            상쇄했다 — 줄이 한 줄뿐일 때는 버튼이 줄 높이를 46px로 키워 이름이 가운데로
            밀렸기 때문이다. **실행 방법이 아랫줄로 내려가면서 그 전제가 깨졌다**:
            왼쪽 칸이 두 줄이라 이미 더 높고, 버튼은 줄 높이를 안 키운다. 되당기는 것만
            남으면 **기준선 정렬을 그만큼 밀어 올린다.**

            **도는 동안에는 뺄 수 없다.** 실험은 [학습하기]를 누른 순간의 스냅샷으로 도므로
            지금 빼도 도는 것은 안 바뀐다 - 뺄 수 있게 두면 화면이 지금 무엇이 도는지에
            대해 거짓말을 하게 된다 (TrainView의 같은 판단).
          -->
          <AppButton
            v-if="!props.running"
            variant="ghost"
            class="shrink-0"
            @click="emit('remove', index)"
          >
            {{ t('train.removeModel') }}
          </AppButton>
        </div>

        <details
          v-if="specsOf(row).length > 0 && !props.running"
          class="mt-3 rounded-panel border border-line"
        >
          <summary class="cursor-pointer px-3 py-2 font-bold text-ink-soft">
            {{ t('train.tuning') }}
          </summary>

          <div class="flex flex-wrap gap-x-6 gap-y-4 border-t border-line p-3">
            <AppField
              v-for="spec in specsOf(row)"
              :key="spec.name"
              :label="t(`hyperparams.${spec.name}`)"
              :hint="t('train.range', { min: spec.min, max: spec.max })"
              :error="outOfRangeNames.has(spec.name) ? t('train.outOfRange') : undefined"
            >
              <template #default="field">
                <input
                  v-bind="field"
                  type="number"
                  class="w-40 rounded-field border border-line-strong bg-surface px-2 py-1"
                  :value="valueOf(row, spec)"
                  :min="spec.min"
                  :max="spec.max"
                  :step="spec.step"
                  @change="onParam(row, spec, $event)"
                />
              </template>
            </AppField>
          </div>
        </details>
      </li>
    </ul>
  </div>
</template>
