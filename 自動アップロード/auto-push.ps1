# 作業の場（Claude）からGitHubへの自動アップロード（Windows版、旅行プランナー用）。
# 「<プロジェクトのフォルダー>\自動アップロード\」に置く。タスクスケジューラーが1分ごとに動かす（install.ps1 で登録）。
# フォルダーに push-request.txt（1行目がコミットの説明）があれば、
#   root-source.tar.gz … フォルダー直下（リポジトリの直下）を、.git と 自動アップロード を除いて丸ごと置き換える
#   <名前>-source.tar.gz … <名前>\ を置き換える（ほかのプロジェクトと共通の動き）
# のあとでコミットして push する。結果は auto-push.log に追記する。
$ErrorActionPreference = 'Continue'
$Dir = Split-Path -Parent $PSScriptRoot
$Req = Join-Path $Dir 'push-request.txt'
$Log = Join-Path $Dir 'auto-push.log'
if (-not (Test-Path $Req)) { exit 0 }
Set-Location $Dir
$Msg = Get-Content $Req -Encoding UTF8 -TotalCount 1
if (-not $Msg) { $Msg = '作業の場からの更新' }
Remove-Item $Req -Force
$out = @("=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Msg")
$keep = @('.git', '自動アップロード', 'auto-push.log', 'root-source.tar.gz', 'Claude outputs')
if (Test-Path 'root-source.tar.gz') {
  $tmp = 'root.new'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory $tmp | Out-Null
  tar -xzf 'root-source.tar.gz' -C $tmp
  if (Test-Path (Join-Path $tmp 'package.json')) {
    Get-ChildItem -Force | Where-Object { $keep -notcontains $_.Name -and $_.Name -ne $tmp } | Remove-Item -Recurse -Force
    Get-ChildItem -Force $tmp | Move-Item -Destination $Dir -Force
    Remove-Item -Recurse -Force $tmp
    Remove-Item -Force 'root-source.tar.gz'
    $out += 'フォルダー直下を更新'
  } else {
    Remove-Item -Recurse -Force $tmp
    $out += 'root-source.tar.gz を展開できませんでした（package.json がありません）'
  }
}
Get-ChildItem -File -Filter '*-source.tar.gz' | Where-Object { $_.Name -ne 'root-source.tar.gz' } | ForEach-Object {
  $name = $_.Name -replace '-source\.tar\.gz$', ''
  $tmp = "$name.new"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory $tmp | Out-Null
  tar -xzf $_.Name -C $tmp
  if (Test-Path (Join-Path $tmp $name)) {
    if (Test-Path $name) { Remove-Item -Recurse -Force $name }
    Move-Item (Join-Path $tmp $name) $name
    Remove-Item -Recurse -Force $tmp
    Remove-Item -Force $_.Name
    $out += "$name\ を更新"
  } else {
    $out += "$($_.Name) を展開できませんでした（中に $name\ がありません）"
  }
}
git rm -r -q --cached --ignore-unmatch "Claude outputs" 2>$null | Out-Null
git add -A
# コミットの説明は UTF-8 のファイルで渡す（日本語の文字化けを防ぐ）
$mf = Join-Path $env:TEMP 'autopush-msg.txt'
[IO.File]::WriteAllText($mf, $Msg, (New-Object Text.UTF8Encoding $false))
git commit -q -F $mf
if ($LASTEXITCODE -eq 0) { $out += 'コミットしました' } else { $out += '変更はありません' }
$p = git push -q origin main 2>&1
if ($LASTEXITCODE -eq 0) { $out += 'push しました' } else { $out += ($p | Out-String).Trim(); $out += 'push に失敗しました' }
Add-Content -Path $Log -Value $out -Encoding UTF8
