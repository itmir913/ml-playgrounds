/**
 * 아이콘 등록부. **화면 코드가 `lucide-vue-next`를 직접 import 하지 않는다.**
 *
 * 이유는 등록부를 쓰는 다른 자리들과 같다 — 아이콘을 바꾸려면 여기 한 줄만 고치면 되고,
 * 어떤 아이콘을 쓰고 있는지가 한눈에 보이며, 나중에 세트를 갈아치울 때 화면을
 * 안 건드린다.
 *
 * **lucide를 고른 이유.**
 * - ISC 라이선스. 아이콘마다 개별 컴포넌트라 **여기 적은 것만 번들에 들어간다.**
 * - 런타임에 아무것도 받아 오지 않는다. `@iconify`는 기본 동작이 API 호출이라
 *   학교망 CDN 차단에 그대로 걸린다 (architecture.md §8.5와 같은 이유).
 * - 24px 스트로크 그리드라 작은 크기에서도 읽힌다.
 */

import {
  ChartColumn,
  ChevronDown,
  ChevronUp,
  Shapes,
  Download,
  FileText,
  FlaskConical,
  CircleQuestionMark,
  FolderOpen,
  Info,
  LayoutDashboard,
  Library,
  Moon,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Table2,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-vue-next'

import type { StepId } from '@/router/steps'

/** 제품 표시. 도구 막대 왼쪽 끝에 있다. */
export const BRAND_ICON: LucideIcon = Shapes

/** 프로젝트 홈. 단계가 아니라 그 위에 있는 자리다. */
export const HOME_ICON: LucideIcon = LayoutDashboard

/** 워크플로 단계의 그림. 레일과 상태 팝오버가 같은 것을 쓴다. */
export const STEP_ICONS: Readonly<Record<StepId, LucideIcon>> = {
  data: Table2,
  preprocess: SlidersHorizontal,
  train: FlaskConical,
  results: ChartColumn,
  predict: Sparkles,
  portfolio: FileText,
}

/** 동작의 그림. 이름은 무엇을 하는지로 짓는다 — `Plus`가 아니라 `newProject`다. */
export const ACTION_ICONS = {
  newProject: Plus,
  openFile: FolderOpen,
  savedProjects: Library,
  exportFile: Download,
  showSummary: Info,
  /** 용어 설명을 여는 물음표. 눌러야 나온다는 것을 이 그림이 말한다 (§8.13). */
  explainTerm: CircleQuestionMark,
  // 스위치는 **바뀔 쪽**을 그린다. 지금 어두우면 해를 보여 준다 - 누르면 밝아진다는 뜻이다.
  toLight: Sun,
  toDark: Moon,
  /** 포트폴리오 문항을 고치고 옮기고 더한다. 문항은 마음대로 고친다 (mlpx-spec.md §8.3). */
  editSection: Pencil,
  moveUp: ChevronUp,
  moveDown: ChevronDown,
  addSection: Plus,
  remove: Trash2,
  dismiss: X,
} as const satisfies Record<string, LucideIcon>
