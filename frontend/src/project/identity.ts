/**
 * 프로젝트 이름과 인적사항을 고친다. **순수 함수다** — 저장은 부르는 쪽이 한다.
 *
 * 학번과 이름은 **선택 입력이다**(mlpx-spec.md §6.2). 필수로 만들지 않는 이유는
 * 서버가 학생의 인적사항을 받지 않는다는 원칙(CLAUDE.md §1.1)과 같은 방향이고,
 * 대신 **적으면 파일 이름 앞에 붙어** 학생이 저장할 때 스스로 알아채고 교사는
 * 수거 폴더만 봐도 누구 것인지 안다.
 */

import type { Manifest, ProjectDocument } from './schema'

/** 폼이 들고 다니는 값. 화면에서는 빈 문자열이 "안 적음"이다. */
export interface Identity {
  readonly name: string
  readonly studentId: string
  readonly studentName: string
}

export function identityOf(manifest: Manifest): Identity {
  const student = manifest.student
  return {
    name: manifest.name,
    studentId: typeof student?.studentId === 'string' ? student.studentId : '',
    studentName: typeof student?.name === 'string' ? student.name : '',
  }
}

/**
 * 고친 값을 문서에 담는다.
 *
 * **빈 칸은 저장하지 않고 지운다.** 빈 문자열을 넣어 두면 "안 적음"과 "빈칸을 적음"이
 * 파일 안에서 같아 보이고, 파일 이름을 만들 때도 걸러야 할 것이 하나 늘어난다.
 *
 * **이름이 비면 옛 이름을 지킨다.** 프로젝트에 이름이 없는 상태를 만들지 않는다 —
 * 그 파일은 저장할 때 이름을 잃는다(`projectFileName`).
 */
export function withIdentity(
  document: ProjectDocument,
  identity: Identity,
  now: string,
): ProjectDocument {
  const name = identity.name.trim()
  const studentId = identity.studentId.trim()
  const studentName = identity.studentName.trim()

  const student = {
    ...(studentId === '' ? {} : { studentId }),
    ...(studentName === '' ? {} : { name: studentName }),
  }

  return {
    ...document,
    manifest: {
      ...document.manifest,
      name: name === '' ? document.manifest.name : name,
      updatedAt: now,
      // 둘 다 비었으면 student 자체를 두지 않는다.
      ...(Object.keys(student).length === 0 ? { student: undefined } : { student }),
    },
  }
}
