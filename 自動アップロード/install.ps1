# 自動アップロードの導入（Windows版、旅行プランナー用。一度だけ実行）。
# 使い方（PowerShell）:
#   powershell -ExecutionPolicy Bypass -File "<プロジェクトのフォルダー>\自動アップロード\install.ps1" https://github.com/asatoh412-spec/tabi-planner.git
# GitHub にすでにある履歴を取り込み、そのうえで作業の場からの更新を push できるようにする。
param([string]$RepoUrl = '')
$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'git が見つかりません。Git for Windows（https://git-scm.com/download/win）を入れてから、もう一度実行してください。'; exit 1 }
$md5 = [Security.Cryptography.MD5]::Create()
$hash = ([BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Dir))) -replace '-', '').Substring(0, 8).ToLower()
$TaskName = "AutoPush-$hash"
# 画面を出さずに動かすための小さな起動ファイル（日本語のパスを扱うため UTF-16 で書く）
$vbs = Join-Path $PSScriptRoot 'run-hidden.vbs'
$ps1 = Join-Path $PSScriptRoot 'auto-push.ps1'
$line = 'CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""' + $ps1 + '""", 0, True'
Set-Content -Path $vbs -Value $line -Encoding Unicode
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "自動アップロード: $Dir" -Force | Out-Null
Set-Location $Dir
$ErrorActionPreference = 'Continue'
if (-not (Test-Path .git) -and $RepoUrl) {
  git init -q -b main
  git remote add origin $RepoUrl
  git config credential.useHttpPath true
  git config user.name 'aki'
  git config user.email 'a.satoh412@gmail.com'
  # GitHub の履歴を取り込む（ここで GitHub へのログインを求められたら、ブラウザでログインするかトークンを入れる）
  git fetch -q origin main
  if ($LASTEXITCODE -ne 0) { Write-Host 'GitHub から取り込めませんでした。ログインやトークン（tabi-planner に Contents: Read and write）を確認してください。'; exit 1 }
  git reset -q --hard origin/main
  git branch -q --set-upstream-to=origin/main main
}
Write-Host "導入しました: $Dir（タスク名 $TaskName、1分ごとに確認）"
