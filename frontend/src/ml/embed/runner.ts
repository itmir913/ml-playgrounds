/**
 * 백본을 실제로 돌리는 것. **워커 안에서만 산다.**
 *
 * 인터페이스를 따로 두는 이유는 handler를 테스트로 덮기 위해서다 — TF.js도
 * `OffscreenCanvas`도 없는 곳에서 **메시지 순서와 실패 전달**을 검사할 수 있어야 한다
 * (ml/worker/handler.ts와 같은 이유).
 *
 * **백엔드는 학생에게 안 보인다** (open-decisions.md "백본을 붙이는 방법"). 여기서
 * 순서대로 시도하고, 되는 것으로 돈다. 실측 근거는 같은 문서의 실측표다 —
 * 개발 PC에서 사진 100장이 WebGPU 1.96초 · WebGL 2.24초 · wasm 4.59초였다.
 */

import { ClientError } from '../../errors'
import type { BackboneSpec } from '../backbones'
import type { EngineState } from '../backend'
import { packPixels } from './pixels'

export interface RunnerTarget {
  readonly spec: BackboneSpec
  /** 메인이 문서 기준으로 푼 `model.json` 주소 (protocol.ts). */
  readonly modelUrl: string
}

export interface BackboneRunner {
  /** 내려받고 백엔드를 띄운다. 단계가 넘어갈 때마다 알린다. */
  prepare(
    target: RunnerTarget,
    onState: (state: EngineState, fraction?: number) => void,
  ): Promise<void>
  /** 사진 하나마다 벡터 하나. 결과는 이어 붙인 배열 하나다. */
  embed(
    target: RunnerTarget,
    images: readonly Uint8Array<ArrayBuffer>[],
    onProgress: (completed: number) => void,
  ): Promise<Float32Array>
  /** 텐서와 모델을 놓는다. 어떤 경로로 끝나든 불린다. */
  dispose(): void
}

/**
 * 시도 순서. **앞의 것부터 되는 것을 쓴다.**
 *
 * **wasm 멀티스레드는 후보에 없다** — `SharedArrayBuffer`가 COOP/COEP 헤더를 요구하는데
 * GitHub Pages는 그 헤더를 못 준다 (open-decisions.md). 그래서 wasm은 항상 단일
 * 스레드로 계산해야 한다.
 */
const BACKENDS = ['webgpu', 'webgl', 'wasm'] as const

type Backend = (typeof BACKENDS)[number]

type TfCore = typeof import('@tensorflow/tfjs-core')
type GraphModel = Awaited<ReturnType<typeof import('@tensorflow/tfjs-converter').loadGraphModel>>

async function loadBackend(tf: TfCore, backend: Backend): Promise<boolean> {
  try {
    if (backend === 'webgpu') {
      // navigator.gpu가 없으면 백엔드 등록 자체가 안 된다 (실측에서 확인한 실패 모양).
      if (!('gpu' in navigator)) return false
      await import('@tensorflow/tfjs-backend-webgpu')
    } else if (backend === 'webgl') {
      await import('@tensorflow/tfjs-backend-webgl')
    } else {
      const wasm = await import('@tensorflow/tfjs-backend-wasm')
      /**
       * **멀티스레드를 여기서 끈다.** 위에 "후보에 없다"고 적어 두고 바이너리를 넘기면
       * 그 말이 코드에는 없는 것이다 — `SharedArrayBuffer`가 있는 환경(자가호스팅이
       * COOP/COEP를 주면 생긴다)에서 TF.js가 알아서 threaded 쪽을 고른다.
       *
       * **끄면 산출물에서도 뺄 수 있다** — 425KB다. 그리고 어디서 돌든 같은 바이너리로
       * 계산한다는 뜻이라, 결과가 환경에 따라 갈릴 자리가 하나 줄어든다.
       *
       * 플래그는 위 `import`가 등록한다. **순서가 중요하다** — 등록 전에 켜고 끄면
       * 기본값에 덮인다.
       */
      tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false)
      const [plain, simd] = await Promise.all([
        import('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url'),
        import('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url'),
      ])
      wasm.setWasmPaths({
        'tfjs-backend-wasm.wasm': plain.default,
        'tfjs-backend-wasm-simd.wasm': simd.default,
      })
    }
    if (!(await tf.setBackend(backend))) return false
    await tf.ready()
    return tf.getBackend() === backend
  } catch {
    // 이 기기에 없는 백엔드다. 다음 것을 본다 — 여기서 던지면 폴백이 죽는다.
    return false
  }
}

export function createTfjsRunner(): BackboneRunner {
  let tf: TfCore | null = null
  let model: GraphModel | null = null

  return {
    async prepare(target, onState) {
      onState('downloading')
      tf = await import('@tensorflow/tfjs-core')
      const converter = await import('@tensorflow/tfjs-converter')

      let chosen: Backend | null = null
      for (const backend of BACKENDS) {
        if (await loadBackend(tf, backend)) {
          chosen = backend
          break
        }
      }
      if (!chosen) throw new Error('no usable TF.js backend in this browser')

      // **받는 동안 얼마나 왔는지 말한다** (2026-08-29 화면 실측 C-7). 백본이
      // 12.4MB라 학교 회선에서는 이 한 줄이 몇십 초를 덮고, 그동안 화면이 문장
      // 하나로 서 있으면 학생은 멈춘 줄 안다.
      model = await converter.loadGraphModel(target.modelUrl, {
        onProgress: (fraction) => onState('downloading', fraction),
      })
      onState('downloaded')

      // 워밍업. WebGL은 셰이더를 여기서 컴파일하고, 실측에서 6.4초가 들었다.
      const { canonicalSize, embeddingNode, embeddingDim } = target.spec
      const warm = model.execute(tf.zeros([1, canonicalSize, canonicalSize, 3]), [embeddingNode])
      const warmTensor = Array.isArray(warm) ? warm[0]! : warm
      const got = (await warmTensor.data()).length
      warmTensor.dispose()
      if (got !== embeddingDim) {
        // 등록부와 모델이 어긋났다. 조용히 넘어가면 파일에 틀린 길이의 벡터가 담긴다.
        throw new Error(`embedding dim differs from registry: ${got} != ${embeddingDim}`)
      }
      onState('ready')
    },

    async embed(target, images, onProgress) {
      if (!tf || !model) throw new Error('prepare() must run first')
      const { canonicalSize: size, embeddingDim: dim, embeddingNode, inputRange } = target.spec

      const canvas = new OffscreenCanvas(size, size)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('OffscreenCanvas 2d context unavailable')

      const out = new Float32Array(images.length * dim)
      const pixels = new Float32Array(size * size * 3)

      for (let index = 0; index < images.length; index += 1) {
        // **형식을 안 적는다.** `createImageBitmap`은 바이트를 스니핑해서 형식을 가리고
        // (HTML 명세의 image sniffing rules), 정본은 webp일 수도 jpg일 수도 있다
        // (open-decisions.md "정본은 WebP로 굽는다"). 여기에 하나를 박으면 그 순간
        // 절반이 거짓말이 된다.
        const bitmap = await createImageBitmap(new Blob([images[index]!]))

        /**
         * **정본이 백본이 요구하는 크기인가** (V11 R1 감사 B-2).
         *
         * `drawImage`는 원본 크기 그대로 그리므로 작은 정본이 오면 캔버스의 남는 자리가
         * **직전 사진의 화소로 남는다.** 두 사진이 섞인 벡터가 나오는데 예외도 경고도
         * 없다. 늘려서 맞추지 않는 것은 결정이다 — 없는 화소를 만들지 않는다
         * (open-decisions.md #4).
         */
        if (bitmap.width !== size || bitmap.height !== size) {
          const found = `${bitmap.width}×${bitmap.height}`
          bitmap.close()
          /**
           * **전용 코드로 던진다** (R6 감사 B-10). 그냥 `Error`로 던지면 핸들러가
           * `BACKBONE_UNAVAILABLE`로 바꾸고, 학생은 원인이 사진인데 *"인터넷 연결을
           * 확인하세요"*를 본다 — 다시 시도해도 영원히 같은 자리에서 죽는다.
           *
           * `failureDetail`도 안 쓴다. 그쪽은 **남의 라이브러리가 던진 영어 원문**을 위한
           * 자리라(`errors.ts`) 우리가 쓴 한국어를 실어 보내면 en/ja 사용자가 한국어를 본다.
           */
          throw new ClientError('IMAGE_CANONICAL_SIZE_MISMATCH', { found, expected: size })
        }

        /**
         * **흰색으로 깐다** (R6 감사 B-11). 전에는 `clearRect`였는데 그것이 까는 바탕은
         * **투명 검정**이고, 알파를 버리는 `packPixels`는 그 자리를 **검정**으로 읽는다.
         * 파이프라인 나머지가 전부 "여백은 흰색"으로 서 있다 — 굽는 자리가 그렇게 하고
         * (`data/image/bake.ts`), 레터박스도 그렇다. 여기서만 검정이면 그 사진의 벡터가
         * 조용히 다른 값이 된다.
         *
         * **크기 검사가 위에 있으므로 이 줄이 막는 것은 잔상이 아니다.** 크기가 같으면
         * `drawImage`가 캔버스를 통째로 덮는다. 이 줄은 **투명 화소가 섞인 정본**을 위한
         * 것이고, 우리가 굽는 정본에는 그런 화소가 없다(`packPixels`의 머리말) — 남이
         * 만든 zip에서만 닿는다.
         */
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, size, size)
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        packPixels(context.getImageData(0, 0, size, size).data, size, inputRange, pixels)

        const input = tf.tensor4d(pixels, [1, size, size, 3])
        const output = model.execute(input, [embeddingNode])
        const tensor = Array.isArray(output) ? output[0]! : output
        out.set(await tensor.data(), index * dim)
        input.dispose()
        tensor.dispose()

        onProgress(index + 1)
      }
      return out
    },

    dispose() {
      model?.dispose()
      model = null
      tf = null
    },
  }
}
