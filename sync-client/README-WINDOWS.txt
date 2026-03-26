========================================
  Handsync for Windows
  Hanplanet 클라우드 드라이브 클라이언트
========================================

[ 설치 방법 ]

1. 이 폴더(handsync.exe, install.ps1)를 원하는 위치에 압축 해제

2. PowerShell을 열고 아래 명령어 실행:
   PowerShell -ExecutionPolicy Bypass -File install.ps1

   - 서버 URL, 동기화 폴더를 입력하면 자동 설정됩니다.
   - 로그인 후 바로 사용 가능합니다.

[ 수동 설치 (설치 스크립트 없이) ]

1. handsync.exe를 PATH에 있는 폴더에 복사

2. 설정 파일 생성:
   handsync init https://www.hanplanet.com C:\Users\user\Hanplanet

3. 로그인 (refresh token을 ~\.handsync\tokens.json에 저장):
   handsync login

4. 동기화 데몬 실행:
   handsync

[ 명령어 ]

  handsync              - 동기화 데몬 실행
  handsync login        - 로그인 (토큰 갱신)
  handsync init <url> <dir>  - 설정 초기화
  handsync version      - 버전 확인

[ 파일 위치 ]

  %USERPROFILE%\.handsync\config.json   - 설정
  %USERPROFILE%\.handsync\tokens.json   - 토큰 (자동 관리)
  %USERPROFILE%\.handsync\handsync.db   - 로컬 동기화 상태

[ 자동 시작 해제 ]

  작업 스케줄러(taskschd.msc)에서 "HandsyncDaemon" 삭제

========================================
