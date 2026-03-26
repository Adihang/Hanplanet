#Requires -Version 5.1
# Handsync 제거 스크립트

# ── 관리자 권한 자동 상승 ─────────────────────────────────────────────────────
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $MyInvocation.MyCommand.Path
    Start-Process powershell -Verb RunAs -ArgumentList $args
    exit
}

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$AppName     = "Handsync"
$InstallDir  = Join-Path $env:ProgramFiles "Hanplanet\$AppName"
$StartMenuDir = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\Hanplanet"
$TaskName    = "HandsyncDaemon"

Clear-Host
Write-Host ""
Write-Host "  Hanplanet Handsync 제거" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  정말 제거하시겠습니까? (y/N): " -ForegroundColor White -NoNewline
$Confirm = Read-Host
if ($Confirm -notmatch "^[Yy]") {
    Write-Host "  취소되었습니다." -ForegroundColor Yellow
    Read-Host "  아무 키나 누르면 종료합니다"
    exit
}
Write-Host ""

# 실행 중인 handsync 프로세스 종료
Write-Host "  동기화 프로세스 종료 중..." -ForegroundColor Yellow
Get-Process -Name "handsync" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "        완료" -ForegroundColor Green

# 작업 스케줄러 태스크 삭제
Write-Host "  자동 시작 태스크 제거 중..." -ForegroundColor Yellow
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "        완료" -ForegroundColor Green

# 시작 메뉴 바로가기 삭제
Write-Host "  시작 메뉴 바로가기 삭제 중..." -ForegroundColor Yellow
if (Test-Path $StartMenuDir) {
    Remove-Item -Path $StartMenuDir -Recurse -Force
}
Write-Host "        완료" -ForegroundColor Green

# 시스템 PATH에서 제거
Write-Host "  시스템 PATH 정리 중..." -ForegroundColor Yellow
$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$NewPath = ($MachinePath -split ";" | Where-Object { $_ -ne $InstallDir }) -join ";"
[Environment]::SetEnvironmentVariable("Path", $NewPath, "Machine")
Write-Host "        완료" -ForegroundColor Green

# 설치 폴더 삭제
Write-Host "  설치 파일 삭제 중..." -ForegroundColor Yellow
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}
Write-Host "        완료" -ForegroundColor Green

# 설정/데이터 삭제 여부 확인
Write-Host ""
Write-Host "  동기화 설정 및 토큰 파일도 삭제할까요?" -ForegroundColor White
Write-Host "  (삭제 시 재설치 후 다시 로그인해야 합니다) (y/N): " -ForegroundColor White -NoNewline
$DelData = Read-Host
if ($DelData -match "^[Yy]") {
    $ConfigDir = Join-Path $env:USERPROFILE ".handsync"
    if (Test-Path $ConfigDir) {
        Remove-Item -Path $ConfigDir -Recurse -Force
        Write-Host "        설정 파일 삭제 완료" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Handsync 제거가 완료되었습니다." -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  아무 키나 누르면 종료합니다"
