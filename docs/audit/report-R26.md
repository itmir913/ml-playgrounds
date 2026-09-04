# R26 감사 보고서 — 학습 병렬화와 두 탭 잠금

> 요청서: `docs/audit/request-R26.md` · 공통 절반: `docs/workflow.md` §3
> 대상: `bba582e~1..HEAD` 커밋 다섯 · 새 파일 열둘 · 검사 다섯

## 0. 한 줄

**계산은 옳고, 그 계산을 지키는 것이 아무것도 없다.**

돌연변이 열둘 중 **운 것은 둘뿐이다.** 그 둘은 대조군이고, **겨눈 열 개가 전부 조용했다.**
병렬화 코드의 판단은 실물 브라우저 A/B가 옳다고 확인했지만(요청서 §4), **관문은 그 옳음을
한 줄도 안 지킨다** — 세 풀 공장의 몸통·컴퓨트 핸들러 하나·실물 배선 한 줄·엔진 3의 정본
상수가 전부 검사 0줄인데, **소스 주석 여럿이 "스펙이 못 박는다"고 단정한다.**

**그러므로 "이 패턴을 더 반복해도 되나"의 답은 조건부다** — 계산 설계는 반복해도 되고,
**검사 설계는 반복하면 안 된다.** 지금 모양은 "가짜 풀로 우리 코드끼리 견주기"이고,
그것이 구조적으로 못 보는 자리에 §3의 결함이 살고 있었다.

## 1. 돌연변이 표 — **전체** (운 것 포함)

전부 심고 **즉시** 파일 하나의 정확한 경로로 되돌렸다(`git checkout --`를 안 썼다).
기준선: `npx vitest run` → **153파일 · 3057통과 · 2건너뜀** (2026-09-04).

| # | 무엇을 뭉갰나 | 돌린 스펙 | 결과 |
|---|---|---|---|
| C1 | `forest-pool.ts` `forestSeeds`의 `seeds.push(current)`를 루프 끝으로 (씨앗 한 칸 밀기) | `forest-parallel` | **욺** — 3건 |
| C2 | `forest-compute.ts` `plainTree`를 통째로 JSON 태우기 | `forest-parallel` | **욺** — 1건(라이브러리 대조) |
| C3 | `neural.ts` `chunksOf`가 낸 조각을 `.reverse()` | `neural-parallel` | **조용** ← 요청서는 울 것이라 적었다 |
| M1 | `knn-pool.ts` 재조립 `merged.push` → `unshift` (순서 뒤집기) | `knn-parallel` `experiment` `worker` | 조용 (138통과) |
| M2 | `forest-pool.ts` 재조립 `trees.push` → `unshift` | `forest-parallel` `experiment` | 조용 (112통과) |
| M3 | `pool.ts` `assignSpans`의 `if (size === 0) continue` 제거 | `knn-parallel` `forest-parallel` | 조용 |
| M4 | `limits.ts` `NEURAL_PARALLEL_CHUNK_ROWS` 50 → 40 | `neural-parallel` `neural` `versions` `mljs` `sklearn-parity` | 조용 (138통과) |
| M5 | `forest-compute.ts` 표 되세우기 열 색인 어긋내기 | `forest-parallel` `worker` | 조용 |
| M6 | `knn-pool.ts` `flatten`이 모든 값에 +1 | `knn-parallel` `experiment` | 조용 (112통과) |
| M7 | `handler.ts`의 실물 주입에서 `knn: knnPoolFactory` 삭제 | `worker` `knn-parallel` | 조용 |
| M8 | `tab-lock.ts` `{ ifAvailable: true }` → `{}` | `tab-lock` `project-open-lock` | 조용 (13통과) |
| M9 | `tab-lock.ts` `if ('unref' in Channel.prototype) return undefined` 삭제 | `tab-lock` `project-open-lock` | 조용 (13통과) |
| M10 | `mljs.ts` `loadForest`의 `n`·`replacement`·`maxFeatures` 셋을 동시에 틀림 | `forest-parallel` `mljs` | 조용 (46통과) |
| M12 | `experiment.ts` 채점이 `predictBatch`를 안 쓰고 항상 `predict` | `experiment` `knn-parallel` `worker` | 조용 (138통과) |

**생존율 10/12 (83%).** 이 저장소의 라운드 평균(20~35% 생존)의 세 배다.

## 2. A급 — 초록불이 거짓이다

### A-1. 세 풀 공장의 몸통이 검사 0줄인데, 주석은 스펙이 지킨다고 단정한다

**자리** `ml/worker/knn-pool.ts:47-84` · `forest-pool.ts:62-118` · `neural-pool.ts:100-142`

**주장** `grep -rn "knnPoolFactory\|forestPoolFactory\|neuralPoolFactory" frontend/tests/` → **0줄.**
세 스펙이 가져가는 것은 순수 헬퍼뿐이다(`shouldSplit*` · `forestSeeds` · `assignChunks`).
평탄화·span↔워커 짝짓기·재조립·`dispose`는 **한 줄도 안 돌아간다.** 스펙의 가짜 풀은
공장을 *부르는* 것이 아니라 **다시 구현한다** — `knn-parallel`은 워커 수를 상수 `3`으로 박고
`flatten`을 손으로 다시 쓴다.

구조적 이유가 있다: jsdom에 `Worker`가 없어 세 공장이 첫 줄에서 `null`을 낸다.
`grep -rn "globalThis.Worker\|vi.stubGlobal('Worker'" frontend/tests/` → **0건** — 스텁이 없으므로
**어떤 스펙도 그 문을 못 넘는다.**

**재현** M1(재조립 순서 뒤집기)·M2(같은 것, 포레스트)·M6(평탄화 값 어긋내기) **전부 조용.**
M6은 모든 특성값을 +1 하는 파괴적 변형인데도 138개가 초록이었다.

**그런데 주석은 반대를 말한다.** `neural-pool.ts:8` *"그 재조립이 깨지면 어떻게 우는지는
`neural-parallel.spec.ts`가 못 박는다"* · `pools.ts` `ForestPool.grow` *"돌려주는 순서는 나무
번호 순서다"* · `knn-parallel.spec.ts:15` 머리말 3번 *"어떻게 나눠도 이어 붙인 답이 같다"*.
**셋 다 제품 코드가 아니라 스펙 자신의 사본을 잰다.**

**이웃** 한 군데가 아니라 **셋 다**다(위 grep). 워커 진입 파일 셋도 검사 0줄인데 그것은
요청서 §4가 이미 안다.

**처방** 스펙 안에 가짜 `Worker` 전역을 세우고 **공장을 진짜로 부른다** — 생성자가
`create*ComputeHandler()` 하나를 들고, `postMessage`가 `structuredClone`을 태워 핸들러에
넘기고, 답도 `structuredClone`을 태워 `message` 이벤트로 되돌린다. `spawn.ts`는
`vi.mock`으로 붙인다(선례: `tests/train-fail.spec.ts:62`).
**넘어야 할 문이 셋이다** — ① `typeof Worker` 가드, ② `shouldSplit*` 게이트(작은 픽스처를
주면 여기서 `null`이 나가고 검사는 아무것도 안 잰 채 초록이 된다), ③ `poolWorkerCount`가
읽는 `navigator.hardwareConcurrency`(고정 안 하면 **코어 2개 기기에서 검사가 갈린다**).
**처방이 실제로 무는지는 M1·M6을 그 스텁 위에서 다시 심어 둘 다 우는 것까지 보고 닫아라.**

### A-2. 엔진 3의 정본을 아무것도 안 잠근다 — **요청서 §6-3의 예상이 틀렸다**

**자리** `limits.ts:1043-1057`(`NEURAL_PARALLEL_CHUNK_ROWS`) · `neural.ts`의 `chunksOf`
· `tests/neural-parallel.spec.ts:94-127` · `tests/versions.spec.ts`

**주장** 엔진 3의 내용은 *"기울기 합산의 정본 순서가 고정 조각 접기로 바뀌었다"*이다.
그런데 **그 정본을 고정하는 검사가 하나도 없다.** `neural-parallel`이 재는 것은
*"직렬과 병렬이 같다"*인데, 조각 크기도 접는 순서도 **두 갈래가 같은 함수를 쓰므로 함께
움직인다** — 정본을 바꾸면 두 갈래가 나란히 바뀌고 단언은 그대로 참이다.

**재현 (이 라운드의 가장 값진 결과)** 요청서 §6-3은 `chunks.reverse()`가
*"neural-parallel의 비트 동일이 울어야 한다"*고 적었다. **C3로 심었더니 6개 전부 통과했다.**
M4(조각 크기 50 → 40)도 `neural`·`versions`·`mljs`·`sklearn-parity`까지 붙여 돌렸는데
**138개가 조용했다.** `sklearn-parity`가 씨앗 다섯의 **구간** 대조라 설계상 안 문다.

**즉 엔진 버전 3을 정의하는 값을 아무나 바꿔도 관문이 초록이다.** 이것은
`workflow.md` §4가 *"기대값을 고치는 것은 답이 아니다"*라고 못 박은 그 종류의 값이다.

**이웃** 같은 병이 `CALIBRATION_BASELINE_MS`에서 이미 한 번 나왔다(요청서 §7의 "이미 잰 것"이
아니라 `workflow.md` §3 "언제 여는가" 3번). **실측·정본 상수는 검사가 구조적으로 못 지킨다.**

**처방** `neural.spec.ts`에 **고정 씨앗의 가중치 몇 개를 소수점 끝까지 박은 앵커**를 세운다
(조각 크기나 접는 순서가 움직이면 반드시 깨지는 값). 그리고 `versions.spec.ts`에
`NEURAL_PARALLEL_CHUNK_ROWS`를 `MLJS_ENGINE.version`과 **같은 못**으로 묶는다 — 상수를
바꾸면서 버전을 안 올리면 거기가 빨개지게. **처방을 넣은 뒤 C3와 M4를 다시 심어 둘 다
우는지 재라.**

### A-3. `createForestComputeHandler`가 검사 0줄 — 형제 둘은 불린다

**자리** `ml/worker/forest-compute.ts:116-166` (특히 137-144의 표 되세우기)

**주장** `neural-parallel`은 `createNeuralComputeHandler`를 부르고 `knn-parallel`은
`createKnnComputeHandler`를 부르는데, **`createForestComputeHandler`만 아무도 안 부른다.**
`forest-parallel`은 그 아래층인 `growTree`를 직접 부른다 — 씨앗 메시지에서 표를 되세우는
루프(워커가 실제로 지나가는 유일한 길)를 건너뛴다.

**재현** M5(열 색인을 `(column + 1) % columns`로 어긋냄 — 모든 나무가 뒤섞인 특성으로
학습된다) **조용, 31통과.**

**이웃** 세 컴퓨트 핸들러 중 하나. 나머지 둘은 불리지만 `createNeuralComputeHandler`도
**조각 하나로만** 불린다(`neural-parallel.spec.ts`의 `chunks: [chunk]`) — 여러 조각의
`transfer` 목록 조립은 안 지나간다.

**처방** A-1의 가짜 워커가 이것을 자동으로 덮는다(워커가 핸들러를 부르므로). 별도 검사를
세울 것 없이 A-1의 처방 하나로 닫힌다.

### A-4. 실물 배선 한 줄(`handler.ts:33`)을 아무 검사도 안 문다

**자리** `ml/worker/handler.ts:33` — `pools: { neural, forest, knn }`

**주장** 이 한 줄이 **유일한 실물 주입 자리**이고 주석 자신이 그렇게 말한다. 병렬화 전체가
이 줄에 매달려 있는데 **아무도 안 잰다.**

**재현** M7(`knn: knnPoolFactory` 삭제) **조용.** 즉 **KNN 병렬화를 통째로 꺼도 관문이 초록이다.**
같은 방식으로 셋 다 조용히 꺼질 수 있다 — 학생은 2.36배를 잃고 아무도 모른다.

**처방** `worker.spec.ts`에서 `handleTrain`이 넘기는 `pools`의 키 셋을 단언한다.
`runExperiment`를 감싸(spy) `options.pools`에 세 이름이 **전부** 있는지 본다. 한 줄이면 된다.

### A-5. tab-lock의 `ifAvailable`을 아무도 안 잰다 — 잃으면 둘째 탭이 영영 매달린다

**자리** `project/tab-lock.ts:76` · `tests/tab-lock.spec.ts`

**주장** `{ ifAvailable: true }`가 빠지면 `locks.request`는 **거절하지 않고 기다린다.**
그러면 `acquireTabLock`의 약속이 안 풀리고, 둘째 탭은 "다른 탭이 쓰고 있다"는 안내 대신
**영영 멈춘 화면**을 본다. 첫 탭이 닫힐 때까지.

**재현** M8(`{ ifAvailable: true }` → `{}`) **조용, 13통과.** 가짜 `LockManager`가
그 옵션을 안 보기 때문이다.

**처방** 가짜 `LockManager`가 **`ifAvailable`을 실제로 해석하게** 고친다 — 이미 잡힌
자물쇠에 `ifAvailable`이 없으면 **영영 안 풀리는 약속**을 돌려주게. 그러면 M8이
타임아웃으로 운다.

## 3. B급 — 결정이 걸리거나 학생이 시간을 잃는다

| # | 자리 | 주장 | 재현 |
|---|---|---|---|
| B-1 | `tab-lock.ts:56-63` | `unref` 지문에 무는 검사 0건. **두 방향 모두 조용히 실패한다** — 브라우저가 언젠가 `unref`를 넣으면 잠금이 통째로 꺼지고, 지문을 지우면 node 채널이 워커 스레드를 가로질러 병렬 스펙이 서로의 잠금에 답한다 | M9 **조용** |
| B-2 | `mljs.ts:454-486` `loadForest` | 손으로 적은 필드 아홉 중 여럿이 검사에 안 걸린다. 주석은 *"`forest-parallel.spec.ts`가 라이브러리와 맞대어 지킨다"*고 단정 | M10(`n`·`replacement`·`maxFeatures` **셋 동시**) **조용, 46통과** |
| B-3 | `experiment.ts:535-540` | 채점이 `predictBatch`를 쓰는 배선에 검사 0줄. `knn-parallel`은 `predictBatch`를 **직접** 부르지 실험 실행을 안 지나간다 | M12 **조용, 138통과** |
| B-4 | `neural-pool.ts:46-83,94-98` vs `pool.ts:26-50` | `assignChunks`·`ask`·워커 수가 `pool.ts`의 **자구까지 같은 두 벌**이고 **이미 갈라졌다** — `poolWorkerCount`에는 있는 일감 클램프(`Math.max(1, jobs)`)가 신경망 쪽에 없다 | 코드 대조(돌연변이 안 함) |
| B-5 | `forest-pool.ts:75` · `knn-pool.ts:54` · `neural-pool.ts:107` | **워커를 못 띄우면 직렬로 안 돌아간다** — `spawn`이 던지면 run이 통째로 실패한다. 결정문은 *"중첩 워커가 없는 환경은 직렬로 돈다"*고 적었는데 그 폴백은 `typeof Worker` 하나뿐이고 **스폰 실패는 안 덮는다** | 코드 대조 |
| B-6 | `pool.ts:52-73` · `neural-pool.ts:64-83` | `askWorker`가 **`messageerror`를 안 듣고 타임아웃도 없다.** 같은 저장소의 `client.ts`는 듣는다(`:95`, `:239`) — 구조화 복제가 수신 쪽에서 실패하면 **영원히 기다린다** | 코드 대조 |
| B-7 | `spawn.ts:18-19` 등 | *"부모가 terminate로 죽으면 자식도 함께 죽는다"*에 근거가 주석뿐이다. 그리고 `dispose`가 **유일하게 안 도는 경로가 정확히 그 취소**다 | 요청서 §4가 이미 앎 · 재 본 적 없음 |
| B-8 | `limits.ts:1083-1129` | 게이트 주석의 산술이 자기 숫자와 안 맞는다 — 포레스트: 575ms를 넷으로 가르면 144ms인데 주석은 190ms를 적는다. KNN: 두 점 분해(3,500×1,500)가 하니스의 분할과 다르다 | 산술 검산 |
| B-9 | `neural-pool.ts:33-36` · `neural.ts:657` | 게이트는 통과하는데 `chunks.length > 1`이 아니면 병렬 갈래가 **한 번도 안 돈다** — 워커 넷을 띄우고 표를 넷으로 복제한 뒤 안 쓴다 | 코드 대조 |
| B-10 | `tools/mutants.json` · `tools/mutate.mjs:97` | **새 파일 열둘이 카탈로그에 0개.** `src/ml/worker/` 전체가 백지다. 그리고 러너는 `expectSpecs`가 비면 스위트 전체를 돌려 **그런 항목은 영원히 "욺"으로 찍힌다** | 카탈로그 대조 |
| B-11 | `tab-lock.ts:139-152` · `stores/project.ts` | 프로젝트를 빠르게 두 번 열면(`await` 사이) 앞 잠금이 고아가 되고 그 탭은 그 프로젝트를 다시 못 연다 | 코드 대조(경합, 재현 못 함) |

## 4. C급 — 유창하게 틀린 주석 (전부 코드로 확인)

1. **`forest-compute.ts:107`** *"직렬 경로도 이 함수를 쓴다"* — **거짓.** `mljs.ts:608-616`의
   직렬 갈래는 `new RandomForestClassifier(options); model.train(...)`이라 `plainTree`를
   안 지나간다. 직렬 숲은 살아 있는 노드, 병렬 숲은 JSON 왕복본이다.
   (모델 **파일**은 같다 — `forest-parallel`의 첫 검사가 그것을 잰다. 갈리는 것은 메모리
   위의 물건이다.)
2. **`forest-compute.ts:6-13`** *"라이브러리가 직렬로 지은 것과 바이트 단위로 같은 숲"* —
   `root`에 JSON을 태우므로 노드마다 일부 값이 소실된다. **"같은 예측을 하는 숲"이 맞는 말이다.**
3. **`train.worker.ts:24-37`** 사슬 큐가 *"뒤 요청이 앞 요청을 앞지를 수 있게 됐다"*고
   단정하는데, **취소는 `terminate` 하나**여서(`client.ts:8`) 그 경로가 도달 불가다.
4. **`pool.ts:34`의 `if (size === 0) continue`** — 죽은 가지다(M3 조용). `lanes`가 이미
   `min(workers, count)`라 `base`가 0이면 `extra`가 모든 칸을 채운다.
5. **`loadForest`가 `numberFeatures`/`numberSamples`를 안 담아** 재조립한 숲의
   `featureImportance()`가 `[NaN]`을 낸다. **지금은 부르는 자리가 없다.**
6. **교정은 직렬을 재는데 학습은 병렬로 돈다** — 큰 숲의 예상 시간이 이제 체계적으로 길다.
7. **`transfer` 목록을 읽는 검사가 0건** — 가짜 손이 `emit`의 둘째 인자를 버린다.

## 5. 못 한 것 · 확인 못 한 것

**여기가 고치는 쪽이 재야 할 자리다.**

- **취소 경로를 못 밟았다.** `Worker.terminate()`가 자식 워커를 함께 죽이는지 **재지 않았다** —
  jsdom에 `Worker`가 없어 검사로 못 밟고, 브라우저 실측은 이 라운드에서 안 했다.
  **고아 워커가 쌓이는지는 여전히 미지다.**
- **B-11(빠른 두 번 열기)을 재현 못 했다.** 경합이고, 이 저장소는 *"경합은 손으로 재현이
  사실상 불가능하다"*는 판정을 이미 갖고 있다.
- **`messageerror`가 실제로 뜨는 값을 못 찾았다.** B-6은 "가능한 경로"이지 실측이 아니다.
  `Float64Array`만 넘기는 두 프로토콜은 안전할 가능성이 높다.
- **KNN의 실물 모델 대조가 여전히 없다** (요청서 §4). 정확도가 같다는 것은 쟀지만
  답 배열이 소수점 끝까지 같은지는 안 쟀다.
- **`vue-tsc`를 돌연변이마다 안 돌렸다.** 열둘 중 타입이 갈릴 만한 것이 M10 하나였고
  그것은 타입이 통과하는 변형이다. **나머지에 대해서는 "타입이 안 울었다"를 주장하지 않는다.**
- **`git diff`의 검사 파일 변경 720줄(`experiment.spec.ts`)을 전수로 안 읽었다.**
  엔진 3이 "안 올렸어야 할 것까지 바꿨는지"는 **숫자가 움직인 자리를 못 찾았다**는 것까지만
  말할 수 있다.
- **성능 회귀는 안 쟀다.** 요청서 §7이 재측정을 금했고, 게이트 상수의 산술만 검산했다.

## 6. 다음 라운드가 겨냥할 것

**이 라운드가 쓴 방법은 "존재하는 코드 한 줄을 바꿔 vitest가 우는가"다.** 그 방법이
**원리적으로 못 보는 것**이 이번에도 그대로 남았다 — 취소·고아 워커·경합·두 시점.
그리고 새로 하나가 늘었다: **jsdom에 `Worker`가 없어 워커 경계 전체가 방법의 사각이다.**

**A-1의 처방(가짜 워커 전역)이 그 사각을 닫는 유일한 수단이다.** 그것을 세우기 전에는
`src/ml/worker/`의 어떤 지적도 돌연변이로 증명할 수 없다.
