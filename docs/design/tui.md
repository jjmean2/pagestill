# 대화형 화면(TUI) 개선 설계 (초안)

> 상태: **구현됨** (화면 구성은 [tui-ia.md](tui-ia.md)). v0.4 화면을 진단하고, 널리 쓰이는 TUI 도구와 CLI 가이드라인을 참고해 목표 화면을 설계했다.
> 화면 구성(영역·배치·페이지)은 [tui-ia.md](tui-ia.md)에서 구체화했고, 이 문서의 §5와 §9 "가로선" 결정은 그쪽이 대체한다.
> 결정이 필요한 부분은 `[결정 Un]`으로 표시했다.

## 1. 목표

1. **처음 본 사람이 화면만 보고** 지금 무엇이 찍힐지, 어떤 키로 무엇을 바꾸는지 안다.
2. **지금 상태가 한눈에** 보인다: 어느 탭인지, 브라우저에 무엇을 적용 중인지, 녹화·자동 캡처 중인지, 작업이 진행 중인지.
3. **결과를 바로 확인**할 수 있다: 방금 찍은 파일이 어디 있는지, 실패했다면 왜인지와 다음에 할 일.
4. 화면을 옮겨도 **같은 키는 같은 뜻**이다.

## 2. 참고한 표준

| 출처 | 가져온 규칙 |
|---|---|
| [Command Line Interface Guidelines](https://clig.dev/) | 100ms 안에 반응하고 오래 걸리면 진행 표시. 상태가 바뀌면 알린다. 오류는 사람이 읽을 수 있게 고쳐 쓰고 다음 할 일을 알려준다. 색은 의도를 담아 아껴 쓰고 `NO_COLOR`를 지킨다. Ctrl+C로 언제든 빠져나갈 수 있어야 한다. 위험한 동작은 확인을 받는다 |
| [Bubbles(Charm)의 help·key 컴포넌트](https://github.com/charmbracelet/bubbles) | 키 정의에서 도움말을 자동으로 만든다. 한 줄 요약 도움말과 여러 줄 전체 도움말을 나누고, 화면이 좁으면 자른다. 화살표와 vim 키(`↑/k`)를 같이 쓴다 |
| [lazygit 키 바인딩](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md) | 전역 키(`?` 도움말, `q` 종료, Esc 취소, Enter 확인, `/` 검색)와 화면별 키를 나눈다. 하단 키 안내는 지금 포커스된 화면에 맞춰 바뀐다 |
| [k9s 명령](https://k9scli.io/topics/commands/) | `/` 필터, `?` 도움말, Esc로 한 단계 뒤로 |
| TUI 디자인 가이드 모음 ([예 1](https://tessl.io/registry/skills/github/administrakt0r/pro-skills-repo-administraktor/tui-design), [예 2](https://claudskills.com/skills/tui-design-system/SKILL.md), [Petitboot ncurses 가이드](https://git.raptorcs.com/git/talos-petitboot/tree/ui/ncurses/ui-guidelines.text)) | 하단 안내는 꼭 필요한 3~5개만 두고 나머지는 `?`로. 모달은 포커스를 가둔다. 터미널이 너무 작으면 "너무 작음" 안내를 띄운다. 텍스트 입력 중에는 글자 키가 단축키로 동작하면 안 된다. Ctrl+C·Ctrl+Z는 터미널 몫이라 단축키로 쓰지 않는다 |

## 3. 지금 화면 진단

```
pagestill 0.4.0 · Chrome (attached) · following the tab in front                    ? help
────────────────────────────────────────────────────────────────────────────────
A
http://localhost:53519/site/a
────────────────────────────────────────────────────────────────────────────────
SAVE      o image + HTML                                      MODES   r Record off
EMULATE   v 1440×900   d as-is   m light                              u Auto off
PREPARE   w 0ms   x none   l lazy load off
IMAGE     a full page   f png
no preset
────────────────────────────────────────────────────────────────────────────────
RECENT → pagestill-out/shots/
  nothing yet
────────────────────────────────────────────────────────────────────────────────

  ⏎ capture   t tab   r record   u auto   e settings   p presets   g folder   q quit
```

| # | 문제 | 왜 문제인가 |
|---|---|---|
| P1 | 설정 줄에 **항목 이름이 없다** (`v 1440×900  d as-is  m light`) | `d`가 DPR인지, `m`이 테마인지 외워야 한다 |
| P2 | **브라우저에 적용 중인 에뮬레이션**이 따로 보이지 않는다 | viewport·DPR·테마는 바로 탭에 적용된다. 브라우저가 왜 좁아졌는지 화면에 설명이 없다 |
| P3 | Record·Auto 상태가 오른쪽 구석의 작은 글자 | 녹화 중이라는 사실은 화면에서 가장 눈에 띄어야 한다 |
| P4 | 진행·알림·오류가 **한 줄을 같이 쓴다** | 오류가 다음 키 입력에 지워진다. 진행 중 표시(`● Capturing image…`)가 움직이지 않아 멈춘 것처럼 보인다 |
| P5 | 하위 화면(설정·탭·프리셋)에 들어가도 **어디인지 표시가 없다** | 화면 중간만 바뀌고 제목·하단 안내는 그대로다 |
| P6 | 하단 키 안내가 **화면과 상관없이 같고 8개나 된다** | 정작 그 화면에서 쓸 수 있는 키는 안 보인다 |
| P7 | RECENT가 파일 이름만 보여주고 **열 수 없다** | 찍힌 결과를 확인하려면 Finder로 가야 한다 |
| P8 | 설정 화면에 **선택한 항목의 설명이 없다** | `Remove unused CSS`가 무슨 뜻인지, CLI 플래그가 뭔지 알 수 없다 |
| P9 | 기본값에서 **무엇을 바꿨는지** 표시가 없다 | 프리셋 옆 "(changed)"만으로는 어떤 값이 바뀌었는지 모른다 |
| P10 | 좁은 터미널에서 줄이 잘리고 열이 무너진다 | 80칸 미만이면 설정 줄 끝이 사라진다 |
| P11 | 녹화한 페이지를 저장하지 않은 채 `q`를 누르면 **그대로 사라진다** | 되돌릴 수 없는 동작인데 확인이 없다 |
| P12 | Chrome 연결이 끊기면 **화면이 그냥 닫힌다** | 무엇이 끊겼는지, 다시 붙을 방법이 안내되지 않는다 |
| P13 | `NO_COLOR`를 지키지 않고, 일부 상태는 **색으로만** 구분한다 | 단색 터미널이나 색약 사용자에게 상태가 안 보인다 |

## 4. 설계 원칙

1. **영역은 고정, 내용만 바뀐다.** 위에서부터 *제목 줄 → 대상(탭) → 본문 → 활동 → 상태 줄 → 키 안내*. 어떤 화면이든 같은 자리에 같은 종류의 정보가 있다.
2. **이름과 키를 같이 쓴다.** `Viewport [v] 1440×900`. 키만 쓰지 않는다 (P1).
3. **브라우저에 영향을 주는 것은 따로 보여준다.** 에뮬레이션 중이면 대상 영역에 `Chrome shows 390×844 mobile · 3x · dark`를 노란색으로 (P2).
4. **모드는 배지로.** 녹화·자동 캡처 중에는 제목 줄 오른쪽에 `● REC 3`, `◉ AUTO` 배지 (P3).
5. **진행·결과·오류의 자리를 나눈다.** 진행 중이면 스피너와 단계, 끝나면 결과 요약, 오류는 사용자가 키를 누를 때까지 남는다 (P4).
6. **하단 안내는 그 화면의 핵심 키 3~6개만.** 나머지는 `?` (P6). 안내는 키 정의에서 만들어 실제 동작과 어긋나지 않게 한다.
7. **색은 의미가 있을 때만, 그리고 기호와 함께.** 성공 `✓`, 확인 필요 `?`, 실패 `✗`, 진행 `⠋`, 녹화 `●`. 색이 없어도 기호로 구분된다 (P13).
8. **되돌릴 수 없는 동작은 묻는다.** 저장 안 한 녹화가 있을 때 종료하거나 프리셋을 지울 때 (P11).

## 5. 메인 화면

### 5.1 기본 (100칸)

```
 pagestill 0.5.0 · Chrome: pagestill (port 9222)                         ? help  q quit
 ──────────────────────────────────────────────────────────────────────────────────────
 Users – Acme Admin                                                      [following]
 https://admin.acme.com/users?page=2
 Chrome shows 390×844 mobile · 3x · dark                       (applied live · R reset)
 ── Capture settings ───────────────────────────────── preset: mobile-dark (2 changed)
  Save      [o] image + HTML              Delay     [w] 500ms •
  Viewport  [v] 390×844 mobile            Hide      [x] .cookie-banner •
  DPR       [d] 3x                        Lazy load [l] off
  Theme     [m] dark                      Area      [a] full page
                                          Format    [f] png
 ── Recent  pagestill-out/shots/ ──────────────────────────────────────────────────────
  ✓ 14:20:11  users.png 2880×9970 3.1MB · users.html 841KB
  ✓ 14:18:02  dashboard.png 1170×2532 1.2MB
 ──────────────────────────────────────────────────────────────────────────────────────
 ✓ Saved users.png + users.html in 2.0s
 ⏎ capture   e settings   t tab   p presets   r record   u auto   g folder
```

- **제목 줄**: 앱 이름, 버전, 연결 상태. 오른쪽에는 늘 `? help  q quit`. 녹화·자동 캡처 중이면 그 사이에 배지가 붙는다.
- **대상**: 페이지 제목과 URL. 오른쪽에 `[following]`(앞에 있는 탭 따라가기) 또는 `[pinned]`. 에뮬레이션 중일 때만 세 번째 줄이 나타난다.
- **설정 패널**: 두 열로 `이름 [키] 값`. 기본값과 다른 값에는 `•`. 패널 제목 오른쪽에 프리셋 이름과 바뀐 개수 (P9).
  - 그룹 이름(SAVE/EMULATE…)은 메인 화면에서 빼고 `e` 화면에서만 쓴다. 메인 화면에는 자주 쓰는 9개만 나오므로 그룹 머리글보다 항목 이름이 더 도움이 된다.
- **Recent**: 최근 5개. 시각을 함께 보여주고, 폴더 경로는 패널 제목에 둔다.
- **상태 줄**: 아래 §6 참고.
- **키 안내**: 이 화면의 핵심 키 7개. 80칸을 넘지 않는다.

### 5.2 상태별 모습

**찍는 중** (스피너 + 단계 + 경과 시간; 다른 키는 받지 않고 Esc는 취소)
```
 ⠹ Capturing… HTML snapshot (1/2) · 1.4s                                   esc cancel
```

**녹화 중** (제목 줄에 배지, Recent 자리에 녹화 목록)
```
 pagestill 0.5.0 · Chrome: pagestill (port 9222)          ● REC 3   ◉ AUTO   ? help  q quit
 ...
 ── Recording → pagestill-out/lists/ (r to stop and save) ─────────────────────────────
  1  /dashboard                Dashboard – Acme Admin
  2  /users?page=2             Users – Acme Admin
  3  /settings/billing         Billing · reached in-page
```

**오류** (빨간 `✗` + 원인 + 다음 할 일, 아무 키나 누를 때까지 남음)
```
 ✗ No visible element matches "#chart". Press A to pick another element, or a to capture the full page.
```

**연결 끊김** (닫히지 않고 다시 연결을 제안, P12)
```
 ── Chrome disconnected ───────────────────────────────────────────────────────────────
  The pagestill Chrome closed or stopped answering on port 9222.
  ⏎ reconnect (starts Chrome if needed)   q quit
```

**터미널이 너무 작음** (60×16 미만)
```
 pagestill needs at least 60×16 (now 52×12). Make the window larger.
```

### 5.3 좁은 화면 (60~89칸)

설정 패널은 한 열로 바뀌고, Recent는 1개만 보여준다. 키 안내는 `⏎ capture  e settings  ? more`처럼 줄인다.

```
 pagestill · Chrome: pagestill            ● REC 3  ? help
 ──────────────────────────────────────────────────────
 Users – Acme Admin                         [following]
 https://admin.acme.com/users?page=2
 ── Capture settings ─────────── preset: mobile-dark (2)
  Save      [o] image + HTML
  Viewport  [v] 390×844 mobile
  ...
```

## 6. 피드백 규칙 (상태 줄)

| 종류 | 표시 | 언제 사라지나 |
|---|---|---|
| 진행 | `⠹` 스피너 + 단계 + 경과 시간 | 끝나면 결과로 바뀐다 |
| 완료 | `✓` 초록 + 무엇을 어디에 저장했는지 | 5초 뒤 또는 다음 동작 |
| 안내 | 기호 없이 흐린 글자 (예: "Theme has fixed choices: press m") | 3초 뒤 또는 다음 키 |
| 확인 필요 | `?` 노랑 (예: 캡처는 됐지만 경고가 있음) | 다음 키 |
| 오류 | `✗` 빨강 + 원인 + 다음 할 일 | **다음 키를 누를 때까지** |

- 브라우저 쪽에도 지금처럼 캡처 후 토스트와 터미널 벨을 유지한다.
- 오류 메시지는 내부 용어(CDP, Target closed 등)를 사람이 이해할 말로 바꾼다. 원문은 `~/.pagestill/last-error.log`에 남긴다.

## 7. 하위 화면

모든 하위 화면은 본문 영역을 차지하고, 패널 제목에 화면 이름이 나온다. Esc는 늘 한 단계 뒤로 간다. 하단 키 안내는 그 화면의 키로 바뀐다 (P5, P6).

### 7.1 설정 (`e`)

```
 ── Settings ──────────────────────────────────────────── / filter   12 of 25 changed
  Emulate
    Viewport            390×844 mobile •    [v V]
  ▸ DPR                 3x •                [d D]
    Theme               dark •              [m]
    Reduced motion      off
  Prepare
    Delay               500ms •             [w W]
    ...
 ──────────────────────────────────────────────────────────────────────────────────────
  Device pixel ratio, e.g. 2.  Flag: --dpr 3   YAML: dpr: 3   Default: as-is
 ↑↓ move   ←→ change   ⏎ type a value   / filter   esc back
```

- 아래 **설명 줄**: 선택한 설정의 설명, CLI 플래그, YAML 키, 기본값 (P8). 화면에서 바꾼 값을 CLI나 목록 파일로 옮기기 쉬워진다.
- **`/` 필터**: 이름으로 걸러 낸다 (예: `/html`).
- **`•` 표시**와 패널 제목의 "N of 25 changed".
- 선택 표시는 반전 색과 함께 `▸` 기호도 쓴다 (색이 없어도 보이게).

### 7.2 탭 (`t`)

```
 ── Tabs ─────────────────────────────────────────────────────────────── / filter
  ▸ 1 ★ Users – Acme Admin            admin.acme.com/users?page=2
    2   Billing – Acme Admin          admin.acme.com/settings/billing
    3   Grafana                       grafana.acme.com/d/overview
 ⏎ pin   1-9 jump   a follow the tab in front   esc back
```

- 번호와 숫자 키로 바로 이동하고, `/`로 필터한다. 제목과 주소를 한 줄에 두 열로 보여준다.

### 7.3 프리셋 (`p`)

```
 ── Presets ───────────────────────────────────────────────────────────────────────────
  ▸ mobile-dark      viewport 390×844 mobile · dpr 3x · theme dark
    retina           dpr 2x
 ──────────────────────────────────────────────────────────────────────────────────────
  Loading mobile-dark changes: Viewport 1440×900 → 390×844 mobile, Theme as-is → dark
 ⏎ load   n save current as…   d delete   esc back
```

- 아래 줄에 **불러오면 무엇이 바뀌는지** 미리 보여준다.
- 삭제는 확인 모달을 띄운다 (§7.5).

### 7.4 도움말 (`?`)

`pagestill help keys`와 같은 내용을 본문에 띄운다. 키 정의에서 자동으로 만들어 실제 동작과 어긋날 수 없게 한다. 길면 스크롤하고, 아무 키나 누르면 닫힌다.

### 7.5 입력·확인 모달

```
 ── DPR ───────────────────────────────────────────────────────────────────────────────
  3_
  e.g. 2 or 1.5, or as-is
  ✗ Invalid DPR "abc" (use e.g. 2, 1.5 or as-is)
 ⏎ ok   esc cancel   ctrl+u clear
```

- 잘못된 값이면 **입력창 안에** 오류를 보여주고 창을 닫지 않는다. 지금은 상태 줄로 나가고 입력이 사라진다.
- 확인 모달: `Quit with 3 recorded pages not saved?  s save   q quit anyway   esc stay`.
- 모달이 떠 있는 동안 뒤 화면은 키를 받지 않는다.

## 8. 키맵

**전역 (모든 화면 공통, 텍스트 입력 중은 제외)**

| 키 | 동작 | 비고 |
|---|---|---|
| `?` | 도움말 | |
| `q` | 종료 (저장 안 한 녹화가 있으면 확인) | 하위 화면에서는 `q`도 Esc처럼 뒤로 |
| Ctrl+C | 즉시 종료 | 터미널 관례, 바꾸지 않는다 |
| Esc | 취소 / 한 단계 뒤로 | |
| ↑↓ / `j` `k`, ←→ / `h` `l`, ⏎ | 이동, 값 바꾸기, 선택 | |
| `/` | 목록 필터 | 설정·탭 화면 |

**메인 화면**: 지금 키를 유지한다. 바꾸는 것만 적는다.

| 키 | 지금 | 제안 |
|---|---|---|
| `R` | 세션 초기화 | 그대로 두고, 에뮬레이션 줄의 안내에서도 노출 |
| Tab | 없음 | 포커스를 Recent로 옮긴다 → ⏎ 파일 열기, `f` Finder에서 보기 (`[결정 U3]`) |
| ⏎ (Recent 포커스) | 없음 | 선택한 캡처 열기 |

## 9. 색과 기호

| 의미 | 색 | 기호 |
|---|---|---|
| 성공 | 초록 | `✓` |
| 확인 필요·경고·에뮬레이션 중 | 노랑 | `?` / `!` |
| 오류·녹화 중 | 빨강 | `✗` / `●` |
| 키 | 청록 | `[v]` |
| 보조 정보 | 흐리게 | |
| 선택 | 반전 | `▸` |

- `NO_COLOR`가 설정되어 있거나 `TERM=dumb`이면 색을 끈다. Ink가 쓰는 chalk는 `FORCE_COLOR`만 확인하므로, 시작할 때 `NO_COLOR`가 있으면 `FORCE_COLOR=0`을 설정한다.
- 상자 테두리 대신 **제목이 들어간 가로선**(`── Capture settings ───`)으로 영역을 나눈다. Ink의 Box는 테두리 안에 제목을 넣을 수 없고, 좁은 화면에서 테두리가 깨지기 쉽다.

## 10. 구현 메모

- **화면 틀 컴포넌트**: `Screen`(제목 줄 + 대상 + 본문 + 상태 줄 + 키 안내)과 `Section`(제목 가로선 + 내용). 하위 화면은 본문과 키 안내만 바꾼다.
- **키 정의를 하나로**: `{ keys, label, when }` 목록에서 입력 처리, 하단 안내, `?` 도움말을 모두 만든다. Bubbles의 key/help 방식이다.
- **스피너**: Ink 8의 `useAnimation`.
- **반응형**: `useWindowSize`로 90칸 이상 두 열, 60~89칸 한 열, 60×16 미만은 안내만 표시.
- **상태 줄**: `{ kind, text, until }` 하나를 상태로 두고, 종류별 타이머로 지운다.
- **연결 끊김**: `disconnected` 이벤트에서 종료하지 않고 끊김 화면으로 바꾼다. ⏎를 누르면 `BrowserSession.connect`를 다시 시도한다.
- **테스트**: 지금처럼 가상 터미널로 화면을 찍어 비교하고, 80칸과 60칸 두 크기를 기본으로 본다.

## 11. 결정이 필요한 것

| ID | 질문 | 제안 |
|---|---|---|
| U1 | 메인 화면에서 그룹 이름(SAVE/EMULATE…)을 빼고 항목 이름만 둘까? | 뺀다. 9개뿐이라 항목 이름이 더 도움이 된다. 그룹은 `e` 화면에 남긴다 |
| U2 | 기본값과 다른 값에 `•`를 붙일까? 기준을 "내장 기본값"으로 할까, "config defaults + preset"으로 할까? | 붙인다. 기준은 config defaults + preset + 플래그(= `R`이 돌아가는 값). "R을 누르면 바뀌는 것"과 일치한다 |
| U3 | Tab으로 Recent에 포커스를 옮겨 파일을 열게 할까? | 2단계로 미룬다. 1단계는 상태 줄에 "⏎ again · g open folder" 안내만 |
| U4 | 연결이 끊겨도 화면을 유지하고 다시 연결하게 할까? | 한다. 지금은 녹화 중인 목록까지 사라진다 |
| U5 | 저장 안 한 녹화가 있을 때 종료 확인을 할까? | 한다 (Ctrl+C는 확인 없이 즉시 종료) |
| U6 | 최소 크기를 60×16으로 할까? | 그렇게 한다. 지금 화면에 필요한 줄 수 기준 |

## 12. 단계

1. **화면 틀과 정보 구조**: 영역 구성, 이름+키 표시, 에뮬레이션 줄, 모드 배지, 상태 줄 규칙, 문맥별 키 안내, `NO_COLOR` (P1~P6, P13)
2. **설정·탭·프리셋 화면**: 설명 줄, `/` 필터, `•` 표시, 프리셋 미리보기, 모달 안 오류 표시 (P8, P9)
3. **안전과 복구**: 종료 확인, 연결 끊김 화면, 최소 크기 안내, 좁은 화면 배치 (P10~P12)
4. (선택) Recent 포커스와 파일 열기 (U3)
