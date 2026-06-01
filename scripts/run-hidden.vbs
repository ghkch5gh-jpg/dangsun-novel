' Launch run-daily.ps1 with NO visible window (SW_HIDE = 0).
' Task Scheduler runs:  wscript.exe "...\scripts\run-hidden.vbs"
' 경로는 동적으로 — 한글 경로 리터럴을 두면 CP949 오독으로 깨짐.
Dim fso, scriptDir, root, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(scriptDir)
ps1 = root & "\scripts\run-daily.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """"
CreateObject("WScript.Shell").Run cmd, 0, False
