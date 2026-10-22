# 대화형 화면 정보 구조 (초안)

> 상태: **구현됨.** 실제 화면은 README의 "The interactive screen"에 있다. 구현하면서 달라진 점은 §9. [tui.md](tui.md)의 개선 설계에서 화면 구성 부분을 구체화했다.
> 영역을 **제목이 달린 상자**로 나누고, **출력 위치**와 **로그** 영역을 추가했다.
> 이 문서는 tui.md §5(메인 화면)와 §9의 "상자 대신 가로선" 결정을 대체한다.
> 결정은 §7에 정리했다.

## 1. 원칙

1. **영역마다 제목이 달린 상자.** 상자 위 테두리에 영역 이름을 쓰고, 오른쪽 끝에는 그 영역의 요약(상태·개수·관련 키)을 쓴다.
   - 예: `╭─ Capture settings ──── mobile-dark · 2 changed ─╮`
   - Ink의 Box는 테두리 안에 제목을 넣지 못한다. 그래서 위 테두리를 끈 Box(`borderTop={false}`)에 제목 줄을 직접 그려 붙인다.
2. **위치가 고정된다.** 어떤 상태든 같은 정보는 같은 자리에 있다. 영역이 나타나거나 사라질 때도 다른 영역의 순서는 바뀌지 않는다.
3. **위에서 아래로 "무엇을 → 어떻게 → 어디에 → 무슨 일이"**: 대상 탭 → 캡처 설정 → 출력 위치 → 로그.
4. **맨 위·맨 아래 한 줄은 상자 밖.** 맨 위는 앱 상태 줄, 맨 아래는 그 화면의 키 안내다.

## 2. 화면 지도

```
                        ┌──────────────────────────┐
              ┌────────►│ Capture (메인)            │◄────────┐
              │  esc    └──┬───┬───┬───┬───┬───┬───┘  esc     │
              │      e     │ t │ p │ l │ ? │ r │              │
     ┌────────┴──┐ ┌───────▼┐ ┌▼──────┐ ┌▼────┐ ┌▼───┐ ┌▼──────────────┐
     │ Settings  │ │ Tabs   │ │Presets│ │ Log │ │Help│ │ Save recording│
     └───────────┘ └────────┘ └───────┘ └─────┘ └────┘ └───────────────┘
   (e)

  모달 (어느 화면 위에든):  값 입력 · 확인(종료/삭제)
  특수 화면:               Chrome 연결 끊김 · 터미널이 너무 작음
```

- 페이지는 **한 단계 깊이**뿐이다. 메인에서 키로 들어가고 Esc로 돌아온다. 페이지 안에서 다른 페이지로 바로 가지 않는다.
- 맨 위 줄에 지금 페이지 이름이 나온다(`… · Settings`).

## 3. 메인 화면

### 3.1 기본 (100칸)

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Capture                                ? help  q quit 
╭─ Tab ──────────────────────────────────────────────────────────────────────────────── following ─╮
│ Users – Acme Admin                                                                               │
│ https://admin.acme.com/users?page=2                                                              │
│ ! Chrome shows 390×844 mobile · 3x · dark (applied live)                                 R reset │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Capture settings ───────────────── mobile-dark · 2 changed ─╮╭─ Output ─────────────────────────╮
│ Save      [o] image + HTML     Delay   [w] 500ms •           ││ ~/work/pagestill-out/shots/      │
│ Viewport  [v] 390×844 mobile • Hide    [x] .cookie-ba… •     ││ next  …142011_admin-acme-com_    │
│ DPR       [d] 3x •             Area    [a] full page         ││       users.png + .html          │
│ Theme     [m] dark •           Format  [f] png               ││ 12 shots · 38MB         [g] open │
╰──────────────────────────────────────────────────────────────╯╰──────────────────────────────────╯
╭─ Log ────────────────────────────────────────────────────────────────── 24 entries · l full log ─╮
│ 14:18:02 ✓ dashboard.png 1170×2532 1.2MB · .html 640KB                                      1.8s │
│ 14:19:40 → following Users – Acme Admin                                                          │
│ 14:19:41 ! Chrome now shows 390×844 mobile · 3x · dark                                           │
│ 14:20:11 ✓ users.png 2880×9970 3.1MB · users.html 841KB                                     2.0s │
│ 14:20:30 ✗ No visible element matches "#chart" · press A to pick another                         │
│ 14:20:41 ⠹ capturing users · HTML snapshot (1/2)                                            1.4s │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ⏎ capture  e settings  t tab  p presets  r record  u auto  l log  g folder
```

### 3.2 영역별 역할

| 영역 | 역할 | 내용 | 바뀌는 때 | 상호작용 | 비었을 때 |
|---|---|---|---|---|---|
| **앱 상태 줄** (상자 밖, 반전 색) | 지금 어떤 상태인지 | 앱·버전 · Chrome 연결(`●` 연결 / `○` 연결 중 / `✗` 끊김)과 포트 · 현재 페이지 이름 · 모드 배지(`● REC 3`, `◉ AUTO`) · `? help  q quit` | 연결·모드·페이지가 바뀔 때 | 없음 | — |
| **Tab** | **무엇을** 찍는지 | 페이지 제목, URL, 에뮬레이션 중이면 `! Chrome shows …` 줄. 제목 오른쪽은 `following` 또는 `pinned` | 탭 전환, 이동, 제목 변경, 설정 변경 | `t` 탭 선택, `R` 에뮬레이션 해제 | "No tab. Open a page in the pagestill Chrome window." |
| **Capture settings** | **어떻게** 찍는지 | 자주 쓰는 9개(Save·Viewport·DPR·Theme / Delay·Hide·Lazy load·Area·Format)를 `이름 [키] 값` 두 열로. 기본값과 다르면 `•`. 제목 오른쪽은 프리셋과 바뀐 개수 | 설정 변경 | 각 키로 변경, `e` 전체 설정, `p` 프리셋 | — |
| **Output** | **어디에** 저장되는지 | 저장 폴더(홈은 `~`), 다음 파일 이름 미리보기, 이번 세션 개수·용량 | 설정(`out`, `name`) 변경, 탭 이동, 캡처 후 | `g` 폴더 열기 | 폴더가 아직 없으면 "(created on first capture)" |
| **Recording** (녹화 중에만) | 녹화한 페이지 | 번호, 경로, 제목, `reached in-page` 표시. 최근 3개, 나머지는 개수. 제목 오른쪽은 `● N pages · r stop and save` | 페이지 이동 | `r` 멈추고 저장 화면으로 | 녹화 시작 직후: 현재 페이지 1개 |
| **Log** | **무슨 일이** 있었는지 | 시각 · 기호 · 내용 · 오른쪽 끝 소요 시간. 최신이 아래. 진행 중인 작업은 맨 아래 스피너 줄. 제목 오른쪽은 개수와 `l full log` | 모든 사건(§6) | `l` 전체 로그 페이지 | "Nothing yet. Press ⏎ to capture this tab." |
| **키 안내** (상자 밖) | 지금 쓸 수 있는 핵심 키 | 화면별로 다르다. 3~8개, 화면 폭을 넘지 않음 | 화면·모드 변경 | — | — |

### 3.3 녹화 중

Recording 상자가 Output과 Log 사이에 나타나고, 앱 상태 줄에 `● REC 3` 배지가 붙는다. 키 안내는 녹화에 맞게 바뀐다.

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Capture                      ● REC 3   ? help  q quit 
╭─ Tab ──────────────────────────────────────────────────────────────────────────────── following ─╮
│ Users – Acme Admin                                                                               │
│ https://admin.acme.com/users?page=2                                                              │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Capture settings ───────────────── mobile-dark · 2 changed ─╮╭─ Output ─────────────────────────╮
│ Save      [o] image + HTML     Delay   [w] 500ms •           ││ ~/work/pagestill-out/shots/      │
│ Viewport  [v] 390×844 mobile • Hide    [x] .cookie-ba… •     ││ next  …142011_admin-acme-com_    │
│ DPR       [d] 3x •             Area    [a] full page         ││       users.png + .html          │
│ Theme     [m] dark •           Format  [f] png               ││ 12 shots · 38MB         [g] open │
╰──────────────────────────────────────────────────────────────╯╰──────────────────────────────────╯
╭─ Recording ──────────────────────────────────────────────────────── ● 3 pages · r stop and save ─╮
│ 1  /dashboard          Dashboard – Acme Admin                                                    │
│ 2  /users?page=2       Users – Acme Admin                                                        │
│ 3  /settings/billing   Billing · reached in-page                                                 │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Log ────────────────────────────────────────────────────────────────── 24 entries · l full log ─╮
│ 14:20:11 ✓ users.png 2880×9970 3.1MB · users.html 841KB                                     2.0s │
│ 14:20:30 ✗ No visible element matches "#chart" · press A to pick another                         │
│ 14:20:41 ⠹ capturing users · HTML snapshot (1/2)                                            1.4s │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ⏎ capture  r stop and save  u auto  e settings  t tab  l log
```

### 3.4 좁은 화면 (80칸)

설정과 출력이 세로로 쌓이고, Output은 한 줄로 줄어든다.

```
 pagestill · ● :9222 · Capture                                   ? help  q quit 
╭─ Tab ──────────────────────────────────────────────────────────── following ─╮
│ Users – Acme Admin                                                           │
│ https://admin.acme.com/users?page=2                                          │
│ ! Chrome shows 390×844 mobile · 3x · dark (applied live)                     │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Capture settings ───────────────────────────────── mobile-dark · 2 changed ─╮
│ Save      [o] image + HTML      Delay   [w] 500ms •                          │
│ Viewport  [v] 390×844 mobile •  Hide    [x] .cookie-ba… •                    │
│ DPR       [d] 3x •              Area    [a] full page                        │
│ Theme     [m] dark •            Format  [f] png                              │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Output ─────────────────────────────────────────────────────────────────────╮
│ ~/work/pagestill-out/shots/ · next …_admin-acme-com_users.png       [g] open │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Log ─────────────────────────────────────────────────────────── l full log ─╮
│ 14:20:11 ✓ users.png 2880×9970 3.1MB · .html 841KB                      2.0s │
│ 14:20:30 ✗ No visible element matches "#chart" · press A                     │
╰──────────────────────────────────────────────────────────────────────────────╯
 ⏎ capture  e settings  t tab  r record  ? more
```

### 3.5 크기 규칙

| 폭 | 배치 |
|---|---|
| 100칸 이상 | Capture settings와 Output을 나란히 (64 : 나머지) |
| 80~99칸 | 세로로 쌓기. 설정은 두 열, Output은 한 줄 |
| 60~79칸 | 설정을 한 열로, URL·파일 이름은 가운데를 `…`로 줄임 |
| 60×18 미만 | "너무 작음" 안내만 (§7.9) |

| 높이가 부족할 때 줄이는 순서 | |
|---|---|
| 1 | Log를 최소 3줄까지 줄인다 |
| 2 | Recording을 최근 1개 + 개수로 줄인다 |
| 3 | Output을 한 줄로 줄인다 |
| 4 | Tab의 에뮬레이션 줄을 앱 상태 줄 배지(`! 390×844m`)로 옮긴다 |

- Log는 남는 높이를 모두 쓴다(`flexGrow`). 터미널이 클수록 로그가 길어진다.

## 4. 페이지

모든 페이지는 메인 화면의 Tab·설정·출력·로그 자리를 통째로 쓰고, 맨 위 줄과 키 안내만 남긴다.

### 4.1 Settings (`e`) — 모든 설정 25개

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Settings                               ? help  q quit 
╭─ Settings ────────────────────────────────────────────────────────── / filter · 4 of 25 changed ─╮
│ Emulate                                                                                          │
│   Viewport              390×844 mobile •          [v V]                                          │
│ ▸ DPR                   3x •                      [d D]                                          │
│   Theme                 dark •                    [m]                                            │
│   Reduced motion        off                                                                      │
│ Prepare                                                                                          │
│   Delay                 500ms •                   [w W]                                          │
│   Hide                  .cookie-banner •          [x X]                                          │
│   Lazy load             off                                                                      │
│   Freeze animations     on                                                                       │
│   …                                                                                              │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ About DPR ──────────────────────────────────────────────────────────────────────────────────────╮
│ Device pixel ratio: how many image pixels per CSS pixel. 2 = retina-sharp.                       │
│ flag --dpr 3    YAML dpr: 3    default as-is    changed from as-is (your session)                │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ↑↓ move  ←→ change  ⏎ type a value  ⌫ back to default  / filter  esc back
```

- 그룹(Save·Emulate·Prepare·Image·HTML snapshot·Files)으로 묶은 목록이다. 기본값과 다르면 `•`, 메인 화면 키가 있으면 `[v V]`처럼 표시한다.
- 아래 **About 상자**: 선택한 설정의 설명, CLI 플래그, YAML 키, 기본값, 무엇에서 바뀌었는지(config / preset / 플래그 / 이번 세션).
- `/`로 이름 필터, `⌫`로 그 항목만 기본값으로 되돌린다.

### 4.2 Tabs (`t`)

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Tabs                                   ? help  q quit 
╭─ Tabs ─────────────────────────────────────────────────── / filter · following the tab in front ─╮
│ ▸ 1 ★ Users – Acme Admin                                             admin.acme.com/users?page=2 │
│   2   Billing – Acme Admin                                       admin.acme.com/settings/billing │
│   3   Grafana                                                        grafana.acme.com/d/overview │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ⏎ pin this tab  1-9 jump  a follow the tab in front  / filter  esc back
```

- 번호와 숫자 키로 바로 고른다. `★`는 지금 대상인 탭이다. `a`를 누르면 "앞에 있는 탭 따라가기"로 돌아간다.

### 4.3 Presets (`p`)

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Presets                                ? help  q quit 
╭─ Presets ───────────────────────────────────────────────────────────── ~/.pagestill/config.yaml ─╮
│ ▸ mobile-dark                                      viewport 390×844 mobile · dpr 3x · theme dark │
│   retina                                                                                  dpr 2x │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Loading mobile-dark changes ────────────────────────────────────────────────────────────────────╮
│ Viewport  1440×900       →  390×844 mobile                                                       │
│ Theme     as-is          →  dark                                                                 │
│ DPR       3x                (same)                                                               │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ⏎ load  n save current as…  d delete  esc back
```

- 아래 상자에서 **불러오면 바뀌는 값**을 미리 보여준다. 삭제할 때는 확인 모달을 띄운다.

### 4.4 Log (`l`) — 전체 로그

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Log                                    ? help  q quit 
╭─ Log ─────────────────────────────────────────────────── all · captures · problems   24 entries ─╮
│ 14:18:02 ✓ dashboard.png 1170×2532 1.2MB · dashboard.html 640KB                             1.8s │
│          ~/work/pagestill-out/shots/20261023-141802_admin-acme-com_dashboard.png                 │
│ 14:19:40 → following Users – Acme Admin                                                          │
│ 14:19:41 ! Chrome now shows 390×844 mobile · 3x · dark                                           │
│ ▸ 14:20:11 ✓ users.png 2880×9970 3.1MB · users.html 841KB                                   2.0s │
│          ~/work/pagestill-out/shots/20261023-142011_admin-acme-com_users.png                     │
│ 14:20:30 ✗ No visible element matches "#chart"                                                   │
│          Press A to pick another element, or a to capture the full page.                         │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ↑↓ move  ⏎ open file  f show in Finder  tab filter  c copy path  esc back
```

- 이번 세션의 모든 기록을 보여준다. 캡처 항목은 파일 경로까지, 오류는 다음 할 일까지 펼쳐서 보여준다.
- Tab 키로 `all / captures / problems` 필터를 바꾼다.
- 캡처 항목에서 ⏎는 파일 열기, `f`는 Finder에서 보기, `c`는 경로 복사.

### 4.5 Save recording (녹화 중 `r`)

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Save recording                         ? help  q quit 
╭─ Recorded pages ───────────────────────────────────────────────────────────────── 2 of 3 ticked ─╮
│ ▸ [x] /dashboard                                                          Dashboard – Acme Admin │
│   [x] /users?page=2                                                           Users – Acme Admin │
│   [ ] /settings/billing                                                Billing · reached in-page │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Save to ────────────────────────────────────────────────────────────────────────────────────────╮
│ (•) new list   ~/work/pagestill-out/lists/admin-acme-com-20261023-142500.pages.yaml              │
│ ( ) add to     ~/work/pagestill-out/lists/admin-acme-com-20261022-101200.pages.yaml     41 pages │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 space tick  tab switch box  ⏎ save  esc keep recording
```

- 녹화를 멈추면 바로 저장하지 않고 이 화면을 띄운다. 저장할 페이지를 고르고, **새 목록**에 저장할지 **기존 목록에 추가**할지 고른다. 기존 목록은 `lists/`에서 가장 최근 것을 제안한다.
- Esc는 녹화를 이어가는 상태로 돌아간다. 녹화 내용은 잃지 않는다.

### 4.6 Help (`?`)

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Help                                   ? help  q quit 
╭─ Capture screen ───────────────────────────────╮╭─ Settings on screen ───────────────────────────╮
│ ⏎      capture now                             ││ o      what to save                            │
│ t      choose tab                              ││ v V    viewport                                │
│ r      record pages                            ││ d D    DPR                                     │
│ u      auto-capture                            ││ m      theme                                   │
│ e      all settings                            ││ w W    delay                                   │
│ p      presets                                 ││ x X    hide elements                           │
│ l      log                                     ││ a A    area / element                          │
│ g      open folder                             ││ f F    format / quality                        │
│ R      reset settings                          │╰────────────────────────────────────────────────╯
╭─ Everywhere ─────────────────────────────────────────────────────────────────────────────────────╮
│ ↑↓ j k move   ←→ h l change   ⏎ select   esc back   / filter   ? help   q quit                   │
│ In the browser: Alt+Shift+S captures the tab you're on.                                          │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 any key to go back
```

- 키 정의에서 자동으로 만든다. 메인 화면, 설정 키, 공통 키, 브라우저 단축키를 나눠 보여준다.

### 4.7 Chrome 연결 끊김

```
 pagestill 0.5.0 · Chrome ✗ disconnected                                                     q quit 
╭─ Chrome ─────────────────────────────────────────────────────────────────────────────────────────╮
│ The pagestill Chrome closed or stopped answering on port 9222.                                   │
│                                                                                                  │
│ ⏎  reconnect (starts Chrome if it isn't running)                                                 │
│ q  quit                                                                                          │
│                                                                                                  │
│ Your settings and 3 recorded pages are kept until you quit.                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ⏎ reconnect  q quit
```

- 지금은 화면이 그냥 닫히지만, 이 화면으로 바꾸고 다시 연결할 수 있게 한다. 설정과 녹화 내용은 유지한다.

### 4.8 모달: 값 입력 / 확인

```
 pagestill 0.5.0 · Chrome ● pagestill :9222 · Capture                                ? help  q quit 
╭─ Tab ──────────────────────────────────────────────────────────────────────────────── following ─╮
│ Users – Acme Admin                                                                               │
   ⋮
╭─ Viewport ───────────────────────────────────────────────────────────────────────────────────────╮
│ 390x844m▏                                                                                        │
│ WIDTHxHEIGHT, add m for mobile (390x844m), or as-is                                              │
│ ✗ Invalid viewport "390-844"                                                                     │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 ⏎ ok  esc cancel  ctrl+u clear
```

```
╭─ Quit? ──────────────────────────────────────────────────────╮
│ 3 recorded pages are not saved.                              │
│                                                              │
│ s  save them first     q  quit anyway     esc  stay          │
╰──────────────────────────────────────────────────────────────╯
```

- 모달이 떠 있는 동안 뒤 화면은 키를 받지 않는다.
- 잘못된 값이면 모달 안에 오류를 보여주고 입력을 유지한다.
- 확인 모달은 되돌릴 수 없는 동작에만 쓴다: 저장 안 한 녹화가 있을 때 종료, 프리셋 삭제.

### 4.9 터미널이 너무 작음

```
pagestill needs at least 60×18. This terminal is 52×14.
Make the window larger (or press q to quit).
```

## 5. 페이지와 키 정리

| 화면 | 들어가는 키 | 주요 키 | 나가기 |
|---|---|---|---|
| Capture (메인) | — | ⏎ capture · `o v d m w x a f`(+Shift) 설정 · `t e p l ?` 페이지 · `r` record · `u` auto · `g` folder · `R` reset | `q` (녹화가 남아 있으면 확인) |
| Settings | `e` | ↑↓ ←→ ⏎ `/` `⌫` | Esc |
| Tabs | `t` | ↑↓ ⏎ `1-9` `a` `/` | Esc |
| Presets | `p` | ↑↓ ⏎ `n` `d` | Esc |
| Log | `l` | ↑↓ ⏎ `f` `c` Tab | Esc |
| Save recording | 녹화 중 `r` | space · Tab · ⏎ | Esc (녹화 계속) |
| Help | `?` | — | 아무 키 |
| 연결 끊김 | 자동 | ⏎ 다시 연결 | `q` |

**지금(0.4)과 달라지는 키**
- `l`: Lazy load 토글에서 **Log 페이지**로 바뀐다. Lazy load는 **`L`** 로 옮긴다 (I1).
- `r`(녹화 중): 프롬프트 대신 **Save recording 페이지**를 연다.

## 6. 로그에 남는 것

| 종류 | 기호 · 색 | 예 | 메인 Log 상자에 보임 |
|---|---|---|---|
| 캡처 완료 | `✓` 초록 | `14:20:11 ✓ users.png 2880×9970 3.1MB · users.html 841KB   2.0s` | 보임 |
| 캡처 경고 | `?` 노랑 | `✓` 줄 아래 `  ? lazy content may be missing` | 보임 |
| 캡처 실패 | `✗` 빨강 | `✗ No visible element matches "#chart" · press A to pick another` | 보임 |
| 진행 중 | `⠹` 스피너 | `⠹ capturing users · HTML snapshot (1/2)   1.4s` | 맨 아래, 끝나면 결과 줄로 바뀜 |
| 대상 탭 변경 | `→` 흐리게 | `→ following Users – Acme Admin` | 보임 |
| 브라우저 변경 | `!` 노랑 | `! Chrome now shows 390×844 mobile · 3x · dark` | 보임 |
| 녹화·자동 캡처 | `●` / `◉` | `● recording started` · `● saved 3 pages to lists/…` | 보임 |
| 연결 | `●` / `✗` | `✗ Chrome disconnected` | 보임 |
| 설정 변경 | `·` 흐리게 | `· theme → dark` | **안 보임** (전체 로그에서만) |
| 안내 | — | "Theme has fixed choices: press m" | 로그에 남기지 않고 키 안내 줄에 3초 |

- 메모리에 최근 500개를 둔다. 파일로는 남기지 않는다 (I2).
- 같은 종류가 연달아 생기면 묶는다. 예: Auto 중 `→ following` 여러 개는 마지막 것만 남긴다.

## 7. 결정

| ID | 질문 | 결정 |
|---|---|---|
| I1 | `l`을 Log 페이지에 쓸까? | 쓴다. **Lazy load는 `L`** 로 옮기고 메인 설정 상자에 `[L]`로 남긴다. 대문자 키 규칙은 "값 입력, 또는 자주 쓰지 않는 동작"(`R` reset, `L` lazy load)으로 정리한다 |
| I2 | 로그를 파일로도 남길까? | 남기지 않는다. 세션 메모리에만 둔다 |
| I3 | 녹화를 멈추면 Save recording 페이지를 띄울까? | 띄운다 |
| I4 | Output 상자에 다음 파일 이름을 보여줄까? | 보여준다 |
| I5 | 설정과 출력을 나란히 놓는 기준 폭 | 100칸 |
| I6 | 앱 상태 줄을 반전 색 막대로 할까? | 한다. `NO_COLOR`일 때는 굵은 글씨 |

## 8. 구현 메모

- `Panel({ title, right, children })`: 제목 줄(`╭─ title ─…─ right ─╮`)을 직접 그리고, 나머지 세 면은 `borderTop={false}`인 Box로 그린다. 폭은 `useWindowSize`와 부모 레이아웃에서 계산한다.
- 문자 폭: 한글처럼 두 칸을 차지하는 글자가 있으므로, 직접 그리는 줄은 Ink가 쓰는 폭 계산(`string-width`)으로 맞춘다.
- 로그는 `{ time, kind, text, detail?, duration?, file? }` 배열로 관리하고, 메인 Log 상자는 높이에 맞춰 끝부분만 그린다.
- 이 문서의 화면 예시는 정렬을 맞추기 위해 스크립트로 생성했다. 구현한 뒤에는 가상 터미널로 실제 화면을 찍어 이 예시와 비교한다.

## 9. 구현하면서 달라진 점

| 설계 | 구현 | 이유 |
|---|---|---|
| 설정 상자 폭 64 | 66 | `390×844 mobile`이 한 칸에 잘리지 않게 |
| 60~79칸에서는 설정을 한 열로 | 60칸까지 두 열 유지 | 한 열이면 9줄이 필요해 높이가 부족했다. 한 칸 30자로 충분하다 |
| 높이가 부족할 때 줄이는 순서 4단계 | 5단계: 마지막에 Tab의 제목과 URL을 한 줄로 합친다 | 60×18에서 설정 상자의 아래 테두리가 잘렸다 |
| 앱 상태 줄 고정 문구 | 90칸 미만이면 버전과 "Chrome" 글자를 뺀다 | 좁은 화면에서 `? help  q quit`가 밀려 사라졌다 |
| 키 안내 고정 | 들어가는 만큼만 보여주고 나머지는 `? more` | 같은 이유 |
| 프리셋 삭제 확인 모달 | 프리셋 화면 안의 확인 상자 | 그 화면 안에서 끝나는 동작이라 |
| 프리셋 바뀜 표시 "(changed)" | "(edited)" | 제목의 "N changed"와 같은 단어가 겹쳤다 |
| Chrome 연결 끊김 로그 `●` | `✗`(오류) | 문제 상황은 오류 기호로 |

