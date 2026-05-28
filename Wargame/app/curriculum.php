<?php
declare(strict_types=1);

function wargame_v2_cases(): array
{
    return [
        [
            'phase' => '오로라 게임넷 침투',
            'slug' => 'aurora_gamenet',
            'incident' => '당신은 오락실 토너먼트 운영망에 침투해 경품 출고 권한을 얻어야 합니다. 공개 페이지에서 내부 콘솔까지 이어지는 최소 침투 흐름으로 시작합니다.',
            'steps' => [
                ['title' => '숨은 운영 라우트', 'slug' => 'hidden_ops_route', 'kind' => 'hidden_route', 'goal' => '토너먼트 안내 페이지에 남은 비공개 라우트 단서를 찾아 운영 콘솔 진입 URL을 직접 호출하세요.'],
                ['title' => '플레이어 번호 탈취', 'slug' => 'player_idor', 'kind' => 'idor', 'goal' => '내 프로필 조회 파라미터를 조작해 다른 플레이어의 경품 보관함 레코드에 접근하세요.'],
                ['title' => '스태프 쿠키 변조', 'slug' => 'staff_cookie', 'kind' => 'cookie_admin', 'goal' => '브라우저 쿠키의 역할 값을 바꿔 스태프 전용 패널을 여세요.'],
                ['title' => '카운터 로그인 우회', 'slug' => 'counter_login_sqli', 'kind' => 'sqli_bypass', 'goal' => '로그인 필터에 SQL 구문을 주입해 카운터 직원 인증을 우회하세요.'],
                ['title' => '경품 금고 열기', 'slug' => 'prize_vault_chain', 'kind' => 'chain_lock', 'goal' => '숨은 라우트, 대상 레코드, 관리자 쿠키를 함께 사용해 경품 금고의 마지막 잠금을 여세요.'],
            ],
        ],
        [
            'phase' => '미러룸 예약 허브',
            'slug' => 'mirror_room_hub',
            'incident' => '당신은 예약 허브의 초대 링크를 가로채고 마스터키 예약권을 탈취해야 합니다. 링크 이동, 파일 경로, 토큰, HTTP 메서드 우회를 차례로 사용합니다.',
            'steps' => [
                ['title' => '초대 링크 납치', 'slug' => 'invite_redirect', 'kind' => 'open_redirect', 'goal' => '예약 초대 링크의 이동 대상을 외부 수집 서버로 바꿔 티켓 값을 빼내세요.'],
                ['title' => '힌트 파일 경로 탈출', 'slug' => 'hint_path_escape', 'kind' => 'path_traversal', 'goal' => '힌트 파일 뷰어의 경로 파라미터를 조작해 공개 폴더 밖의 비밀 파일을 읽으세요.'],
                ['title' => '마스터키 토큰 위조', 'slug' => 'masterkey_jwt', 'kind' => 'jwt_forge', 'goal' => '서명 검증이 빠진 JWT의 권한 클레임을 바꿔 마스터키 토큰으로 통과하세요.'],
                ['title' => '잠긴 예약 강제 취소', 'slug' => 'method_override_cancel', 'kind' => 'method_override', 'goal' => '프록시가 신뢰하는 메서드 오버라이드 헤더를 이용해 잠긴 예약 상태를 변경하세요.'],
                ['title' => '탈출문 컨트롤러', 'slug' => 'escape_door_chain', 'kind' => 'chain_lock', 'goal' => '탈취한 링크와 토큰 단서를 조합해 탈출문 컨트롤러의 권한 검사를 우회하세요.'],
            ],
        ],
        [
            'phase' => '루멘 라디오 백스테이지',
            'slug' => 'lumen_radio',
            'incident' => '당신은 인터넷 라디오 백스테이지의 편성표 API를 파고들어 미공개 송출 키를 노립니다. API 탐색과 브라우저 보안 경계를 직접 공격합니다.',
            'steps' => [
                ['title' => '스키마 속 금고 필드', 'slug' => 'graphql_vault_field', 'kind' => 'graphql_probe', 'goal' => 'GraphQL 탐색 쿼리로 숨겨진 금고 필드를 찾고 해당 필드를 요청하세요.'],
                ['title' => '외부 Origin 판정 우회', 'slug' => 'cors_origin_bypass', 'kind' => 'cors_misconfig', 'goal' => '허술한 CORS Origin 반사를 이용해 외부 사이트에서 읽을 수 있는 응답을 받아내세요.'],
                ['title' => '메타데이터 리퀘스트', 'slug' => 'metadata_ssrf', 'kind' => 'ssrf_fetch', 'goal' => 'URL 미리보기 기능을 내부 메타데이터 주소로 보내 송출 키를 가져오세요.'],
                ['title' => '캐시 헤더 오염', 'slug' => 'cache_host_poison', 'kind' => 'cache_poison', 'goal' => '신뢰되지 않은 Host 계열 헤더로 캐시된 백스테이지 링크를 내 수집 도메인으로 오염시키세요.'],
                ['title' => '라이브 콘솔 장악', 'slug' => 'live_console_chain', 'kind' => 'chain_lock', 'goal' => 'API 탐색과 헤더 조작으로 얻은 값을 조합해 라이브 콘솔 잠금을 해제하세요.'],
            ],
        ],
        [
            'phase' => '픽셀펫 배틀 아레나',
            'slug' => 'pixelpet_arena',
            'incident' => '당신은 가상 펫 배틀 아레나의 아이템 제작기와 이미지 업로드를 발판으로 GM 권한을 노립니다. 파서와 실행 경계를 직접 공격합니다.',
            'steps' => [
                ['title' => 'XML 먹이 레시피', 'slug' => 'feed_xxe', 'kind' => 'xxe_probe', 'goal' => '먹이 레시피 XML 파서에 외부 엔티티를 넣어 서버 로컬 비밀 코드 파일을 읽으세요.'],
                ['title' => '스킨 미리보기 템플릿', 'slug' => 'skin_ssti', 'kind' => 'ssti_probe', 'goal' => '스킨 미리보기 템플릿 표현식을 조작해 서버 설정에 있는 값을 출력하세요.'],
                ['title' => '펫 이름 핑 명령', 'slug' => 'pet_ping_injection', 'kind' => 'command_injection', 'goal' => '상태 확인 명령의 입력값에 쉘 메타문자를 넣어 클리어 코드 출력 명령을 이어 붙이세요.'],
                ['title' => '아바타 확장자 속이기', 'slug' => 'avatar_upload_bypass', 'kind' => 'upload_bypass', 'goal' => '이미지 업로드 검사가 파일명과 Content-Type을 따로 믿는 약점을 이용해 실행 가능한 파일을 통과시키세요.'],
                ['title' => 'GM 보상 박스', 'slug' => 'gm_reward_chain', 'kind' => 'chain_lock', 'goal' => '파서, 명령 주입, 업로드 우회로 얻은 단서를 모아 GM 보상 박스를 여세요.'],
            ],
        ],
        [
            'phase' => '스프린트 보드 SaaS',
            'slug' => 'sprintboard_saas',
            'incident' => '당신은 협업 보드 SaaS의 테넌트 경계를 넘어 관리자 워크스페이스를 차지해야 합니다. 현대 웹앱 권한 모델을 단계적으로 공격합니다.',
            'steps' => [
                ['title' => '필터 객체 주입', 'slug' => 'nosql_filter_injection', 'kind' => 'nosql_injection', 'goal' => '로그인 필터가 객체 조건을 그대로 받는 약점을 이용해 비밀번호 검사를 우회하세요.'],
                ['title' => '프로필 권한 대량 할당', 'slug' => 'profile_mass_assignment', 'kind' => 'mass_assignment', 'goal' => '프로필 저장 요청에 숨겨진 role 필드를 추가해 워크스페이스 관리자 권한을 얻으세요.'],
                ['title' => '직렬화된 세션 승격', 'slug' => 'serialized_session_admin', 'kind' => 'deserialization', 'goal' => '클라이언트가 보관하는 직렬화 프로필 값을 고쳐 관리자 세션으로 복원시키세요.'],
                ['title' => 'Host 헤더 관리자 분기', 'slug' => 'host_header_admin', 'kind' => 'host_header', 'goal' => '라우터가 신뢰하는 Host 계열 헤더를 관리자 서브도메인처럼 바꿔 내부 분기로 들어가세요.'],
                ['title' => '테넌트 루트 권한', 'slug' => 'tenant_root_chain', 'kind' => 'chain_lock', 'goal' => '테넌트 ID, 관리자 세션, Host 헤더 조건을 함께 만족시켜 루트 워크스페이스를 여세요.'],
            ],
        ],
        [
            'phase' => '벨벳 스트리밍 스튜디오',
            'slug' => 'velvet_streaming',
            'incident' => '당신은 스트리밍 스튜디오의 크리에이터 콘솔에 침투해 미공개 영상을 공개 전에 재생해야 합니다. 콘텐츠 관리 흐름을 우회합니다.',
            'steps' => [
                ['title' => '초안 콘솔 찾기', 'slug' => 'draft_console_route', 'kind' => 'hidden_route', 'goal' => '랜딩 페이지에 숨어 있는 초안 콘솔 경로를 찾아 직접 진입하세요.'],
                ['title' => '영상 ID 바꿔보기', 'slug' => 'video_idor', 'kind' => 'idor', 'goal' => '내 영상 상세 요청의 ID를 바꿔 다른 크리에이터의 비공개 영상 레코드를 열람하세요.'],
                ['title' => '프리미어 쿠키 승격', 'slug' => 'premiere_cookie', 'kind' => 'cookie_admin', 'goal' => '프리미어 심사 쿠키를 조작해 공개 전 재생 버튼을 활성화하세요.'],
                ['title' => '스튜디오 로그인 우회', 'slug' => 'studio_sqli', 'kind' => 'sqli_bypass', 'goal' => '스튜디오 로그인 검색식에 SQL 조건을 주입해 심사 계정으로 통과하세요.'],
                ['title' => '프리미어 키 발급', 'slug' => 'premiere_key_chain', 'kind' => 'chain_lock', 'goal' => '초안 경로와 영상 레코드, 승격 쿠키를 조합해 프리미어 재생 키를 발급받으세요.'],
            ],
        ],
        [
            'phase' => '블랙박스 렌탈 키오스크',
            'slug' => 'blackbox_rental',
            'incident' => '당신은 장비 렌탈 키오스크에서 반납 전 장비를 원격 해제해야 합니다. 리다이렉트, 파일 뷰어, 토큰, 메서드 변조를 다시 응용합니다.',
            'steps' => [
                ['title' => '반납 링크 빼돌리기', 'slug' => 'return_redirect', 'kind' => 'open_redirect', 'goal' => '반납 확인 링크의 next 값을 외부 도메인으로 바꿔 반납 티켓을 가로채세요.'],
                ['title' => '장비 매뉴얼 경로 탈출', 'slug' => 'manual_traversal', 'kind' => 'path_traversal', 'goal' => '매뉴얼 뷰어가 허용한 상대 경로를 벗어나 잠금 해제 파일을 읽으세요.'],
                ['title' => '정비 토큰 위조', 'slug' => 'maintenance_jwt', 'kind' => 'jwt_forge', 'goal' => '정비자 토큰의 role 클레임을 바꿔 원격 해제 API가 믿는 토큰을 만드세요.'],
                ['title' => '반납 상태 덮어쓰기', 'slug' => 'override_return_method', 'kind' => 'method_override', 'goal' => '메서드 오버라이드 헤더로 읽기 전용 반납 요청을 상태 변경 요청처럼 처리시키세요.'],
                ['title' => '보관함 잠금 해제', 'slug' => 'locker_release_chain', 'kind' => 'chain_lock', 'goal' => '가로챈 티켓과 정비자 권한을 조합해 장비 보관함의 최종 잠금을 해제하세요.'],
            ],
        ],
        [
            'phase' => '코스모스 팬클럽 플랫폼',
            'slug' => 'cosmos_fanclub',
            'incident' => '당신은 팬클럽 플랫폼의 비공개 멤버십 공지를 외부에서 읽을 수 있게 만들어야 합니다. API, CORS, SSRF, 캐시 오염을 하나의 공격 흐름으로 묶습니다.',
            'steps' => [
                ['title' => '멤버십 GraphQL 탐색', 'slug' => 'membership_graphql', 'kind' => 'graphql_probe', 'goal' => 'GraphQL 스키마에서 멤버십 금고 객체를 찾아 직접 조회하세요.'],
                ['title' => '팬사이트 Origin 반사', 'slug' => 'fansite_cors', 'kind' => 'cors_misconfig', 'goal' => '허용 목록 검사가 느슨한 CORS 설정을 이용해 외부 팬사이트 Origin으로 응답을 읽으세요.'],
                ['title' => '이미지 프록시 내부 요청', 'slug' => 'image_proxy_ssrf', 'kind' => 'ssrf_fetch', 'goal' => '이미지 프록시 URL을 내부 메타데이터 주소로 바꿔 서버 쪽 요청을 유도하세요.'],
                ['title' => '공지 캐시 도메인 오염', 'slug' => 'notice_cache_poison', 'kind' => 'cache_poison', 'goal' => '캐시 키에 섞이는 Host 헤더를 바꿔 공지 링크를 내 수집 도메인으로 저장시키세요.'],
                ['title' => 'VIP 공지 열람', 'slug' => 'vip_notice_chain', 'kind' => 'chain_lock', 'goal' => '스키마 탐색, 내부 요청, 캐시 오염 결과를 조합해 VIP 공지를 여세요.'],
            ],
        ],
        [
            'phase' => '네온 프린트 파이프라인',
            'slug' => 'neon_print_pipeline',
            'incident' => '당신은 주문형 인쇄 파이프라인에서 프린터 작업자 권한을 얻고 내부 템플릿을 조작해야 합니다. 문서 파서와 업로드 경계를 공격합니다.',
            'steps' => [
                ['title' => '작업지시 XML 엔티티', 'slug' => 'jobticket_xxe', 'kind' => 'xxe_probe', 'goal' => '작업지시 XML에 외부 엔티티를 넣어 프린터 서버의 로컬 비밀 코드를 읽으세요.'],
                ['title' => '명함 템플릿 실행', 'slug' => 'businesscard_ssti', 'kind' => 'ssti_probe', 'goal' => '명함 템플릿 미리보기에서 서버 템플릿 표현식을 실행해 설정 값을 출력하세요.'],
                ['title' => '프린터 상태 명령 주입', 'slug' => 'printer_command_injection', 'kind' => 'command_injection', 'goal' => '프린터 상태 확인 입력값에 명령 구분자를 넣어 클리어 코드 파일 출력 명령을 실행시키세요.'],
                ['title' => 'PDF 업로드 우회', 'slug' => 'pdf_upload_bypass', 'kind' => 'upload_bypass', 'goal' => '업로드 검사가 확장자와 MIME을 따로 믿는 틈을 이용해 스크립트 파일을 문서처럼 통과시키세요.'],
                ['title' => '작업자 큐 장악', 'slug' => 'worker_queue_chain', 'kind' => 'chain_lock', 'goal' => '파서와 업로드 우회로 얻은 권한 단서를 조합해 작업자 큐 관리 화면을 여세요.'],
            ],
        ],
        [
            'phase' => '솔라리스 리워드 월렛',
            'slug' => 'solaris_rewards',
            'incident' => '당신은 포인트 리워드 월렛에서 다른 사용자의 잔액 경계를 넘고 관리자 보정 기능까지 열어야 합니다. 데이터 바인딩 취약점을 집중 훈련합니다.',
            'steps' => [
                ['title' => '조건 객체 로그인', 'slug' => 'wallet_nosql_login', 'kind' => 'nosql_injection', 'goal' => '로그인 요청의 비밀번호 필드를 객체 조건으로 바꿔 검증을 우회하세요.'],
                ['title' => '리워드 권한 필드 삽입', 'slug' => 'reward_mass_assignment', 'kind' => 'mass_assignment', 'goal' => '프로필 수정 요청에 숨겨진 reward_admin 필드를 추가해 보정 메뉴 권한을 얻으세요.'],
                ['title' => '월렛 프로필 역직렬화', 'slug' => 'wallet_deserialize', 'kind' => 'deserialization', 'goal' => '클라이언트 프로필 쿠키를 조작해 서버가 관리자 월렛으로 복원하게 만드세요.'],
                ['title' => '관리자 Host 분기', 'slug' => 'wallet_host_header', 'kind' => 'host_header', 'goal' => 'Host 헤더를 관리자 서브도메인처럼 위조해 일반 라우터 밖의 분기로 들어가세요.'],
                ['title' => '보정 승인 잠금', 'slug' => 'reward_adjust_chain', 'kind' => 'chain_lock', 'goal' => '권한 필드와 Host 분기 단서를 조합해 리워드 보정 승인 잠금을 여세요.'],
            ],
        ],
        [
            'phase' => '아틀라스 지도 제작소',
            'slug' => 'atlas_mapworks',
            'incident' => '당신은 지도 제작소의 내부 타일 서버에서 비공개 레이어를 내려받아야 합니다. 라우트 발견부터 SQL 우회까지 기본 침투를 더 깊게 다룹니다.',
            'steps' => [
                ['title' => '타일 관리자 라우트', 'slug' => 'tile_admin_route', 'kind' => 'hidden_route', 'goal' => '공개 지도 페이지에 남은 관리자 타일 라우트를 찾아 직접 요청하세요.'],
                ['title' => '레이어 ID 경계 넘기', 'slug' => 'layer_idor', 'kind' => 'idor', 'goal' => '내 레이어 조회 ID를 바꿔 비공개 지도 레이어 레코드를 열람하세요.'],
                ['title' => '편집자 쿠키 조작', 'slug' => 'editor_cookie', 'kind' => 'cookie_admin', 'goal' => '편집자 여부를 판단하는 쿠키 값을 조작해 레이어 편집 패널에 접근하세요.'],
                ['title' => '좌표 검색 SQL 우회', 'slug' => 'coordinate_sqli', 'kind' => 'sqli_bypass', 'goal' => '좌표 검색 로그인 필터에 SQL 조건을 주입해 지도 편집자 인증을 우회하세요.'],
                ['title' => '비공개 레이어 추출', 'slug' => 'private_layer_chain', 'kind' => 'chain_lock', 'goal' => '관리자 라우트, 레이어 ID, 편집자 쿠키를 함께 이용해 비공개 레이어 키를 추출하세요.'],
            ],
        ],
        [
            'phase' => '바이트서커스 티켓 게이트',
            'slug' => 'bytecircus_gate',
            'incident' => '당신은 공연 티켓 게이트에서 스캔 전 티켓을 관리자 승인 상태로 바꿔야 합니다. 링크, 파일, 토큰, 메서드 조작을 조합합니다.',
            'steps' => [
                ['title' => '검표 링크 리다이렉트', 'slug' => 'scan_redirect', 'kind' => 'open_redirect', 'goal' => '검표 준비 링크의 이동 주소를 외부 수집 주소로 바꿔 검표 토큰을 가져가세요.'],
                ['title' => '좌석표 파일 탈출', 'slug' => 'seatmap_traversal', 'kind' => 'path_traversal', 'goal' => '좌석표 뷰어의 file 파라미터를 조작해 보호된 티켓 키 파일을 읽으세요.'],
                ['title' => '검표원 JWT 승격', 'slug' => 'scanner_jwt', 'kind' => 'jwt_forge', 'goal' => '검표원 JWT의 권한 클레임을 admin으로 바꿔 승인 API가 받아들이게 만드세요.'],
                ['title' => '티켓 상태 메서드 우회', 'slug' => 'ticket_method_override', 'kind' => 'method_override', 'goal' => '프록시 메서드 오버라이드 헤더로 읽기 요청을 티켓 승인 요청처럼 처리시키세요.'],
                ['title' => '백스테이지 티켓 발급', 'slug' => 'backstage_ticket_chain', 'kind' => 'chain_lock', 'goal' => '티켓 토큰, 보호 파일, 승격 JWT를 조합해 백스테이지 티켓 발급 잠금을 푸세요.'],
            ],
        ],
        [
            'phase' => '하이브노트 지식베이스',
            'slug' => 'hivenote_kb',
            'incident' => '당신은 지식베이스 서비스의 비공개 운영 문서를 외부 도메인에서 읽을 수 있게 만들어야 합니다. API 탐색과 서버 쪽 요청을 연결합니다.',
            'steps' => [
                ['title' => '문서 GraphQL 금고', 'slug' => 'document_graphql_vault', 'kind' => 'graphql_probe', 'goal' => 'GraphQL 스키마에서 숨겨진 문서 금고 필드를 찾아 조회하세요.'],
                ['title' => '문서 뷰어 CORS 반사', 'slug' => 'doc_cors_reflection', 'kind' => 'cors_misconfig', 'goal' => '문서 뷰어가 Origin을 그대로 반사하는 약점을 이용해 외부 Origin으로 내용을 읽으세요.'],
                ['title' => '링크 미리보기 SSRF', 'slug' => 'link_preview_ssrf', 'kind' => 'ssrf_fetch', 'goal' => '링크 미리보기 기능에 내부 메타데이터 URL을 넣어 서버가 대신 요청하게 만드세요.'],
                ['title' => '문서 캐시 Poison', 'slug' => 'document_cache_poison', 'kind' => 'cache_poison', 'goal' => '캐시가 X-Forwarded-Host를 신뢰하는 약점을 이용해 공유 문서 링크를 오염시키세요.'],
                ['title' => '운영 문서 언락', 'slug' => 'ops_doc_chain', 'kind' => 'chain_lock', 'goal' => 'GraphQL 필드와 SSRF 결과, 캐시 오염 단서를 묶어 운영 문서 잠금을 여세요.'],
            ],
        ],
        [
            'phase' => '루비콘 폼 빌더',
            'slug' => 'rubicon_forms',
            'incident' => '당신은 폼 빌더 서비스의 설문 템플릿 파서와 파일 첨부 기능을 악용해 응답 관리자 권한을 노립니다. 입력 해석 계층을 뚫는 훈련입니다.',
            'steps' => [
                ['title' => '설문 XML 가져오기', 'slug' => 'survey_xxe', 'kind' => 'xxe_probe', 'goal' => '설문 가져오기 XML에 외부 엔티티를 심어 서버 로컬 값을 읽어내세요.'],
                ['title' => '감사 문구 템플릿', 'slug' => 'thanks_ssti', 'kind' => 'ssti_probe', 'goal' => '감사 문구 미리보기 템플릿에 서버 변수를 출력하는 표현식을 넣으세요.'],
                ['title' => '웹훅 테스트 명령', 'slug' => 'webhook_command_injection', 'kind' => 'command_injection', 'goal' => '웹훅 연결 테스트 입력값에 명령 구분자를 넣어 클리어 코드 출력 명령을 실행시키세요.'],
                ['title' => '첨부 파일 타입 우회', 'slug' => 'attachment_upload_bypass', 'kind' => 'upload_bypass', 'goal' => '첨부 파일 검사가 MIME만 믿는 틈을 이용해 서버 스크립트를 업로드 요청에 섞으세요.'],
                ['title' => '응답 관리자 획득', 'slug' => 'response_admin_chain', 'kind' => 'chain_lock', 'goal' => 'XML, 템플릿, 업로드 우회에서 얻은 단서를 모아 응답 관리자 잠금을 해제하세요.'],
            ],
        ],
        [
            'phase' => '오닉스 플러그인 마켓',
            'slug' => 'onyx_plugin_market',
            'incident' => '당신은 플러그인 마켓에서 게시자 권한을 가로채 악성 업데이트를 올릴 수 있는 위치까지 들어가야 합니다. 권한 필드와 세션 신뢰 문제를 공격합니다.',
            'steps' => [
                ['title' => '게시자 로그인 조건 우회', 'slug' => 'publisher_nosql', 'kind' => 'nosql_injection', 'goal' => '게시자 로그인 필터에 객체 조건을 넣어 비밀번호 검사를 우회하세요.'],
                ['title' => '플러그인 role 필드 삽입', 'slug' => 'plugin_mass_assignment', 'kind' => 'mass_assignment', 'goal' => '플러그인 설정 저장 요청에 숨겨진 maintainer 필드를 넣어 관리자 권한을 얻으세요.'],
                ['title' => '마켓 세션 재조립', 'slug' => 'market_session_deserialize', 'kind' => 'deserialization', 'goal' => '직렬화된 세션 쿠키를 관리자 게시자 값으로 바꿔 서버가 그대로 복원하게 만드세요.'],
                ['title' => '업데이트 Host 전환', 'slug' => 'update_host_header', 'kind' => 'host_header', 'goal' => '업데이트 라우터가 신뢰하는 Host 헤더를 관리자 채널로 바꿔 내부 분기를 타세요.'],
                ['title' => '릴리즈 서명 잠금', 'slug' => 'release_sign_chain', 'kind' => 'chain_lock', 'goal' => '게시자 권한, 세션 조작, Host 전환을 조합해 릴리즈 서명 잠금을 푸세요.'],
            ],
        ],
        [
            'phase' => '스펙터 메일룸',
            'slug' => 'specter_mailroom',
            'incident' => '당신은 메일룸 자동분류 서비스의 사내 메일 라벨러를 장악해야 합니다. 기본 침투 5단계를 메일 시스템에 다시 적용합니다.',
            'steps' => [
                ['title' => '라벨러 관리 경로', 'slug' => 'labeler_hidden_route', 'kind' => 'hidden_route', 'goal' => '공개 메일 추적 화면에 숨어 있는 라벨러 관리 경로를 찾아 직접 접속하세요.'],
                ['title' => '메일함 ID 가로지르기', 'slug' => 'mailbox_idor', 'kind' => 'idor', 'goal' => '메일함 조회 ID를 바꿔 다른 사용자의 격리 메일 레코드를 확인하세요.'],
                ['title' => '분류자 쿠키 승격', 'slug' => 'classifier_cookie', 'kind' => 'cookie_admin', 'goal' => '분류자 권한을 판단하는 쿠키를 조작해 격리 해제 버튼을 활성화하세요.'],
                ['title' => '메일룸 로그인 주입', 'slug' => 'mailroom_sqli', 'kind' => 'sqli_bypass', 'goal' => '메일룸 로그인 검색식에 SQL 조건을 주입해 분류자 계정으로 들어가세요.'],
                ['title' => '격리 메일 해제', 'slug' => 'quarantine_release_chain', 'kind' => 'chain_lock', 'goal' => '관리 경로, 격리 레코드, 분류자 쿠키를 조합해 격리 메일 해제 키를 얻으세요.'],
            ],
        ],
        [
            'phase' => '크립트 패스포트 부스',
            'slug' => 'crypt_passport',
            'incident' => '당신은 가상 이벤트 패스포트 부스에서 참가자 스탬프를 조작해야 합니다. 링크와 토큰을 이용한 상태 변경을 다룹니다.',
            'steps' => [
                ['title' => '스탬프 링크 리다이렉트', 'slug' => 'stamp_redirect', 'kind' => 'open_redirect', 'goal' => '스탬프 수령 링크의 이동 주소를 바꿔 스탬프 티켓을 외부로 보내세요.'],
                ['title' => '배지 이미지 경로 탈출', 'slug' => 'badge_path_traversal', 'kind' => 'path_traversal', 'goal' => '배지 이미지 뷰어의 경로를 벗어나 보호된 스탬프 파일을 읽으세요.'],
                ['title' => '심사위원 JWT 조작', 'slug' => 'judge_jwt', 'kind' => 'jwt_forge', 'goal' => '심사위원 JWT의 권한 클레임을 바꿔 최종 스탬프 승인 권한을 얻으세요.'],
                ['title' => '스탬프 상태 메서드 변조', 'slug' => 'stamp_method_override', 'kind' => 'method_override', 'goal' => '메서드 오버라이드 헤더로 조회 요청을 스탬프 승인 요청처럼 처리시키세요.'],
                ['title' => '완주 패스포트 발급', 'slug' => 'passport_finish_chain', 'kind' => 'chain_lock', 'goal' => '스탬프 티켓, 보호 파일, 심사위원 토큰을 묶어 완주 패스포트를 발급받으세요.'],
            ],
        ],
        [
            'phase' => '모노리스 배너 익스체인지',
            'slug' => 'monolith_banner',
            'incident' => '당신은 광고 배너 익스체인지의 내부 캠페인 리포트를 외부에서 열람할 수 있게 만들어야 합니다. 브라우저-서버 경계와 캐시를 집중 공격합니다.',
            'steps' => [
                ['title' => '캠페인 GraphQL 필드', 'slug' => 'campaign_graphql', 'kind' => 'graphql_probe', 'goal' => 'GraphQL 탐색으로 숨겨진 캠페인 금고 필드를 찾고 직접 조회하세요.'],
                ['title' => '광고 미리보기 CORS', 'slug' => 'ad_preview_cors', 'kind' => 'cors_misconfig', 'goal' => '미리보기 API가 Origin을 느슨하게 반사하는 틈을 이용해 외부 Origin에서 응답을 읽으세요.'],
                ['title' => '썸네일 프록시 SSRF', 'slug' => 'thumbnail_proxy_ssrf', 'kind' => 'ssrf_fetch', 'goal' => '썸네일 프록시 URL을 내부 메타데이터 주소로 바꿔 서버 쪽 요청을 발생시키세요.'],
                ['title' => '배너 캐시 오염', 'slug' => 'banner_cache_poison', 'kind' => 'cache_poison', 'goal' => 'X-Forwarded-Host를 이용해 배너 캐시에 내 수집 도메인 링크를 저장시키세요.'],
                ['title' => '리포트 금고 열기', 'slug' => 'report_vault_chain', 'kind' => 'chain_lock', 'goal' => 'GraphQL, SSRF, 캐시 오염 단서를 조합해 내부 캠페인 리포트 금고를 여세요.'],
            ],
        ],
        [
            'phase' => '폴라리스 번역 엔진',
            'slug' => 'polaris_translate',
            'incident' => '당신은 번역 엔진 관리 콘솔에서 문장 템플릿과 업로드 파이프라인을 이용해 관리자 토큰을 얻어야 합니다. 파서 공격을 다시 응용합니다.',
            'steps' => [
                ['title' => '용어집 XML 엔티티', 'slug' => 'glossary_xxe', 'kind' => 'xxe_probe', 'goal' => '용어집 XML 가져오기 기능에 외부 엔티티를 넣어 서버 로컬 비밀 코드를 읽으세요.'],
                ['title' => '번역 템플릿 표현식', 'slug' => 'translation_ssti', 'kind' => 'ssti_probe', 'goal' => '번역 결과 템플릿에 서버 설정 변수를 출력하는 표현식을 삽입하세요.'],
                ['title' => '엔진 상태 명령 주입', 'slug' => 'engine_command_injection', 'kind' => 'command_injection', 'goal' => '엔진 상태 확인 입력값에 쉘 메타문자를 넣어 클리어 코드 출력 명령을 이어 붙이세요.'],
                ['title' => '사전 파일 업로드 우회', 'slug' => 'dictionary_upload_bypass', 'kind' => 'upload_bypass', 'goal' => '사전 파일 업로드 검사가 신뢰하는 MIME 값을 속여 실행 가능한 파일을 통과시키세요.'],
                ['title' => '관리 토큰 발급', 'slug' => 'translator_admin_chain', 'kind' => 'chain_lock', 'goal' => 'XML, 템플릿, 업로드 단서를 조합해 번역 엔진 관리 토큰을 발급받으세요.'],
            ],
        ],
        [
            'phase' => '나이트폴 계약 포털',
            'slug' => 'nightfall_contracts',
            'incident' => '당신은 계약 포털에서 검토자 권한을 얻고 비공개 계약 상태를 바꿔야 합니다. 객체 조건, 대량 할당, 세션 조작을 강화합니다.',
            'steps' => [
                ['title' => '검토자 조건 로그인', 'slug' => 'reviewer_nosql_login', 'kind' => 'nosql_injection', 'goal' => '로그인 필터의 비밀번호 값을 조건 객체로 바꿔 검토자 인증을 우회하세요.'],
                ['title' => '계약 role 필드 주입', 'slug' => 'contract_mass_assignment', 'kind' => 'mass_assignment', 'goal' => '계약 프로필 저장 요청에 숨겨진 approver 필드를 추가해 승인 권한을 얻으세요.'],
                ['title' => '검토 세션 역직렬화', 'slug' => 'review_session_deserialize', 'kind' => 'deserialization', 'goal' => '직렬화된 검토 세션 쿠키를 조작해 관리자 권한으로 복원되게 만드세요.'],
                ['title' => '승인 Host 헤더 전환', 'slug' => 'approval_host_header', 'kind' => 'host_header', 'goal' => 'Host 계열 헤더를 승인 전용 서브도메인처럼 바꿔 내부 라우터 분기를 타세요.'],
                ['title' => '계약 승인 금고', 'slug' => 'contract_approval_chain', 'kind' => 'chain_lock', 'goal' => '조건 로그인, 대량 할당, Host 전환을 조합해 계약 승인 금고를 여세요.'],
            ],
        ],
        [
            'phase' => '제로데이 연습장',
            'slug' => 'zeroday_range',
            'incident' => '당신은 연습장 포털을 첫 침투 실험장으로 삼아 지금까지의 기본 웹 침투 기술을 더 적은 힌트로 수행합니다.',
            'steps' => [
                ['title' => '비밀 랩 라우트', 'slug' => 'secret_lab_route', 'kind' => 'hidden_route', 'goal' => '연습장 시작 화면에서 비밀 랩 라우트를 찾아 직접 진입하세요.'],
                ['title' => '랩 계정 IDOR', 'slug' => 'lab_account_idor', 'kind' => 'idor', 'goal' => '계정 상세 ID를 조작해 다른 훈련생의 잠긴 랩 레코드를 열람하세요.'],
                ['title' => '운영 쿠키 탈바꿈', 'slug' => 'operator_cookie', 'kind' => 'cookie_admin', 'goal' => '운영 여부를 판단하는 쿠키 값을 바꿔 랩 운영 패널을 여세요.'],
                ['title' => '훈련장 로그인 SQLi', 'slug' => 'range_login_sqli', 'kind' => 'sqli_bypass', 'goal' => '로그인 조건에 SQL 구문을 주입해 훈련장 운영자 인증을 우회하세요.'],
                ['title' => '운영 패널 장악', 'slug' => 'operator_panel_chain', 'kind' => 'chain_lock', 'goal' => '비밀 라우트, 잠긴 계정, 운영 쿠키를 조합해 운영 패널을 장악하세요.'],
            ],
        ],
        [
            'phase' => '메타링크 초대 서버',
            'slug' => 'metalink_invites',
            'incident' => '당신은 초대 서버에서 외부 링크와 서명 없는 토큰을 이용해 비공개 그룹에 들어가야 합니다. 초대 흐름을 공격합니다.',
            'steps' => [
                ['title' => '그룹 초대 리다이렉트', 'slug' => 'group_invite_redirect', 'kind' => 'open_redirect', 'goal' => '그룹 초대 링크의 next 값을 외부 수집 주소로 바꿔 초대 티켓을 빼내세요.'],
                ['title' => '그룹 파일 경로 탈출', 'slug' => 'group_file_traversal', 'kind' => 'path_traversal', 'goal' => '그룹 파일 뷰어에서 상대 경로를 벗어나 보호된 초대 키 파일을 읽으세요.'],
                ['title' => '초대 토큰 클레임 위조', 'slug' => 'invite_jwt_claim', 'kind' => 'jwt_forge', 'goal' => '초대 JWT의 group_admin 클레임을 조작해 그룹 관리자 권한을 얻으세요.'],
                ['title' => '초대 승인 메서드 우회', 'slug' => 'invite_method_override', 'kind' => 'method_override', 'goal' => '메서드 오버라이드 헤더로 초대 조회 요청을 승인 요청처럼 처리시키세요.'],
                ['title' => '비공개 그룹 입장', 'slug' => 'private_group_chain', 'kind' => 'chain_lock', 'goal' => '티켓, 보호 파일, 위조 토큰을 조합해 비공개 그룹 입장 잠금을 푸세요.'],
            ],
        ],
        [
            'phase' => '옵시디언 대시보드',
            'slug' => 'obsidian_dashboard',
            'incident' => '당신은 운영 대시보드의 내부 메트릭과 관리자 알림을 외부에서 읽을 수 있게 만들어야 합니다. API와 캐시 취약점을 운영 화면에 적용합니다.',
            'steps' => [
                ['title' => '메트릭 GraphQL 금고', 'slug' => 'metric_graphql_vault', 'kind' => 'graphql_probe', 'goal' => 'GraphQL 스키마 탐색으로 숨겨진 메트릭 금고 필드를 찾아 직접 조회하세요.'],
                ['title' => '대시보드 CORS 반사', 'slug' => 'dashboard_cors', 'kind' => 'cors_misconfig', 'goal' => '대시보드 API가 Origin을 그대로 믿는 약점을 이용해 외부 Origin으로 응답을 읽으세요.'],
                ['title' => '위젯 프록시 SSRF', 'slug' => 'widget_proxy_ssrf', 'kind' => 'ssrf_fetch', 'goal' => '위젯 프록시의 URL을 내부 메타데이터 주소로 바꿔 서버 쪽 요청을 유도하세요.'],
                ['title' => '알림 캐시 Poison', 'slug' => 'alert_cache_poison', 'kind' => 'cache_poison', 'goal' => '신뢰되지 않은 X-Forwarded-Host로 관리자 알림 캐시 링크를 오염시키세요.'],
                ['title' => '관리 알림 금고', 'slug' => 'admin_alert_chain', 'kind' => 'chain_lock', 'goal' => '스키마 필드, SSRF 결과, 캐시 오염 단서를 조합해 관리 알림 금고를 여세요.'],
            ],
        ],
        [
            'phase' => '쿼츠 렌더 팜',
            'slug' => 'quartz_renderfarm',
            'incident' => '당신은 렌더 팜에서 장면 파일 파서와 작업 실행기를 이용해 렌더 노드 권한을 얻어야 합니다. 서버 입력 처리의 위험한 경계를 다룹니다.',
            'steps' => [
                ['title' => '장면 XML 엔티티', 'slug' => 'scene_xxe', 'kind' => 'xxe_probe', 'goal' => '장면 가져오기 XML에 외부 엔티티를 넣어 렌더 노드의 로컬 비밀 코드를 읽으세요.'],
                ['title' => '렌더 템플릿 주입', 'slug' => 'render_ssti', 'kind' => 'ssti_probe', 'goal' => '렌더 이름 템플릿에 서버 변수 출력 표현식을 넣어 설정 값을 노출시키세요.'],
                ['title' => '노드 상태 명령 주입', 'slug' => 'node_command_injection', 'kind' => 'command_injection', 'goal' => '노드 상태 확인 입력값에 명령 구분자를 넣어 클리어 코드 출력 명령을 연결하세요.'],
                ['title' => '장면 파일 업로드 우회', 'slug' => 'scene_upload_bypass', 'kind' => 'upload_bypass', 'goal' => '장면 파일 업로드 검사가 믿는 Content-Type을 속여 스크립트 파일을 통과시키세요.'],
                ['title' => '렌더 노드 셸 권한', 'slug' => 'render_node_chain', 'kind' => 'chain_lock', 'goal' => 'XML, 템플릿, 명령 주입 단서를 모아 렌더 노드 제어 잠금을 여세요.'],
            ],
        ],
        [
            'phase' => '베가 데이터룸',
            'slug' => 'vega_dataroom',
            'incident' => '당신은 데이터룸에서 게스트 계정을 관리자 검토자로 승격해 비공개 자료를 열람해야 합니다. 권한 상승 취약점을 종합합니다.',
            'steps' => [
                ['title' => '게스트 조건 로그인', 'slug' => 'guest_nosql_login', 'kind' => 'nosql_injection', 'goal' => '로그인 필터가 객체 조건을 허용하는 약점을 이용해 게스트 검사를 우회하세요.'],
                ['title' => '자료실 권한 대량 할당', 'slug' => 'dataroom_mass_assignment', 'kind' => 'mass_assignment', 'goal' => '자료실 프로필 저장 요청에 숨겨진 reviewer 필드를 넣어 검토자 권한을 얻으세요.'],
                ['title' => '자료실 세션 변조', 'slug' => 'dataroom_deserialization', 'kind' => 'deserialization', 'goal' => '직렬화된 프로필 쿠키를 관리자 검토자 값으로 바꿔 서버가 그대로 복원하게 하세요.'],
                ['title' => '검토 Host 헤더 분기', 'slug' => 'review_host_header', 'kind' => 'host_header', 'goal' => 'Host 헤더를 검토 전용 서브도메인으로 위조해 내부 라우터 분기를 타세요.'],
                ['title' => '비공개 자료 금고', 'slug' => 'private_file_chain', 'kind' => 'chain_lock', 'goal' => '권한 상승, 세션 변조, Host 분기 조건을 합쳐 비공개 자료 금고를 여세요.'],
            ],
        ],
        [
            'phase' => '최종 작전: 레드라인',
            'slug' => 'redline_final',
            'incident' => '당신은 반년 과정의 마지막 작전에서 하나의 가상 침해 체인을 완성해야 합니다. 정찰, 권한 우회, 토큰 위조, 서버 입력 공격, 권한 상승을 모두 사용합니다.',
            'steps' => [
                ['title' => '침투 시작 라우트', 'slug' => 'entry_route', 'kind' => 'hidden_route', 'goal' => '외부 포털에서 숨겨진 침투 시작 라우트를 찾아 첫 내부 화면으로 들어가세요.'],
                ['title' => '핵심 자산 IDOR', 'slug' => 'core_asset_idor', 'kind' => 'idor', 'goal' => '자산 조회 ID를 조작해 핵심 자산 레코드를 열람하고 다음 권한 단서를 얻으세요.'],
                ['title' => '최종 토큰 위조', 'slug' => 'final_jwt_forge', 'kind' => 'jwt_forge', 'goal' => '서명 검증이 빠진 토큰의 클레임을 바꿔 최종 작전 권한을 획득하세요.'],
                ['title' => '오퍼레이터 권한 상승', 'slug' => 'final_mass_assignment', 'kind' => 'mass_assignment', 'goal' => '프로필 저장 요청에 숨겨진 operator 필드를 추가해 오퍼레이터 권한을 얻으세요.'],
                ['title' => '레드라인 종료 코드', 'slug' => 'redline_shutdown_chain', 'kind' => 'chain_lock', 'goal' => '마지막으로 라우트, 핵심 자산 ID, 오퍼레이터 권한을 조합해 종료 코드를 획득하세요.'],
            ],
        ],
    ];
}

function wargame_v2_kind_meta(string $kind): array
{
    $map = [
        'hidden_route' => [
            'tags' => ['Recon', 'HTML', 'Endpoint Discovery'],
            'tips' => ['view-source endpoint discovery', 'hidden route enumeration', 'HTML data attributes'],
        ],
        'idor' => [
            'tags' => ['IDOR', 'Access Control', 'Parameter Tampering'],
            'tips' => ['IDOR object identifiers', 'authorization boundary testing', 'parameter tampering'],
        ],
        'cookie_admin' => [
            'tags' => ['Cookie Tampering', 'Access Control', 'Session State'],
            'tips' => ['browser cookie editing', 'client-side trust boundary', 'role cookie tampering'],
        ],
        'sqli_bypass' => [
            'tags' => ['SQL Injection', 'Authentication Bypass', 'SQLite'],
            'tips' => ['SQL injection login bypass', 'boolean conditions in SQL', 'SQLite authentication filters'],
        ],
        'open_redirect' => [
            'tags' => ['Open Redirect', 'URL Validation', 'Token Leakage'],
            'tips' => ['open redirect exploitation', 'URL allowlist bypass', 'token leakage through redirects'],
        ],
        'path_traversal' => [
            'tags' => ['Path Traversal', 'File Disclosure', 'URL Encoding'],
            'tips' => ['directory traversal payloads', '../ path normalization', 'URL encoding traversal'],
        ],
        'jwt_forge' => [
            'tags' => ['JWT', 'Base64URL', 'Claim Tampering'],
            'tips' => ['JWT header payload signature', 'alg none risk', 'base64url claim editing'],
        ],
        'method_override' => [
            'tags' => ['HTTP Method Override', 'Access Control', 'Request Smuggling'],
            'tips' => ['X-HTTP-Method-Override', 'method based authorization', 'proxy method handling'],
        ],
        'graphql_probe' => [
            'tags' => ['GraphQL', 'Introspection', 'API Enumeration'],
            'tips' => ['GraphQL introspection', 'hidden fields in schemas', 'GraphQL query crafting'],
        ],
        'cors_misconfig' => [
            'tags' => ['CORS', 'Origin Reflection', 'Browser Security'],
            'tips' => ['CORS origin reflection', 'Access-Control-Allow-Origin', 'credentialed CORS risk'],
        ],
        'ssrf_fetch' => [
            'tags' => ['SSRF', 'URL Validation', 'Metadata Service'],
            'tips' => ['SSRF to metadata service', 'URL parser confusion', 'server-side fetch risks'],
        ],
        'cache_poison' => [
            'tags' => ['Web Cache Poisoning', 'HTTP Headers', 'Host Header'],
            'tips' => ['web cache poisoning', 'unkeyed headers', 'X-Forwarded-Host abuse'],
        ],
        'xxe_probe' => [
            'tags' => ['XXE', 'XML', 'File Disclosure'],
            'tips' => ['XML external entity', 'DOCTYPE entity payloads', 'local file disclosure via XXE'],
        ],
        'ssti_probe' => [
            'tags' => ['SSTI', 'Template Injection', 'Payload Crafting'],
            'tips' => ['server-side template injection', '{{7*7}} probing', 'template context variables'],
        ],
        'command_injection' => [
            'tags' => ['Command Injection', 'Shell Metacharacters', 'Input Validation'],
            'tips' => ['command injection payloads', 'shell metacharacters', 'argument injection risks'],
        ],
        'upload_bypass' => [
            'tags' => ['File Upload', 'MIME Confusion', 'Extension Bypass'],
            'tips' => ['file upload validation bypass', 'MIME type confusion', 'double extension payloads'],
        ],
        'nosql_injection' => [
            'tags' => ['NoSQL Injection', 'Authentication Bypass', 'Object Injection'],
            'tips' => ['NoSQL operator injection', '$ne authentication bypass', 'object based query filters'],
        ],
        'mass_assignment' => [
            'tags' => ['Mass Assignment', 'Access Control', 'API Abuse'],
            'tips' => ['mass assignment vulnerabilities', 'hidden role fields', 'API parameter binding'],
        ],
        'deserialization' => [
            'tags' => ['Insecure Deserialization', 'Cookie Tampering', 'Session State'],
            'tips' => ['client-side serialized state', 'base64 JSON cookies', 'deserialization trust boundary'],
        ],
        'host_header' => [
            'tags' => ['Host Header Injection', 'Reverse Proxy', 'Access Control'],
            'tips' => ['Host header injection', 'X-Forwarded-Host routing', 'reverse proxy trust boundaries'],
        ],
        'chain_lock' => [
            'tags' => ['Exploit Chaining', 'Access Control', 'Privilege Escalation'],
            'tips' => ['exploit chain thinking', 'combine route id and role controls', 'privilege escalation workflow'],
        ],
    ];

    return $map[$kind] ?? $map['hidden_route'];
}

function wargame_v2_answer_meta(string $kind): array
{
    $map = [
        'hidden_route' => ['prefix' => 'route', 'label' => '콘솔 진입 코드'],
        'idor' => ['prefix' => 'record', 'label' => '레코드 접근 코드'],
        'cookie_admin' => ['prefix' => 'panel', 'label' => '패널 접근 코드'],
        'sqli_bypass' => ['prefix' => 'session', 'label' => '세션 발급 코드'],
        'open_redirect' => ['prefix' => 'capture', 'label' => '수집 확인 코드'],
        'path_traversal' => ['prefix' => 'file', 'label' => '파일 열람 코드'],
        'jwt_forge' => ['prefix' => 'token', 'label' => '토큰 승인 코드'],
        'method_override' => ['prefix' => 'state', 'label' => '상태 변경 코드'],
        'graphql_probe' => ['prefix' => 'schema', 'label' => '스키마 열람 코드'],
        'cors_misconfig' => ['prefix' => 'origin', 'label' => 'Origin 읽기 코드'],
        'ssrf_fetch' => ['prefix' => 'meta', 'label' => '메타데이터 코드'],
        'cache_poison' => ['prefix' => 'cache', 'label' => '캐시 오염 코드'],
        'xxe_probe' => ['prefix' => 'entity', 'label' => '엔티티 해석 코드'],
        'ssti_probe' => ['prefix' => 'render', 'label' => '렌더링 코드'],
        'command_injection' => ['prefix' => 'shell', 'label' => '명령 실행 코드'],
        'upload_bypass' => ['prefix' => 'upload', 'label' => '업로드 처리 코드'],
        'nosql_injection' => ['prefix' => 'account', 'label' => '계정 세션 코드'],
        'mass_assignment' => ['prefix' => 'role', 'label' => '권한 반영 코드'],
        'deserialization' => ['prefix' => 'restore', 'label' => '세션 복원 코드'],
        'host_header' => ['prefix' => 'vhost', 'label' => '가상호스트 코드'],
        'chain_lock' => ['prefix' => 'chain', 'label' => '연쇄 해제 코드'],
    ];

    return $map[$kind] ?? ['prefix' => 'clear', 'label' => '클리어 코드'];
}

function wargame_v2_answer_value(string $prefix, int $level, string $slug): string
{
    return $prefix . '{' . str_pad((string) $level, 3, '0', STR_PAD_LEFT) . '_' . $slug . '}';
}

function wargame_v2_base64url(string $value): string
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function wargame_v2_jwt(array $claims): string
{
    $header = ['alg' => 'none', 'typ' => 'JWT'];
    return wargame_v2_base64url(json_encode($header, JSON_UNESCAPED_SLASHES)) . '.'
        . wargame_v2_base64url(json_encode($claims, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) . '.';
}

function wargame_v2_tips(array $kindTips, int $kindOccurrence): array
{
    $tips = array_values(array_unique(array_filter($kindTips, 'is_string')));
    if ($tips === []) {
        return [];
    }

    if ($kindOccurrence <= 1) {
        return array_slice($tips, 0, 2);
    }

    $tipIndex = min($kindOccurrence - 1, count($tips) - 1);
    return [$tips[$tipIndex]];
}

function wargame_v2_list_challenges(): array
{
    $challenges = [];
    $level = 1;
    $kindOccurrences = [];

    foreach (wargame_v2_cases() as $weekIndex => $case) {
        $weekNumber = $weekIndex + 1;
        foreach ((array) $case['steps'] as $dayIndex => $step) {
            $dayNumber = $dayIndex + 1;
            $id = 'level' . $level;
            $kind = (string) ($step['kind'] ?? 'hidden_route');
            $meta = wargame_v2_kind_meta($kind);
            $answerMeta = wargame_v2_answer_meta($kind);
            $kindOccurrences[$kind] = ($kindOccurrences[$kind] ?? 0) + 1;
            $slug = (string) $case['slug'] . '_' . (string) $step['slug'];
            $answerPrefix = (string) $answerMeta['prefix'];
            $flag = wargame_v2_answer_value($answerPrefix, $level, $slug);
            $difficulty = $weekNumber <= 5 ? 'Easy' : ($weekNumber <= 15 ? 'Medium' : 'Hard');
            $tags = (array) $meta['tags'];

            $challenges[$id] = [
                'id' => $id,
                'week' => $weekNumber,
                'day' => $dayNumber,
                'phase' => (string) $case['phase'],
                'mission' => (string) $case['incident'],
                'name' => sprintf('W%02d-D%d %s', $weekNumber, $dayNumber, (string) $step['title']),
                'title' => (string) $step['title'],
                'case_slug' => (string) $case['slug'],
                'challenge_slug' => $slug,
                'kind' => $kind,
                'tags' => $tags,
                'difficulty' => $difficulty,
                'desc' => sprintf(
                    "%d주차 %d일차\n\n상황: %s\n목표: %s\n\n목표를 달성하면 대상 서비스가 표시하는 %s를 제출하세요. 형식: %s",
                    $weekNumber,
                    $dayNumber,
                    (string) $case['incident'],
                    (string) $step['goal'],
                    (string) $answerMeta['label'],
                    $answerPrefix . '{...}'
                ),
                'tasks' => [],
                'artifact_title' => '',
                'artifact' => '',
                'lab_url' => '/lab.php?challenge=' . rawurlencode($id),
                'tips' => wargame_v2_tips((array) ($meta['tips'] ?? []), $kindOccurrences[$kind]),
                'answer_label' => (string) $answerMeta['label'],
                'answer_format' => $answerPrefix . '{...}',
                'clear_code' => $flag,
                'flag' => $flag,
            ];
            $level++;
        }
    }

    return $challenges;
}

function wargame_v2_lab_context(array $challenge): array
{
    $slug = (string) ($challenge['challenge_slug'] ?? $challenge['id']);
    $seed = hash('sha256', $slug);
    $targetId = 'obj-' . substr($seed, 0, 6);
    $route = '/ops/' . substr($seed, 6, 8);
    $gate = 'gate-' . substr($seed, 14, 8);
    $fileName = 'clear-code-' . substr($seed, 22, 8) . '.txt';
    $scope = 'scope-' . substr($seed, 30, 8);
    $ticket = 'ticket-' . substr($seed, 38, 8);
    $metadataKey = 'meta/' . substr($seed, 46, 8);

    return [
        'kind' => (string) ($challenge['kind'] ?? 'hidden_route'),
        'slug' => $slug,
        'title' => (string) ($challenge['title'] ?? $challenge['name']),
        'case_title' => (string) ($challenge['phase'] ?? 'Wargame'),
        'incident' => (string) ($challenge['mission'] ?? ''),
        'flag' => (string) ($challenge['flag'] ?? ''),
        'answer_label' => (string) ($challenge['answer_label'] ?? '클리어 코드'),
        'answer_format' => (string) ($challenge['answer_format'] ?? 'clear{...}'),
        'route' => $route,
        'gate' => $gate,
        'self_id' => 'obj-' . substr($seed, 54, 6),
        'target_id' => $targetId,
        'role_cookie' => 'wargame_role',
        'file_name' => $fileName,
        'safe_file' => 'readme.txt',
        'scope' => $scope,
        'ticket' => $ticket,
        'metadata_url' => 'http://169.254.169.254/latest/meta-data/' . $metadataKey,
        'metadata_key' => $metadataKey,
        'collector_host' => 'https://collector.training/capture',
        'target_host' => str_replace('_', '-', $slug) . '.training.local',
        'starter_jwt' => wargame_v2_jwt(['role' => 'guest', 'scope' => $scope, 'sub' => 'trainee']),
        'admin_jwt' => wargame_v2_jwt(['role' => 'admin', 'scope' => $scope, 'sub' => 'trainee']),
        'starter_profile' => base64_encode(json_encode(['role' => 'guest', 'workspace' => 'public'], JSON_UNESCAPED_SLASHES)),
        'admin_profile' => base64_encode(json_encode(['role' => 'admin', 'workspace' => 'root'], JSON_UNESCAPED_SLASHES)),
    ];
}
