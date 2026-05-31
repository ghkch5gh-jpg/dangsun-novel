# 웹소설 매일 생성 — Windows 작업 스케줄러가 08:30 KST 에 호출.
# ASCII-only: repo가 한글 경로 아래 있어 Desktop을 환경에서 해석.
$ErrorActionPreference = 'Continue'

# 작업 스케줄러는 최소 PATH로 실행 — node/git/claude 경로 명시.
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Users\myh43\AppData\Roaming\npm;$env:Path"

$repo = Join-Path ([Environment]::GetFolderPath('Desktop')) 'work\14_웹소설'
Set-Location $repo
$log = Join-Path $repo 'daily.log'

function Log($m) {
  "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m |
    Out-File -FilePath $log -Append -Encoding utf8
}

Log "==== start ===="
git pull --quiet origin main *>> $log

node scripts/build-local.mjs *>> $log
if ($LASTEXITCODE -ne 0) { Log "generator failed (exit $LASTEXITCODE)"; exit 1 }

# 편집자 리뷰 갱신 — 오늘 회차까지 반영해 다음 화 생성 지침을 새로 뽑는다(자가발전). 실패해도 무시.
node scripts/review.mjs *>> $log
if ($LASTEXITCODE -ne 0) { Log "review failed (exit $LASTEXITCODE) — skip" }

git add -A *>> $log
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m ("daily: " + (Get-Date -Format 'yyyy-MM-dd') + " episode") *>> $log
  git push origin main *>> $log
  Log "pushed"
} else {
  Log "no changes (today's episode already exists)"
}
