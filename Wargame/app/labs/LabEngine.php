<?php
declare(strict_types=1);

/**
 * Isolated, challenge-only lab runtime.
 *
 * This file deliberately has no dependency on the portal bootstrap, Django,
 * HTTP clients, or operating-system command runners. Every persistent artifact
 * is created below the instance directory passed to the constructor.
 */
final class LabEngine
{
    public const HTTP_HEADERS = 'web-v1-01-http';
    public const CLIENT_TRUST = 'web-v1-02-client-trust';
    public const IDOR = 'web-v1-03-idor';
    public const SQLI_LOGIN = 'web-v1-04-sqli-login';
    public const SQLI_UNION = 'web-v1-05-sqli-union';
    public const REFLECTED_XSS = 'web-v1-06-reflected-xss';
    public const PATH_TRAVERSAL = 'web-v1-07-path-traversal';
    public const UPLOAD_VALIDATION = 'web-v1-08-upload-validation';
    public const JWT_VALIDATION = 'web-v1-09-jwt-validation';
    public const SSRF = 'web-v1-10-ssrf';
    public const OPERATION_NIGHTFALL = 'web-v1-11-operation-nightfall';

    private const STATE_VERSION = 1;
    private const MAX_INPUT_LENGTH = 65536;

    /** @var array<string, array{title:string,surface:string,type:string}> */
    private const LABS = [
        self::HTTP_HEADERS => ['title' => '01 · 응답 헤더의 단서', 'surface' => 'browser', 'type' => 'http_headers'],
        self::CLIENT_TRUST => ['title' => '02 · 클라이언트 권한 토큰', 'surface' => 'browser', 'type' => 'role_token'],
        self::IDOR => ['title' => '03 · 청구서 객체 권한', 'surface' => 'browser', 'type' => 'idor_sqlite'],
        self::SQLI_LOGIN => ['title' => '04 · SQLite 로그인 우회', 'surface' => 'terminal', 'type' => 'sqli_login'],
        self::SQLI_UNION => ['title' => '05 · SQLite UNION 조사', 'surface' => 'terminal', 'type' => 'union_sqlite'],
        self::REFLECTED_XSS => ['title' => '06 · 반사 XSS 샌드박스', 'surface' => 'browser', 'type' => 'xss_nonce'],
        self::PATH_TRAVERSAL => ['title' => '07 · 파일 경로 경계', 'surface' => 'terminal', 'type' => 'path_traversal'],
        self::UPLOAD_VALIDATION => ['title' => '08 · 업로드 MIME 검증', 'surface' => 'browser', 'type' => 'upload_mime'],
        self::JWT_VALIDATION => ['title' => '09 · JWT 알고리즘 검증', 'surface' => 'terminal', 'type' => 'jwt_none'],
        self::SSRF => ['title' => '10 · 가상 네트워크 SSRF', 'surface' => 'network', 'type' => 'virtual_network'],
        self::OPERATION_NIGHTFALL => ['title' => '11 · Operation Nightfall', 'surface' => 'browser', 'type' => 'final_chain'],
    ];

    private string $instanceRoot;

    public function __construct(string $instanceDir)
    {
        if ($instanceDir === '' || str_contains($instanceDir, "\0")) {
            throw new InvalidArgumentException('instanceDir must be a non-empty local path.');
        }

        $trimmed = rtrim($instanceDir, DIRECTORY_SEPARATOR);
        if ($trimmed === '') {
            $trimmed = DIRECTORY_SEPARATOR;
        }
        if (is_link($trimmed)) {
            throw new RuntimeException('The instance directory may not be a symbolic link.');
        }
        if (!is_dir($trimmed) && !mkdir($trimmed, 0700, true) && !is_dir($trimmed)) {
            throw new RuntimeException('Unable to create the instance directory.');
        }

        $real = realpath($trimmed);
        if ($real === false || !is_dir($real) || !is_writable($real)) {
            throw new RuntimeException('The instance directory is not usable.');
        }

        $this->instanceRoot = rtrim($real, DIRECTORY_SEPARATOR);
        if ($this->instanceRoot === '') {
            $this->instanceRoot = DIRECTORY_SEPARATOR;
        }
    }

    /** @return list<string> */
    public static function stableIds(): array
    {
        return array_keys(self::LABS);
    }

    /** @return array<string, array{title:string,surface:string,type:string}> */
    public function listLabs(): array
    {
        return self::LABS;
    }

    /**
     * Create an instance if needed and return its learner-safe initial view.
     *
     * @return array<string, mixed>
     */
    public function start(string $labId): array
    {
        return $this->withLabLock($labId, function (string $labDir) use ($labId): array {
            $state = $this->loadOrInitialize($labId, $labDir);
            return $this->startView($state);
        });
    }

    /**
     * Handle one entirely virtual request.
     *
     * @param array<string, mixed> $request JSON-serializable request data
     * @return array<string, mixed>
     */
    public function handle(string $labId, array $request): array
    {
        $normalized = $this->normalizeRequest($request);

        return $this->withLabLock($labId, function (string $labDir) use ($labId, $normalized): array {
            $state = $this->loadOrInitialize($labId, $labDir);

            if (($state['completed'] ?? false) === true) {
                return $this->makeResponse(
                    $state,
                    $this->surfaceFor($state),
                    ['message' => '이미 완료한 실습입니다.', 'proof' => $state['completion_proof']],
                    $normalized,
                    200,
                    [],
                    ['type' => 'already_completed', 'message' => '재시작하려면 reset을 사용하세요.']
                );
            }

            $state['attempts'] = (int) ($state['attempts'] ?? 0) + 1;
            $response = match ($labId) {
                self::HTTP_HEADERS => $this->handleHttpHeaders($state, $normalized),
                self::CLIENT_TRUST => $this->handleClientTrust($state, $normalized),
                self::IDOR => $this->handleIdor($state, $labDir, $normalized),
                self::SQLI_LOGIN => $this->handleSqliLogin($state, $labDir, $normalized),
                self::SQLI_UNION => $this->handleSqliUnion($state, $labDir, $normalized),
                self::REFLECTED_XSS => $this->handleReflectedXss($state, $normalized),
                self::PATH_TRAVERSAL => $this->handlePathTraversal($state, $labDir, $normalized),
                self::UPLOAD_VALIDATION => $this->handleUpload($state, $labDir, $normalized),
                self::JWT_VALIDATION => $this->handleJwt($state, $normalized),
                self::SSRF => $this->handleSsrf($state, $normalized),
                self::OPERATION_NIGHTFALL => $this->handleNightfall($state, $labDir, $normalized),
                default => throw new LogicException('Unreachable lab id.'),
            };

            $state['last_event'] = $response['event'];
            $this->saveState($labDir, $state);
            $response['completed'] = (bool) $state['completed'];
            return $response;
        });
    }

    /**
     * Delete one lab's local artifacts and create a fresh randomized instance.
     *
     * @return array<string, mixed>
     */
    public function reset(string $labId): array
    {
        return $this->withLabLock($labId, function (string $labDir) use ($labId): array {
            foreach (scandir($labDir) ?: [] as $entry) {
                if ($entry === '.' || $entry === '..' || $entry === '.lock') {
                    continue;
                }
                $this->removeLocalTree($labDir . DIRECTORY_SEPARATOR . $entry, $labDir);
            }

            $state = $this->initializeState($labId);
            $this->initializeResources($state, $labDir);
            $this->saveState($labDir, $state);
            $view = $this->startView($state);
            $view['event'] = ['type' => 'reset', 'message' => '새 무작위 인스턴스를 만들었습니다.'];
            return $view;
        });
    }

    /**
     * Return a learner-safe, JSON-serializable progress snapshot.
     *
     * @return array<string, mixed>
     */
    public function serialize(string $labId): array
    {
        return $this->withLabLock($labId, function (string $labDir) use ($labId): array {
            $state = $this->loadOrInitialize($labId, $labDir);
            $output = [
                'lab_id' => $labId,
                'attempts' => (int) $state['attempts'],
                'progress' => $this->publicProgress($state),
            ];
            if ((bool) $state['completed']) {
                $output['proof'] = $state['completion_proof'];
            }

            return $this->makeResponse(
                $state,
                $this->surfaceFor($state),
                $output,
                $this->recommendedRequest($state),
                200,
                [],
                (array) ($state['last_event'] ?? ['type' => 'state', 'message' => '현재 진행 상태입니다.'])
            );
        });
    }

    /** @return array<string, mixed> */
    private function initializeState(string $labId): array
    {
        $this->assertKnownLab($labId);
        $state = [
            'version' => self::STATE_VERSION,
            'lab_id' => $labId,
            'created_at' => gmdate('c'),
            'attempts' => 0,
            'completed' => false,
            'completed_at' => null,
            'completion_proof' => 'LAB{' . $this->randomHex(18) . '}',
            'secrets' => [],
            'progress' => [],
            'last_event' => ['type' => 'started', 'message' => '격리된 실습 인스턴스를 준비했습니다.'],
        ];

        switch ($labId) {
            case self::HTTP_HEADERS:
                $state['secrets'] = [
                    'operations_path' => '/operations/' . $this->randomHex(5),
                    'case_token' => 'case_' . $this->randomHex(12),
                ];
                $state['progress'] = ['headers_observed' => false];
                break;

            case self::CLIENT_TRUST:
                $nonce = $this->randomHex(10);
                $state['secrets'] = [
                    'nonce' => $nonce,
                    'viewer_token' => $this->base64UrlEncodeJson([
                        'sub' => 'freelance-analyst',
                        'role' => 'viewer',
                        'nonce' => $nonce,
                    ]),
                ];
                $state['progress'] = ['token_examined' => false];
                break;

            case self::IDOR:
                [$selfId, $targetId] = $this->twoRandomIds(10000, 80000);
                $state['secrets'] = ['self_id' => $selfId, 'target_id' => $targetId];
                $state['progress'] = ['last_invoice_id' => null];
                break;

            case self::SQLI_LOGIN:
                $state['secrets'] = [
                    'admin_password' => 'pw_' . $this->randomHex(14),
                    'analyst_password' => 'pw_' . $this->randomHex(14),
                ];
                $state['progress'] = ['last_username' => null];
                break;

            case self::SQLI_UNION:
                $state['secrets'] = ['vault_note_id' => 'note_' . $this->randomHex(8)];
                $state['progress'] = ['last_term' => null, 'column_hint_seen' => false];
                break;

            case self::REFLECTED_XSS:
                $state['secrets'] = ['nonce' => $this->randomHex(12)];
                $state['progress'] = ['last_rendered' => null, 'nonce_event' => false];
                break;

            case self::PATH_TRAVERSAL:
                $state['secrets'] = ['private_file' => 'briefing-' . $this->randomHex(7) . '.txt'];
                $state['progress'] = ['last_file' => null, 'blocked_escapes' => 0];
                break;

            case self::UPLOAD_VALIDATION:
                $state['secrets'] = ['storage_salt' => $this->randomHex(12)];
                $state['progress'] = ['uploads' => []];
                break;

            case self::JWT_VALIDATION:
                $nonce = $this->randomHex(10);
                $audience = 'lab-admin-' . $this->randomHex(5);
                $payload = ['sub' => 'contractor', 'role' => 'viewer', 'aud' => $audience, 'nonce' => $nonce];
                $state['secrets'] = [
                    'nonce' => $nonce,
                    'audience' => $audience,
                    'viewer_token' => $this->makeJwt(['alg' => 'HS256', 'typ' => 'JWT'], $payload, $this->randomHex(16)),
                ];
                $state['progress'] = ['last_alg' => null];
                break;

            case self::SSRF:
                $state['secrets'] = ['assignment_id' => 'asg_' . $this->randomHex(9)];
                $state['progress'] = ['last_trace' => []];
                break;

            case self::OPERATION_NIGHTFALL:
                [$selfId, $targetId] = $this->twoRandomIds(20000, 70000);
                $nonce = $this->randomHex(12);
                $audience = 'nightfall-' . $this->randomHex(6);
                $privateFile = 'operator-' . $this->randomHex(7) . '.json';
                $payload = [
                    'sub' => 'nightfall-contractor',
                    'role' => 'viewer',
                    'scope' => 'reports:read',
                    'aud' => $audience,
                    'nonce' => $nonce,
                ];
                $state['secrets'] = [
                    'self_id' => $selfId,
                    'target_id' => $targetId,
                    'private_file' => $privateFile,
                    'nonce' => $nonce,
                    'audience' => $audience,
                    'viewer_token' => $this->makeJwt(['alg' => 'HS256', 'typ' => 'JWT'], $payload, $this->randomHex(16)),
                ];
                $state['progress'] = ['stage' => 'idor'];
                break;
        }

        return $state;
    }

    /** @param array<string, mixed> $state */
    private function initializeResources(array $state, string $labDir): void
    {
        switch ($state['lab_id']) {
            case self::IDOR:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE invoices (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, summary TEXT NOT NULL, confidential TEXT NOT NULL)');
                $insert = $pdo->prepare('INSERT INTO invoices (id, owner, summary, confidential) VALUES (:id, :owner, :summary, :confidential)');
                $insert->execute([
                    ':id' => $state['secrets']['self_id'],
                    ':owner' => 'freelance-analyst',
                    ':summary' => '내 테스트 청구서',
                    ':confidential' => 'public-training-record',
                ]);
                $insert->execute([
                    ':id' => $state['secrets']['target_id'],
                    ':owner' => 'client-operations',
                    ':summary' => 'Nightjar 인수 검토',
                    ':confidential' => $state['completion_proof'],
                ]);
                break;

            case self::SQLI_LOGIN:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE staff (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, proof TEXT NOT NULL)');
                $insert = $pdo->prepare('INSERT INTO staff (id, username, password, role, proof) VALUES (:id, :username, :password, :role, :proof)');
                $insert->execute([
                    ':id' => 1,
                    ':username' => 'admin',
                    ':password' => $state['secrets']['admin_password'],
                    ':role' => 'admin',
                    ':proof' => $state['completion_proof'],
                ]);
                $insert->execute([
                    ':id' => 2,
                    ':username' => 'analyst',
                    ':password' => $state['secrets']['analyst_password'],
                    ':role' => 'viewer',
                    ':proof' => '',
                ]);
                break;

            case self::SQLI_UNION:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)');
                $pdo->query('CREATE TABLE vault_notes (note_id TEXT PRIMARY KEY, secret TEXT NOT NULL)');
                $product = $pdo->prepare('INSERT INTO products (sku, name, price) VALUES (:sku, :name, :price)');
                $product->execute([':sku' => 'KB-104', ':name' => 'Mechanical Keyboard', ':price' => 79000]);
                $product->execute([':sku' => 'HD-220', ':name' => 'USB Headset', ':price' => 43000]);
                $note = $pdo->prepare('INSERT INTO vault_notes (note_id, secret) VALUES (:id, :secret)');
                $note->execute([':id' => $state['secrets']['vault_note_id'], ':secret' => $state['completion_proof']]);
                break;

            case self::PATH_TRAVERSAL:
                $vfs = $this->makeVirtualFileSystem($labDir);
                $notice = "공개 파일 서버 점검 안내\n이전 운영 브리핑은 ../private/{$state['secrets']['private_file']} 로 이동됨\n";
                $this->writeLocalFile($vfs . '/public/notice.txt', $notice, $vfs);
                $this->writeLocalFile($vfs . '/private/' . $state['secrets']['private_file'], "CLIENT BRIEFING\n{$state['completion_proof']}\n", $vfs);
                break;

            case self::UPLOAD_VALIDATION:
                $uploads = $labDir . '/private_uploads';
                if (!mkdir($uploads, 0700, true) && !is_dir($uploads)) {
                    throw new RuntimeException('Unable to create private upload storage.');
                }
                break;

            case self::OPERATION_NIGHTFALL:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE cases (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, attachment TEXT NOT NULL)');
                $insert = $pdo->prepare('INSERT INTO cases (id, owner, title, attachment) VALUES (:id, :owner, :title, :attachment)');
                $insert->execute([
                    ':id' => $state['secrets']['self_id'],
                    ':owner' => 'nightfall-contractor',
                    ':title' => '내 온보딩 케이스',
                    ':attachment' => 'readme.txt',
                ]);
                $insert->execute([
                    ':id' => $state['secrets']['target_id'],
                    ':owner' => 'nightfall-operations',
                    ':title' => '중단 절차 승인 건',
                    ':attachment' => '../private/' . $state['secrets']['private_file'],
                ]);

                $vfs = $this->makeVirtualFileSystem($labDir);
                $this->writeLocalFile($vfs . '/public/readme.txt', "공개 자료만 열람할 수 있습니다.\n", $vfs);
                $note = json_encode([
                    'memo' => '레거시 검증기는 alg=none 토큰을 허용한다.',
                    'viewer_token' => $state['secrets']['viewer_token'],
                    'required_role' => 'operator',
                    'required_scope' => 'shutdown:write',
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
                $this->writeLocalFile($vfs . '/private/' . $state['secrets']['private_file'], $note . "\n", $vfs);
                break;
        }
    }

    /** @param array<string, mixed> $state @return array<string, mixed> */
    private function startView(array $state): array
    {
        $labId = (string) $state['lab_id'];
        $output = match ($labId) {
            self::HTTP_HEADERS => [
                'story' => '의뢰인은 상태 페이지 뒤에 숨겨진 운영 화면을 찾아 달라고 요청했습니다.',
                'available_paths' => ['/status'],
                'task' => '응답 본문뿐 아니라 응답 헤더도 조사하세요.',
            ],
            self::CLIENT_TRUST => [
                'story' => '브라우저에 저장되는 권한 배지가 서버에서 그대로 신뢰되는지 확인하세요.',
                'client_token' => $state['secrets']['viewer_token'],
                'token_format' => 'base64url(JSON), 서명 없음',
                'target_path' => '/admin',
            ],
            self::IDOR => [
                'story' => '청구서 API가 로그인 사용자의 소유권을 검사하는지 검증하세요.',
                'my_invoice_id' => $state['secrets']['self_id'],
                'activity_feed' => ['recently_shared_invoice' => $state['secrets']['target_id']],
                'endpoint' => '/api/invoices?id={id}',
            ],
            self::SQLI_LOGIN => [
                'story' => '레거시 SQLite 직원 로그인에서 인증 우회 가능성을 조사하세요.',
                'endpoint' => '/login',
                'fields' => ['username', 'password'],
                'known_usernames' => ['admin', 'analyst'],
            ],
            self::SQLI_UNION => [
                'story' => '상품 검색 결과를 이용해 별도 SQLite 테이블의 승인 메모를 회수하세요.',
                'endpoint' => '/search?q={term}',
                'visible_columns' => ['sku', 'name', 'price'],
                'internal_schema_note' => 'vault_notes(note_id, secret)',
            ],
            self::REFLECTED_XSS => [
                'story' => '검색어가 HTML 조각에 그대로 반사되는지 확인하고 가상 보고 이벤트를 발생시키세요.',
                'endpoint' => '/search?q={term}',
                'virtual_callback' => "lab.report('complete')",
                'safety' => '반환 문자열은 포털 DOM에 삽입되지 않으며 쿠키에 접근하지 않습니다.',
            ],
            self::PATH_TRAVERSAL => [
                'story' => '공개 파일 뷰어에서 의뢰인의 비공개 브리핑을 찾아 회수하세요.',
                'endpoint' => '/files?file={relative-path}',
                'public_file' => 'notice.txt',
                'notice' => "이전 운영 브리핑은 ../private/{$state['secrets']['private_file']} 로 이동됨",
            ],
            self::UPLOAD_VALIDATION => [
                'story' => '클라이언트 제공 MIME만 믿는 업로드 검증기를 안전한 시뮬레이션으로 우회하세요.',
                'endpoint' => '/upload',
                'fields' => ['name', 'type', 'content'],
                'policy' => 'type이 image/로 시작하면 승인',
                'safety' => '모든 파일은 비공개 .bin으로 저장되며 실행되지 않습니다.',
            ],
            self::JWT_VALIDATION => [
                'story' => '이 실습 전용 JWT 검증기의 알고리즘 혼동을 확인하세요.',
                'endpoint' => '/admin/verify',
                'viewer_token' => $state['secrets']['viewer_token'],
                'required_role' => 'admin',
                'challenge_scope' => '이 토큰은 LabEngine 밖에서 어떤 인증 권한도 갖지 않습니다.',
            ],
            self::SSRF => [
                'story' => 'URL 미리보기 서비스가 리다이렉트 뒤의 내부 주소를 다시 검사하는지 확인하세요.',
                'endpoint' => '/fetch',
                'allowlist' => ['assets.vendor.test', 'redirector.vendor.test'],
                'virtual_routes' => [
                    'https://assets.vendor.test/logo.svg',
                    'https://redirector.vendor.test/go?to={url}',
                    'http://metadata.internal/latest/assignment',
                ],
                'safety' => '모든 요청은 메모리 내 가상 디스패처에서만 처리됩니다.',
            ],
            self::OPERATION_NIGHTFALL => [
                'story' => 'IDOR → 경로 이동 → JWT 변조 순서로 중단 승인을 획득하세요.',
                'stage' => $state['progress']['stage'],
                'my_case_id' => $state['secrets']['self_id'],
                'audit_reference' => $state['secrets']['target_id'],
                'endpoint' => '/api/cases?id={id}',
            ],
            default => [],
        };

        $headers = [];
        if ($labId === self::REFLECTED_XSS) {
            $headers['Content-Security-Policy'] = "default-src 'none'; script-src 'nonce-{$state['secrets']['nonce']}'";
        }

        return $this->makeResponse(
            $state,
            $this->surfaceFor($state),
            $output,
            $this->recommendedRequest($state),
            200,
            $headers,
            ['type' => 'started', 'message' => '의뢰 환경이 준비되었습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleHttpHeaders(array &$state, array $request): array
    {
        $path = (string) $request['path'];
        if ($path === '/status') {
            $state['progress']['headers_observed'] = true;
            return $this->makeResponse(
                $state,
                'browser',
                ['service' => 'client-gateway', 'health' => 'ok', 'body_note' => '본문에는 운영 경로가 없습니다.'],
                $request,
                200,
                [
                    'Content-Type' => 'application/json',
                    'X-Operations-Path' => $state['secrets']['operations_path'],
                    'X-Case-Token' => $state['secrets']['case_token'],
                ],
                ['type' => 'headers_observed', 'message' => '가상 응답 헤더를 수신했습니다.']
            );
        }

        if (hash_equals((string) $state['secrets']['operations_path'], $path)) {
            $token = $this->headerValue($request, 'X-Case-Token');
            if (!(bool) $state['progress']['headers_observed'] || !hash_equals((string) $state['secrets']['case_token'], $token)) {
                return $this->makeResponse(
                    $state,
                    'browser',
                    ['error' => '운영 경로에 필요한 케이스 헤더가 없거나 올바르지 않습니다.'],
                    $request,
                    403,
                    ['Content-Type' => 'application/json'],
                    ['type' => 'access_denied', 'message' => 'X-Case-Token을 확인하세요.']
                );
            }

            $this->markCompleted($state);
            return $this->makeResponse(
                $state,
                'browser',
                ['diagnostic' => 'restricted client diagnostic', 'proof' => $state['completion_proof']],
                $request,
                200,
                ['Content-Type' => 'application/json'],
                ['type' => 'http_diagnostic_reached', 'message' => '응답 헤더의 단서로 진단 화면에 도달했습니다.']
            );
        }

        return $this->notFound($state, $request, 'browser');
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleClientTrust(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/admin') {
            return $this->notFound($state, $request, 'browser');
        }

        $token = $this->bodyString($request, 'token');
        $authorization = $this->headerValue($request, 'Authorization');
        if ($token === '' && preg_match('/^Client\s+(.+)$/i', $authorization, $matches) === 1) {
            $token = trim($matches[1]);
        }

        $payload = $this->decodeBase64Json($token);
        if ($payload === null) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '클라이언트 토큰을 JSON으로 복원할 수 없습니다.'],
                $request,
                400,
                [],
                ['type' => 'token_rejected', 'message' => 'base64url(JSON) 형식을 확인하세요.']
            );
        }

        $state['progress']['token_examined'] = true;
        $role = is_string($payload['role'] ?? null) ? $payload['role'] : '';
        $nonce = is_string($payload['nonce'] ?? null) ? $payload['nonce'] : '';
        if ($role === 'admin' && hash_equals((string) $state['secrets']['nonce'], $nonce)) {
            $this->markCompleted($state);
            return $this->makeResponse(
                $state,
                'browser',
                ['archive' => 'client-review-archive', 'role' => 'admin', 'proof' => $state['completion_proof']],
                $request,
                200,
                [],
                ['type' => 'review_archive_opened', 'message' => '변조한 클라이언트 역할로 검토 보관함을 열었습니다.']
            );
        }

        return $this->makeResponse(
            $state,
            'browser',
            ['role' => $role, 'message' => 'viewer 권한에는 보관함이 표시되지 않습니다.'],
            $request,
            403,
            [],
            ['type' => 'role_denied', 'message' => '서버가 클라이언트 role 값을 그대로 신뢰하고 있습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleIdor(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/api/invoices') {
            return $this->notFound($state, $request, 'browser');
        }

        $id = $this->queryString($request, 'id');
        if ($id === '' || preg_match('/^[0-9]{1,10}$/', $id) !== 1) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '숫자 청구서 id가 필요합니다.'],
                $request,
                400,
                ['Content-Type' => 'application/json'],
                ['type' => 'invalid_request', 'message' => 'id 쿼리 값을 확인하세요.']
            );
        }

        $pdo = $this->openDatabase($labDir);
        $query = $pdo->prepare('SELECT id, owner, summary, confidential FROM invoices WHERE id = :id');
        $query->execute([':id' => (int) $id]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '청구서를 찾을 수 없습니다.'],
                $request,
                404,
                ['Content-Type' => 'application/json'],
                ['type' => 'record_missing', 'message' => '다른 객체 식별자를 조사하세요.']
            );
        }

        $state['progress']['last_invoice_id'] = (int) $row['id'];
        $foreign = (int) $row['id'] === (int) $state['secrets']['target_id'];
        if ($foreign && hash_equals((string) $state['completion_proof'], (string) $row['confidential'])) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'browser',
            ['invoice' => $row, 'authorization_check' => 'missing'],
            $request,
            200,
            ['Content-Type' => 'application/json'],
            $foreign
                ? ['type' => 'foreign_document_viewed', 'message' => '다른 소유자의 실제 인스턴스 SQLite 행을 조회했습니다.']
                : ['type' => 'own_document_viewed', 'message' => '내 청구서를 조회했습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleSqliLogin(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/login' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'terminal',
                ['error' => 'POST /login 요청이 필요합니다.'],
                $request,
                405,
                ['Allow' => 'POST'],
                ['type' => 'method_not_allowed', 'message' => '로그인 폼 방식으로 요청하세요.']
            );
        }

        $username = $this->bodyString($request, 'username');
        $password = $this->bodyString($request, 'password');
        if (strlen($username) > 512 || strlen($password) > 512) {
            return $this->inputTooLarge($state, $request, 'terminal');
        }
        $state['progress']['last_username'] = $username;

        $pdo = $this->openDatabase($labDir);
        $pdo->query('PRAGMA query_only = ON');
        // Deliberately vulnerable inside this disposable challenge database.
        $sql = "SELECT id, username, role, proof FROM staff WHERE username = '" . $username
            . "' AND password = '" . $password . "' LIMIT 1";
        try {
            $row = $pdo->query($sql)->fetch(PDO::FETCH_ASSOC);
        } catch (PDOException $exception) {
            return $this->makeResponse(
                $state,
                'terminal',
                ['database_error' => $exception->getMessage(), 'query_shape' => "... username = '<input>' AND password = '<input>'"],
                $request,
                400,
                [],
                ['type' => 'sqlite_error', 'message' => 'SQLite가 조합된 문자열을 해석하지 못했습니다.']
            );
        }

        if (!is_array($row)) {
            return $this->makeResponse(
                $state,
                'terminal',
                ['authenticated' => false, 'message' => '자격 증명이 일치하지 않습니다.'],
                $request,
                401,
                [],
                ['type' => 'login_failed', 'message' => '문자열 연결 지점을 조사하세요.']
            );
        }

        $isManager = ($row['role'] ?? '') === 'admin'
            && hash_equals((string) $state['completion_proof'], (string) ($row['proof'] ?? ''));
        if ($isManager) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'terminal',
            ['authenticated' => true, 'user' => $row['username'], 'role' => $row['role'], 'proof' => $isManager ? $row['proof'] : null],
            $request,
            200,
            [],
            $isManager
                ? ['type' => 'manager_session_started', 'message' => '취약한 SQLite 질의로 관리자 세션을 열었습니다.']
                : ['type' => 'viewer_session_started', 'message' => '일반 세션이 열렸습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleSqliUnion(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/search') {
            return $this->notFound($state, $request, 'terminal');
        }

        $term = $this->queryString($request, 'q');
        if (strlen($term) > 512) {
            return $this->inputTooLarge($state, $request, 'terminal');
        }
        $state['progress']['last_term'] = $term;

        $pdo = $this->openDatabase($labDir);
        $pdo->query('PRAGMA query_only = ON');
        // Deliberately vulnerable UNION surface, constrained to this SQLite file.
        $sql = "SELECT sku, name, price FROM products WHERE name LIKE '%" . $term . "%'";
        try {
            $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $exception) {
            $state['progress']['column_hint_seen'] = true;
            return $this->makeResponse(
                $state,
                'terminal',
                ['database_error' => $exception->getMessage(), 'visible_columns' => 3],
                $request,
                400,
                [],
                ['type' => 'sqlite_error', 'message' => 'UNION 양쪽의 열 개수와 자료 위치를 맞추세요.']
            );
        }

        $extracted = false;
        foreach ($rows as $row) {
            if (hash_equals((string) $state['completion_proof'], (string) ($row['name'] ?? ''))) {
                $extracted = true;
                break;
            }
        }
        if ($extracted) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'terminal',
            ['rows' => $rows, 'row_count' => count($rows)],
            $request,
            200,
            [],
            $extracted
                ? ['type' => 'training_note_extracted', 'message' => 'UNION 결과에 승인 메모를 결합했습니다.']
                : ['type' => 'search_completed', 'message' => 'SQLite 검색 결과를 받았습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleReflectedXss(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/search') {
            return $this->notFound($state, $request, 'browser');
        }

        $term = $this->queryString($request, 'q');
        if (strlen($term) > 4096) {
            return $this->inputTooLarge($state, $request, 'browser');
        }

        $nonce = (string) $state['secrets']['nonce'];
        $rendered = '<div class="search-result">검색어: ' . $term . '</div>';
        $state['progress']['last_rendered'] = $rendered;
        $pattern = '/<script\b[^>]*\bnonce\s*=\s*(["\'])' . preg_quote($nonce, '/') . '\1[^>]*>(.*?)<\/script>/is';
        $nonceMatched = preg_match($pattern, $term, $matches) === 1;
        $callbackMatched = $nonceMatched
            && preg_match('/\blab\.report\s*\(\s*(["\'])complete\1\s*\)/i', (string) ($matches[2] ?? '')) === 1;

        $headers = ['Content-Security-Policy' => "default-src 'none'; script-src 'nonce-{$nonce}'"];
        if ($callbackMatched) {
            $state['progress']['nonce_event'] = true;
            $this->markCompleted($state);
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'rendered_fragment' => $rendered,
                    'virtual_console' => ['event' => 'lab.report', 'argument' => 'complete'],
                    'proof' => $state['completion_proof'],
                    'execution_model' => 'nonce event simulation only; no DOM, cookies, or portal context',
                ],
                $request,
                200,
                $headers,
                ['type' => 'sandbox_script_executed', 'message' => '일치하는 nonce의 가상 스크립트 이벤트가 발생했습니다.']
            );
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'rendered_fragment' => $rendered,
                'virtual_console' => $nonceMatched ? ['event' => 'no_report_callback'] : ['event' => 'csp_nonce_blocked'],
                'execution_model' => 'text and nonce-event simulation only',
            ],
            $request,
            200,
            $headers,
            ['type' => 'fragment_rendered', 'message' => '반사 문자열을 안전한 가상 렌더러에서 확인했습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handlePathTraversal(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/files') {
            return $this->notFound($state, $request, 'terminal');
        }

        $file = $this->queryString($request, 'file');
        if ($file === '') {
            $file = 'notice.txt';
        }
        $state['progress']['last_file'] = $file;
        $read = $this->readVirtualFile($labDir, $file);
        if ($read['status'] === 'blocked') {
            $state['progress']['blocked_escapes'] = (int) $state['progress']['blocked_escapes'] + 1;
            return $this->makeResponse(
                $state,
                'terminal',
                ['error' => '인스턴스 가상 파일 루트 밖으로 나가는 경로는 차단되었습니다.', 'requested_file' => $file],
                $request,
                403,
                [],
                ['type' => 'instance_escape_blocked', 'message' => '실제 호스트 파일은 읽지 않았습니다.']
            );
        }
        if ($read['status'] === 'missing') {
            return $this->makeResponse(
                $state,
                'terminal',
                ['error' => '가상 파일을 찾을 수 없습니다.', 'requested_file' => $file],
                $request,
                404,
                [],
                ['type' => 'file_missing', 'message' => '공개 파일의 상대 경로 단서를 확인하세요.']
            );
        }

        $isProof = (bool) $read['private']
            && hash_equals('private/' . (string) $state['secrets']['private_file'], (string) $read['logical'])
            && str_contains((string) $read['content'], (string) $state['completion_proof']);
        if ($isProof) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'terminal',
            [
                'logical_file' => $read['logical'],
                'zone' => $read['private'] ? 'private' : 'public',
                'content' => $read['content'],
            ],
            $request,
            200,
            [],
            $isProof
                ? ['type' => 'private_proof_read', 'message' => 'public에서 private로 이동해 브리핑을 읽었습니다.']
                : ['type' => 'public_file_read', 'message' => '가상 공개 파일을 읽었습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleUpload(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/upload' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => 'POST /upload 요청이 필요합니다.'],
                $request,
                405,
                ['Allow' => 'POST'],
                ['type' => 'method_not_allowed', 'message' => '업로드 폼으로 요청하세요.']
            );
        }

        $upload = $request['files']['file'] ?? $request['files']['upload'] ?? null;
        if (!is_array($upload)) {
            $upload = is_array($request['body']) ? $request['body'] : [];
        }
        $name = is_string($upload['name'] ?? null) ? $upload['name'] : '';
        $type = is_string($upload['type'] ?? null) ? $upload['type'] : '';
        $content = is_string($upload['content'] ?? null) ? $upload['content'] : '';
        if ($name === '' || $type === '') {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => 'name, type, content가 필요합니다.'],
                $request,
                400,
                [],
                ['type' => 'invalid_upload', 'message' => '가상 파일 메타데이터를 확인하세요.']
            );
        }
        if (strlen($name) > 255 || strlen($type) > 128 || strlen($content) > self::MAX_INPUT_LENGTH) {
            return $this->inputTooLarge($state, $request, 'browser');
        }

        // Intentionally weak challenge validator: it trusts the client MIME.
        $accepted = str_starts_with(strtolower(trim($type)), 'image/');
        if (!$accepted) {
            return $this->makeResponse(
                $state,
                'browser',
                ['accepted' => false, 'validator' => 'client MIME prefix', 'received_type' => $type],
                $request,
                415,
                [],
                ['type' => 'upload_rejected', 'message' => '검증기는 image/ MIME만 허용합니다.']
            );
        }

        $storageName = 'upload-' . $this->randomHex(16) . '.bin';
        $storageRoot = realpath($labDir . '/private_uploads');
        if ($storageRoot === false || !$this->isWithin($storageRoot, $labDir)) {
            throw new RuntimeException('Private upload storage is unavailable.');
        }
        $storedPath = $storageRoot . DIRECTORY_SEPARATOR . $storageName;
        $this->writeLocalFile($storedPath, $content, $storageRoot);

        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $dangerous = in_array($extension, ['php', 'phtml', 'phar'], true);
        $state['progress']['uploads'][] = [
            'original_name' => basename(str_replace('\\', '/', $name)),
            'claimed_type' => $type,
            'stored_as' => 'private://' . $storageName,
            'dangerous_extension' => $dangerous,
        ];
        $state['progress']['uploads'] = array_slice((array) $state['progress']['uploads'], -20);
        if ($dangerous) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'accepted' => true,
                'original_name' => $name,
                'claimed_type' => $type,
                'stored_as' => 'private://' . $storageName,
                'public_url' => null,
                'executable' => false,
                'validator' => 'client MIME prefix only',
                'proof' => $dangerous ? $state['completion_proof'] : null,
            ],
            $request,
            201,
            [],
            $dangerous
                ? ['type' => 'dangerous_upload_accepted', 'message' => '위험 확장자가 위조 MIME로 승인되었습니다. 파일은 실행되지 않습니다.']
                : ['type' => 'upload_stored', 'message' => '파일을 비공개 비실행 저장소에 보관했습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleJwt(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/admin/verify' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'terminal',
                ['error' => 'POST /admin/verify 요청이 필요합니다.'],
                $request,
                405,
                ['Allow' => 'POST'],
                ['type' => 'method_not_allowed', 'message' => 'Bearer 토큰 검증 엔드포인트를 사용하세요.']
            );
        }

        $token = $this->bearerOrBodyToken($request);
        $jwt = $this->decodeJwt($token);
        if ($jwt === null) {
            return $this->makeResponse(
                $state,
                'terminal',
                ['accepted' => false, 'error' => 'JWT 형식이 올바르지 않습니다.'],
                $request,
                400,
                [],
                ['type' => 'token_rejected', 'message' => 'header.payload.signature 세 부분을 확인하세요.']
            );
        }

        $alg = is_string($jwt['header']['alg'] ?? null) ? strtolower($jwt['header']['alg']) : '';
        $state['progress']['last_alg'] = $alg;
        $accepted = $alg === 'none'
            && $jwt['signature'] === ''
            && ($jwt['payload']['role'] ?? null) === 'admin'
            && is_string($jwt['payload']['aud'] ?? null)
            && hash_equals((string) $state['secrets']['audience'], $jwt['payload']['aud'])
            && is_string($jwt['payload']['nonce'] ?? null)
            && hash_equals((string) $state['secrets']['nonce'], $jwt['payload']['nonce']);
        if ($accepted) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'terminal',
            [
                'accepted' => $accepted,
                'decoded_header' => $jwt['header'],
                'decoded_payload' => $jwt['payload'],
                'validator_scope' => 'this challenge instance only',
                'proof' => $accepted ? $state['completion_proof'] : null,
            ],
            $request,
            $accepted ? 200 : 403,
            [],
            $accepted
                ? ['type' => 'admin_token_accepted', 'message' => '실습 전용 alg:none 토큰이 관리자 권한으로 승인되었습니다.']
                : ['type' => 'token_rejected', 'message' => '알고리즘, 역할, audience, nonce를 점검하세요.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleSsrf(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/fetch' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'network',
                ['error' => 'POST /fetch 요청이 필요합니다.'],
                $request,
                405,
                ['Allow' => 'POST'],
                ['type' => 'method_not_allowed', 'message' => 'url 필드로 가상 요청을 보내세요.']
            );
        }

        $url = $this->bodyString($request, 'url');
        if ($url === '' || strlen($url) > 2048) {
            return $this->makeResponse(
                $state,
                'network',
                ['error' => '유효한 가상 URL이 필요합니다.'],
                $request,
                400,
                [],
                ['type' => 'invalid_url', 'message' => 'http 또는 https URL을 입력하세요.']
            );
        }

        $parts = $this->parseVirtualUrl($url);
        $allowedHosts = ['assets.vendor.test', 'redirector.vendor.test'];
        if ($parts === null || !in_array($parts['host'], $allowedHosts, true)) {
            return $this->makeResponse(
                $state,
                'network',
                ['allowed' => false, 'url' => $url, 'allowlist' => $allowedHosts],
                $request,
                403,
                [],
                ['type' => 'initial_host_blocked', 'message' => '첫 요청 호스트가 allowlist에 없습니다.']
            );
        }

        $first = $this->dispatchVirtualUrl($url, $state);
        $trace = [['url' => $url, 'status' => $first['status'], 'host' => $parts['host']]];
        $final = $first;
        if ($first['status'] === 302 && is_string($first['headers']['Location'] ?? null)) {
            // The intended flaw: this virtual redirect is followed without a second allowlist check.
            $redirectUrl = $first['headers']['Location'];
            $redirectParts = $this->parseVirtualUrl($redirectUrl);
            if ($redirectParts === null) {
                return $this->makeResponse(
                    $state,
                    'network',
                    ['trace' => $trace, 'error' => '리다이렉트 URL이 올바르지 않습니다.'],
                    $request,
                    502,
                    [],
                    ['type' => 'virtual_redirect_failed', 'message' => '가상 디스패처가 리다이렉트를 중단했습니다.']
                );
            }
            $final = $this->dispatchVirtualUrl($redirectUrl, $state);
            $trace[] = ['url' => $redirectUrl, 'status' => $final['status'], 'host' => $redirectParts['host']];
        }

        $state['progress']['last_trace'] = $trace;
        $fetchedProof = ($final['body']['assignment_id'] ?? null) === $state['secrets']['assignment_id']
            && ($final['body']['proof'] ?? null) === $state['completion_proof'];
        if ($fetchedProof) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'network',
            ['trace' => $trace, 'response' => $final['body'], 'network_mode' => 'allowlisted in-memory dispatcher'],
            $request,
            (int) $final['status'],
            (array) $final['headers'],
            $fetchedProof
                ? ['type' => 'metadata_proof_fetched', 'message' => '재검증되지 않은 가상 리다이렉트로 내부 메타데이터를 읽었습니다.']
                : ['type' => 'virtual_fetch_completed', 'message' => '가상 네트워크 응답을 받았습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfall(array &$state, string $labDir, array $request): array
    {
        $stage = (string) $state['progress']['stage'];
        if ($stage === 'idor') {
            return $this->handleNightfallIdor($state, $labDir, $request);
        }
        if ($stage === 'traversal') {
            return $this->handleNightfallTraversal($state, $labDir, $request);
        }
        if ($stage === 'jwt') {
            return $this->handleNightfallJwt($state, $request);
        }

        throw new RuntimeException('Unknown Nightfall stage.');
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallIdor(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/api/cases') {
            return $this->stageConflict($state, $request, 'browser', '먼저 /api/cases의 객체 권한을 조사하세요.');
        }
        $id = $this->queryString($request, 'id');
        if (preg_match('/^[0-9]{1,10}$/', $id) !== 1) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '숫자 case id가 필요합니다.'],
                $request,
                400,
                [],
                ['type' => 'invalid_request', 'message' => '감사 로그의 참조 번호를 확인하세요.']
            );
        }

        $pdo = $this->openDatabase($labDir);
        $query = $pdo->prepare('SELECT id, owner, title, attachment FROM cases WHERE id = :id');
        $query->execute([':id' => (int) $id]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => 'case를 찾지 못했습니다.'],
                $request,
                404,
                [],
                ['type' => 'record_missing', 'message' => '다른 case id를 확인하세요.']
            );
        }

        $foreign = (int) $row['id'] === (int) $state['secrets']['target_id'];
        if ($foreign) {
            $state['progress']['stage'] = 'traversal';
        }
        return $this->makeResponse(
            $state,
            'browser',
            ['case' => $row, 'authorization_check' => 'missing', 'next_endpoint' => $foreign ? '/files?file={attachment}' : null],
            $request,
            200,
            [],
            $foreign
                ? ['type' => 'nightfall_idor_complete', 'message' => '외부 case에서 비공개 첨부 경로를 확보했습니다.']
                : ['type' => 'nightfall_own_case', 'message' => '내 case를 확인했습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallTraversal(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/files') {
            return $this->stageConflict($state, $request, 'terminal', '확보한 attachment를 /files에서 조사하세요.');
        }
        $file = $this->queryString($request, 'file');
        $read = $this->readVirtualFile($labDir, $file);
        if ($read['status'] === 'blocked') {
            return $this->makeResponse(
                $state,
                'terminal',
                ['error' => 'Nightfall 인스턴스 파일 루트 밖은 차단됩니다.'],
                $request,
                403,
                [],
                ['type' => 'instance_escape_blocked', 'message' => '실제 시스템 파일은 접근하지 않았습니다.']
            );
        }
        if ($read['status'] !== 'ok') {
            return $this->makeResponse(
                $state,
                'terminal',
                ['error' => '첨부 파일을 찾을 수 없습니다.'],
                $request,
                404,
                [],
                ['type' => 'file_missing', 'message' => 'case의 attachment 값을 그대로 사용하세요.']
            );
        }

        $expected = 'private/' . (string) $state['secrets']['private_file'];
        $correct = (bool) $read['private'] && hash_equals($expected, (string) $read['logical']);
        if ($correct) {
            $state['progress']['stage'] = 'jwt';
        }
        return $this->makeResponse(
            $state,
            'terminal',
            ['logical_file' => $read['logical'], 'content' => $read['content'], 'next_endpoint' => $correct ? '/operator/shutdown' : null],
            $request,
            200,
            [],
            $correct
                ? ['type' => 'nightfall_traversal_complete', 'message' => '비공개 운영 토큰 메모를 회수했습니다.']
                : ['type' => 'public_file_read', 'message' => '공개 첨부 파일을 읽었습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallJwt(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/operator/shutdown' || (string) $request['method'] !== 'POST') {
            return $this->stageConflict($state, $request, 'terminal', '변조한 Bearer 토큰을 POST /operator/shutdown에 제출하세요.');
        }

        $jwt = $this->decodeJwt($this->bearerOrBodyToken($request));
        $accepted = $jwt !== null
            && strtolower((string) ($jwt['header']['alg'] ?? '')) === 'none'
            && $jwt['signature'] === ''
            && ($jwt['payload']['role'] ?? null) === 'operator'
            && ($jwt['payload']['scope'] ?? null) === 'shutdown:write'
            && is_string($jwt['payload']['aud'] ?? null)
            && hash_equals((string) $state['secrets']['audience'], $jwt['payload']['aud'])
            && is_string($jwt['payload']['nonce'] ?? null)
            && hash_equals((string) $state['secrets']['nonce'], $jwt['payload']['nonce']);
        if (!$accepted) {
            return $this->makeResponse(
                $state,
                'terminal',
                ['accepted' => false, 'decoded' => $jwt],
                $request,
                403,
                [],
                ['type' => 'nightfall_token_rejected', 'message' => 'alg, role, scope, aud, nonce를 다시 확인하세요.']
            );
        }

        $state['progress']['stage'] = 'complete';
        $this->markCompleted($state);
        return $this->makeResponse(
            $state,
            'terminal',
            ['shutdown_authorized' => true, 'vault' => 'nightfall-final', 'proof' => $state['completion_proof']],
            $request,
            200,
            [],
            ['type' => 'nightfall_vault_opened', 'message' => '세 단계 연쇄를 완료하고 최종 승인 금고를 열었습니다.']
        );
    }

    /**
     * @param array<string, mixed> $state
     * @return array{status:int,headers:array<string,string>,body:array<string,mixed>}
     */
    private function dispatchVirtualUrl(string $url, array $state): array
    {
        $parts = $this->parseVirtualUrl($url);
        if ($parts === null) {
            return ['status' => 400, 'headers' => [], 'body' => ['error' => 'invalid virtual URL']];
        }

        if ($parts['host'] === 'assets.vendor.test' && $parts['path'] === '/logo.svg') {
            return [
                'status' => 200,
                'headers' => ['Content-Type' => 'image/svg+xml'],
                'body' => ['asset' => 'vendor-logo', 'content' => '<svg><!-- virtual asset --></svg>'],
            ];
        }

        if ($parts['host'] === 'redirector.vendor.test' && $parts['path'] === '/go') {
            parse_str($parts['query'], $query);
            $target = is_string($query['to'] ?? null) ? $query['to'] : '';
            if ($target === '') {
                return ['status' => 400, 'headers' => [], 'body' => ['error' => 'missing redirect target']];
            }
            return ['status' => 302, 'headers' => ['Location' => $target], 'body' => ['redirecting' => true]];
        }

        if ($parts['host'] === 'metadata.internal' && $parts['path'] === '/latest/assignment') {
            return [
                'status' => 200,
                'headers' => ['Content-Type' => 'application/json', 'X-Virtual-Network' => 'internal'],
                'body' => [
                    'assignment_id' => $state['secrets']['assignment_id'],
                    'classification' => 'training-only',
                    'proof' => $state['completion_proof'],
                ],
            ];
        }

        return ['status' => 404, 'headers' => [], 'body' => ['error' => 'virtual route not found']];
    }

    /** @return array{scheme:string,host:string,path:string,query:string}|null */
    private function parseVirtualUrl(string $url): ?array
    {
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return null;
        }
        $scheme = is_string($parts['scheme'] ?? null) ? strtolower($parts['scheme']) : '';
        $host = is_string($parts['host'] ?? null) ? strtolower(rtrim($parts['host'], '.')) : '';
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            return null;
        }
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])) {
            return null;
        }
        return [
            'scheme' => $scheme,
            'host' => $host,
            'path' => is_string($parts['path'] ?? null) && $parts['path'] !== '' ? $parts['path'] : '/',
            'query' => is_string($parts['query'] ?? null) ? $parts['query'] : '',
        ];
    }

    /**
     * @param array<string, mixed> $state
     * @param array<string, mixed> $request
     * @param array<string, mixed> $output
     * @param array<string, string> $headers
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    private function makeResponse(
        array $state,
        string $surface,
        array $output,
        array $request,
        int $status,
        array $headers,
        array $event
    ): array {
        $response = [
            'lab_id' => (string) $state['lab_id'],
            'lab_type' => self::LABS[(string) $state['lab_id']]['type'],
            'surface' => $surface,
            'title' => self::LABS[(string) $state['lab_id']]['title'],
            'output' => $output,
            'request' => $request,
            'status' => $status,
            'headers' => $headers,
            'completed' => (bool) $state['completed'],
            'event' => $event,
            'hints' => $this->hintsFor($state),
        ];
        json_encode($response, JSON_THROW_ON_ERROR);
        return $response;
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function notFound(array $state, array $request, string $surface): array
    {
        return $this->makeResponse(
            $state,
            $surface,
            ['error' => '가상 엔드포인트를 찾을 수 없습니다.', 'path' => $request['path']],
            $request,
            404,
            [],
            ['type' => 'route_missing', 'message' => '의뢰서의 엔드포인트를 확인하세요.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function inputTooLarge(array $state, array $request, string $surface): array
    {
        return $this->makeResponse(
            $state,
            $surface,
            ['error' => '가상 요청 입력이 허용 크기를 초과했습니다.'],
            $request,
            413,
            [],
            ['type' => 'input_too_large', 'message' => '더 작은 학습용 입력을 사용하세요.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function stageConflict(array $state, array $request, string $surface, string $message): array
    {
        return $this->makeResponse(
            $state,
            $surface,
            ['error' => '현재 연쇄 단계와 맞지 않는 요청입니다.', 'stage' => $state['progress']['stage']],
            $request,
            409,
            [],
            ['type' => 'stage_order_required', 'message' => $message]
        );
    }

    /** @param array<string, mixed> $state */
    private function markCompleted(array &$state): void
    {
        if (!(bool) $state['completed']) {
            $state['completed'] = true;
            $state['completed_at'] = gmdate('c');
        }
    }

    /** @param array<string, mixed> $state @return list<string> */
    private function hintsFor(array $state): array
    {
        return match ((string) $state['lab_id']) {
            self::HTTP_HEADERS => [
                '개발자 도구의 Network 패널에서 Response Headers를 펼쳐 보세요.',
                '숨겨진 경로 요청에도 발견한 X-Case-Token 헤더가 필요합니다.',
            ],
            self::CLIENT_TRUST => [
                '토큰은 암호문이 아니라 base64url로 표현한 JSON입니다.',
                'nonce는 그대로 두고 role만 바꾼 뒤 Client 인증 헤더로 보내 보세요.',
            ],
            self::IDOR => [
                '내 id와 활동 피드에 보인 id를 비교하세요.',
                '서버가 조회 결과의 owner를 로그인 사용자와 비교하지 않습니다.',
            ],
            self::SQLI_LOGIN => [
                '입력값이 작은따옴표 사이에 직접 연결됩니다.',
                "참인 조건과 주석을 조합해 뒤의 password 비교를 무력화해 보세요.",
            ],
            self::SQLI_UNION => [
                '원래 검색 결과는 3개 열입니다.',
                'vault_notes의 secret을 결과의 두 번째 열에 맞추세요.',
            ],
            self::REFLECTED_XSS => [
                'Content-Security-Policy 헤더의 nonce를 확인하세요.',
                "해당 nonce를 가진 script 문자열에서 lab.report('complete')를 호출하세요.",
            ],
            self::PATH_TRAVERSAL => [
                'notice.txt에 private 파일의 상대 경로가 적혀 있습니다.',
                '가상 public 디렉터리에서 .. 한 번이면 sibling private에 도달합니다.',
            ],
            self::UPLOAD_VALIDATION => [
                '검증기는 파일 내용이나 확장자가 아니라 클라이언트 MIME만 봅니다.',
                '위험 확장자를 유지한 채 image/ MIME을 주장해 보세요. 파일은 절대 실행되지 않습니다.',
            ],
            self::JWT_VALIDATION => [
                'JWT의 header와 payload는 각각 base64url JSON입니다.',
                'alg을 none, role을 admin으로 바꾸고 aud와 nonce를 유지한 뒤 빈 서명으로 끝내세요.',
            ],
            self::SSRF => [
                '직접 내부 호스트를 요청하면 첫 allowlist 검사에서 차단됩니다.',
                '허용된 redirector의 to 값에 내부 메타데이터 URL을 URL 인코딩해 넣어 보세요.',
            ],
            self::OPERATION_NIGHTFALL => match ((string) $state['progress']['stage']) {
                'idor' => ['감사 참조 번호를 case id로 조회하세요.', '외부 case의 attachment가 다음 단계 단서입니다.'],
                'traversal' => ['attachment의 ../private 경로를 /files에 전달하세요.', '파일 루트 바깥으로 더 이동하는 경로는 차단됩니다.'],
                'jwt' => ['메모의 viewer JWT에서 aud와 nonce를 유지하세요.', 'alg=none, role=operator, scope=shutdown:write, 빈 서명이 필요합니다.'],
                default => ['Operation Nightfall을 완료했습니다.'],
            },
            default => [],
        };
    }

    /** @param array<string, mixed> $state @return array<string, mixed> */
    private function recommendedRequest(array $state): array
    {
        $request = match ((string) $state['lab_id']) {
            self::HTTP_HEADERS => ['method' => 'GET', 'path' => '/status', 'query' => [], 'headers' => [], 'body' => [], 'files' => []],
            self::CLIENT_TRUST => ['method' => 'GET', 'path' => '/admin', 'query' => [], 'headers' => ['Authorization' => 'Client {token}'], 'body' => [], 'files' => []],
            self::IDOR => ['method' => 'GET', 'path' => '/api/invoices', 'query' => ['id' => (string) $state['secrets']['self_id']], 'headers' => [], 'body' => [], 'files' => []],
            self::SQLI_LOGIN => ['method' => 'POST', 'path' => '/login', 'query' => [], 'headers' => [], 'body' => ['username' => '', 'password' => ''], 'files' => []],
            self::SQLI_UNION => ['method' => 'GET', 'path' => '/search', 'query' => ['q' => 'Keyboard'], 'headers' => [], 'body' => [], 'files' => []],
            self::REFLECTED_XSS => ['method' => 'GET', 'path' => '/search', 'query' => ['q' => 'keyboard'], 'headers' => [], 'body' => [], 'files' => []],
            self::PATH_TRAVERSAL => ['method' => 'GET', 'path' => '/files', 'query' => ['file' => 'notice.txt'], 'headers' => [], 'body' => [], 'files' => []],
            self::UPLOAD_VALIDATION => ['method' => 'POST', 'path' => '/upload', 'query' => [], 'headers' => [], 'body' => [], 'files' => ['file' => ['name' => 'avatar.png', 'type' => 'image/png', 'content' => 'virtual-bytes']]],
            self::JWT_VALIDATION => ['method' => 'POST', 'path' => '/admin/verify', 'query' => [], 'headers' => ['Authorization' => 'Bearer {token}'], 'body' => [], 'files' => []],
            self::SSRF => ['method' => 'POST', 'path' => '/fetch', 'query' => [], 'headers' => [], 'body' => ['url' => 'https://assets.vendor.test/logo.svg'], 'files' => []],
            self::OPERATION_NIGHTFALL => match ((string) $state['progress']['stage']) {
                'idor' => ['method' => 'GET', 'path' => '/api/cases', 'query' => ['id' => (string) $state['secrets']['self_id']], 'headers' => [], 'body' => [], 'files' => []],
                'traversal' => ['method' => 'GET', 'path' => '/files', 'query' => ['file' => '../private/{attachment}'], 'headers' => [], 'body' => [], 'files' => []],
                default => ['method' => 'POST', 'path' => '/operator/shutdown', 'query' => [], 'headers' => ['Authorization' => 'Bearer {token}'], 'body' => [], 'files' => []],
            },
            default => [],
        };
        return $request;
    }

    /** @param array<string, mixed> $state @return array<string, mixed> */
    private function publicProgress(array $state): array
    {
        return match ((string) $state['lab_id']) {
            self::HTTP_HEADERS => ['headers_observed' => (bool) $state['progress']['headers_observed']],
            self::CLIENT_TRUST => ['token_examined' => (bool) $state['progress']['token_examined']],
            self::IDOR => ['last_invoice_id' => $state['progress']['last_invoice_id']],
            self::SQLI_LOGIN => ['last_username' => $state['progress']['last_username']],
            self::SQLI_UNION => ['last_term' => $state['progress']['last_term'], 'column_hint_seen' => (bool) $state['progress']['column_hint_seen']],
            self::REFLECTED_XSS => ['nonce_event' => (bool) $state['progress']['nonce_event']],
            self::PATH_TRAVERSAL => ['last_file' => $state['progress']['last_file'], 'blocked_escapes' => (int) $state['progress']['blocked_escapes']],
            self::UPLOAD_VALIDATION => ['uploads' => $state['progress']['uploads']],
            self::JWT_VALIDATION => ['last_alg' => $state['progress']['last_alg']],
            self::SSRF => ['last_trace' => $state['progress']['last_trace']],
            self::OPERATION_NIGHTFALL => ['stage' => $state['progress']['stage']],
            default => [],
        };
    }

    /** @param array<string, mixed> $state */
    private function surfaceFor(array $state): string
    {
        if ((string) $state['lab_id'] !== self::OPERATION_NIGHTFALL) {
            return self::LABS[(string) $state['lab_id']]['surface'];
        }
        return match ((string) $state['progress']['stage']) {
            'idor' => 'browser',
            'traversal', 'jwt', 'complete' => 'terminal',
            default => 'browser',
        };
    }

    /** @param array<string, mixed> $request @return array<string, mixed> */
    private function normalizeRequest(array $request): array
    {
        try {
            json_encode($request, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new InvalidArgumentException('The request must be JSON serializable.', 0, $exception);
        }

        $method = is_string($request['method'] ?? null) ? strtoupper(trim($request['method'])) : 'GET';
        if ($method === '' || preg_match('/^[A-Z]{1,16}$/', $method) !== 1) {
            throw new InvalidArgumentException('Invalid virtual request method.');
        }
        $path = is_string($request['path'] ?? null) ? $request['path'] : '/';
        if ($path === '' || $path[0] !== '/' || strlen($path) > 2048 || str_contains($path, "\0")) {
            throw new InvalidArgumentException('Invalid virtual request path.');
        }

        $query = $this->normalizeJsonMap($request['query'] ?? []);
        $headers = [];
        foreach ($this->normalizeJsonMap($request['headers'] ?? []) as $name => $value) {
            if (!is_scalar($value) && $value !== null) {
                throw new InvalidArgumentException('Virtual header values must be scalar.');
            }
            $headerName = trim((string) $name);
            $headerValue = (string) ($value ?? '');
            if ($headerName === '' || preg_match('/^[A-Za-z0-9-]{1,128}$/', $headerName) !== 1
                || str_contains($headerValue, "\r") || str_contains($headerValue, "\n")) {
                throw new InvalidArgumentException('Invalid virtual header.');
            }
            $headers[$headerName] = $headerValue;
        }

        $bodyValue = $request['body'] ?? [];
        if (is_array($bodyValue)) {
            $body = $this->normalizeJsonMap($bodyValue);
        } elseif (is_string($bodyValue)) {
            $body = $bodyValue;
        } else {
            throw new InvalidArgumentException('Virtual request body must be an array or string.');
        }
        $files = $this->normalizeJsonMap($request['files'] ?? []);

        return [
            'method' => $method,
            'path' => $path,
            'query' => $query,
            'headers' => $headers,
            'body' => $body,
            'files' => $files,
        ];
    }

    /** @return array<string, mixed> */
    private function normalizeJsonMap(mixed $value): array
    {
        if (!is_array($value)) {
            throw new InvalidArgumentException('Expected a JSON object/array.');
        }
        $normalized = [];
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $normalized[$key] = $this->normalizeJsonMap($item);
            } elseif (is_scalar($item) || $item === null) {
                $normalized[$key] = $item;
            } else {
                throw new InvalidArgumentException('Request values must contain only JSON scalars and arrays.');
            }
        }
        return $normalized;
    }

    /** @param array<string, mixed> $request */
    private function queryString(array $request, string $key): string
    {
        $value = $request['query'][$key] ?? '';
        return is_scalar($value) ? (string) $value : '';
    }

    /** @param array<string, mixed> $request */
    private function bodyString(array $request, string $key): string
    {
        if (!is_array($request['body'])) {
            return '';
        }
        $value = $request['body'][$key] ?? '';
        return is_scalar($value) ? (string) $value : '';
    }

    /** @param array<string, mixed> $request */
    private function headerValue(array $request, string $wanted): string
    {
        foreach ((array) $request['headers'] as $name => $value) {
            if (strcasecmp((string) $name, $wanted) === 0) {
                return is_scalar($value) ? (string) $value : '';
            }
        }
        return '';
    }

    /** @param array<string, mixed> $request */
    private function bearerOrBodyToken(array $request): string
    {
        $token = $this->bodyString($request, 'token');
        if ($token !== '') {
            return $token;
        }
        $authorization = $this->headerValue($request, 'Authorization');
        if (preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches) === 1) {
            return trim($matches[1]);
        }
        return '';
    }

    /** @return array<string, mixed>|null */
    private function decodeBase64Json(string $encoded): ?array
    {
        $decoded = $this->base64UrlDecode($encoded);
        if ($decoded === null) {
            return null;
        }
        try {
            $value = json_decode($decoded, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }
        return is_array($value) ? $value : null;
    }

    /** @return array{header:array<string,mixed>,payload:array<string,mixed>,signature:string}|null */
    private function decodeJwt(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        $header = $this->decodeBase64Json($parts[0]);
        $payload = $this->decodeBase64Json($parts[1]);
        if ($header === null || $payload === null) {
            return null;
        }
        return ['header' => $header, 'payload' => $payload, 'signature' => $parts[2]];
    }

    /** @param array<string, mixed> $header @param array<string, mixed> $payload */
    private function makeJwt(array $header, array $payload, string $signature): string
    {
        return $this->base64UrlEncodeJson($header) . '.'
            . $this->base64UrlEncodeJson($payload) . '.'
            . $this->base64UrlEncode($signature);
    }

    /** @param array<string, mixed> $value */
    private function base64UrlEncodeJson(array $value): string
    {
        return $this->base64UrlEncode(json_encode($value, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): ?string
    {
        if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1) {
            return null;
        }
        $padding = (4 - strlen($value) % 4) % 4;
        $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', $padding), true);
        return $decoded === false ? null : $decoded;
    }

    private function randomHex(int $bytes): string
    {
        return bin2hex(random_bytes($bytes));
    }

    /** @return array{0:int,1:int} */
    private function twoRandomIds(int $minimum, int $span): array
    {
        $first = $this->randomNumber($minimum, $span);
        do {
            $second = $this->randomNumber($minimum, $span);
        } while ($second === $first);
        return [$first, $second];
    }

    private function randomNumber(int $minimum, int $span): int
    {
        $unpacked = unpack('Nvalue', random_bytes(4));
        if (!is_array($unpacked)) {
            throw new RuntimeException('Unable to generate random instance data.');
        }
        return $minimum + ((int) $unpacked['value'] % $span);
    }

    private function openDatabase(string $labDir): PDO
    {
        $path = $labDir . '/lab.sqlite3';
        if (is_link($path)) {
            throw new RuntimeException('Refusing a symbolic-link database.');
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->query('PRAGMA foreign_keys = ON');
        $pdo->query('PRAGMA busy_timeout = 3000');
        if (is_file($path)) {
            chmod($path, 0600);
        }
        return $pdo;
    }

    private function makeVirtualFileSystem(string $labDir): string
    {
        $vfs = $labDir . '/vfs';
        foreach ([$vfs, $vfs . '/public', $vfs . '/private'] as $directory) {
            if (is_link($directory)) {
                throw new RuntimeException('Refusing a symbolic-link virtual filesystem directory.');
            }
            if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
                throw new RuntimeException('Unable to create the virtual filesystem.');
            }
        }
        $real = realpath($vfs);
        if ($real === false || !$this->isWithin($real, $labDir)) {
            throw new RuntimeException('Virtual filesystem escaped the lab directory.');
        }
        return $real;
    }

    /** @return array{status:string,logical:string,private:bool,content:string} */
    private function readVirtualFile(string $labDir, string $file): array
    {
        $empty = ['status' => 'blocked', 'logical' => '', 'private' => false, 'content' => ''];
        if ($file === '' || strlen($file) > 2048 || str_contains($file, "\0") || str_contains($file, '\\')) {
            return $empty;
        }
        $decoded = rawurldecode($file);
        if ($decoded === '' || str_starts_with($decoded, '/') || preg_match('/^[A-Za-z][A-Za-z0-9+.-]*:/', $decoded) === 1) {
            return $empty;
        }

        $vfs = realpath($labDir . '/vfs');
        $public = realpath($labDir . '/vfs/public');
        $private = realpath($labDir . '/vfs/private');
        if ($vfs === false || $public === false || $private === false || !$this->isWithin($vfs, $labDir)) {
            throw new RuntimeException('Virtual filesystem is unavailable.');
        }
        $candidate = $public . DIRECTORY_SEPARATOR . $decoded;
        $real = realpath($candidate);
        if ($real === false) {
            $parent = realpath(dirname($candidate));
            if ($parent !== false && !$this->isWithin($parent, $vfs)) {
                return $empty;
            }
            return ['status' => 'missing', 'logical' => '', 'private' => false, 'content' => ''];
        }
        if (!$this->isWithin($real, $vfs)) {
            return $empty;
        }
        if ((!$this->isWithin($real, $public) && !$this->isWithin($real, $private)) || !is_file($real) || is_link($real)) {
            return $empty;
        }

        $content = file_get_contents($real);
        if ($content === false) {
            throw new RuntimeException('Unable to read the virtual file.');
        }
        return [
            'status' => 'ok',
            'logical' => ltrim(substr($real, strlen($vfs)), DIRECTORY_SEPARATOR),
            'private' => $this->isWithin($real, $private),
            'content' => $content,
        ];
    }

    private function writeLocalFile(string $path, string $content, string $allowedRoot): void
    {
        $root = realpath($allowedRoot);
        $parent = realpath(dirname($path));
        if ($root === false || $parent === false || !$this->isWithin($parent, $root) || is_link($path)) {
            throw new RuntimeException('Refusing to write outside the local instance boundary.');
        }
        if (file_put_contents($path, $content, LOCK_EX) === false) {
            throw new RuntimeException('Unable to write an instance artifact.');
        }
        chmod($path, 0600);
    }

    private function isWithin(string $path, string $root): bool
    {
        $normalizedRoot = rtrim($root, DIRECTORY_SEPARATOR);
        if ($normalizedRoot === '') {
            $normalizedRoot = DIRECTORY_SEPARATOR;
        }
        return $path === $normalizedRoot
            || str_starts_with($path, $normalizedRoot === DIRECTORY_SEPARATOR ? DIRECTORY_SEPARATOR : $normalizedRoot . DIRECTORY_SEPARATOR);
    }

    /**
     * @param callable(string):array<string,mixed> $callback
     * @return array<string, mixed>
     */
    private function withLabLock(string $labId, callable $callback): array
    {
        $this->assertKnownLab($labId);
        $separator = $this->instanceRoot === DIRECTORY_SEPARATOR ? '' : DIRECTORY_SEPARATOR;
        $labPath = $this->instanceRoot . $separator . $labId;
        if (is_link($labPath)) {
            throw new RuntimeException('The lab directory may not be a symbolic link.');
        }
        if (!is_dir($labPath) && !mkdir($labPath, 0700, true) && !is_dir($labPath)) {
            throw new RuntimeException('Unable to create the lab directory.');
        }
        $labDir = realpath($labPath);
        if ($labDir === false || !$this->isWithin($labDir, $this->instanceRoot)) {
            throw new RuntimeException('The lab directory escaped its instance root.');
        }

        $lockPath = $labDir . '/.lock';
        if (is_link($lockPath)) {
            throw new RuntimeException('The lab lock may not be a symbolic link.');
        }
        $handle = fopen($lockPath, 'c+');
        if ($handle === false) {
            throw new RuntimeException('Unable to open the lab lock.');
        }
        chmod($lockPath, 0600);
        if (!flock($handle, LOCK_EX)) {
            fclose($handle);
            throw new RuntimeException('Unable to acquire the lab lock.');
        }

        try {
            $result = $callback($labDir);
            json_encode($result, JSON_THROW_ON_ERROR);
            return $result;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /** @return array<string, mixed> */
    private function loadOrInitialize(string $labId, string $labDir): array
    {
        $statePath = $labDir . '/state.json';
        if (is_link($statePath)) {
            throw new RuntimeException('The lab state may not be a symbolic link.');
        }
        if (is_file($statePath)) {
            $raw = file_get_contents($statePath);
            if ($raw === false) {
                throw new RuntimeException('Unable to read lab state.');
            }
            try {
                $state = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
            } catch (JsonException $exception) {
                throw new RuntimeException('The lab state is corrupt.', 0, $exception);
            }
            if (!is_array($state)
                || ($state['version'] ?? null) !== self::STATE_VERSION
                || ($state['lab_id'] ?? null) !== $labId
                || !is_array($state['secrets'] ?? null)
                || !is_array($state['progress'] ?? null)) {
                throw new RuntimeException('The lab state does not match this engine version.');
            }
            return $state;
        }

        // Recover cleanly from a partial first-start without mixing old secrets.
        foreach (scandir($labDir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..' || $entry === '.lock') {
                continue;
            }
            $this->removeLocalTree($labDir . DIRECTORY_SEPARATOR . $entry, $labDir);
        }

        $state = $this->initializeState($labId);
        $this->initializeResources($state, $labDir);
        $this->saveState($labDir, $state);
        return $state;
    }

    /** @param array<string, mixed> $state */
    private function saveState(string $labDir, array $state): void
    {
        $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
        $statePath = $labDir . '/state.json';
        if (is_link($statePath)) {
            throw new RuntimeException('The lab state may not be a symbolic link.');
        }
        $temporary = $labDir . '/.state-' . $this->randomHex(8) . '.tmp';
        $this->writeLocalFile($temporary, $encoded . "\n", $labDir);
        if (!rename($temporary, $statePath)) {
            @unlink($temporary);
            throw new RuntimeException('Unable to commit lab state.');
        }
        chmod($statePath, 0600);
    }

    private function removeLocalTree(string $path, string $allowedRoot): void
    {
        if (!$this->isWithin($path, $allowedRoot) || $path === $allowedRoot) {
            throw new RuntimeException('Refusing to remove outside the lab boundary.');
        }
        if (is_link($path) || is_file($path)) {
            if (!unlink($path) && file_exists($path)) {
                throw new RuntimeException('Unable to remove a lab artifact.');
            }
            return;
        }
        if (!is_dir($path)) {
            return;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $this->removeLocalTree($path . DIRECTORY_SEPARATOR . $entry, $allowedRoot);
        }
        if (!rmdir($path) && is_dir($path)) {
            throw new RuntimeException('Unable to remove a lab directory.');
        }
    }

    private function assertKnownLab(string $labId): void
    {
        if (!array_key_exists($labId, self::LABS)) {
            throw new InvalidArgumentException('Unknown stable lab id: ' . $labId);
        }
    }
}
