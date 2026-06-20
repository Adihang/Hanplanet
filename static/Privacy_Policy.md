# 개인정보 처리방침

시행일: 2026-06-19

Hanplanet(이하 "서비스")은 이용자의 개인정보와 이용자가 보관하는 파일을 중요하게 다룹니다. 본 개인정보 처리방침은 Hanplanet, HanDrive, 계정 인증, GitHub 연동, Google 연동, Google Drive 연동, 검색/번역/챗 기능 및 관련 부가 기능에서 어떤 정보를 수집하고 어떻게 이용, 보관, 보호하는지 설명합니다.

## 1. 수집하는 개인정보 항목

서비스는 기능 제공에 필요한 범위에서 다음 정보를 수집하거나 저장할 수 있습니다.

- 계정 정보: 아이디, 비밀번호 해시, 이름, 이메일 주소, 프로필 이미지, 선호 언어, 테마, 검색 엔진 설정, 약관 동의 시각
- 인증 정보: 로그인 세션 쿠키, 보안 토큰, 이메일 인증 코드, 2단계 인증 관련 상태, 접속 IP, User-Agent, 요청 로그
- HanDrive 데이터: 사용자가 업로드, 생성, 수정, 삭제, 이동, 공유한 파일과 폴더, 파일명, 경로, MIME 타입, 크기, 수정 시각, 접근 권한, 공유 링크, 공개 쓰기 설정, 폴더 아이콘, 동기화 제외 경로
- Git/Forgejo 데이터: HanDrive 폴더를 Git 저장소로 사용할 때의 저장소명, 브랜치명, 커밋 메시지, 커밋 ID, 협업자 권한, 저장소 접근 토큰
- GitHub 연동 데이터: GitHub 사용자 ID, 로그인명, 표시 이름, 이메일, 아바타 URL, OAuth access token, refresh token, 토큰 만료 시각, 권한 범위, 사용자가 선택한 저장소 목록, 브랜치/커밋/파일 메타데이터 및 저장소 캐시
- Google 연동 데이터: Google 사용자 ID, 이메일, 표시 이름, 아바타 URL, OAuth access token, refresh token, 토큰 만료 시각, 권한 범위, Google Drive 표시 허용 여부, Google Picker 선택 항목 목록
- Google Drive 데이터: 사용자가 Google Drive 표시를 켜고 Google Picker로 파일 또는 폴더를 선택한 경우, 선택한 파일/폴더 및 선택한 폴더 안의 항목에 대한 Drive 파일/폴더 ID, 이름, MIME 타입, 크기, 수정 시각, 부모 폴더, 파일 내용, 다운로드/업로드/수정/삭제/이동 결과
- 서비스 이용 정보: 페이지 방문, 버튼 클릭, API 호출, 오류 로그, 게임 기록, 루트 바로가기, 공개 포트폴리오 작성 내용, 문의 내용
- AI/번역 기능 입력값: 사용자가 챗봇 또는 번역 기능에 입력한 텍스트와 해당 응답

## 2. 개인정보 수집 방법

개인정보는 다음 경로로 수집됩니다.

- 회원가입, 로그인, 계정 설정, 프로필 수정 과정
- GitHub, Google OAuth 인증 및 계정 연동 과정
- 사용자가 HanDrive에서 파일을 업로드, 편집, 다운로드, 삭제, 공유, 동기화하거나 Git 저장소로 변환하는 과정
- 사용자가 Google Drive 표시를 명시적으로 켜고 Google Picker에서 파일 또는 폴더를 선택한 뒤, 선택한 항목 또는 선택한 폴더 안의 항목을 열람, 업로드, 수정, 이동, 삭제하는 과정
- 사용자가 GitHub 저장소를 선택하고 저장소 파일을 열람, 수정, 추가, 삭제, 커밋하거나 브랜치를 생성/삭제하는 과정
- 검색, 번역, 챗봇, 게임, 포트폴리오, 문의 등 사이트 기능 이용 과정
- 서버 보안, 장애 분석, 남용 방지를 위해 자동으로 생성되는 로그

## 3. 개인정보 이용 목적

수집된 정보는 다음 목적을 위해 사용됩니다.

- 사용자 계정 생성, 로그인 인증, 세션 유지, 계정 보안
- HanDrive 파일 업로드, 정리, 미리보기, 편집, 다운로드, 삭제, 공유, 동기화 제공
- Google Picker로 선택한 Google Drive 파일/폴더 및 선택한 폴더 안의 항목을 HanDrive 안에서 표시하고 읽기, 수정, 생성, 삭제, 이동할 수 있도록 제공
- 사용자가 선택한 GitHub 저장소를 HanDrive 안에서 표시하고 파일 읽기, 수정, 추가, 삭제, 커밋, 브랜치 생성/삭제를 수행하도록 제공
- Git/Forgejo 저장소 생성, 브랜치/커밋 관리, 협업자 권한 관리
- 사용자가 요청한 검색, 번역, 챗봇, 게임, 포트폴리오 기능 제공
- 고객 문의 대응, 오류 분석, 보안 감사, 비정상 이용 방지, 서비스 안정성 유지
- 법령 준수 및 약관 위반 대응

## 4. Google API 데이터 사용

서비스는 Google OAuth, Google Drive API, Google Picker를 사용합니다. Google 계정 연동 시 기본 프로필 정보와 이메일 주소를 사용하여 로그인, 회원가입, 계정 연동을 처리합니다. 사용자가 계정 모달에서 Google Drive 표시 옵션을 켜고 Google Picker에서 파일 또는 폴더를 선택한 경우에만 선택 항목 목록을 저장하고, 해당 선택 파일/폴더 및 선택한 폴더 안의 항목을 HanDrive 안에 표시합니다. 서비스는 Google Drive 전체 목록을 임의로 동기화하거나 표시하지 않으며, 사용자의 명시적 조작에 따라 선택 범위 안에서 파일 읽기, 업로드, 생성, 수정, 이름 변경, 이동, 삭제를 수행합니다.

Google Drive 표시 옵션을 끄면 서버는 Google Drive 관련 HanDrive API 접근을 차단합니다. Google 계정 연동을 해제하면 서비스에 저장된 Google 연동 정보, 토큰, Google Picker 선택 항목 목록은 삭제되며, Google 계정 보안 설정에서 앱 권한을 별도로 철회할 수 있습니다.

서비스는 Google 사용자 데이터를 광고, 판매, 사용자 추적, 범용 AI/ML 모델 학습에 사용하지 않습니다. Google API에서 받은 정보의 사용 및 다른 앱으로의 전송은 Google API Services User Data Policy 및 Limited Use 요구사항을 준수합니다.

## 5. GitHub 데이터 사용

서비스는 GitHub OAuth를 사용하여 로그인, 회원가입, 계정 연동을 처리하고 사용자가 접근 권한을 가진 저장소 목록을 불러옵니다. 사용자가 선택한 GitHub 저장소만 HanDrive 루트에 표시되며, 해당 저장소 안에서 사용자의 조작에 따라 파일 읽기, 수정, 추가, 삭제, 커밋, 브랜치 생성/삭제가 수행됩니다.

GitHub 연동 정보와 토큰은 GitHub 기능 제공을 위해 저장됩니다. GitHub 계정 연동을 해제하면 서비스에 저장된 GitHub 연동 정보, 토큰, 선택 저장소 정보는 삭제되며, GitHub 설정에서 앱 권한을 별도로 철회할 수 있습니다.

## 6. 파일, 외부 저장소, 캐시

HanDrive 파일은 서비스가 설정한 저장 위치에 보관됩니다. 운영 설정에 따라 SSD 또는 HDD 저장 위치가 사용될 수 있습니다. GitHub 저장소 캐시는 사용자가 설정한 저장 위치 정책을 따르며, 저장소 파일 표시와 Git 작업 속도 개선을 위해 사용됩니다.

Google Drive 파일은 기본적으로 Google Drive에 보관되며, 서비스는 Google Picker로 선택한 파일/폴더 및 선택한 폴더 안의 항목에 대해 사용자의 요청을 처리하기 위해 필요한 범위에서 파일 메타데이터와 파일 내용을 전송하거나 일시적으로 처리할 수 있습니다. 사용자가 Google Drive 파일을 HanDrive로 드래그 앤 드롭하여 업로드하면 해당 파일 사본이 HanDrive 저장소에 저장될 수 있습니다.

공개 공유 링크를 만든 파일은 링크를 아는 사람이 접근할 수 있습니다. 공개 쓰기 기능을 켠 Markdown 파일은 권한을 가진 외부 사용자가 내용을 수정할 수 있으므로, 민감한 정보 공유에 주의해야 합니다.

## 7. 제3자 제공 및 처리 위탁

서비스는 이용자의 개인정보를 판매하지 않습니다. 다만 다음 경우에는 필요한 범위에서 정보가 외부 서비스로 전달될 수 있습니다.

- Google: Google 로그인, Google 계정 연동, Google Picker 선택 파일/폴더 표시 및 조작
- GitHub: GitHub 로그인, GitHub 계정 연동, 저장소 목록 조회 및 저장소 파일/브랜치/커밋 조작
- Forgejo/Gitea: HanDrive 기반 Git 저장소 생성, 인증, clone/push, 협업자 관리
- 이메일 전송 서비스: 회원가입, 인증, 알림, 문의 대응
- CDN, 터널, 웹 서버, 호스팅 및 보안 인프라: 서비스 제공, 보안, 성능, 로그 분석
- 사용자가 직접 선택한 외부 검색 엔진: 루트 검색에서 검색어 제출 시 해당 검색 엔진이 검색어를 처리
- 로컬 AI 서버: 사용자가 챗봇 또는 번역 기능에 입력한 텍스트 처리

법령상 의무 이행, 수사기관의 적법한 요청, 이용자의 사전 동의, 서비스 보안과 권리 보호를 위해 필요한 경우에도 정보가 제공될 수 있습니다.

## 8. 쿠키와 세션

서비스는 로그인 상태 유지, 세션 식별, 보안 확인, 사용자 설정 저장을 위해 쿠키와 브라우저 저장소를 사용할 수 있습니다. 이용자는 브라우저 설정에서 쿠키를 삭제하거나 차단할 수 있으나, 이 경우 로그인과 일부 기능 이용이 제한될 수 있습니다.

## 9. 보관 기간 및 파기

개인정보는 수집 및 이용 목적 달성에 필요한 기간 동안 보관됩니다.

- 계정 정보: 회원 탈퇴 또는 계정 삭제 시까지
- OAuth 연동 정보와 토큰: 계정 연동 해제, 계정 삭제 또는 토큰 갱신 불가 시까지
- HanDrive 파일과 공유 설정: 사용자가 삭제하거나 계정이 삭제될 때까지
- Git/GitHub 저장소 캐시: 저장소 선택 해제, 연동 해제, 계정 삭제 또는 운영상 정리 시까지
- 접속 로그와 오류 로그: 보안, 장애 분석, 남용 방지에 필요한 기간 동안
- 문의 기록: 문의 처리와 분쟁 대응에 필요한 기간 동안

보관 목적이 사라진 정보는 복구가 어렵도록 삭제하거나 식별할 수 없는 형태로 처리합니다. 백업이나 로그에 남은 정보는 정기 보관 주기에 따라 삭제될 수 있습니다.

## 10. 이용자의 권리

이용자는 언제든지 다음 권리를 행사할 수 있습니다.

- 본인 개인정보 조회, 수정, 삭제 요청
- HanDrive 파일 삭제 및 공유 해제
- GitHub 또는 Google 계정 연동 해제
- Google Drive 표시 옵션 끄기 및 Google Picker 선택 항목 삭제
- 계정 삭제 요청
- 개인정보 처리에 대한 문의 또는 이의 제기

OAuth 앱 권한 철회는 각 제공자(Google, GitHub)의 계정 보안 설정에서도 직접 수행할 수 있습니다.

## 11. 개인정보 보호 조치

서비스는 개인정보 보호를 위해 다음 조치를 적용합니다.

- 비밀번호 해시 저장
- 세션과 토큰 접근 제한
- 사용자별 HanDrive 경로 및 권한 확인
- Google Drive 표시 옵션 비활성화 시 관련 API 차단 및 Google Picker 선택 항목 기준 권한 확인
- GitHub 저장소 선택 및 권한 확인
- 보안 로그와 오류 로그 점검
- 운영상 필요한 최소 권한 원칙 적용

## 12. 개인정보 보호책임자

서비스 운영자: 임한별  
문의 이메일: limhan456@naver.com

## 13. 정책 변경

본 개인정보 처리방침은 법령, 외부 API 정책, 서비스 기능 변경에 따라 수정될 수 있습니다. 중요한 변경 사항은 본 페이지 또는 서비스 화면을 통해 안내합니다.

---

# Privacy Policy

Effective Date: 2026-06-19

Hanplanet ("Service") values user privacy and user files. This Privacy Policy explains how Hanplanet, HanDrive, account authentication, GitHub integration, Google integration, Google Drive integration, search, translation, chat, and related features collect, use, store, and protect information.

## 1. Information We Collect

We may collect or store the following information as needed to provide the Service:

- Account data: username, password hash, name, email address, profile image, language preference, theme preference, search engine preference, consent timestamps
- Authentication data: login session cookies, security tokens, email verification codes, two-factor authentication state, IP address, User-Agent, request logs
- HanDrive data: files and folders users upload, create, edit, delete, move, or share; file names, paths, MIME types, sizes, modification times, permissions, share links, public write settings, folder icons, sync exclusions
- Git/Forgejo data: repository names, branch names, commit messages, commit IDs, collaborator permissions, repository access tokens
- GitHub integration data: GitHub user ID, login, display name, email, avatar URL, OAuth access token, refresh token, token expiration, scopes, selected repositories, branch/commit/file metadata, and repository cache
- Google integration data: Google user ID, email, display name, avatar URL, OAuth access token, refresh token, token expiration, scopes, Google Drive display setting, and Google Picker selected item list
- Google Drive data: when the user enables Google Drive display and selects files or folders with Google Picker, Drive file/folder IDs, names, MIME types, sizes, modification times, parent folders, file content, and results of download/upload/create/update/delete/move actions for selected files/folders and items inside selected folders
- Usage data: page visits, button clicks, API calls, error logs, game records, root quick links, public portfolio content, and support inquiries
- AI/translation input: text users submit to the chatbot or translation feature and the generated response

## 2. How We Collect Information

Information may be collected when users:

- Sign up, log in, update account settings, or edit profiles
- Authenticate or link accounts through GitHub or Google OAuth
- Upload, edit, download, delete, share, sync, or convert HanDrive files to Git repositories
- Enable Google Drive display, select files or folders with Google Picker, and view, upload, edit, move, or delete selected items or items inside selected folders
- Select GitHub repositories and view, edit, add, delete, commit, or manage branches for repository files
- Use search, translation, chatbot, game, portfolio, or inquiry features
- Interact with the Service in ways that generate security, error, or abuse-prevention logs

## 3. How We Use Information

We use collected information to:

- Create accounts, authenticate logins, maintain sessions, and protect accounts
- Provide HanDrive upload, organization, preview, edit, download, delete, sharing, and sync features
- Display and manage Google Drive files/folders selected with Google Picker, and items inside selected folders, only when authorized by the user
- Display and manage selected GitHub repositories in HanDrive only when selected by the user
- Provide Git/Forgejo repository creation, branch/commit management, and collaborator permissions
- Provide requested search, translation, chatbot, game, and portfolio features
- Respond to inquiries, analyze errors, audit security, prevent abuse, and maintain service stability
- Comply with laws and enforce the Terms of Service

## 4. Google API Data

The Service uses Google OAuth, the Google Drive API, and Google Picker. Google profile and email information are used for login, sign-up, and account linking. Google Drive item lists are stored only when the user enables the Google Drive display option in the account modal and selects files or folders with Google Picker. The Service displays only those selected files/folders, and items inside selected folders, inside HanDrive. The Service does not arbitrarily sync or display the user's entire Google Drive. Within the selected scope, read, upload, create, update, rename, move, and delete actions are performed only in response to user actions.

When Google Drive display is disabled, the server blocks Google Drive-related HanDrive API access. When a Google account is unlinked, locally stored Google connection data, tokens, and Google Picker selected item lists are deleted. Users may also revoke app access in their Google account security settings.

The Service does not use Google user data for advertising, sale, user tracking, or training general AI/ML models. The Service's use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

## 5. GitHub Data

The Service uses GitHub OAuth for login, sign-up, and account linking, and to load repositories that the user is authorized to access. Only repositories selected by the user are displayed in the HanDrive root. Within selected repositories, the Service performs file read, edit, add, delete, commit, and branch create/delete actions only in response to user actions.

GitHub connection data and tokens are stored to provide GitHub features. When a GitHub account is unlinked, locally stored GitHub connection data, tokens, and selected repository information are deleted. Users may also revoke app access in GitHub settings.

## 6. Files, External Storage, and Cache

HanDrive files are stored in the configured service storage location. Depending on operational settings, SSD or HDD storage may be used. GitHub repository cache follows the configured storage location policy and is used to display repository files and improve Git operation speed.

Google Drive files remain in Google Drive by default. For files/folders selected with Google Picker, and items inside selected folders, the Service may transmit or temporarily process file metadata and file content only as needed to fulfill user-requested actions. If a user drags and drops a Google Drive file into HanDrive, a copy of that file may be stored in HanDrive storage.

Files shared through public links may be accessible to anyone with the link. Public-write Markdown files may be edited by authorized external users, so users should avoid sharing sensitive information publicly.

## 7. Third Parties and Service Providers

We do not sell personal information. Information may be processed by the following services only as needed:

- Google: Google login, Google account linking, and display/management of Google Picker selected files/folders
- GitHub: GitHub login, GitHub account linking, repository listing, and repository file/branch/commit actions
- Forgejo/Gitea: HanDrive-based Git repositories, authentication, clone/push, and collaborator management
- Email providers: sign-up, verification, notifications, and support
- CDN, tunnel, web server, hosting, and security infrastructure: service delivery, security, performance, and logs
- External search engines selected by the user: search queries submitted from the root search feature
- Local AI server: text submitted by the user to chatbot or translation features

Information may also be disclosed when required by law, valid legal request, user consent, service security, or rights protection.

## 8. Cookies and Sessions

The Service may use cookies and browser storage to keep users logged in, identify sessions, perform security checks, and store preferences. Users may block or delete cookies in browser settings, but login and some features may not work correctly.

## 9. Retention and Deletion

We keep information only as long as needed for the purposes described in this policy.

- Account data: until account deletion
- OAuth connection data and tokens: until unlinking, account deletion, or token invalidation
- HanDrive files and sharing settings: until deleted by the user or account deletion
- Git/GitHub repository cache: until repository deselection, unlinking, account deletion, or operational cleanup
- Access and error logs: as needed for security, troubleshooting, and abuse prevention
- Support inquiries: as needed for support and dispute handling

When retention is no longer necessary, information is deleted or de-identified. Backup or log copies may be removed according to regular retention cycles.

## 10. User Rights

Users may request or perform:

- Access, correction, or deletion of personal information
- Deletion of HanDrive files and removal of sharing links
- GitHub or Google account unlinking
- Disabling Google Drive display and removing Google Picker selected items
- Account deletion
- Privacy inquiries or objections

Users may also revoke OAuth app access directly in Google or GitHub account security settings.

## 11. Security Measures

The Service applies security measures such as:

- Password hash storage
- Restricted access to sessions and tokens
- User-specific HanDrive path and permission checks
- Server-side blocking of Google Drive APIs when Google Drive display is disabled and permission checks based on Google Picker selected items
- GitHub repository selection and permission checks
- Security and error log monitoring
- Least-privilege operational access

## 12. Contact

Operator: Hanbyeol Lim  
Email: limhan456@naver.com

## 13. Changes

This Privacy Policy may be updated to reflect changes in laws, external API policies, or Service features. Material changes will be announced on this page or within the Service.
