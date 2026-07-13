<?php
declare(strict_types=1);

return [
    [
        'id' => 'web-v1-01-http',
        'module' => '01-http-and-trust',
        'order' => 10,
        'title' => 'HTTP 요청 지도 읽기',
        'eyebrow' => '모듈 1 · 웹의 언어',
        'difficulty' => '입문',
        'minutes' => 20,
        'prerequisites' => [],
        'client' => '오로라 문구점',
        'story' => '오로라 문구점의 할인 확인 화면은 평범해 보이지만, 서버 응답에는 운영자가 다음 점검 화면으로 이동할 수 있도록 남긴 진단 헤더가 있습니다.',
        'brief' => '개발자 도구의 Network 패널에서 요청과 응답을 분리해 읽고, 응답 헤더가 알려 주는 진단 엔드포인트를 직접 호출하세요.',
        'target' => [
            'objective' => '진단 응답 헤더에 숨은 경로와 필요한 요청 헤더를 찾아 점검 화면을 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-01-http',
            'surface' => 'HTTP method · path · request header · response header',
        ],
        'objectives' => [
            'HTTP 요청의 method, path, query, header, body를 구분한다.',
            '응답의 status, header, body가 서로 다른 정보를 전달한다는 점을 확인한다.',
            '화면에 보이지 않는 네트워크 정보를 개발자 도구에서 찾는다.',
        ],
        'lesson' => [
            'summary' => '웹 해킹의 첫 단계는 화면을 보는 것이 아니라 브라우저와 서버가 주고받는 메시지를 읽는 것입니다.',
            'paragraphs' => [
                '브라우저는 주소와 폼 입력을 HTTP 요청으로 바꾸고, 서버는 상태 코드·헤더·본문으로 이루어진 응답을 돌려줍니다. 같은 화면을 열어도 method나 header가 달라지면 서버가 전혀 다른 동작을 할 수 있습니다.',
                '개발자 도구의 Network 패널에서는 요청 URL, method, 요청 헤더, 폼 데이터, 응답 헤더와 본문을 각각 볼 수 있습니다. Elements 패널은 최종 화면을 보여 주지만 Network 패널은 그 화면이 만들어진 과정을 보여 줍니다.',
                '이 실습에서는 실제 외부 시스템을 스캔하지 않습니다. 오직 이 미션이 제공한 요청을 관찰하고, 응답이 명시적으로 가리키는 훈련용 경로만 호출합니다.',
            ],
            'diagram' => '/assets/lessons/http-flow.svg',
            'table' => [
                'columns' => ['구성 요소', '예시', '확인할 질문'],
                'rows' => [
                    ['Method', 'GET, POST', '읽기 요청인가, 상태를 바꾸는 요청인가?'],
                    ['Path / Query', '/coupon?code=SPRING', '어떤 자원과 입력값을 선택하는가?'],
                    ['Request Header', 'X-Debug-Mode: inspect', '브라우저가 서버에 어떤 문맥을 전달하는가?'],
                    ['Response Header', 'X-Lab-Next: /diagnostics', '본문 밖에서 서버가 어떤 단서를 주는가?'],
                    ['Response Body', 'HTML 또는 JSON', '서버가 처리 결과를 어떻게 표현하는가?'],
                ],
            ],
            'code' => [
                'language' => 'http',
                'content' => "GET /lab.php?mission=web-v1-01-http HTTP/1.1\nHost: wargame.hanplanet.com\nAccept: text/html\n\nHTTP/1.1 200 OK\nX-Lab-Next: /lab.php?mission=web-v1-01-http&view=diagnostic\nContent-Type: text/html; charset=utf-8",
            ],
        ],
        'resources' => [
            ['label' => 'MDN · HTTP 개요', 'url' => 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview'],
            ['label' => 'MDN · HTTP 메시지', 'url' => 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Messages'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '요청을 다시 관찰하기', 'body' => '개발자 도구를 연 뒤 페이지를 새로고침하고 Network 목록에서 document 요청을 선택하세요.'],
            ['level' => 2, 'title' => '본문 밖의 정보', 'body' => 'Headers 탭의 Response Headers를 살펴보세요. X-Lab-Next라는 이름이 다음 위치를 알려 줍니다.'],
            ['level' => 3, 'title' => '진단 요청 완성하기', 'body' => '찾은 view 값을 주소에 적용한 뒤, 화면이 요구하는 X-Debug-Mode 요청 헤더를 inspect 값으로 보내세요.'],
        ],
        'lab' => ['type' => 'http_headers'],
        'completion' => [
            'event' => 'http_diagnostic_reached',
            'email' => [
                'subject' => '[Aurora] 첫 번째 진단 경로 확인 완료',
                'preview' => '요청과 응답을 분리해서 읽었습니다. 다음 미션에서는 브라우저가 보관하는 값을 직접 검증합니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-02-client-trust',
        'module' => '01-http-and-trust',
        'order' => 20,
        'title' => '브라우저 값은 권한이 아니다',
        'eyebrow' => '모듈 1 · 신뢰 경계',
        'difficulty' => '입문',
        'minutes' => 25,
        'prerequisites' => ['web-v1-01-http'],
        'client' => '리프 리뷰 센터',
        'story' => '리프 리뷰 센터는 검토자 화면을 숨기기 위해 브라우저 쿠키에 역할을 기록했습니다. 서버는 그 값이 사용자가 바꿀 수 있다는 사실을 잊었습니다.',
        'brief' => '쿠키가 요청마다 서버로 되돌아가는 과정을 확인하고, 클라이언트가 보관한 역할 값을 서버가 그대로 신뢰할 때 어떤 일이 생기는지 재현하세요.',
        'target' => [
            'objective' => '훈련용 role 토큰의 내용을 확인하고 reviewer 권한으로 리뷰 보관함을 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-02-client-trust',
            'surface' => 'Cookie · Base64URL · client-side trust',
        ],
        'objectives' => [
            '쿠키가 서버가 아닌 브라우저에 저장되는 값임을 설명한다.',
            'Base64URL 인코딩과 무결성 검증의 차이를 구분한다.',
            '화면 숨김과 서버 측 인가 검사가 다른 통제임을 이해한다.',
        ],
        'lesson' => [
            'summary' => '클라이언트가 보관하거나 전송하는 값은 사용자가 바꿀 수 있으므로, 권한의 근거로 단독 사용하면 안 됩니다.',
            'paragraphs' => [
                '쿠키는 서버가 Set-Cookie 응답 헤더로 제안하고 브라우저가 저장한 뒤, 이후 요청의 Cookie 헤더로 다시 보내는 작은 데이터입니다. 개발자 도구나 프록시를 사용하면 사용자는 자신의 브라우저에 저장된 값을 바꿀 수 있습니다.',
                'Base64URL은 데이터를 읽기 쉬운 문자 집합으로 바꾸는 인코딩일 뿐 암호화나 서명이 아닙니다. 디코딩한 JSON의 role 값을 바꾸고 다시 인코딩할 수 있다면 서버는 원본 여부를 판별할 수 없습니다.',
                '안전한 서비스는 서버 세션에서 권한을 조회하거나, 서명된 값을 검증한 뒤에도 현재 권한을 서버 데이터와 대조합니다. 버튼을 숨기는 JavaScript는 편의 기능이지 접근 통제가 아닙니다.',
            ],
            'diagram' => '/assets/lessons/access-control.svg',
            'table' => [
                'columns' => ['통제 위치', '사용자 변경 가능', '보안 판단에 사용'],
                'rows' => [
                    ['숨겨진 버튼 / disabled 속성', '가능', '불가'],
                    ['hidden input', '가능', '불가'],
                    ['서명 없는 role 쿠키', '가능', '불가'],
                    ['서버 세션의 role + 자원별 인가', '직접 변경 불가', '가능'],
                ],
            ],
            'code' => [
                'language' => 'text',
                'content' => "Cookie: leaf_role=eyJyb2xlIjoicmVhZGVyIn0\n\nBase64URL decode\n{\"role\":\"reader\"}\n\n변조 목표\n{\"role\":\"reviewer\"}",
            ],
        ],
        'resources' => [
            ['label' => 'MDN · HTTP 쿠키 사용하기', 'url' => 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies'],
            ['label' => 'OWASP · Authorization Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '브라우저 저장소 확인', 'body' => 'Application 또는 Storage 패널에서 이 미션 경로에 설정된 leaf_role 쿠키를 찾으세요.'],
            ['level' => 2, 'title' => '인코딩된 JSON', 'body' => '쿠키 값은 Base64URL로 인코딩된 JSON입니다. 패딩이 없어도 디코딩할 수 있습니다.'],
            ['level' => 3, 'title' => '서버가 기대하는 역할', 'body' => 'role 값을 reviewer로 바꾸고 Base64URL로 다시 인코딩한 뒤 페이지를 새로고침하세요.'],
        ],
        'lab' => ['type' => 'role_token'],
        'completion' => [
            'event' => 'review_archive_opened',
            'email' => [
                'subject' => '[Leaf] 리뷰 보관함 접근 기록',
                'preview' => '클라이언트 값만 신뢰하면 화면을 숨겨도 권한을 지킬 수 없습니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-03-idor',
        'module' => '01-http-and-trust',
        'order' => 30,
        'title' => '내 문서 번호를 바꾸면?',
        'eyebrow' => '모듈 1 · 접근 통제',
        'difficulty' => '초급',
        'minutes' => 30,
        'prerequisites' => ['web-v1-02-client-trust'],
        'client' => '노바 문서함',
        'story' => '노바 문서함은 로그인 여부는 확인하지만, 요청한 문서가 현재 사용자의 것인지는 확인하지 않습니다. 활동 로그에는 다른 문서의 번호가 우연히 노출되어 있습니다.',
        'brief' => '문서 ID가 단순한 선택자일 뿐 권한 증명이 아니라는 사실을 확인하고, 소유권 검사가 빠진 SQLite 조회를 이용해 다른 사용자의 문서를 읽으세요.',
        'target' => [
            'objective' => '활동 로그에서 목표 문서 ID를 찾고 URL의 id 값을 바꿔 외부 소유자의 문서를 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-03-idor',
            'surface' => 'Query parameter · object identifier · SQLite authorization',
        ],
        'objectives' => [
            '인증, 세션, 인가의 역할을 각각 설명한다.',
            'ID를 추측할 수 있다는 사실보다 소유권 검사 누락이 핵심 원인임을 이해한다.',
            '수평 권한 상승을 요청과 SQL 관점에서 추적한다.',
        ],
        'lesson' => [
            'summary' => '문서 번호는 어느 행을 찾을지 알려 줄 뿐, 그 행을 볼 권한까지 증명하지 않습니다.',
            'paragraphs' => [
                'IDOR는 사용자가 전달한 객체 식별자를 서버가 직접 조회하면서 현재 사용자가 그 객체에 접근할 수 있는지 확인하지 않을 때 발생합니다. 숫자 ID, UUID, 파일명 모두 같은 문제가 생길 수 있습니다.',
                '취약한 쿼리는 WHERE id = ? 조건만 사용합니다. 안전한 쿼리는 같은 요청에서도 WHERE id = ? AND owner_id = ?처럼 현재 사용자와 자원의 관계를 함께 확인합니다.',
                '복잡하거나 무작위인 ID는 추측을 어렵게 만들 수 있지만 인가를 대신하지 않습니다. 로그, 링크, 공유 화면에서 ID가 노출될 수 있으므로 모든 객체 요청에서 서버 측 검사가 필요합니다.',
            ],
            'diagram' => '/assets/lessons/access-control.svg',
            'table' => [
                'columns' => ['단계', '취약한 처리', '안전한 처리'],
                'rows' => [
                    ['요청', 'GET /document?id=1002', '동일'],
                    ['조회', 'WHERE id = :id', 'WHERE id = :id AND owner = :viewer'],
                    ['판정', '행이 있으면 반환', '소유자 또는 명시적 공유 관계 확인'],
                    ['결과', '다른 사용자 문서 노출', '권한 없으면 404 또는 403'],
                ],
            ],
            'code' => [
                'language' => 'sql',
                'content' => "-- 취약한 조회\nSELECT title, body FROM documents WHERE id = :id;\n\n-- 안전한 조회\nSELECT title, body\nFROM documents\nWHERE id = :id AND owner_id = :current_user_id;",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · IDOR', 'url' => 'https://portswigger.net/web-security/access-control/idor'],
            ['label' => 'OWASP · Authorization Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '선택자는 어디에 있나', 'body' => '내 문서를 열었을 때 URL에서 어떤 값이 문서를 선택하는지 확인하세요.'],
            ['level' => 2, 'title' => '다른 번호의 흔적', 'body' => '페이지 아래 활동 로그에는 방금 공유가 해제된 문서 번호가 남아 있습니다.'],
            ['level' => 3, 'title' => '소유권 검사 확인', 'body' => 'id 값을 활동 로그에서 본 번호로 바꾸세요. 서버는 로그인만 확인하고 owner 조건을 쿼리에 넣지 않습니다.'],
        ],
        'lab' => ['type' => 'idor_sqlite'],
        'completion' => [
            'event' => 'foreign_document_viewed',
            'email' => [
                'subject' => '[Nova] 소유권 검사 누락 확인',
                'preview' => '객체 ID는 권한 증명이 아닙니다. 모든 조회에서 사용자와 자원의 관계를 확인해야 합니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-04-sqli-login',
        'module' => '02-injection',
        'order' => 40,
        'title' => 'SQL 문장의 경계 무너뜨리기',
        'eyebrow' => '모듈 2 · 인젝션',
        'difficulty' => '초급',
        'minutes' => 35,
        'prerequisites' => ['web-v1-03-idor'],
        'client' => '코멧 재고 관리',
        'story' => '코멧의 야간 재고 로그인은 username과 password를 SQL 문자열에 직접 이어 붙입니다. 입력값이 데이터가 아니라 쿼리 문법으로 해석될 수 있습니다.',
        'brief' => '따옴표와 boolean 조건, 주석이 최종 SQL에 어떤 변화를 만드는지 관찰하고 manager 계정의 비밀번호 검사를 우회하세요.',
        'target' => [
            'objective' => '실제 훈련용 SQLite 로그인 쿼리를 항상 참인 조건으로 바꿔 manager 세션을 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-04-sqli-login',
            'surface' => 'Login form · string concatenation · SQLite WHERE clause',
        ],
        'objectives' => [
            '문자열 연결이 입력값과 SQL 문법의 경계를 없애는 과정을 설명한다.',
            'boolean 조건과 SQL 주석이 인증 쿼리에 미치는 영향을 예측한다.',
            'prepared statement가 코드와 데이터를 분리하는 이유를 이해한다.',
        ],
        'lesson' => [
            'summary' => 'SQL Injection은 특수문자 자체가 아니라 입력값이 SQL 코드로 재해석되는 경계 실패입니다.',
            'paragraphs' => [
                '애플리케이션이 username과 password를 SQL 문자열 안에 직접 넣으면 사용자가 입력한 따옴표가 원래 문자열을 끝낼 수 있습니다. 그 뒤에 새로운 조건과 주석을 붙이면 쿼리의 의미가 바뀝니다.',
                '로그인 우회에서는 비밀번호 비교보다 우선하거나 전체 WHERE 절을 참으로 만드는 boolean 표현식을 구성합니다. 주석은 애플리케이션이 뒤에 붙인 따옴표와 조건을 무시하게 할 수 있습니다.',
                '방어는 입력 문자열을 블랙리스트로 지우는 것이 아니라 prepared statement에 값을 별도로 바인딩하는 것입니다. 그러면 따옴표와 연산자는 SQL 문법이 아니라 평범한 데이터로 처리됩니다.',
            ],
            'diagram' => '/assets/lessons/sql-injection.svg',
            'table' => [
                'columns' => ['입력 실험', '관찰할 변화', '학습 의미'],
                'rows' => [
                    ['정상 사용자 / 틀린 암호', '로그인 실패', '기본 쿼리 확인'],
                    ['따옴표 하나', 'SQLite 문법 오류', '문자열 경계 확인'],
                    ['항상 참인 OR 조건', '조건식 의미 변화', '데이터가 코드가 됨'],
                    ['주석 추가', '뒤의 암호 조건 제거', '남은 쿼리 정리'],
                ],
            ],
            'code' => [
                'language' => 'sql',
                'content' => <<<'SQL'
-- 취약한 문자열 연결 결과
SELECT id, username, role
FROM accounts
WHERE username = '$username' AND password = '$password';

-- 방어
SELECT id, username, role
FROM accounts
WHERE username = :username AND password_hash = :password_hash;
SQL,
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · SQL Injection', 'url' => 'https://portswigger.net/web-security/sql-injection'],
            ['label' => 'OWASP · SQL Injection Prevention', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '쿼리 경계 찾기', 'body' => 'username에 따옴표 하나를 넣고 오류 메시지가 SQL 문자열의 어느 위치를 가리키는지 보세요.'],
            ['level' => 2, 'title' => '조건을 참으로 만들기', 'body' => 'manager 문자열 뒤에서 OR 연산으로 항상 참인 비교식을 추가하는 형태를 생각하세요.'],
            ['level' => 3, 'title' => '뒤쪽 조건 제거', 'body' => 'SQLite의 줄 주석을 사용해 애플리케이션이 덧붙이는 password 비교와 마지막 따옴표를 무시하세요.'],
        ],
        'lab' => ['type' => 'sqli_login'],
        'completion' => [
            'event' => 'manager_session_started',
            'email' => [
                'subject' => '[Comet] 야간 관리자 세션 생성됨',
                'preview' => '입력값이 SQL 문법으로 해석되면서 인증 조건이 무너졌습니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-05-sqli-union',
        'module' => '02-injection',
        'order' => 50,
        'title' => 'UNION으로 숨은 행 꺼내기',
        'eyebrow' => '모듈 2 · 데이터 추출',
        'difficulty' => '중급',
        'minutes' => 45,
        'prerequisites' => ['web-v1-04-sqli-login'],
        'client' => '헬리오스 카탈로그',
        'story' => '헬리오스 상품 검색은 이름과 가격 두 열을 반환합니다. 같은 instance SQLite에는 운영 메모 테이블도 있으며 검색 결과와 열 모양만 맞추면 다른 SELECT 결과를 합칠 수 있습니다.',
        'brief' => '오류와 출력 모양을 이용해 열 개수와 자료형을 맞추고, UNION SELECT로 training_notes의 목표 값을 검색 결과에 표시하세요.',
        'target' => [
            'objective' => '상품 검색 쿼리에 UNION SELECT를 결합해 훈련용 운영 메모를 추출하세요.',
            'entry_url' => '/lab.php?mission=web-v1-05-sqli-union',
            'surface' => 'Search parameter · UNION SELECT · per-instance SQLite',
        ],
        'objectives' => [
            'UNION으로 합치는 SELECT가 같은 열 개수와 호환 자료형을 가져야 함을 확인한다.',
            'NULL과 ORDER BY를 이용해 원래 결과의 형태를 추론한다.',
            '인젝션이 인증 우회를 넘어 데이터 유출로 이어지는 경로를 설명한다.',
        ],
        'lesson' => [
            'summary' => 'UNION 기반 SQLi는 원래 화면이 표시하는 열을 다른 테이블의 데이터를 운반하는 통로로 바꿉니다.',
            'paragraphs' => [
                'UNION은 두 SELECT의 결과 집합을 위아래로 합칩니다. 따라서 양쪽 SELECT의 열 개수가 같고 각 위치의 자료형이 호환되어야 합니다. 먼저 원래 쿼리의 모양을 알아내는 이유입니다.',
                'ORDER BY 번호를 늘려 오류가 나는 지점을 찾거나 UNION SELECT에 NULL을 하나씩 추가해 열 개수를 추론할 수 있습니다. NULL은 여러 자료형과 호환되어 구조를 시험하기에 편리합니다.',
                '실제 서비스에서는 DB 계정에 최소 권한을 주고, 상세 오류를 노출하지 않으며, 무엇보다 모든 사용자 입력을 prepared statement로 바인딩해야 합니다. 이 실습 DB는 instance 파일로 분리되어 다른 미션 데이터에는 접근할 수 없습니다.',
            ],
            'diagram' => '/assets/lessons/sql-injection.svg',
            'table' => [
                'columns' => ['단계', '목적', '성공 신호'],
                'rows' => [
                    ['열 개수 확인', '원래 SELECT의 폭 파악', '특정 ORDER BY 번호부터 오류'],
                    ['NULL 배치', 'UNION 결과 모양 맞춤', '검색 결과가 정상 렌더링'],
                    ['문자열 위치 확인', '화면에 표시되는 열 선택', '테스트 문자열 출력'],
                    ['목표 테이블 조회', 'training_notes 값 운반', '운영 메모가 상품 행으로 표시'],
                ],
            ],
            'code' => [
                'language' => 'sql',
                'content' => "-- 원래 검색의 두 출력 열\nSELECT name, price\nFROM products\nWHERE name LIKE '%<입력값>%';\n\n-- 학습 순서\nUNION SELECT NULL, NULL\nUNION SELECT note_title, note_body FROM training_notes",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · UNION attacks', 'url' => 'https://portswigger.net/web-security/sql-injection/union-attacks'],
            ['label' => 'OWASP · SQL Injection Prevention', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '결과의 폭', 'body' => 'ORDER BY 뒤 숫자를 늘려 보며 몇 번째 열에서 오류가 나는지 확인하세요.'],
            ['level' => 2, 'title' => 'NULL로 모양 맞추기', 'body' => '원래 SELECT는 두 열을 반환합니다. UNION SELECT에 같은 수의 NULL을 배치하세요.'],
            ['level' => 3, 'title' => '목표 테이블', 'body' => 'training_notes 테이블의 note_title과 note_body를 두 출력 열에 맞춰 선택하세요.'],
        ],
        'lab' => ['type' => 'union_sqlite'],
        'completion' => [
            'event' => 'training_note_extracted',
            'email' => [
                'subject' => '[Helios] 비공개 운영 메모가 검색됨',
                'preview' => '원래 검색 결과의 열을 이용해 다른 테이블의 행이 화면으로 이동했습니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-06-reflected-xss',
        'module' => '02-injection',
        'order' => 60,
        'title' => '문자열이 브라우저 코드가 될 때',
        'eyebrow' => '모듈 2 · 브라우저 문맥',
        'difficulty' => '중급',
        'minutes' => 40,
        'prerequisites' => ['web-v1-05-sqli-union'],
        'client' => '프리즘 도움말',
        'story' => '프리즘 도움말 검색은 사용자가 찾은 문구를 HTML에 그대로 반사합니다. 검색 결과는 안전한 opaque-origin iframe 안에 격리되어 있지만, 그 안의 HTML 파서는 여전히 입력을 태그와 이벤트로 해석합니다.',
        'brief' => '출력 문맥을 관찰하고 harmless 이벤트 핸들러를 실행해 훈련용 completeLab 함수를 호출하세요. 다른 사용자의 데이터나 쿠키에는 접근할 수 없습니다.',
        'target' => [
            'objective' => '반사된 검색어를 HTML 요소와 이벤트로 해석시켜 sandbox 완료 신호를 발생시키세요.',
            'entry_url' => '/lab.php?mission=web-v1-06-reflected-xss',
            'surface' => 'Reflected HTML · event handler · sandboxed iframe',
        ],
        'objectives' => [
            '사용자 입력이 놓이는 HTML 문맥에 따라 필요한 인코딩이 달라짐을 이해한다.',
            'HTML 파서가 문자열을 DOM과 실행 가능한 이벤트로 바꾸는 과정을 관찰한다.',
            '출력 인코딩, 안전한 DOM API, CSP가 서로 보완하는 방어임을 설명한다.',
        ],
        'lesson' => [
            'summary' => 'XSS는 서버에서 만들어진 문자열이 브라우저의 코드 문맥으로 들어가 피해자의 권한에서 실행되는 문제입니다.',
            'paragraphs' => [
                'HTML 본문, 속성, URL, JavaScript 문자열은 서로 다른 파싱 규칙을 사용합니다. 한 문맥에서 안전한 인코딩이 다른 문맥에서는 충분하지 않을 수 있으므로 데이터를 삽입하는 위치를 먼저 알아야 합니다.',
                'innerHTML이나 템플릿 문자열로 입력을 합치면 브라우저는 꺾쇠괄호와 속성을 마크업으로 해석합니다. textContent처럼 텍스트 전용 API를 사용하면 같은 입력이 실행 가능한 DOM으로 바뀌지 않습니다.',
                '이 실습의 실행 영역에는 sandbox의 allow-scripts만 있고 allow-same-origin은 없습니다. 따라서 실습 코드가 실행되어도 Wargame 세션이나 부모 페이지 DOM을 읽지 못하며, 제공된 nonce 완료 신호만 보낼 수 있습니다.',
            ],
            'diagram' => '/assets/lessons/xss-context.svg',
            'table' => [
                'columns' => ['출력 위치', '취약한 예', '권장 방식'],
                'rows' => [
                    ['HTML 본문', 'element.innerHTML = input', 'textContent 또는 HTML entity encoding'],
                    ['HTML 속성', 'value="입력" 직접 결합', '속성 API와 문맥별 encoding'],
                    ['URL', 'href에 임의 scheme 허용', '허용 scheme 검사와 URL 파서'],
                    ['JavaScript', 'script 문자열에 직접 삽입', '데이터를 JSON으로 전달하고 코드와 분리'],
                ],
            ],
            'code' => [
                'language' => 'html',
                'content' => "<!-- 취약한 렌더링 개념 -->\n<div>검색 결과: <사용자 입력></div>\n\n<!-- 안전한 렌더링 개념 -->\n<script nonce=\"...\">\n  result.textContent = userInput;\n</script>",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · Cross-site scripting', 'url' => 'https://portswigger.net/web-security/cross-site-scripting'],
            ['label' => 'OWASP · XSS Prevention Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '출력 문맥 확인', 'body' => '검색어에 단순한 HTML 태그를 넣고 결과가 텍스트인지 실제 요소인지 확인하세요.'],
            ['level' => 2, 'title' => '자동으로 발생하는 이벤트', 'body' => '로드에 실패하는 이미지 요소는 브라우저 이벤트를 발생시킬 수 있습니다.'],
            ['level' => 3, 'title' => '안전한 완료 함수', 'body' => '이 sandbox에는 completeLab() 함수가 준비되어 있습니다. 이벤트 핸들러에서 이 함수를 호출하세요.'],
        ],
        'lab' => ['type' => 'xss_nonce'],
        'completion' => [
            'event' => 'sandbox_script_executed',
            'email' => [
                'subject' => '[Prism] 검색 결과 문맥 탈출 감지',
                'preview' => '문자열이 HTML 요소와 이벤트로 해석되었습니다. 출력 위치에 맞는 인코딩이 필요합니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-07-path-traversal',
        'module' => '03-server-boundaries',
        'order' => 70,
        'title' => '파일 경로의 울타리 넘기',
        'eyebrow' => '모듈 3 · 파일시스템 경계',
        'difficulty' => '초급',
        'minutes' => 35,
        'prerequisites' => ['web-v1-06-reflected-xss'],
        'client' => '아틀라스 현장 매뉴얼',
        'story' => '아틀라스 문서 뷰어는 public 폴더와 사용자가 보낸 파일명을 단순 결합합니다. 같은 훈련 instance의 private 폴더에는 공개하면 안 되는 점검 증명이 있습니다.',
        'brief' => '상대 경로가 어떻게 상위 디렉터리로 이동하는지 파일 트리와 실제 경로를 대조하고, instance 안에서만 private/proof.txt를 읽으세요.',
        'target' => [
            'objective' => 'file 파라미터에 상대 경로를 사용해 public의 형제 디렉터리인 private의 proof 파일을 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-07-path-traversal',
            'surface' => 'File parameter · dot segments · scoped filesystem sandbox',
        ],
        'objectives' => [
            '상대 경로의 점 구간이 파일시스템에서 어떻게 정규화되는지 설명한다.',
            '문자열 prefix 검사와 canonical path 검사의 차이를 이해한다.',
            '허용 루트와 공개 하위 폴더를 별도로 검증해야 함을 확인한다.',
        ],
        'lesson' => [
            'summary' => '파일명을 경로에 그대로 붙이면 사용자가 의도한 공개 폴더 밖의 파일을 선택할 수 있습니다.',
            'paragraphs' => [
                '점 두 개와 슬래시는 현재 디렉터리의 부모로 이동합니다. public/guide.txt 대신 public/../private/proof.txt를 해석하면 최종 위치는 private/proof.txt가 됩니다.',
                '안전한 구현은 허용된 논리 이름을 실제 파일에 매핑하거나, realpath로 정규화한 최종 경로가 허용 루트 안에 있는지 디렉터리 경계를 포함해 확인합니다. 단순히 ../ 문자열 한 종류만 지우면 중첩 인코딩과 플랫폼 차이를 놓칠 수 있습니다.',
                '훈련용 뷰어는 절대 경로, NUL, URL wrapper를 거부하고 instance root 밖으로 나가는 최종 경로도 차단합니다. 취약점은 public과 private 사이에만 의도적으로 남겨 둡니다.',
            ],
            'diagram' => '/assets/lessons/filesystem-boundary.svg',
            'table' => [
                'columns' => ['입력', '정규화 결과', '판정'],
                'rows' => [
                    ['guide.txt', 'instance/public/guide.txt', '공개 문서'],
                    ['manual/intro.txt', 'instance/public/manual/intro.txt', '공개 하위 폴더'],
                    ['../private/proof.txt', 'instance/private/proof.txt', '취약한 뷰어에서 노출'],
                    ['../../outside.txt', 'instance 밖', 'sandbox 경계에서 차단'],
                ],
            ],
            'code' => [
                'language' => 'php',
                'content' => <<<'PHP'
// 취약한 개념
$path = $instanceRoot . '/public/' . $_GET['file'];
$content = file_get_contents($path);

// 안전한 개념
$resolved = realpath($candidate);
assert(path_is_within($resolved, $allowedPublicRoot));
PHP,
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · Path traversal', 'url' => 'https://portswigger.net/web-security/file-path-traversal'],
            ['label' => 'OWASP · Input Validation Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '기준 디렉터리 찾기', 'body' => '기본 파일을 열었을 때 화면이 보여 주는 instance/public 파일 트리를 확인하세요.'],
            ['level' => 2, 'title' => '형제 폴더로 이동', 'body' => 'public에서 한 단계 위로 이동하면 private과 같은 부모 아래에 놓입니다.'],
            ['level' => 3, 'title' => '목표 상대 경로', 'body' => 'file 값으로 ../private/proof.txt를 요청해 최종 경로가 어떻게 정규화되는지 확인하세요.'],
        ],
        'lab' => ['type' => 'path_traversal'],
        'completion' => [
            'event' => 'private_proof_read',
            'email' => [
                'subject' => '[Atlas] 비공개 점검 파일 열람됨',
                'preview' => '상대 경로가 공개 폴더의 울타리를 넘었습니다. 정규화한 최종 경로를 검증해야 합니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-08-upload-validation',
        'module' => '03-server-boundaries',
        'order' => 80,
        'title' => '업로드 파일의 세 가지 얼굴',
        'eyebrow' => '모듈 3 · 업로드 검증',
        'difficulty' => '중급',
        'minutes' => 45,
        'prerequisites' => ['web-v1-07-path-traversal'],
        'client' => '픽셀펫 프로필',
        'story' => '픽셀펫 아바타 업로더는 multipart의 Content-Type이 image로 시작하는지만 확인합니다. 파일명과 실제 내용, 저장 위치는 별도로 확인하지 않습니다.',
        'brief' => '클라이언트가 선언한 MIME과 파일 확장자·내용이 다를 수 있음을 재현하세요. 파일은 비공개 비실행 저장소에만 보관되며 실제 PHP 코드는 실행되지 않습니다.',
        'target' => [
            'objective' => '스크립트 확장자와 훈련 marker를 가진 파일의 part Content-Type을 이미지로 바꿔 취약 validator를 통과하세요.',
            'entry_url' => '/lab.php?mission=web-v1-08-upload-validation',
            'surface' => 'multipart/form-data · filename · reported MIME · non-executable storage',
        ],
        'objectives' => [
            '파일명, 요청 MIME, 서버 탐지 MIME, 실제 내용이 독립적인 신호임을 설명한다.',
            '클라이언트가 보낸 Content-Type을 단독 신뢰하면 안 되는 이유를 확인한다.',
            '검증 후 이름 재생성, 크기 제한, 비공개 저장, 실행 금지를 방어 순서로 연결한다.',
        ],
        'lesson' => [
            'summary' => '업로드 보안은 확장자 하나를 검사하는 문제가 아니라 입력 검증과 저장·서비스 방식을 함께 설계하는 문제입니다.',
            'paragraphs' => [
                'multipart 요청의 Content-Type은 브라우저나 프록시가 작성하므로 사용자가 바꿀 수 있습니다. image/png라고 선언해도 실제 바이트가 PNG라는 보장은 없습니다.',
                '서버는 필요한 파일 형식을 allowlist로 제한하고, 확장자와 magic bytes를 함께 검사하며, 원래 파일명을 버리고 무작위 저장명을 사용해야 합니다. 파일 크기와 이미지 디코딩 성공 여부도 검증해야 합니다.',
                '가장 중요한 마지막 경계는 업로드 디렉터리를 public web root 밖에 두고 실행 권한을 주지 않는 것입니다. 이 실습은 위험한 불일치를 탐지하지만 업로드된 내용을 PHP로 실행하지 않습니다.',
            ],
            'diagram' => '/assets/lessons/filesystem-boundary.svg',
            'table' => [
                'columns' => ['신호', '누가 정하는가', '단독 신뢰 가능'],
                'rows' => [
                    ['원본 filename', '클라이언트', '아니오'],
                    ['multipart Content-Type', '클라이언트', '아니오'],
                    ['서버가 탐지한 magic bytes', '서버', '다른 검사와 함께 사용'],
                    ['저장 위치와 실행 설정', '서버 운영 정책', '핵심 방어 경계'],
                ],
            ],
            'code' => [
                'language' => 'http',
                'content' => "POST /lab.php?mission=web-v1-08-upload-validation HTTP/1.1\nContent-Type: multipart/form-data; boundary=LAB\n\n--LAB\nContent-Disposition: form-data; name=\"avatar\"; filename=\"training.php\"\nContent-Type: image/png\n\nLAB_UPLOAD_MARKER\n--LAB--",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · File upload vulnerabilities', 'url' => 'https://portswigger.net/web-security/file-upload'],
            ['label' => 'OWASP · File Upload Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '두 종류의 타입', 'body' => '업로드 결과에서 filename 확장자와 multipart Content-Type이 각각 어떻게 기록되는지 비교하세요.'],
            ['level' => 2, 'title' => '요청을 수정하기', 'body' => '브라우저에서 전송한 multipart 요청을 편집해 파일 part의 Content-Type만 바꿀 수 있습니다.'],
            ['level' => 3, 'title' => '검증 조건 맞추기', 'body' => '파일명은 training.php, 본문은 LAB_UPLOAD_MARKER를 포함하고, 신고 MIME은 image/png가 되도록 요청하세요.'],
        ],
        'lab' => ['type' => 'upload_mime'],
        'completion' => [
            'event' => 'dangerous_upload_accepted',
            'email' => [
                'subject' => '[PixelPet] 아바타 MIME 불일치 감지',
                'preview' => '클라이언트가 선언한 이미지 타입만 믿어 스크립트 확장자 파일을 수락했습니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-09-jwt-validation',
        'module' => '03-server-boundaries',
        'order' => 90,
        'title' => 'JWT의 점 세 개와 서명',
        'eyebrow' => '모듈 3 · 토큰 무결성',
        'difficulty' => '중급',
        'minutes' => 45,
        'prerequisites' => ['web-v1-08-upload-validation'],
        'client' => '벡터 배포 콘솔',
        'story' => '벡터의 훈련용 배포 콘솔은 JWT처럼 생긴 토큰을 사용하지만 alg가 none일 때 서명 검증을 건너뜁니다. payload는 누구나 읽고 바꿀 수 있습니다.',
        'brief' => 'header와 payload를 Base64URL로 디코딩하고, instance의 audience와 scope는 유지하면서 role만 admin으로 바꾼 무서명 토큰을 제출하세요.',
        'target' => [
            'objective' => 'alg none 검증 누락을 이용해 challenge 전용 admin JWT를 만들고 배포 승인 화면을 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-09-jwt-validation',
            'surface' => 'JWT header · claims · Base64URL · signature verification',
        ],
        'objectives' => [
            'JWT의 header, payload, signature 각 부분의 역할을 설명한다.',
            'Base64URL 인코딩이 기밀성과 무결성을 제공하지 않음을 확인한다.',
            '허용 algorithm 고정, 서명 검증, exp·aud·iss 검증을 방어 항목으로 연결한다.',
        ],
        'lesson' => [
            'summary' => 'JWT payload는 숨겨진 정보가 아니며, 서버가 신뢰할 수 있는 이유는 올바른 서명을 검증했기 때문입니다.',
            'paragraphs' => [
                'JWT는 보통 점으로 구분된 header, payload, signature로 구성됩니다. 앞의 두 부분은 Base64URL JSON이므로 토큰을 가진 누구나 읽을 수 있고 새 값으로 다시 인코딩할 수도 있습니다.',
                '서버는 자신이 허용한 algorithm과 키로 signature를 검증한 뒤에만 claim을 신뢰해야 합니다. 토큰 header가 선택한 임의 algorithm을 그대로 받아들이거나 none을 허용하면 공격자가 role 같은 claim을 바꿀 수 있습니다.',
                '이 실습 토큰은 Django 인증 토큰과 이름, audience, 저장 위치가 모두 다릅니다. 실제 Hanplanet 계정 토큰이나 서명 키는 실습 handler에 전달되지 않습니다.',
            ],
            'diagram' => '/assets/lessons/server-trust-chain.svg',
            'table' => [
                'columns' => ['부분', '내용', '보안 성질'],
                'rows' => [
                    ['Header', 'alg, typ', '검증 방식을 설명하지만 스스로 신뢰할 수 없음'],
                    ['Payload', 'sub, role, aud, exp', '읽고 수정할 수 있는 claim'],
                    ['Signature', 'header와 payload에 대한 검증값', '키와 algorithm을 올바르게 검증할 때 무결성 제공'],
                    ['서버 정책', '허용 alg, aud, iss, exp', '토큰의 사용 범위를 최종 결정'],
                ],
            ],
            'code' => [
                'language' => 'json',
                'content' => "Header\n{\"alg\":\"none\",\"typ\":\"JWT\"}\n\nPayload\n{\"sub\":\"trainee\",\"role\":\"viewer\",\"aud\":\"vector-lab\",\"scope\":\"<instance>\"}\n\n목표: aud와 scope는 유지하고 role만 admin으로 변경",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · JWT attacks', 'url' => 'https://portswigger.net/web-security/jwt'],
            ['label' => 'OWASP · JWT Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '점으로 나누기', 'body' => '토큰을 점 기준으로 나누고 첫 번째와 두 번째 부분을 Base64URL 디코딩하세요.'],
            ['level' => 2, 'title' => '신뢰되는 claim', 'body' => '배포 승인 화면은 role, aud, scope를 검사합니다. audience와 instance scope는 발급된 값을 그대로 유지해야 합니다.'],
            ['level' => 3, 'title' => '무서명 토큰 형태', 'body' => 'header의 alg를 none으로, payload role을 admin으로 바꾸고 두 부분을 Base64URL로 인코딩한 뒤 마지막 점까지 포함하세요.'],
        ],
        'lab' => ['type' => 'jwt_none'],
        'completion' => [
            'event' => 'admin_token_accepted',
            'email' => [
                'subject' => '[Vector] 서명 없는 관리자 토큰 승인됨',
                'preview' => 'payload가 아니라 서명과 서버 정책이 토큰의 무결성을 만듭니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-10-ssrf',
        'module' => '03-server-boundaries',
        'order' => 100,
        'title' => '서버의 눈으로 내부 주소 보기',
        'eyebrow' => '모듈 3 · 네트워크 경계',
        'difficulty' => '중급',
        'minutes' => 45,
        'prerequisites' => ['web-v1-09-jwt-validation'],
        'client' => '루멘 이미지 프록시',
        'story' => '루멘의 카드 미리보기는 사용자가 준 URL을 서버가 대신 읽습니다. 외부 사용자는 볼 수 없는 metadata.training 주소도 미리보기 서버의 가상 네트워크에서는 접근 가능합니다.',
        'brief' => '브라우저가 직접 요청하는 것과 서버가 대신 요청하는 것의 차이를 이해하고, 훈련용 virtual network의 내부 metadata proof를 가져오세요.',
        'target' => [
            'objective' => '미리보기 URL을 내부 metadata endpoint로 바꿔 서버 측 fetch 결과를 화면에 표시하세요.',
            'entry_url' => '/lab.php?mission=web-v1-10-ssrf',
            'surface' => 'Server-side fetch · URL parser · virtual internal network',
        ],
        'objectives' => [
            'SSRF에서 요청 주체가 사용자 브라우저가 아니라 취약한 서버임을 설명한다.',
            '내부 서비스와 metadata endpoint가 외부에서 보이지 않아도 보호가 필요한 이유를 이해한다.',
            'scheme·host allowlist, DNS 재검증, redirect 제한, egress 통제를 방어로 연결한다.',
        ],
        'lesson' => [
            'summary' => '서버가 사용자가 고른 URL을 대신 요청하면 사용자는 서버의 네트워크 위치와 권한을 빌릴 수 있습니다.',
            'paragraphs' => [
                '이미지 프록시, 웹훅 검사, 링크 미리보기처럼 서버가 URL을 가져오는 기능은 흔합니다. URL 전체를 사용자가 결정하면 서버 자신이나 내부 호스트로 요청을 보낼 수 있습니다.',
                '문자열 prefix만 검사하면 사용자 정보 구간, 대소문자, IP 표현, DNS 변경, redirect 같은 URL 해석 차이로 우회될 수 있습니다. 파싱한 scheme과 hostname을 정책에 맞게 검증하고 최종 연결 주소도 확인해야 합니다.',
                '이 미션은 실제 네트워크 요청을 만들지 않습니다. PHP virtual network dispatcher가 images.training과 metadata.training이라는 정해진 가상 host만 처리하므로 로컬 시스템이나 인터넷으로 연결되지 않습니다.',
            ],
            'diagram' => '/assets/lessons/server-trust-chain.svg',
            'table' => [
                'columns' => ['요청 위치', '접근 가능한 대상', '위험'],
                'rows' => [
                    ['사용자 브라우저', '공개 웹과 브라우저가 허용한 네트워크', '직접 요청의 출처가 사용자에게 보임'],
                    ['미리보기 서버', '공개 웹 + 내부 서비스', '서버 권한으로 의도하지 않은 요청 가능'],
                    ['metadata 서비스', '내부에서만 접근하도록 설계', '자격 증명과 설정 유출 가능'],
                    ['virtual dispatcher', '훈련용 두 host만', '실제 egress 없이 SSRF 의미 재현'],
                ],
            ],
            'code' => [
                'language' => 'http',
                'content' => "POST /lab.php?mission=web-v1-10-ssrf HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nurl=https%3A%2F%2Fimages.training%2Fcard.png\n\n관찰할 내부 단서\nhttp://metadata.training/latest/lab-proof",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · SSRF', 'url' => 'https://portswigger.net/web-security/ssrf'],
            ['label' => 'OWASP · SSRF Prevention Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '누가 요청하는가', 'body' => '결과 로그의 requester 항목을 보세요. 입력한 URL은 브라우저가 아니라 preview-worker가 가져옵니다.'],
            ['level' => 2, 'title' => '내부 host 단서', 'body' => '정상 카드 응답의 debug 메타데이터에 metadata.training이라는 가상 내부 host가 표시됩니다.'],
            ['level' => 3, 'title' => '목표 endpoint', 'body' => '미리보기 URL을 http://metadata.training/latest/lab-proof로 바꿔 요청하세요.'],
        ],
        'lab' => ['type' => 'virtual_network'],
        'completion' => [
            'event' => 'metadata_proof_fetched',
            'email' => [
                'subject' => '[Lumen] 내부 metadata 응답 노출',
                'preview' => '사용자가 서버의 네트워크 시야를 빌렸습니다. URL 검증과 egress 통제가 함께 필요합니다.',
            ],
        ],
    ],
    [
        'id' => 'web-v1-11-operation-nightfall',
        'module' => '04-operation',
        'order' => 110,
        'title' => '최종 작전: 나이트폴',
        'eyebrow' => '모듈 4 · 종합 작전',
        'difficulty' => '중급',
        'minutes' => 70,
        'prerequisites' => ['web-v1-10-ssrf'],
        'client' => '나이트폴 관제 포털',
        'story' => '관제 포털의 외부 보고서, 파일 뷰어, 운영 토큰 검증기가 하나의 업무 흐름으로 연결되어 있습니다. 하나의 취약점만으로는 최종 vault를 열 수 없지만 각 단계에서 얻은 증거가 다음 경계를 가리킵니다.',
        'brief' => '취약점 이름을 먼저 맞히려 하지 말고 관찰한 증거를 기록하세요. IDOR로 보고서를 찾고, 제한된 Path Traversal로 verifier 설정을 읽고, JWT 검증 누락을 이용해 운영 vault를 여세요.',
        'target' => [
            'objective' => '같은 instance에서 보고서 열람, verifier 설정 확인, admin 토큰 승격을 순서대로 수행해 Nightfall vault를 여세요.',
            'entry_url' => '/lab.php?mission=web-v1-11-operation-nightfall',
            'surface' => 'IDOR → scoped path traversal → JWT claim tampering',
        ],
        'objectives' => [
            '관찰한 증거에서 다음 공격 가설을 세우고 결과로 가설을 갱신한다.',
            '여러 개의 낮은 수준 취약점이 연결되어 높은 영향의 권한 상승이 되는 과정을 설명한다.',
            '각 경계에서 필요한 방어가 하나의 취약점 패치보다 넓어야 함을 정리한다.',
        ],
        'lesson' => [
            'summary' => '실전형 분석은 취약점 목록을 대입하는 일이 아니라 자산, 신뢰 경계, 증거와 상태 변화를 연결하는 일입니다.',
            'paragraphs' => [
                '첫 화면에는 내 보고서와 최근 활동만 있습니다. 요청 파라미터, 응답 데이터, 파일 경로처럼 관찰 가능한 사실을 기록하고 어떤 서버 측 검사가 빠졌을지 가설을 세우세요.',
                '다른 보고서에서 얻은 파일 경로는 파일 뷰어의 기준 디렉터리를 알려 줍니다. verifier 설정은 토큰 검증기의 algorithm 처리 방식을 설명합니다. 각 단계의 출력이 다음 단계의 입력이 됩니다.',
                '최종 완료 판정은 vault URL을 한 번 호출했다는 사실만 보지 않습니다. 같은 instance의 foreign_report_viewed, verifier_config_read, admin_token_accepted 이벤트가 모두 존재해야 하므로 실제 연쇄 흐름을 수행해야 합니다.',
            ],
            'diagram' => '/assets/lessons/server-trust-chain.svg',
            'table' => [
                'columns' => ['증거', '가설', '다음 검증'],
                'rows' => [
                    ['보고서 URL에 report_id 존재', '객체 소유권 검사가 약할 수 있음', '활동 로그의 다른 ID 요청'],
                    ['외부 보고서에 verifier 파일 경로', '뷰어 기준 폴더 밖 설정 접근 가능', 'instance 안의 상대 경로 구성'],
                    ['설정에 allow_none=true', 'JWT 서명 없이 claim 변경 가능', 'aud와 scope를 유지한 admin 토큰 생성'],
                    ['관리자 토큰 승인', 'vault 접근 조건 충족', '연쇄 이벤트와 함께 vault 요청'],
                ],
            ],
            'code' => [
                'language' => 'http',
                'content' => "# 1. 객체 접근 경계\nGET /lab.php?mission=web-v1-11-operation-nightfall&view=report&report_id=<관찰한 ID>\n\n# 2. 파일 경계\nGET /lab.php?mission=web-v1-11-operation-nightfall&view=file&file=<상대 경로>\n\n# 3. 토큰 경계\nAuthorization: Bearer <훈련용 admin JWT>",
            ],
        ],
        'resources' => [
            ['label' => 'PortSwigger · Access control', 'url' => 'https://portswigger.net/web-security/access-control'],
            ['label' => 'PortSwigger · Web Security Academy', 'url' => 'https://portswigger.net/web-security'],
            ['label' => 'OWASP · Authorization Cheat Sheet', 'url' => 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html'],
        ],
        'hints' => [
            ['level' => 1, 'title' => '증거부터 기록하기', 'body' => '내 보고서를 열어 URL의 선택자와 최근 활동의 다른 보고서 번호를 비교하세요. 공격 이름보다 입력과 결과를 먼저 기록하세요.'],
            ['level' => 2, 'title' => '출력이 다음 입력', 'body' => '다른 보고서 본문에는 운영자가 참조한 verifier 설정 파일의 상대 위치가 있습니다. 파일 뷰어의 public 기준 경로와 연결하세요.'],
            ['level' => 3, 'title' => '마지막 신뢰 경계', 'body' => '설정의 allow_none 값을 확인한 뒤 발급된 토큰의 aud와 scope는 유지하고 role을 admin으로 바꿔 vault에 제출하세요.'],
        ],
        'lab' => ['type' => 'final_chain'],
        'completion' => [
            'event' => 'nightfall_vault_opened',
            'email' => [
                'subject' => '[NIGHTFALL] 작전 종료 · 관제 vault 확보',
                'preview' => '객체 접근, 파일 경로, 토큰 무결성의 세 경계를 연결해 최종 작전을 완료했습니다.',
            ],
        ],
    ],
];
