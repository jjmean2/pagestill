# pagestill 컨셉 가이드 (목표안, v0.4 초안)

> 상태: **초안, 검토용.** 이 문서는 "지금의 동작"이 아니라 "정리한 뒤의 목표"를 적는다.
> 지금과 달라지는 부분은 §8에 모았고, 결정이 필요한 부분은 `[결정 Dn]`으로 표시했다.
> 실제로 화면에 나올 도움말 문구는 [help.md](help.md)에 있다.

## 1. 한 문장

**pagestill은 내가 보고 있는 브라우저 화면을, 보이는 그대로 이미지와 HTML 파일로 남긴다.**
한 장씩 찍을 수도 있고(Shot), 돌아다니며 자동으로 찍을 수도 있고(Auto), 페이지 목록을 만들어 한꺼번에 찍을 수도 있다(Run).

## 2. 다섯 가지 개념

모든 기능은 아래 다섯 개념을 조합한 것이다. 명령, 옵션, 화면 모두 이 이름을 그대로 쓴다.

| 개념 | 한 줄 정의 | 어디에 있나 |
|---|---|---|
| **Browser** | pagestill이 연결해서 화면을 읽는 Chrome | 기본은 pagestill 전용 Chrome (`~/.pagestill/chrome-profile`) |
| **Capture** | 지금 화면을 파일로 남기는 한 번의 동작. 결과는 이미지와 HTML 스냅샷 | `pagestill-out/` |
| **Settings** | 어떻게 찍을지 (viewport, 포맷, 숨길 요소 등). 이름을 붙여 저장한 묶음이 **Preset** | `~/.pagestill/config.yaml` |
| **Page list** | 무엇을 찍을지 (URL과 페이지별 준비 동작). 파일 이름은 `*.pages.yaml` | `pagestill-out/lists/` |
| **Run** | Page list의 모든 페이지를 모든 설정 조합으로 찍는 한 번의 실행. 갤러리 포함 | `pagestill-out/runs/` |

```
            Settings (어떻게)                 Page list (무엇을)
                 │                                  │
   ┌─────────────┼──────────────┐                   │
   ▼             ▼              ▼                   ▼
 Shot          Auto           Record ──────────► list ◄── Crawl
 (지금 한 장)   (이동할 때마다)   (돌아다닌 곳 기록)    │       (링크 따라가며 수집)
   │             │                                  │ edit (고르기)
   ▼             ▼                                  ▼
 shots/        shots/                         Run ──► runs/<run>/ (+ 갤러리)
```

## 3. Browser

pagestill은 URL을 직접 열어서 찍는 도구가 아니다. **사람이 띄워 둔 화면에 붙어서 그 화면을 읽는 도구**다. 그래서 로그인한 화면, 클릭으로만 갈 수 있는 화면, 입력 중인 폼까지 지금 상태 그대로 찍을 수 있다.

| 연결 방식 | 언제 | 방법 |
|---|---|---|
| **전용 Chrome** (기본) | 대부분의 경우 | 그냥 `pagestill`을 실행한다. Chrome이 없으면 띄우고 있으면 붙는다. 로그인 정보는 이 프로필에 계속 남는다 |
| **포트 지정** | 직접 띄운 디버깅용 Chrome에 붙을 때 | `--port 9333` 또는 `--ws <url>` |
| **평소 Chrome** (실험) | 평소 쓰는 Chrome의 탭을 그대로 쓸 때 | `chrome://inspect`에서 원격 디버깅을 켜고 `--auto-connect`. macOS에서는 터미널 앱에 전체 디스크 접근 권한이 필요하다 |

Run과 Crawl은 같은 Chrome 안에 **새 창**을 열어서 작업한다. 쿠키(로그인 상태)는 공유하지만 지금 보고 있는 탭은 건드리지 않는다.

## 4. Capture: 세 가지 찍는 방법

| 방법 | 누가 페이지를 여나 | 언제 쓰나 | 결과 위치 |
|---|---|---|---|
| **Shot** | 사람 | 지금 이 화면 한 장. 클릭으로만 갈 수 있는 상태도 찍힌다 | `shots/` |
| **Auto** | 사람 | 둘러보면서 이동할 때마다 자동으로 | `shots/` |
| **Run** | pagestill | 같은 페이지들을 여러 조건으로 반복해서 | `runs/<run>/` |

- Shot과 Auto는 **지금 화면 상태를 그대로** 찍는다. 대신 같은 화면을 나중에 다시 만들 수는 없다.
- Run은 **URL로 페이지를 다시 열어서** 찍는다. 몇 번이든 반복할 수 있지만, URL만으로 재현되지 않는 상태(모달, 탭 선택 등)는 Page list에 준비 동작(`steps`)을 적어 줘야 한다.
- Run은 결과를 검사한다. 로그인 화면으로 넘어가면 멈추고 사람에게 묻는다. **HTTP 오류, 다른 페이지로 넘어감, 기록할 때와 다른 제목**은 "ok"가 아니라 경고로 표시한다.

## 5. Settings와 Preset

### 5.1 설정이 정해지는 순서: 어디서든 같다

```
기본값  ←  config의 defaults  ←  preset  ←  page list의 settings  ←  페이지별 settings  ←  matrix 조합  ←  명령줄 플래그
(약함)                                                                                                    (강함)
```

- `shot`, `run`, TUI, `crawl --capture`가 **모두 이 순서**를 따른다.
- 같은 명령은 언제나 같은 결과를 낸다. 숨은 상태 때문에 결과가 달라지지 않는다.
- **TUI 세션 상태는 TUI에만 적용된다.** TUI를 다시 열면 지난 세션의 설정을 복원하지만(`[결정 D1]`), `shot`과 `run`에는 영향을 주지 않는다. 계속 쓰고 싶은 설정은 Preset이나 `defaults`로 저장한다.

### 5.2 이름 규칙: 설정 하나에 이름 하나

같은 설정은 CLI, YAML, TUI에서 같은 단어로 부른다.

| 위치 | 형식 | 예 |
|---|---|---|
| YAML (config, page list) | camelCase | `lazyLoad: true` |
| CLI 플래그 | kebab-case | `--lazy-load` |
| TUI 라벨 | 띄어 쓴 단어 | `Lazy load` |

설정은 모두 6개 그룹, 24개다. 전체 목록은 help.md의 `pagestill help settings`에 있다.

| 그룹 | 설정 |
|---|---|
| Save | `image`, `html` |
| Emulate | `viewport`, `dpr`, `theme`, `reducedMotion` |
| Prepare | `delay`, `hide`, `lazyLoad`, `freezeAnimations`, `hideScrollbars` |
| Image | `area`, `element`, `format`, `quality`, `transparent` |
| HTML | `htmlEngine`, `htmlScripts`, `htmlRemoveHidden`, `htmlRemoveUnusedCss`, `htmlFrames`, `htmlMinify`, `htmlAbsoluteLinks`, `htmlMaxResourceMb` |
| Files | `out`, `name` |

**모든 설정을 CLI 플래그로도 지정할 수 있다.** `shot`, `run`, `crawl --capture`, TUI 시작이 모두 같은 플래그 세트를 받는다.

### 5.3 Preset

이름을 붙여 저장한 설정 묶음이다. `--preset mobile-dark`, page list의 `preset:`, TUI의 `p`에서 쓴다. 여러 개를 겹칠 수도 있다: `--preset retina,dark` (`[결정 D2]`).

## 6. Page list (`*.pages.yaml`)

"무엇을 찍을지"를 담은 파일이다. 만드는 방법은 세 가지이고, 어느 방법이든 형식은 같다.

| 만드는 법 | 명령 | 특징 |
|---|---|---|
| **Crawl** | `pagestill crawl [url]` | 링크를 따라가며 자동으로 모은다. `/users/:id` 같은 패턴은 표본만 남기고, 로그아웃·삭제 링크는 피한다 |
| **Record** | TUI에서 `r` | 사람이 돌아다닌 곳을 기록한다. 클릭으로 도달한 화면에는 표시를 남긴다 |
| **직접 작성** | 편집기 | 가장 정밀하다 |

- 저장 위치는 `pagestill-out/lists/<host>-<시각>.pages.yaml`이다.
- 이미 있는 파일 이름으로 Record를 저장하면 **덮어쓰지 않고 뒤에 추가**한다. 이미 있는 URL은 건너뛴다.
- `pagestill edit <list>`로 항목을 켜고 끈다. 주석은 그대로 남는다.
- 크롤링하면서 바로 찍으려면 `pagestill crawl --capture`를 쓴다. 방문하는 페이지마다 바로 찍어서 Run과 같은 결과를 만든다.

가장 단순한 형식:
```yaml
base: https://admin.acme.com/
pages:
  - /dashboard
  - /users
```
전체 형식은 help.md의 `pagestill help lists`에 있다.

## 7. 결과물이 저장되는 곳: 작업 폴더 하나

```
pagestill-out/                ← 작업 폴더 (-o 또는 config의 out으로 변경)
  shots/                      ← Shot, Auto
    20261014-142011_acme-com_users.png
    20261014-142011_acme-com_users.html
  lists/                      ← Crawl, Record
    admin-acme-com-20261014-141500.pages.yaml
  runs/                       ← Run, crawl --capture
    admin-review-20261014-143000/
      index.html              ← 갤러리
      manifest.json
      users/1440x900.dark.png
~/.pagestill/
  config.yaml                 ← defaults, presets, browser
  tui-state.yaml              ← TUI 마지막 세션 (TUI만 읽음)
  chrome-profile/             ← 전용 Chrome의 로그인 정보
```

- **`-o, --out`은 언제나 작업 폴더**를 뜻한다. 명령에 따라 뜻이 바뀌지 않는다 (`[결정 D3]`).
- 작업 폴더는 명령을 실행한 위치 기준이다. 결과를 한곳에 모으고 싶으면 config의 `out`에 절대 경로를 적는다.

## 8. 지금과 달라지는 점

### 8.1 이름 변경

| 지금 | 목표 | 이유 |
|---|---|---|
| job file, `pages-*.yaml` | **page list**, `*.pages.yaml` | 한 개념에 이름이 셋 |
| `hideSelectors` | `hide` | CLI(`--hide`)와 통일 |
| `loadLazy` / `--lazy` / "Lazy-load scroll" | `lazyLoad` / `--lazy-load` / "Lazy load" | 이름 셋을 하나로 |
| `waitMs` / `--wait` | `delay` / `--delay` | page list의 `load:`(로딩 대기)와 구분 |
| `selector` / `--selector` | `element` / `--element` | area 값 `element`와 짝을 맞춤 |
| `omitBackground` | `transparent` | TUI 라벨과 통일 |
| `htmlOptions.*` (중첩) | `html*` (한 단계) | 플래그와 1:1로 대응 |
| `outDir` | `out` | `--out`과 통일 |
| `filename` | `name` | 짧게 |
| TUI "Output" | "Save" | "Output folder"와 혼동 |
| page list `wait:` | `load:` | 설정의 `delay`와 구분 |
| page list `actions:` | `steps:` | 읽기 쉬움 |
| page list `loginPattern:` | `login:` | 짧게 |
| `pagestill open`, `pagestill tabs` | `pagestill browser open`, `pagestill browser tabs` | 브라우저 관리 명령을 한곳에 |

이전 이름은 v0.4에서는 경고를 띄우며 계속 받고, v0.5에서 없앤다 (`[결정 D4]`).

### 8.2 동작 변경

| 지금 | 목표 |
|---|---|
| `shot`이 TUI 마지막 설정을 따라감 | 따라가지 않음 (§5.1) |
| TUI를 끌 때 `-o` 같은 일회성 플래그까지 저장 | 세션 상태만 `tui-state.yaml`에 저장하고, 플래그는 저장하지 않음 |
| `-o`가 명령마다 폴더 / 상위 폴더 / 파일로 제각각 | 언제나 작업 폴더 |
| 설정 24개 중 12개만 CLI 플래그 지원 | 24개 전부 |
| `run`이 캡처 플래그를 받지 않음 | 받음 (page list 설정 위에 덮어씀) |
| Crawl 결과가 실행한 폴더에 생김 | `lists/`에 생김 |
| Record 저장이 기존 파일을 덮어씀 | 뒤에 추가 |
| Record·Auto가 크롤러와 Run이 연 창에도 반응 | 지금 보는 탭에만 반응 |
| Run이 404나 엉뚱한 화면을 "ok"로 기록 | 경고로 표시 (갤러리에도) |
| Shift+키 규칙에 예외 (`O`=폴더 열기, `M`/`F`/`L`=반응 없음) | 예외 없음 (help.md의 TUI 키 참고) |
| 키 도움말 화면 없음 | `?`로 표시 |

## 9. 결정이 필요한 것

| ID | 질문 | 제안 |
|---|---|---|
| D1 | TUI를 다시 열면 지난 세션 설정을 복원할까? | 복원한다. 화면 위에 "restored last session · R to reset"을 표시 |
| D2 | Preset 여러 개를 겹쳐 쓰게 할까? | 한다 (`--preset a,b`, 뒤쪽이 우선). 구현 비용이 작다 |
| D3 | `-o`를 "작업 폴더"로 통일할까? `shot -o shots/`가 그 폴더에 바로 저장되길 기대하는 사람에게는 낯설 수 있다 | 통일한다. 파일이 놓일 정확한 위치는 `--name`(템플릿)으로 정한다 |
| D4 | 이전 이름을 언제까지 받을까? | v0.4에서는 경고와 함께 받고, v0.5에서 없앤다 |
| D5 | `pagestill crawl --capture`를 이번 범위에 넣을까? | 넣는다. 크롤러가 이미 페이지를 열고 로딩을 기다리므로 추가 비용이 작다 |
| D6 | TUI에서 Crawl·Run을 실행하는 메뉴를 넣을까? | 이번에는 빼고 다음 단계에서 |
| D7 | Record가 클릭 단계까지 기록해서 `steps:`를 자동으로 만들게 할까? | 이번에는 뺀다. 대신 "클릭으로 도달" 표시만 남긴다 |
| D8 | TUI의 `s`(이미지만)·`h`(HTML만) 즉시 캡처 키를 없앨까? | 없앤다. 저장 대상은 `o`(Save)로 정하고 캡처는 `⏎` 하나로 통일 |
| D9 | Run의 검사 결과에 "check"(확인 필요) 상태를 추가할까? 지금은 ok / failed / skipped 세 가지 | 추가한다. HTTP 오류, 다른 URL로 이동, 제목 불일치를 여기에 넣고 종료 코드 2로 알린다 |
| D10 | `run --only <glob>`(목록 일부만 찍기)을 넣을까? | 넣는다. `edit`으로 파일을 고치지 않고 일부만 다시 찍을 때 유용 |
| D11 | page list에서 `300ms`, `30s` 같은 시간 표기를 받을까? | 받는다. 숫자만 쓰면 지금처럼 밀리초 |
