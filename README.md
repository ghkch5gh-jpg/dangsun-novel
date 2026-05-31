# dangsun-novel

매일 한 화씩 자동으로 이어지는 **개입형 웹소설** 콘텐츠 repo. **dangsun.kr/novel** 에서 렌더링됨.

## 구조

- `YYYY-MM-DD_NNN.md` — 회차 (frontmatter + 본문). NNN = 화수(001부터)
- `canon/` — **연속성 캐논(옵시디언 볼트)**. 상세는 [canon/README.md](canon/README.md)
  - `canon/timeline.md` 🔒🔒 회귀 미래지식(절대불변) · `canon/world.md` 🔒 세계관 · `canon/characters/*.md` 🔒 인물
  - `canon/threads.md` 떡밥(런닝)
- `state.md` — 현재 상태 스냅샷(런닝, 매 화 갱신) · `synopsis.md` — 회차별 1줄(누적)
- `index.md` — 회차 목록 (생성기가 자동 재작성)
- `scripts/build-local.mjs` — 생성기 v2 · `scripts/run-daily.ps1` — 스케줄러 래퍼

상위 폴더(`14_웹소설`)를 **옵시디언 볼트로 열면** canon 위키링크 그래프가 보인다. 사람이 직접 고쳐 드리프트를 잡을 수 있다.

## 생성 방식 (연속성 설계)

`12_AItrends` 와 동일하게 **로컬 Claude Code 구독(정액제)** 으로 생성한다.
매일 08:30 KST Windows 작업 스케줄러가 `build-local.mjs` 실행 →

1. 락드 canon(timeline/world/characters) + 런닝(state/threads/synopsis) + 직전 화 + 독자 개입(Supabase `novel_steering`) 로딩
2. `claude -p` 로 다음 화 + 캐논 갱신분 생성
3. **연속성 체크(2차 claude 호출)** — 새 화를 캐논·이전 떡밥과 대조. 하드 모순이면 1회 재생성
4. 적용: 회차 .md 저장 / state·threads 갱신 / synopsis·world·timeline·인물로그는 **append만**(전언게임 차단) / 신규 인물 create
5. commit & push → Vercel ISR(revalidate 300s) 반영

드리프트 방지 원칙: 락드 canon은 **덮어쓰기 없이 추가만**. 자세한 파일별 쓰기 권한은 [canon/README.md](canon/README.md).

```bash
# 수동 실행 (다음 화 생성)
node scripts/build-local.mjs

# 프롬프트만 확인 (claude 호출 안 함)
DRY_RUN=1 node scripts/build-local.mjs

# 오늘 이미 생성했어도 강제로 한 화 더 / 모델 변경
FORCE=1 CLAUDE_MODEL=opus node scripts/build-local.mjs
```

## 개입 (steering)

독자(로그인)가 dangsun.kr/novel 의 입력폼에 다음 화 방향을 적으면
Supabase `novel_steering` 에 `status=pending` 으로 저장된다.
다음 생성 때 pending 노트를 프롬프트에 넣어 반영하고 `status=applied` 로 마킹한다.
개입이 없으면 `state.md` 의 '다음 화 방향' 으로 자연스럽게 이어간다.

## 환경변수 (개입 기능용, 없으면 개입 없이 진행)

repo 루트에 `.env` (gitignore됨):

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

site repo(`11_site/design-competition-ontology`)의 `.env.local` 값과 동일.
