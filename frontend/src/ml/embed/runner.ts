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
  prepare(target: RunnerTarget, onState: (state: EngineState) => void): Promise<void>
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
      const [plain, simd, threaded] = await Promise.all([
        import('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url'),
        import('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url'),
        import('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url'),
      ])
      wasm.setWasmPaths({
        'tfjs-backend-wasm.wasm': plain.default,
        'tfjs-backend-wasm-simd.wasm': simd.default,
        'tfjs-backend-wasm-threaded-simd.wasm': threaded.default,
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
      if (!chosen) throw new Error('이 브라우저에서 쓸 수 있는 TF.js 백엔드가 없다')

      model = await converter.loadGraphModel(target.modelUrl)
      onState('downloaded')

      // 워밍업. WebGL은 셰이더를 여기서 컴파일하고, 실측에서 6.4초가 들었다.
      const { canonicalSize, embeddingNode, embeddingDim } = target.spec
      const warm = model.execute(tf.zeros([1, canonicalSize, canonicalSize, 3]), [embeddingNode])
      const warmTensor = Array.isArray(warm) ? warm[0]! : warm
      const got = (await warmTensor.data()).length
      warmTensor.dispose()
      if (got !== embeddingDim) {
        // 등록부와 모델이 어긋났다. 조용히 넘어가면 파일에 틀린 길이의 벡터가 담긴다.
        throw new Error(`임베딩 차원이 등록부와 다르다: ${got} ≠ ${embeddingDim}`)
      }
      onState('ready')
    },

    async embed(target, images, onProgress) {
      if (!tf || !model) throw new Error('prepare를 먼저 불러야 한다')
      const { canonicalSize: size, embeddingDim: dim, embeddingNode, inputRange } = target.spec

      const canvas = new OffscreenCanvas(size, size)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('OffscreenCanvas의 2d 컨텍스트를 못 얻었다')

      const out = new Float32Array(images.length * dim)
      const pixels = new Float32Array(size * size * 3)

      for (let index = 0; index < images.length; index += 1) {
        const bitmap = await createImageBitmap(new Blob([images[index]!], { type: 'image/jpeg' }))
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
