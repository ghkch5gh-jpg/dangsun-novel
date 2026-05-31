#!/usr/bin/env node
// 웹소설 자동연재 생성기 — story-bible(누적 설정) + 직전 화 + 독자 개입(Supabase) → claude -p → 다음 화.
// dangsun.kr/novel 에서 렌더링. 한국 웹소설 정통 문법.
//
//   DRY_RUN=1 : 프롬프트만 출력 (claude 호출 안 함)
//   FORCE=1   : 오늘 회차가 이미 있어도 강제로 다음 화 생성
//   CLAUDE_MODEL=opus : 품질 ↑ (기본 sonnet)
//
// 환경변수(개입 기능용, 없으면 개입 없이 진행):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   → 없으면 .env 파일(이 repo 루트, gitignore됨)에서 읽음.

import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";

const DRY_RUN = process.env.DRY_RUN === "1";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";

// ── .env 로더 (있으면) ─────────────────────────────────────────
async function loadDotEnv() {
  try {
    await access(".env");
  } catch {
    return;
  }
  const txt = await readFile(".env", "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
await loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STEERING_ENABLED = !!(SUPABASE_URL && SUPABASE_KEY);

// ── 날짜 / 회차 번호 ───────────────────────────────────────────
const now = new Date();
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
const dateStr = kst.toISOString().slice(0, 10);

const allMd = (await readdir(".")).filter((f) => /^\d{4}-\d{2}-\d{2}_\d+\.md$/.test(f));
const epNums = allMd
  .map((f) => parseInt((f.match(/_(\d+)\.md$/) || [])[1] || "0", 10))
  .sort((a, b) => a - b);
const lastEp = epNums.length ? epNums[epNums.length - 1] : 0;

// 오늘 이미 생성했는지 — 같은 날짜 prefix 파일 존재 여부
const todayExists = allMd.some((f) => f.startsWith(`${dateStr}_`));
if (todayExists && process.env.FORCE !== "1") {
  console.log(`${dateStr} 회차 이미 존재 — 종료 (FORCE=1로 강제 추가)`);
  process.exit(0);
}

const nextEp = lastEp + 1;
const slug = `${dateStr}_${String(nextEp).padStart(3, "0")}`;
const isFirst = nextEp === 1;

// ── 직전 화 본문 (최대 2화) ───────────────────────────────────
function bodyOf(md) {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return (m ? m[1] : md).trim();
}
const priorFiles = allMd.sort().reverse().slice(0, 2);
const priorBodies = [];
for (const f of priorFiles.reverse()) {
  const num = parseInt((f.match(/_(\d+)\.md$/) || [])[1] || "0", 10);
  priorBodies.push(`[${num}화]\n${bodyOf(await readFile(f, "utf8"))}`);
}

// ── 스토리 바이블 (누적 설정) ─────────────────────────────────
let bible = "";
try {
  bible = await readFile("story-bible.md", "utf8");
} catch {
  bible = "";
}

// ── 독자 개입 노트 (Supabase) ─────────────────────────────────
async function fetchSteering() {
  if (!STEERING_ENABLED) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/novel_steering?status=eq.pending&order=created_at.asc&select=id,note,created_at`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`개입 노트 fetch 실패: HTTP ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (e) {
    console.warn(`개입 노트 fetch 오류: ${e.message}`);
    return [];
  }
}
async function markApplied(ids, episodeSlug) {
  if (!STEERING_ENABLED || !ids.length) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/novel_steering?id=in.(${ids.join(",")})`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          status: "applied",
          applied_episode: episodeSlug,
          applied_at: new Date().toISOString(),
        }),
      }
    );
    if (!res.ok) console.warn(`개입 노트 applied 처리 실패: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`개입 노트 applied 오류: ${e.message}`);
  }
}

const steering = await fetchSteering();
const steeringText = steering.length
  ? steering.map((s, i) => `${i + 1}. ${String(s.note).trim()}`).join("\n")
  : "";

// ── 시드(1화 전용) ────────────────────────────────────────────
const SEED = `# 시드 설정 (1화 생성용 — 한국 웹소설 정통: 현대 회귀 헌터물)

- 주인공: 강시혁(姜時赫), 34세. 세계 최강 길드 '백야'의 잡일꾼 포터(짐꾼). 각성 능력은 최하급, 늘 무시당하며 살았다.
- 사건: 마지막 게이트 '심연'의 공략 중, 길드장의 버림을 받아 미끼로 던져져 죽는다. 눈을 뜨니 모든 게이트가 처음 열리던 10년 전, 26세의 자신.
- 무기: 미래의 기억 — 어떤 게이트에서 무엇이 나오는지, 어떤 아이템이 어디 있는지, 누가 언제 배신하는지 전부 안다.
- 목표: 이번 생엔 최강 헌터가 되어, 10년 뒤 인류를 멸망시킬 '심연 게이트'를 막는다. 그리고 자신을 버린 자들에게 갚아준다.
- 톤: 1인칭 또는 주인공 밀착 3인칭. 사이다·성장·복수. 절단신공(매 화 끝 강한 훅).`;

// ── 프롬프트 ──────────────────────────────────────────────────
const STYLE = `# 한국 웹소설 정통 문법 (반드시 준수)
- 분량: 본문 2500~3500자. 하루치 한 화로 5분 안에 읽히게.
- 시점·톤: 주인공 밀착(1인칭 또는 3인칭 제한). 짧고 빠른 문장, 대사 중심. 묘사는 최소, 사건과 감정 위주.
- 구조: 도입(상황) → 전개(갈등·정보·행동) → **절단신공**(마지막 1~2문장은 강한 훅/반전/위기로 끊어 다음 화를 궁금하게).
- 사이다: 주인공이 미래 지식·실력으로 한 방 먹이거나 앞서나가는 통쾌함을 매 화 최소 1회.
- 떡밥: 매 화 새 떡밥 하나는 심거나 회수. 인물·설정은 story-bible과 어긋나면 안 됨(연속성 최우선).
- 금지: 작가의 메타발언, 회차 요약식 서술, "다음 화에 계속" 같은 직접 안내문. 본문은 순수 소설 텍스트만.`;

let prompt;
if (isFirst) {
  prompt = `**중요 — 이 요청은 *채팅 응답* 형식입니다. 도구·검색·파일시스템 사용 금지. 응답은 한 덩어리 JSON만. 첫 글자부터 \`{\` 로 시작. 인사·보고문 금지.**

당신은 한국 웹소설 전문 작가입니다. 아래 시드 설정으로 **1화**를 씁니다.

${SEED}

${STYLE}

# 출력 스키마 (이대로만)
\`\`\`
{
  "title": "1화. 제목",
  "edition_note": "이 화 한 줄 소개 (~60자, 스포 없이 후킹)",
  "body_md": "본문 (마크다운, 2500~3500자, 대사·장면 포함, 절단신공으로 끝)",
  "recap": "이 화 핵심 한 줄 (다음 화 생성 참고용)",
  "bible": "스토리 바이블 전문 (마크다운). 아래 6개 섹션 필수:\\n## 로그라인\\n## 주요 인물 (이름·정체·관계·현재상황)\\n## 세계관·규칙 (게이트/각성/길드 등 설정)\\n## 진행 중 떡밥 (열린 것/회수된 것)\\n## 현재 상태 (1화 끝 시점의 장소·상황·주인공 목표)\\n## 다음 화 예고 (작가 메모, 어디로 이어질지)"
}
\`\`\``;
} else {
  prompt = `**중요 — 이 요청은 *채팅 응답* 형식입니다. 도구·검색·파일시스템 사용 금지. 응답은 한 덩어리 JSON만. 첫 글자부터 \`{\` 로 시작. 인사·보고문 금지.**

당신은 한국 웹소설 전문 작가입니다. 연재 중인 작품의 **${nextEp}화**를 씁니다. 아래 스토리 바이블과 직전 화에 **완벽히 연속**되게 이어 쓰세요.

# 스토리 바이블 (지금까지의 누적 설정 — 절대 어기지 말 것)
${bible || "(바이블 없음 — 직전 화에서 추론)"}

# 직전 화 본문
${priorBodies.join("\n\n---\n\n") || "(없음)"}

${steeringText ? `# ⚡ 독자(작가)의 개입 지시 — 이번 화에 반드시 반영
${steeringText}

→ 위 지시를 자연스럽게 이번 화 전개에 녹이세요. 단, 기존 설정·연속성은 유지하면서.` : "# 독자 개입\n(이번 화는 개입 없음 — 바이블의 '다음 화 예고' 방향으로 자연스럽게 이어가세요.)"}

${STYLE}

# 출력 스키마 (이대로만)
\`\`\`
{
  "title": "${nextEp}화. 제목",
  "edition_note": "이 화 한 줄 소개 (~60자, 스포 없이 후킹)",
  "body_md": "본문 (마크다운, 2500~3500자, 대사·장면 포함, 절단신공으로 끝)",
  "recap": "이 화 핵심 한 줄 (다음 화 생성 참고용)",
  "bible": "갱신된 스토리 바이블 전문 (마크다운, 위 바이블을 이번 화 내용 반영해 업데이트). 6개 섹션 유지:\\n## 로그라인\\n## 주요 인물\\n## 세계관·규칙\\n## 진행 중 떡밥\\n## 현재 상태\\n## 다음 화 예고"
}
\`\`\``;
}

console.log(`회차: ${nextEp}화 (${slug}) · 개입 ${steering.length}건 · 모델 ${CLAUDE_MODEL}`);
console.log(`Prompt: ${(Buffer.byteLength(prompt, "utf8") / 1024).toFixed(1)} KB`);
if (DRY_RUN) {
  console.log("=== DRY RUN ===\n" + prompt.slice(0, 3000) + `\n...(전체 ${prompt.length}자)`);
  process.exit(0);
}

// ── claude 호출 ───────────────────────────────────────────────
function callClaude(promptText) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "text", "--allowedTools", "", "--model", CLAUDE_MODEL];
    console.log(`claude -p (${CLAUDE_MODEL}) 호출...`);
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "inherit"], shell: true });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("타임아웃 5분")); }, 5 * 60 * 1000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}`)); });
    child.stdin.write(promptText);
    child.stdin.end();
  });
}

const raw = await callClaude(prompt);
const jm = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
if (!jm) { console.error("JSON 미발견:", raw.slice(0, 600)); process.exit(1); }
let data;
try { data = JSON.parse(jm[1] ?? jm[0]); } catch (e) { console.error("파싱 실패:", e.message, "\n", raw.slice(0, 600)); process.exit(1); }

const title = String(data.title || `${nextEp}화`).trim();
const note = String(data.edition_note || "").replaceAll('"', "'").trim();
const bodyMd = String(data.body_md || "").trim();
if (bodyMd.length < 400) { console.error("본문이 너무 짧음 — 생성 실패로 간주"); process.exit(1); }

// ── 회차 .md 저장 ─────────────────────────────────────────────
const heroTitle = title.replace(/^(\d+화)\.?\s*/, "$1 <em>").replace(/$/, "</em>");
const md = `---
title: ${title}
eyebrow: 웹소설 · 매일 연재
hero_title: "${heroTitle}"
description: "${note}"
summary: ${note}
---

<div class="novel">

${bodyMd}

</div>
`;
await writeFile(`${slug}.md`, md);
console.log(`${slug}.md 저장 — ${title} (${bodyMd.length}자)`);

// ── 스토리 바이블 갱신 ────────────────────────────────────────
if (data.bible && String(data.bible).trim().length > 100) {
  await writeFile("story-bible.md", String(data.bible).trim() + "\n");
  console.log("story-bible.md 갱신");
}

// ── 개입 노트 applied 처리 ────────────────────────────────────
await markApplied(steering.map((s) => s.id), slug);
if (steering.length) console.log(`개입 ${steering.length}건 applied 처리`);

// ── index.md 재생성 ───────────────────────────────────────────
const files = (await readdir(".")).filter((f) => /^\d{4}-\d{2}-\d{2}_\d+\.md$/.test(f));
function epNumOf(f) { return parseInt((f.match(/_(\d+)\.md$/) || [])[1] || "0", 10); }
files.sort((a, b) => epNumOf(b) - epNumOf(a)); // 최신 화 먼저
async function metaOf(file) {
  try {
    const fm = (await readFile(file, "utf8")).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return { title: file, summary: "" };
    const t = fm[1].match(/^title:\s*(.+)$/m);
    const s = fm[1].match(/^summary:\s*(.+)$/m);
    return { title: t ? t[1].trim() : file, summary: s ? s[1].trim() : "" };
  } catch { return { title: file, summary: "" }; }
}
const entries = await Promise.all(
  files.map(async (f) => {
    const slugOnly = f.replace(".md", "");
    const { title: t, summary } = await metaOf(f);
    return summary ? `- [${t} — ${summary}](${slugOnly}.html)` : `- [${t}](${slugOnly}.html)`;
  })
);

const indexMd = `---
title: 웹소설
eyebrow: DAILY · WEB NOVEL
hero_title: "매일 이어지는 <em>웹소설</em>"
description: 매일 아침 한 화씩 자동으로 이어지는 연재 소설입니다. 독자가 방향을 던지면 그대로, 던지지 않으면 흐름대로 흘러갑니다.
stats:
  - num: "매일"
    lbl: "Daily Episode"
  - num: "${files.length}"
    lbl: "회차"
  - num: "개입형"
    lbl: "Reader-steered"
---

## 회차 목록

${entries.join("\n")}
{:.episode-list}

*매일 08:30 KST 새 화가 자동으로 이어집니다. 로그인 후 다음 화의 방향을 직접 던질 수 있어요.*

## 이 연재는

매일 아침, 직전 화와 누적된 설정(스토리 바이블)을 이어받아 다음 화가 자동으로 쓰입니다. Claude Code 구독으로 로컬 생성하므로 별도 API 비용이 없습니다. 독자가 개입하면 그 방향으로, 개입이 없으면 이야기 자체의 흐름대로 흘러갑니다.
`;
await writeFile("index.md", indexMd);
console.log(`index.md 갱신 (${files.length}회차)`);
