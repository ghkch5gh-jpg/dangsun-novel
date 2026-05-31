# dangsun-novel

매일 한 화씩 자동으로 이어지는 **개입형 웹소설** 콘텐츠 repo. **dangsun.kr/novel** 에서 렌더링됨.

## 구조

- `YYYY-MM-DD_NNN.md` — 회차 (frontmatter + 본문). NNN = 화수(001부터)
- `story-bible.md` — 누적 설정(로그라인/인물/세계관/떡밥/현재상태/다음화 예고). **연속성의 핵심.** 매 화 갱신됨
- `index.md` — 회차 목록 (생성기가 자동 재작성)
- `scripts/build-local.mjs` — 생성기
- `scripts/run-daily.ps1` — 스케줄러 래퍼

## 생성 방식

`12_AItrends` 와 동일하게 **로컬 Claude Code 구독(정액제)** 으로 생성한다.
매일 08:30 KST Windows 작업 스케줄러가 `build-local.mjs` 실행 →
직전 화 + story-bible + 독자 개입(Supabase `novel_steering`) 을 묶어 `claude -p` 로 다음 화 작성 →
회차 .md + story-bible 갱신 → commit & push. Vercel ISR(revalidate 300s)이 반영.

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
개입이 없으면 story-bible 의 '다음 화 예고' 방향으로 자연스럽게 이어간다.

## 환경변수 (개입 기능용, 없으면 개입 없이 진행)

repo 루트에 `.env` (gitignore됨):

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

site repo(`11_site/design-competition-ontology`)의 `.env.local` 값과 동일.
