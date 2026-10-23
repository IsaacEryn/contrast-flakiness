# 명도 대비 오탐 실험 하네스

자동 웹 접근성 검사에서 명도 대비(WCAG 1.4.3 / KWCAG 2.2 5.4.3) 판정이 렌더링 조건과
반복 측정에 따라 어떻게 달라지는지 측정하는 연구용 하네스입니다.

국내 공개 웹사이트 54곳을 대상으로 한 명도 대비 오탐 실험의 하네스와 익명 데이터셋을
담고 있으며, 실험의 표 1~3을 이 저장소만으로 재현할 수 있습니다. 검사 엔진과 2-패스
안정성 필터는 [a11ychk](https://github.com/IsaacEryn/a11ychk)에 있습니다.

## 무엇을 측정하나

애니메이션 감속(`prefers-reduced-motion`)과 웹폰트 정책(차단/허용)을 2×2로 조합한
네 조건에서, 같은 페이지를 조건당 여러 번 검사합니다.

| 조건 | reducedMotion | 웹폰트 |
|---|---|---|
| `base` | off | 차단 |
| `rm` | on | 차단 |
| `font` | off | 허용 |
| `rm+font` | on | 허용 |

뷰포트(1280×800), 로케일(ko-KR), image/media 차단은 전 조건에 고정하고 axe-core의
`color-contrast` 규칙만 실행해 조건 외 변인을 통제합니다.

핵심 측정값은 **요소별 발생률**입니다 — 같은 조건에서 k회 검사했을 때 그 요소가 몇 번
보고되었는지. 0 < 발생률 < 1인 요소를 **비결정 위반**이라 부르며, 이것이 이 연구의
주된 관심사입니다.

## 설치

```bash
git clone https://github.com/IsaacEryn/contrast-flakiness.git
cd contrast-flakiness
npm install
npx playwright install chromium
```

Node 22.19 이상이 필요합니다.

## 사용

### 1. 대상 목록 준비

줄당 URL 하나, `#`로 시작하는 줄은 주석입니다.

```
# candidates.txt
https://example.com/
https://example.org/main
```

### 2. 스크리닝 — 표본 선별

로드 시점의 실행 중 애니메이션과 오파시티 전환 요소를 세고, 1.5초 후 다시 재어
"로드 시에만 도는" 페이드인과 상시 애니메이션을 구분합니다.

```bash
node contrast-falsepos.mjs --screen --candidates=candidates.txt
# → exp-out/screening-report.md
```

둘 중 하나라도 관측되면 본 실험 후보입니다.

### 3. 본 실험

```bash
node contrast-falsepos.mjs --candidates=candidates.txt --runs=5
# → exp-out/results.json, exp-out/labeling-report.md
```

`--runs`는 조건당 반복 횟수입니다. 비결정성을 측정하는 것이 목적이므로 **5회 이상**을
권합니다. `--sites=N`으로 앞의 N곳만 쓸 수 있습니다.

### 4. 분석

```bash
node analyze.mjs                    # → exp-out/analysis-summary.md
node analyze.mjs --in=other.json
```

조건별 위반 수, 대조군 대비 증감, 측정 안정성, 그리고 라벨링이 필요한 케이스를
양방향(제어 조건에서 사라진 요소 / 새로 생긴 요소)으로 정리합니다.

### 5. 라벨링

조건 간 차이를 보인 요소가 실제로 위반인지는 **안정 상태**에서 다시 재야 알 수 있습니다.
안정 상태는 애니메이션이 끝나고(감속 미적용) 실제 웹폰트가 적용된 상태로 정의하며,
`document.fonts.ready`와 실행 중 애니메이션 소멸을 기다린 뒤 측정합니다.

```bash
node label-assist.mjs --in=exp-out/results.json   # 1회 측정 기반 제안
node verify-labels.mjs --host=example.com --runs=5  # 사이트별 5회 반복 검증
node verify-summary.mjs                             # 전 사이트 집계
```

`label-assist.mjs`는 제안일 뿐입니다. **안정 상태 측정 자체가 비결정적일 수 있으므로**
`verify-labels.mjs`로 반복 검증하세요. 반복 측정에서 발생률이 0도 1도 아닌 요소는
안정 상태에서조차 라벨을 확정할 수 없으며, 이 하네스는 그것을 **경계**로 분류합니다.

### 6. 익명화 (선택)

산출물에는 사이트별 위반 수가 실명과 함께 들어 있습니다. 공개 데이터셋으로 낼 때
익명 ID로 치환할 수 있습니다.

```bash
node anonymize.mjs --in=exp-out --out=exp-out-anon --mapping=mapping.json --shots
```

공개 전에는 반드시 검사하세요. 호스트명 치환만으로는 부족합니다 — 선택자에 남은 URL
경로나 HTML 스니펫의 한국어 UI 문구로도 사이트가 특정됩니다.

```bash
node check-anonymity.mjs --dir=dataset --mapping=mapping.json
```

매핑은 호스트명 정렬 기준이라 결정적입니다 — 같은 데이터를 다시 익명화해도 같은 ID가
나옵니다. **매핑표는 공개 저장소에 커밋하지 마세요.**

## 알아 둘 한계

**image/media를 차단하고 측정합니다.** 프로덕션 스캐너와 조건을 맞추기 위함이지만,
배경 이미지 위의 텍스트는 axe가 배경색을 확정하지 못해 판정에서 빠질 수 있습니다.
`label-assist.mjs`는 이런 경우를 "판정 보류"로 분류합니다.

**렌더링 조건 실험은 2-패스 안정성 필터를 적용하지 않습니다.** `contrast-falsepos.mjs`는 필터 없는
1차 패스만 측정합니다. 필터와 애니메이션 종료 대기의 효과는 아래 "측정 절차 평가"에서 따로 잽니다.

**렌더링 조건 실험은 조건 순서를 섞지 않았고 회차별 원자료를 남기지 않았습니다.** 사이트마다
base → rm → font → rm+font 순으로 연속 측정했고, 요소별 발생률만 저장했습니다. 측정 절차 평가는
둘 다 고쳤습니다.

**첫 화면만 봅니다.** 로그인 이후 화면이나 하위 페이지는 대상이 아닙니다.

## 산출물

| 파일 | 내용 |
|---|---|
| `screening-report.md` | 표본 선별 근거 (애니메이션·오파시티 측정) |
| `results.json` | 사이트 × 조건 × 요소별 발생률 원자료 |
| `analysis-summary.md` | 조건별 위반 수·비결정 위반 집계 |
| `labeling-report.md` | 조건 간 diff 케이스 체크리스트 |
| `labeling-assist.md` / `.json` | 안정 상태 1회 측정 기반 라벨 제안 |
| `label-verify-<host>.json` | 사이트별 반복 검증 결과 |
| `label-verify-summary.md` | 전 사이트 라벨 확정 집계 |

## 공개 데이터셋 (`dataset/`)

논문 실험의 측정 결과입니다. 사이트는 익명 ID(`site-A`, `site-B`, …)로, 요소는
`el-N`으로 치환했습니다.

```bash
node analyze.mjs --in=dataset/results-combined.json
node verify-summary.mjs --in=dataset   # label-verify-*.json 집계
```

**측정값만 담았습니다.** CSS 선택자·HTML 스니펫·URL 경로는 검색하면 원 사이트를
특정할 수 있어 제거했습니다. 요소 식별자(`el-N`)는 안정적이라 같은 요소가 여러 조건에
등장하는지는 비교할 수 있지만, 그 요소가 원 사이트의 어느 부분인지는 알 수 없습니다.
스크린샷도 화면 자체가 식별 정보라 제외했습니다.

조건별 위반 수, 발생률, 대비값, 라벨 판정은 모두 그대로입니다. 분석 표는 아래
`procedure-analysis.mjs`로 이 저장소만으로 다시 계산할 수 있습니다. 실명 매핑표는 연구자가
비공개로 보관합니다.

## 측정 절차 평가 (2026-10)

렌더링 조건을 바꾸는 대신, 실서비스 검사 엔진([a11ychk](https://github.com/IsaacEryn/a11ychk) `runAxeOnPage`)의
측정 절차를 평가합니다. 엔진을 그대로 번들해 유한 애니메이션 종료 대기와 2-패스 안정성 필터만 켜고 끕니다.

| 조건 | 종료 대기 | 2-패스 필터 |
|---|---|---|
| `P0` | 끔 | 끔 |
| `P1` | 켬 | 끔 |
| `P2` | 끔 | 켬 |
| `P3` | 켬 | 켬 (실서비스) |

렌더링 조건은 실서비스 웹 검사와 같게 고정합니다(웹폰트 허용, 감속 없음, 1280×800, ko-KR,
이미지·미디어 차단). 조건 순서는 사이트·회차마다 고정 시드로 섞고, 회차마다 원자료를 남기며,
axe가 돈 바로 그 순간에 위반 요소마다 화면 노출 정보(보이는지, 가려졌는지, 누적 불투명도)를 기록합니다.

```bash
npm install
node build-core.mjs --a11ychk=<a11ychk 저장소 경로>     # vendor/a11ychk-runaxe.mjs (a8b0c7c 이후)
node procedure-eval.mjs --sites=<사이트 JSON> --out=<원자료 폴더> --runs=10
node procedure-summary.mjs --in=<원자료 폴더>
node anonymize-procedure.mjs --in=<원자료 폴더> --out=dataset/procedure-eval
```

공개 데이터 `dataset/procedure-eval/`은 23곳 × 4조건 × 10회(920회 로드, 2026-10-19 측정)의 익명
원자료입니다. 선택자는 사이트 안에서 고정된 `pe-N`(8월 데이터의 `el-N`과 별개), URL과 HTML 조각은
뺐습니다. 측정 환경은 `dataset/procedure-eval/env.json`에 있습니다(axe-core 4.12.1, Playwright 1.61.1,
Chromium 149.0.7827.55, a11ychk a8b0c7c).

측정해 보니 2-패스 필터가 뺀 노드 대부분은 렌더링 과도 상태가 아니었습니다. 확정 패스에서 같은
위치·크기·색으로 다시 보고됐는데, axe가 동적 DOM에서 같은 요소에 다른 선택자 문자열을 만들어 짝을
못 지은 것입니다. a11ychk는 이후 필터가 선택자 대신 요소 자체를 견주도록 고쳤고(cd4d37f), 같은
23곳 × 4조건 × 10회를 그 엔진으로 다시 쟀습니다. 그 원자료가 `dataset/procedure-eval-fixed/`입니다
(920회 로드, 2026-10-20 측정, 형식은 같고 엔진이 유지한 노드를 `keptSameElement`·`keptHidden`에 따로 담음).

```bash
node procedure-analysis.mjs --august=dataset --procedure=dataset/procedure-eval   # 두 실험의 분석 표 전부
node procedure-analysis.mjs --august=dataset --procedure=dataset/procedure-eval --fixed=dataset/procedure-eval-fixed   # 수정 전후 비교 포함
```

## 선택자 식별 실험 (2026-10)

측정 절차 평가와 같은 23곳, 같은 렌더링 조건(웹폰트 허용, 감속 없음, 1280×800, 이미지·미디어 차단, 유한 애니메이션 종료 대기)에서
검사 엔진 래퍼 없이 axe-core만 주입해 기본 WCAG 2 A·AA 규칙 전체를 한 로드 안에서 500ms 간격으로 두 번 실행합니다.
두 실행 모두 `elementRef`·`ancestry`를 켜고, 첫 실행의 위반 요소를 페이지 안 `WeakMap`에 등록해 두 번째 실행의 요소와
실제 요소로 짝짓습니다. 같은 요소인데 기본 선택자나 위치 경로(`ancestry`)가 달라졌는지를 규칙별·사이트별로 셉니다.

```bash
node selector-identity.mjs --sites=<사이트 JSON> --out=<원자료 폴더> --runs=10
node anonymize-selector.mjs --in=<원자료 폴더> --out=dataset/selector-identity
node selector-analysis.mjs --in=dataset/selector-identity
```

공개 데이터 `dataset/selector-identity/`는 23곳 × 10회(230회 로드, 2026-10-23 측정)의 익명 원자료입니다. 노드마다 규칙,
같은 요소로 짝지어졌는지, 선택자 변화의 종류(같음·순서만·특징 바뀜), 첫 실행 선택자가 두 번째 실행 목록에서 찾아지는지,
위치 경로가 바뀌었는지만 남기고 선택자 문자열과 URL은 뺐습니다. 측정 환경은 `dataset/selector-identity/env.json`에 있습니다.

## 독립 무작위 표본 (2026-10)

측정 절차 평가에 쓰지 않은 사이트로 같은 측정을 되풀이했습니다. 표본틀은 Tranco 목록(2026-10-22 판)의 상위 .kr 도메인
1,000개이고, 앞선 실험에 쓴 사이트를 뺀 뒤 고정 시드(20261023)로 섞어 첫 화면이 열리는 순서대로 30곳을 골랐습니다
(익명 ID `site-R01`~`site-R30`). 엔진 판마다 한 세션씩 P0·P3를 10회 쟀고(수정 전 a8b0c7c, 수정 후 cd4d37f),
같은 30곳에서 선택자 식별 실험도 10회 돌렸습니다.

```bash
node procedure-eval.mjs --sites=<사이트 JSON> --out=<원자료 폴더> --runs=10 --conds=P0,P3 --seed=20261023
node indep-analysis.mjs --before=dataset/indep-before --after=dataset/indep-after
node selector-analysis.mjs --in=dataset/indep-selector-identity
```

공개 데이터는 `dataset/indep-before/`, `dataset/indep-after/`(각 600회 로드), `dataset/indep-selector-identity/`(300회 로드)입니다.
형식은 측정 절차 평가·선택자 식별 실험의 익명본과 같습니다.

## 라이선스

Apache-2.0. a11ychk 검사 엔진(`packages/core`)과 같은 라이선스입니다.
