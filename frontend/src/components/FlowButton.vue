<script setup lang="ts">
/**
 * 도구 막대의 [프로젝트 흐름도] (`architecture.md` §8.22). 열린 프로젝트의 파일을 스토어에서 읽어 넘기는
 * 얇은 껍데기다 — **스토어를 읽는 것은 이 파일이고, 단추와 창은 파일만 받는다**(`components/flow/`). 그래서
 * 점검 화면이 같은 단추와 창을 스토어 없이 쓴다.
 *
 * 어느 단계에서나 같은 창을 연다 — 다른 단계 화면에는 그림을 따로 두지 않는다.
 */

import FlowGuard from '@/components/flow/FlowGuard.vue'
import FlowOpenButton from '@/components/flow/FlowOpenButton.vue'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()
</script>

<template>
  <FlowGuard v-if="project.file !== null" :key="project.projectId ?? ''">
    <FlowOpenButton :file="project.file" compact />
  </FlowGuard>
</template>
