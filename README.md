# CTS Signal Analysis

SPE 파일 선택 → ((SPE 1 − SPE 2) + (SPE 3 − SPE 4)) / 2 → Y 구간 평균 → Sn-119 Thomson 피팅을 한 페이지에서 수행합니다. 첨부 스케치의 두 패널 구성을 반영했습니다. 서버로 실험 파일을 전송하지 않고 Web Worker의 Pyodide에서 **실제 PlasmaPy + lmfit Python**을 실행합니다. `fitting.txt`는 외부 함수가 빠진 별도 JS 모델이므로 실행 경로로 사용하지 않고, 제공된 Python을 기준으로 통합했습니다. 원본 첨부 코드는 `reference/`에 보관했습니다.

## 실행과 GitHub Pages

```sh
cd /workspace/CTS_Signal_Analysis
python -m http.server 8000 --bind 127.0.0.1
```

브라우저에서 HTTP로 열어야 합니다 (`file://` 직접 열기는 Worker/모듈 로딩 불가). GitHub에서 사용하려면 파일들을 저장소 `main`에 올린 뒤 **Settings → Pages → Source: GitHub Actions**를 선택하세요. 포함된 `.github/workflows/pages.yml`이 정적 파일을 배포합니다. Pages 설정 후 **Actions → Deploy CTS to GitHub Pages → Run workflow**를 실행하세요. 이후 main에 push하면 자동 배포됩니다. 코드 작성만으로 GitHub 업로드나 배포가 실행되지는 않습니다.

첫 분석은 Python 런타임과 패키지를 내려받아 시간이 걸립니다. `cdn.jsdelivr.net`, `pypi.org`, `files.pythonhosted.org`에 HTTPS 접근이 필요합니다. 런타임 Pyodide 0.27.7, PlasmaPy 2025.8.0, lmfit 1.3.4, xarray 2025.1.2를 지정했습니다. 이후 브라우저 캐시를 활용하나 오프라인 동작을 보장하지 않습니다. 계산은 느릴 수 있으며 중단 버튼은 Worker를 종료합니다.

## 사용 순서

1. Rayleigh 쪽 SPE **4개**를 선택합니다: **1=Rayleigh A, 2=Background A, 3=Rayleigh B, 4=Background B**. 각 파일의 프레임을 고른 뒤 `차감·평균 적용`을 누릅니다. 각 파일의 선택 프레임을 먼저 평균하고, 최종 R을 **`((1 − 2) + (3 − 4)) / 2`**로 계산합니다. 네 파일은 필수이며 이미지 크기가 같아야 합니다. 두 차감 결과는 프레임 개수와 무관하게 동일한 가중치 1/2로 평균합니다. 이 최종 R 하나를 미리보기, 픽셀 값, R.txt, Python 피팅에 공통으로 사용합니다.
2. Thomson SPE와 분석할 프레임을 선택합니다. 이 프레임들도 평균합니다. Thomson의 별도 SPE 배경은 스케치에 없으므로 Python의 선형 배경 추정을 유지합니다.
3. Y from/to/step을 지정합니다. 좌표는 **0부터 시작, from 포함/to 제외**입니다. step은 건너뛰기가 아니라 연속 Y 행을 평균할 크기입니다. 마지막 구간은 남은 행만 평균합니다. 예: Y 10→15, step 2는 `[10,12)`, `[12,14)`, `[14,15)`의 3개 스펙트럼입니다. X는 항상 `[0,1024)` 전체입니다. R/T의 높이가 달라도 지정 Y 범위가 양쪽에 존재하면 됩니다.
4. Notch X from/to는 양쪽 끝 포함이며 피팅에서 제외합니다. 에너지 단위는 mJ, shot 수는 양의 정수입니다. 선택 프레임 수와 shot 수는 독립된 값입니다. shot 수를 프레임 수로 자동 변경하지 않습니다.
5. `분석 실행`으로 ne, Te, Ti, Z, 속도, 수렴 여부, 스펙트럼과 피팅 곡선을 확인합니다. 표의 행을 선택하면 해당 구간의 상세 곡선을 표시합니다. CSV의 velocity 단위는 m/s, 화면은 km/s입니다. JSON에는 입력 조건, 파일명, 프레임 번호, Y 범위와 상세 곡선도 포함됩니다.

`R / T 저장`은 기존 Python과 호환되는 평탄한 텍스트를 내보냅니다. 각 Y 구간당 X 1024개 값을 저장하며 반올림하지 않습니다. 브라우저에서 다중 다운로드 허용이 필요할 수 있습니다. 파일/프레임/분석 조건이 바뀌면 기존 결과를 무효화합니다. 밝기는 미리보기만 바꿉니다.

## 데이터 지원 범위

- SPE **2.x, 단일 사각 ROI, 가로 1024 픽셀**. Float32, Int32, Int16, UInt16, UInt32 little-endian.
- SPE 3.x XML/다중 ROI 및 기타 데이터 타입은 오류로 안내합니다. 잘린 파일은 일부 프레임만 분석하지 않고 거부합니다.
- 음수, 실수, 65535를 초과하는 값도 원본 정밀도를 보존합니다. 차감값을 0으로 자르지 않습니다.
- 대용량 파일은 브라우저 메모리 제약을 받습니다. 파일은 브라우저 메모리에 보관하고 피팅 행렬은 Worker에 복사합니다.

## 원본 Python과의 차이 및 과학적 검토 사항

물리 상수, Sn-119 두 전하종 혼합, FLYCHK Z 보간, 135° 기하, 532 nm, 2.266 pm/pixel, Rayleigh/Thomson 적분 구간, differential evolution 피팅을 유지했습니다. **실측 데이터의 타당성 검증은 별도 필요**합니다.

- 단일 Y 구간의 `c[1]` 오류를 수정했습니다. 이때 속도 분포 폭은 0입니다. 여러 구간은 원본처럼 이웃 중심 차이로 폭을 추정합니다 (Y step으로 나누지 않음).
- Notch는 실제 픽셀 기준 마스크로 통일했습니다. 원본의 N1/N2는 512 중심, 파장축은 notch 중점 중심으로 계산되어 서로 다른 영역을 제외하던 문제가 있었습니다.
- 원본처럼 마스크된 배열에 먼저 convolution을 적용하면 notch 양쪽이 붙습니다. 통합본은 1024 균일 격자에서 모델과 convolution을 계산한 후 마스크를 적용합니다. 따라서 원본 결과와 수치가 완전히 같지는 않습니다.
- 최종 곡선은 피팅된 중심을 사용합니다. 속도는 원본의 대칭 중심 `c` 기준을 유지하며 JSON에 두 중심을 모두 기록합니다.
- 원본 Rayleigh 음수 신호의 임의값 100 대체/미정의 `i` 출력을 제거하고 명시적으로 실패합니다. 0 이하 적분, 비유한 값도 거부합니다.
- 온도 반복 최대 20회, 밀도 반복 최대 200회, 피팅 최대 12000 함수 평가입니다. 온도 반복 상한은 `미수렴`으로 표시하고, 밀도/최적화 실패는 오류로 중단합니다. 미수렴 값은 확정된 분석 결과로 사용하지 마세요.
- 원본 주석의 장치폭 4.8 px와 실제 코드 8 px가 다릅니다. **실제 코드의 FWHM 8 px**를 유지했습니다. 원본의 531–533 nm ROI, 200:350/600:750 배경 구간도 유지합니다. 실험 장치에 맞는지 확인해야 합니다.

## 검증

```sh
node --test tests/spe.test.mjs
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
MPLCONFIGDIR=/tmp/cts-mpl .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

SPE 파싱/프레임 평균/배경 차감/Y 구간 테스트와 Python 합성 스펙트럼 회귀 검사를 제공합니다. 합성 검사는 실제 계측 데이터의 검증을 대신하지 않습니다.

브라우저 통합 검사는 개발 의존성과 Playwright/Chromium을 설치한 환경에서, 위 정적 서버를 실행한 뒤 `python tests/browser_smoke.py`로 수행합니다. 이 검사는 합성 SPE 업로드부터 **브라우저의 실제 Python 피팅 완료**까지 실행합니다. `CTS_TEST_URL`로 서버 주소를 바꿀 수 있습니다. HTTPS 프록시를 직접 상속하지 않는 클라우드 브라우저에서는 `CTS_BROWSER_SYSTEM_PROXY=1`로 시스템 인증서 검증을 사용하는 테스트 전용 네트워크 중계를 활성화합니다. 앱 자체에는 이 중계가 필요하지 않습니다. Playwright 패키지는 별도 설치하며 이 환경에서는 `/usr/bin/chromium`을 사용합니다.
