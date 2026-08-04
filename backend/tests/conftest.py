"""pytest 공용 픽스처와 경로 설정.

임시 디렉터리는 반드시 테스트 종료 시 정리되는지까지 확인한다.

scripts/ 의 CI 검사 스크립트도 여기서 테스트한다. 검사 스크립트는 표준 라이브러리만
쓰지만, 위반을 실제로 잡는지 확인하지 않으면 통과만 하는 장식이 된다.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
