#Requires -Version 5.1
# Handsync Windows 설치 스크립트
# 더블클릭 또는 PowerShell에서 실행 가능

# ── 관리자 권한 자동 상승 ─────────────────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # 관리자가 아니면 UAC 창을 띄워서 재실행
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $MyInvocation.MyCommand.Path
    Start-Process powershell -Verb RunAs -ArgumentList $args
    exit
}

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ── 상수 ──────────────────────────────────────────────────────────────────────
$AppName     = "Handsync"
$ExeName     = "handsync.exe"
$InstallDir  = Join-Path $env:ProgramFiles "Hanplanet\$AppName"
$ExePath     = Join-Path $InstallDir $ExeName
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceExe   = Join-Path $ScriptDir $ExeName

$StartMenuDir = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Hanplanet"
$ShortcutRun  = Join-Path $StartMenuDir "$AppName.lnk"
$ShortcutUni  = Join-Path $StartMenuDir "$AppName 제거.lnk"

# ── 헤더 ──────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ██╗  ██╗ █████╗ ███╗  ██╗██████╗ ██████╗ ██╗   ██╗███████╗" -ForegroundColor Cyan
Write-Host "  ██║  ██║██╔══██╗████╗ ██║██╔══██╗██╔══██╗╚██╗ ██╔╝██╔════╝" -ForegroundColor Cyan
Write-Host "  ███████║███████║██╔██╗██║██║  ██║██████╔╝ ╚████╔╝ █████╗  " -ForegroundColor Cyan
Write-Host "  ██╔══██║██╔══██║██║╚████║██║  ██║██╔══██╗  ╚██╔╝  ██╔══╝  " -ForegroundColor Cyan
Write-Host "  ██║  ██║██║  ██║██║ ╚███║██████╔╝██║  ██║   ██║   ███████╗" -ForegroundColor Cyan
Write-Host "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚══╝╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Hanplanet 클라우드 드라이브 동기화 클라이언트" -ForegroundColor White
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── 실행파일 존재 확인 ────────────────────────────────────────────────────────
if (-not (Test-Path $SourceExe)) {
    Write-Host "  [오류] $ExeName 을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "         install.ps1 과 handsync.exe 가 같은 폴더에 있어야 합니다." -ForegroundColor Red
    Write-Host ""
    Read-Host "  아무 키나 누르면 종료합니다"
    exit 1
}

# ── 1단계: 파일 설치 ──────────────────────────────────────────────────────────
Write-Host "  [1/4] 파일 설치 중..." -ForegroundColor Yellow
Write-Host "        경로: $InstallDir" -ForegroundColor DarkGray

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Copy-Item -Path $SourceExe -Destination $ExePath -Force

# uninstall.ps1 도 설치 경로에 복사 (있으면)
$SourceUninstall = Join-Path $ScriptDir "uninstall.ps1"
if (Test-Path $SourceUninstall) {
    Copy-Item -Path $SourceUninstall -Destination (Join-Path $InstallDir "uninstall.ps1") -Force
}

Write-Host "        완료" -ForegroundColor Green

# ── 2단계: 시스템 PATH 등록 ───────────────────────────────────────────────────
Write-Host "  [2/4] 시스템 PATH 등록 중..." -ForegroundColor Yellow

$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
if ($MachinePath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$MachinePath;$InstallDir", "Machine")
    Write-Host "        완료" -ForegroundColor Green
} else {
    Write-Host "        이미 등록됨" -ForegroundColor DarkGray
}

# ── 3단계: 시작 메뉴 바로가기 ────────────────────────────────────────────────
Write-Host "  [3/4] 시작 메뉴 바로가기 생성 중..." -ForegroundColor Yellow

if (-not (Test-Path $StartMenuDir)) {
    New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
}

$WShell = New-Object -ComObject WScript.Shell

# 실행 바로가기
$sc = $WShell.CreateShortcut($ShortcutRun)
$sc.TargetPath       = $ExePath
$sc.WorkingDirectory = $InstallDir
$sc.Description      = "Hanplanet 파일 동기화 시작"
$sc.Save()

# 제거 바로가기
$uninstallPs = Join-Path $InstallDir "uninstall.ps1"
$sc2 = $WShell.CreateShortcut($ShortcutUni)
$sc2.TargetPath       = "powershell.exe"
$sc2.Arguments        = "-ExecutionPolicy Bypass -File `"$uninstallPs`""
$sc2.WorkingDirectory = $InstallDir
$sc2.Description      = "Hanplanet Handsync 제거"
$sc2.Save()

Write-Host "        완료" -ForegroundColor Green

# ── 4단계: 초기 설정 ──────────────────────────────────────────────────────────
Write-Host "  [4/4] 초기 설정" -ForegroundColor Yellow
Write-Host ""

$DefaultServer = "https://www.hanplanet.com"
$DefaultSync   = Join-Path $env:USERPROFILE "Hanplanet"

Write-Host "  서버 URL (Enter = $DefaultServer): " -ForegroundColor White -NoNewline
$ServerURL = Read-Host
if ([string]::IsNullOrWhiteSpace($ServerURL)) { $ServerURL = $DefaultServer }

Write-Host "  동기화 폴더 (Enter = $DefaultSync): " -ForegroundColor White -NoNewline
$SyncDir = Read-Host
if ([string]::IsNullOrWhiteSpace($SyncDir)) { $SyncDir = $DefaultSync }

# 동기화 폴더 생성
if (-not (Test-Path $SyncDir)) {
    New-Item -ItemType Directory -Path $SyncDir -Force | Out-Null
    Write-Host "        폴더 생성: $SyncDir" -ForegroundColor DarkGray
}

# config.json 저장
$ConfigDir  = Join-Path $env:USERPROFILE ".handsync"
$ConfigPath = Join-Path $ConfigDir "config.json"
if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

@{
    server_url            = $ServerURL.TrimEnd("/")
    sync_dir              = $SyncDir
    poll_interval_seconds = 30
} | ConvertTo-Json -Depth 2 | Set-Content -Path $ConfigPath -Encoding UTF8

Write-Host "        설정 저장: $ConfigPath" -ForegroundColor DarkGray

# 로그인
Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Hanplanet 계정으로 로그인하세요" -ForegroundColor White
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
& $ExePath login

# ── 자동 시작 (작업 스케줄러) ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  Windows 시작 시 자동으로 동기화를 실행할까요? (Y/n): " -ForegroundColor White -NoNewline
$AutoStart = Read-Host
if ($AutoStart -eq "" -or $AutoStart -match "^[Yy]") {
    $TaskName    = "HandsyncDaemon"
    $TaskAction  = New-ScheduledTaskAction -Execute $ExePath
    $TaskTrigger = New-ScheduledTaskTrigger -AtLogOn
    $TaskSettings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -StartWhenAvailable $true

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $TaskAction `
        -Trigger     $TaskTrigger `
        -Settings    $TaskSettings `
        -Description "Hanplanet 파일 동기화 데몬" `
        -RunLevel    Limited | Out-Null

    Write-Host "        자동 시작 등록 완료" -ForegroundColor Green
}

# ── 완료 ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  설치 완료!" -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  시작 메뉴 > Hanplanet > Handsync  로 실행하거나" -ForegroundColor White
Write-Host "  새 터미널에서  handsync  명령어를 입력하세요." -ForegroundColor White
Write-Host ""
Read-Host "  아무 키나 누르면 종료합니다"
