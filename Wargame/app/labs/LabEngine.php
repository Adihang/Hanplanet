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

    private const STATE_VERSION = 3;
    private const MAX_INPUT_LENGTH = 65536;

    /** @var array<string, array{title:string,surface:string,type:string}> */
    private const LABS = [
        self::HTTP_HEADERS => ['title' => 'Aurora SmartCoupon', 'surface' => 'browser', 'type' => 'http_headers'],
        self::CLIENT_TRUST => ['title' => 'LeafPeer Review', 'surface' => 'browser', 'type' => 'role_token'],
        self::IDOR => ['title' => 'Nova Vault', 'surface' => 'browser', 'type' => 'idor_sqlite'],
        self::SQLI_LOGIN => ['title' => 'Comet StockFlow', 'surface' => 'browser', 'type' => 'sqli_login'],
        self::SQLI_UNION => ['title' => 'Helios Supply Catalog', 'surface' => 'browser', 'type' => 'union_sqlite'],
        self::REFLECTED_XSS => ['title' => 'PrismCare Help Desk', 'surface' => 'browser', 'type' => 'xss_nonce'],
        self::PATH_TRAVERSAL => ['title' => 'Atlas Field Manual', 'surface' => 'browser', 'type' => 'path_traversal'],
        self::UPLOAD_VALIDATION => ['title' => 'PixelPet Profile', 'surface' => 'browser', 'type' => 'upload_mime'],
        self::JWT_VALIDATION => ['title' => 'Vector Deploy Gate', 'surface' => 'browser', 'type' => 'jwt_none'],
        self::SSRF => ['title' => 'Lumen Campaign Preview', 'surface' => 'network', 'type' => 'virtual_network'],
        self::OPERATION_NIGHTFALL => ['title' => 'Nightfall RelayOps', 'surface' => 'browser', 'type' => 'final_chain'],
    ];

    /** @var array<string, array{client:string,product:string,host:string,entry_path:string,sector:string,environment:string}> */
    private const TARGETS = [
        self::HTTP_HEADERS => [
            'client' => '오로라 문구점',
            'product' => 'Aurora SmartCoupon',
            'host' => 'coupon.aurora-stationery.training',
            'entry_path' => '/discount/check',
            'sector' => '문구 소매 프로모션',
            'environment' => '서울 성수점 할인 확인 서비스',
        ],
        self::CLIENT_TRUST => [
            'client' => '리프 리뷰 센터',
            'product' => 'LeafPeer Review',
            'host' => 'review.leaf-center.training',
            'entry_path' => '/inbox',
            'sector' => '동료 검토 워크플로',
            'environment' => '서울 연구센터 리뷰 보관함',
        ],
        self::IDOR => [
            'client' => '노바 문서함',
            'product' => 'Nova Vault',
            'host' => 'docs.nova-office.training',
            'entry_path' => '/documents',
            'sector' => '기업 문서 협업',
            'environment' => '노바 오피스 외부 자문 계정',
        ],
        self::SQLI_LOGIN => [
            'client' => '코멧 재고 관리',
            'product' => 'Comet StockFlow',
            'host' => 'night.comet-logistics.training',
            'entry_path' => '/login',
            'sector' => '물류·재고 운영',
            'environment' => '남부 물류센터 야간 재고 콘솔',
        ],
        self::SQLI_UNION => [
            'client' => '헬리오스 카탈로그',
            'product' => 'Helios Supply Catalog',
            'host' => 'catalog.helios-supply.training',
            'entry_path' => '/products',
            'sector' => 'B2B 산업용품 조달',
            'environment' => '판매 대리점용 상품 검색',
        ],
        self::REFLECTED_XSS => [
            'client' => '프리즘 도움말',
            'product' => 'PrismCare Help Desk',
            'host' => 'help.prismcare.training',
            'entry_path' => '/search',
            'sector' => '고객 지원 지식 베이스',
            'environment' => '프리즘케어 고객용 도움말 검색',
        ],
        self::PATH_TRAVERSAL => [
            'client' => '아틀라스 현장 매뉴얼',
            'product' => 'Atlas Field Manual',
            'host' => 'manuals.atlas-field.training',
            'entry_path' => '/viewer',
            'sector' => '현장 설비 점검',
            'environment' => '아틀라스 현장 기술자 문서 뷰어',
        ],
        self::UPLOAD_VALIDATION => [
            'client' => '픽셀펫 프로필',
            'product' => 'PixelPet Profile',
            'host' => 'profile.pixelpet.training',
            'entry_path' => '/avatar',
            'sector' => '반려동물 커뮤니티',
            'environment' => '픽셀펫 프로필·아바타 관리',
        ],
        self::JWT_VALIDATION => [
            'client' => '벡터 배포 콘솔',
            'product' => 'Vector Deploy Gate',
            'host' => 'deploy.vector-cloud.training',
            'entry_path' => '/approvals',
            'sector' => '클라우드 배포 승인',
            'environment' => '벡터 운영팀 생성 배포 승인 게이트',
        ],
        self::SSRF => [
            'client' => '루멘 이미지 프록시',
            'product' => 'Lumen Campaign Preview',
            'host' => 'preview.lumen-studio.training',
            'entry_path' => '/cards',
            'sector' => '마케팅 캠페인 제작',
            'environment' => '루멘 스튜디오 카드 미리보기 워커',
        ],
        self::OPERATION_NIGHTFALL => [
            'client' => '나이트폴 관제 포털',
            'product' => 'Nightfall RelayOps',
            'host' => 'ops.nightfall-grid.training',
            'entry_path' => '/reports',
            'sector' => '에너지 격자망 운영',
            'environment' => '나이트폴 중계소 외부 감사 포털',
        ],
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

    /** @return array<string, array{client:string,product:string,host:string,entry_path:string,sector:string,environment:string}> */
    public static function targetProfiles(): array
    {
        return self::TARGETS;
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
                $diagnosticView = 'promo-' . $this->randomHex(5);
                $state['secrets'] = [
                    'diagnostic_view' => $diagnosticView,
                    'operations_path' => '/discount/reconciliation?batch=' . $diagnosticView,
                ];
                $state['progress'] = ['headers_observed' => false];
                break;

            case self::CLIENT_TRUST:
                $nonce = $this->randomHex(10);
                $state['secrets'] = [
                    'nonce' => $nonce,
                    'viewer_token' => $this->base64UrlEncodeJson([
                        'sub' => 'external.reader',
                        'display_name' => '강하늘',
                        'role' => 'reader',
                        'team' => 'leaf-bio-safety',
                        'nonce' => $nonce,
                    ]),
                ];
                $state['progress'] = ['token_examined' => false];
                break;

            case self::IDOR:
                [$selfId, $targetId] = $this->twoRandomIds(10000, 80000);
                $state['secrets'] = ['self_id' => $selfId, 'target_id' => $targetId];
                $state['progress'] = ['last_document_id' => null];
                break;

            case self::SQLI_LOGIN:
                $state['secrets'] = [
                    'manager_password' => 'pw_' . $this->randomHex(14),
                    'clerk_password' => 'pw_' . $this->randomHex(14),
                ];
                $state['progress'] = ['last_username' => null];
                break;

            case self::SQLI_UNION:
                $state['secrets'] = ['training_note_id' => 'OPS-' . strtoupper($this->randomHex(4))];
                $state['progress'] = ['last_term' => null, 'column_hint_seen' => false];
                break;

            case self::REFLECTED_XSS:
                $state['secrets'] = ['nonce' => $this->randomHex(12)];
                $state['progress'] = ['last_rendered' => null, 'sandbox_event' => false];
                break;

            case self::PATH_TRAVERSAL:
                $state['secrets'] = ['private_file' => 'inspection-proof-' . $this->randomHex(7) . '.txt'];
                $state['progress'] = ['last_file' => null, 'blocked_escapes' => 0];
                break;

            case self::UPLOAD_VALIDATION:
                $state['secrets'] = ['storage_salt' => $this->randomHex(12)];
                $state['progress'] = ['uploads' => []];
                break;

            case self::JWT_VALIDATION:
                $nonce = $this->randomHex(10);
                $audience = 'vector-deploy-' . $this->randomHex(5);
                $scope = 'release:approve:' . $this->randomHex(4);
                $payload = [
                    'sub' => 'release-auditor',
                    'role' => 'viewer',
                    'aud' => $audience,
                    'scope' => $scope,
                    'release' => 'vector-api-2026.07.15-rc3',
                    'nonce' => $nonce,
                ];
                $state['secrets'] = [
                    'nonce' => $nonce,
                    'audience' => $audience,
                    'scope' => $scope,
                    'viewer_token' => $this->makeJwt(['alg' => 'HS256', 'typ' => 'JWT'], $payload, $this->randomHex(16)),
                ];
                $state['progress'] = ['last_alg' => null];
                break;

            case self::SSRF:
                $state['secrets'] = [
                    'assignment_id' => 'campaign_' . $this->randomHex(7),
                    'asset_etag' => 'W/"' . $this->randomHex(8) . '"',
                ];
                $state['progress'] = ['last_trace' => []];
                break;

            case self::OPERATION_NIGHTFALL:
                [$selfId, $targetId] = $this->twoRandomIds(20000, 70000);
                $nonce = $this->randomHex(12);
                $audience = 'nightfall-' . $this->randomHex(6);
                $privateFile = 'verifier-' . $this->randomHex(7) . '.json';
                $payload = [
                    'sub' => 'nightfall-auditor',
                    'role' => 'viewer',
                    'scope' => 'vault:open',
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
                $state['progress'] = ['stage' => 'idor', 'approved_token_hash' => null];
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
                $pdo->query('CREATE TABLE documents (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, audit_marker TEXT NOT NULL)');
                $insert = $pdo->prepare('INSERT INTO documents (id, owner, title, category, updated_at, body, audit_marker) VALUES (:id, :owner, :title, :category, :updated_at, :body, :audit_marker)');
                $insert->execute([
                    ':id' => $state['secrets']['self_id'],
                    ':owner' => '강하늘 (외부 자문)',
                    ':title' => 'Q3 자문 인터뷰 질문지',
                    ':category' => '외부 공유',
                    ':updated_at' => '2026-07-14 18:42 KST',
                    ':body' => "제품 그룹 인터뷰 질문 12건\n담당: 전략기획팀 문서 소유자의 승인 후 배포",
                    ':audit_marker' => 'owner-visible',
                ]);
                $insert->execute([
                    ':id' => $state['secrets']['target_id'],
                    ':owner' => '정유나 (전략기획팀)',
                    ':title' => '미래바이오 NDA 갱신 검토안',
                    ':category' => '대외비',
                    ':updated_at' => '2026-07-15 00:17 KST',
                    ':body' => "[대외비] 미래바이오 협약 갱신 검토\n- 법무 검토: 완료\n- 보안 부록: 파트너 담당자에게만 공유\n- 링크 공유: 2026-07-14 23:58 해제",
                    ':audit_marker' => $state['completion_proof'],
                ]);
                break;

            case self::SQLI_LOGIN:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE staff (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, proof TEXT NOT NULL)');
                $insert = $pdo->prepare('INSERT INTO staff (id, username, password, role, proof) VALUES (:id, :username, :password, :role, :proof)');
                $insert->execute([
                    ':id' => 1,
                    ':username' => 'manager',
                    ':password' => $state['secrets']['manager_password'],
                    ':role' => 'inventory_manager',
                    ':proof' => $state['completion_proof'],
                ]);
                $insert->execute([
                    ':id' => 2,
                    ':username' => 'night.clerk',
                    ':password' => $state['secrets']['clerk_password'],
                    ':role' => 'stock_clerk',
                    ':proof' => '',
                ]);
                break;

            case self::SQLI_UNION:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, price TEXT NOT NULL, stock INTEGER NOT NULL)');
                $pdo->query('CREATE TABLE training_notes (note_title TEXT PRIMARY KEY, note_body TEXT NOT NULL)');
                $product = $pdo->prepare('INSERT INTO products (sku, name, price, stock) VALUES (:sku, :name, :price, :stock)');
                $product->execute([':sku' => 'HLS-CUT-180', ':name' => '프리시전 커터 180mm', ':price' => '18,900원', ':stock' => 142]);
                $product->execute([':sku' => 'HLS-GRV-024', ':name' => '절연 장갑 Pro 24', ':price' => '32,400원', ':stock' => 58]);
                $product->execute([':sku' => 'HLS-LMP-700', ':name' => '작업대 LED 램프 700', ':price' => '74,000원', ':stock' => 21]);
                $note = $pdo->prepare('INSERT INTO training_notes (note_title, note_body) VALUES (:title, :body)');
                $note->execute([
                    ':title' => '[OPS] ' . $state['secrets']['training_note_id'],
                    ':body' => '조달 운영 검수 증거: ' . $state['completion_proof'],
                ]);
                break;

            case self::PATH_TRAVERSAL:
                $vfs = $this->makeVirtualFileSystem($labDir);
                $notice = "ATLAS FIELD SERVICE / 문서 이관 공지\n"
                    . "아침 순회 체크리스트: equipment-checklist.md\n"
                    . "이전 안전점검 증명서: ../private/{$state['secrets']['private_file']}\n";
                $this->writeLocalFile($vfs . '/public/notice.txt', $notice, $vfs);
                $this->writeLocalFile($vfs . '/public/equipment-checklist.md', "# ATLAS AF-27 아침 점검\n- 전원 절연: 정상\n- 압력 게이지: 4.2 bar\n- 다음 점검: 2026-07-18\n", $vfs);
                $this->writeLocalFile(
                    $vfs . '/private/' . $state['secrets']['private_file'],
                    "ATLAS SAFETY AUDIT / AF-27\n점검 지점: 서부 3공구\n결과: 시정 권고 2건, 운행 중지 사유 없음\nAUDIT PROOF: {$state['completion_proof']}\n",
                    $vfs
                );
                break;

            case self::UPLOAD_VALIDATION:
                $uploads = $labDir . '/private_uploads';
                if (!mkdir($uploads, 0700, true) && !is_dir($uploads)) {
                    throw new RuntimeException('Unable to create private upload storage.');
                }
                break;

            case self::OPERATION_NIGHTFALL:
                $pdo = $this->openDatabase($labDir);
                $pdo->query('CREATE TABLE reports (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, station TEXT NOT NULL, title TEXT NOT NULL, severity TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, verifier_config TEXT NOT NULL)');
                $insert = $pdo->prepare('INSERT INTO reports (id, owner, station, title, severity, updated_at, body, verifier_config) VALUES (:id, :owner, :station, :title, :severity, :updated_at, :body, :verifier_config)');
                $insert->execute([
                    ':id' => $state['secrets']['self_id'],
                    ':owner' => 'external.audit',
                    ':station' => 'Relay K-04',
                    ':title' => '중계소 K-04 외부 점검 준비',
                    ':severity' => 'INFO',
                    ':updated_at' => '2026-07-14 21:20 KST',
                    ':body' => '외부 감사인 접근 범위 확인. 공개 자료만 열람 가능.',
                    ':verifier_config' => 'readme.txt',
                ]);
                $insert->execute([
                    ':id' => $state['secrets']['target_id'],
                    ':owner' => 'relay.ops',
                    ':station' => 'Relay N-17',
                    ':title' => 'N-17 운영 토큰 검증기 전환 기록',
                    ':severity' => 'RESTRICTED',
                    ':updated_at' => '2026-07-15 01:36 KST',
                    ':body' => '릴레이 제어 vault 전환 전 레거시 verifier 설정을 재확인할 것.',
                    ':verifier_config' => '../private/' . $state['secrets']['private_file'],
                ]);

                $vfs = $this->makeVirtualFileSystem($labDir);
                $this->writeLocalFile($vfs . '/public/readme.txt', "NIGHTFALL RELAYOPS\n외부 감사 문서 뷰어 / public zone\n", $vfs);
                $note = json_encode([
                    'service' => 'relay-token-verifier',
                    'version' => '2.7.4-legacy',
                    'allow_none' => true,
                    'memo' => '전환 완료 전까지 레거시 none 알고리즘이 활성화됨.',
                    'viewer_token' => $state['secrets']['viewer_token'],
                    'required_role' => 'admin',
                    'required_scope' => 'vault:open',
                    'audience' => $state['secrets']['audience'],
                    'verify_endpoint' => '/api/token/verify',
                    'vault_endpoint' => '/api/vault/open',
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
                'story' => '오로라 문구점 성수점의 스마트 할인 확인 화면입니다.',
                'available_paths' => ['/discount/check'],
                'task' => '승인된 범위 안에서 할인 조회 서비스의 비공개 운영 경계가 외부 요청으로 열리는지 검증하세요.',
                'page' => [
                    'template' => 'discount_check',
                    'path' => '/discount/check',
                    'title' => '오늘의 할인 확인',
                    'subtitle' => '오로라 문구점 성수점',
                    'promotion' => ['name' => '한여름 필기구 위크', 'discount' => '20%', 'ends_at' => '2026-07-19 22:00 KST'],
                ],
                'records' => [
                    ['sku' => 'AUR-NB-A5-MNT', 'name' => '민트 라인 A5 노트', 'price' => '4,800원', 'discounted_price' => '3,840원', 'stock' => 47],
                    ['sku' => 'AUR-PEN-05-BK', 'name' => '아카이브 중성펜 0.5', 'price' => '2,200원', 'discounted_price' => '1,760원', 'stock' => 86],
                ],
            ],
            self::CLIENT_TRUST => [
                'story' => '리프 연구센터의 동료 검토 수신함입니다. 외부 열람자에게는 배정된 문서만 보여야 하지만 role 결정을 브라우저 쿠키에 위임했습니다.',
                'client_token' => $state['secrets']['viewer_token'],
                'token_format' => 'base64url(JSON), 서명 없음',
                'cookie' => ['name' => 'leaf_role', 'value' => $state['secrets']['viewer_token'], 'path' => '/', 'http_only' => false],
                'target_path' => '/inbox/archive',
                'page' => ['template' => 'review_inbox', 'path' => '/inbox', 'title' => '내 리뷰 수신함', 'signed_in_as' => '강하늘 · 외부 열람자'],
                'records' => [
                    ['id' => 'LR-260715-018', 'title' => '신재료 안정성 초안', 'author' => '민서준', 'status' => '열람 가능', 'due' => '7월 18일'],
                    ['id' => 'LR-260714-092', 'title' => '시험 프로토콜 변경안', 'author' => '이아름', 'status' => '배정 대기', 'due' => '7월 21일'],
                ],
            ],
            self::IDOR => [
                'story' => '노바 오피스 문서함에 외부 자문 계정으로 접속했습니다. 문서 목록은 정상이지만 최근 활동에 공유가 해제된 대외비 문서 ID가 남아 있습니다.',
                'self_id' => $state['secrets']['self_id'],
                'my_document_id' => $state['secrets']['self_id'],
                'activity_feed' => [
                    'recently_unshared_document' => $state['secrets']['target_id'],
                    'message' => '정유나님이 문서 #' . $state['secrets']['target_id'] . '의 외부 공유를 해제했습니다.',
                    'at' => '2026-07-15 00:19 KST',
                ],
                'endpoint' => '/documents?id={id}',
                'page' => ['template' => 'document_list', 'path' => '/documents', 'title' => '내 문서', 'signed_in_as' => '강하늘 · 외부 자문'],
                'records' => [
                    ['id' => $state['secrets']['self_id'], 'title' => 'Q3 자문 인터뷰 질문지', 'owner' => '강하늘', 'category' => '외부 공유', 'updated_at' => '2026-07-14 18:42 KST'],
                ],
            ],
            self::SQLI_LOGIN => [
                'story' => '코멧 남부 물류센터의 야간 재고 콘솔입니다. 주간 SSO 점검 중에는 레거시 SQLite 로그인이 활성화됩니다.',
                'endpoint' => '/login',
                'fields' => ['username', 'password'],
                'known_usernames' => ['manager', 'night.clerk'],
                'page' => ['template' => 'stockflow_login', 'path' => '/login', 'title' => '야간 재고 관리', 'shift' => 'NIGHT-02 · 22:00–06:00'],
                'records' => [
                    ['zone' => 'A-12', 'alerts' => 3, 'status' => '실사 대기'],
                    ['zone' => 'C-04', 'alerts' => 0, 'status' => '정상'],
                    ['zone' => 'COLD-02', 'alerts' => 1, 'status' => '온도 확인'],
                ],
            ],
            self::SQLI_UNION => [
                'story' => '헬리오스 조달 대리점용 산업용품 카탈로그입니다. 상품명과 가격을 보여 주는 검색 쿼리가 운영 메모 테이블과 같은 SQLite에 있습니다.',
                'endpoint' => '/products?q={term}',
                'visible_columns' => ['name', 'price'],
                'internal_schema_note' => 'training_notes(note_title, note_body)',
                'page' => ['template' => 'supply_catalog', 'path' => '/products', 'title' => '산업용품 카탈로그', 'account' => '패트너 대리점 2048'],
                'records' => [
                    ['sku' => 'HLS-CUT-180', 'name' => '프리시전 커터 180mm', 'price' => '18,900원', 'stock' => 142],
                    ['sku' => 'HLS-GRV-024', 'name' => '절연 장갑 Pro 24', 'price' => '32,400원', 'stock' => 58],
                    ['sku' => 'HLS-LMP-700', 'name' => '작업대 LED 램프 700', 'price' => '74,000원', 'stock' => 21],
                ],
            ],
            self::REFLECTED_XSS => [
                'story' => '프리즘케어 고객이 사용하는 도움말 검색입니다. 결과가 없을 때 검색어를 결과 화면의 HTML에 그대로 삽입합니다.',
                'endpoint' => '/search?q={term}',
                'page' => ['template' => 'help_search', 'path' => '/search', 'title' => '무엇을 도와드릴까요?', 'support_status' => '상담원 평균 응답 4분'],
                'records' => [
                    ['slug' => 'reset-sensor', 'title' => '스마트 케어 센서를 초기화하는 법', 'category' => '기기 설정'],
                    ['slug' => 'billing-receipt', 'title' => '결제 영수증을 다시 받고 싶어요', 'category' => '결제'],
                    ['slug' => 'family-share', 'title' => '가족 계정을 연결하는 법', 'category' => '계정'],
                ],
            ],
            self::PATH_TRAVERSAL => [
                'story' => '아틀라스 AF-27 설비를 담당하는 현장 기술자의 매뉴얼 뷰어입니다. 문서 이관 공지에는 이전 안전점검 증명서의 새 위치가 남아 있습니다.',
                'endpoint' => '/viewer?file={relative-path}',
                'public_file' => 'notice.txt',
                'notice' => "이전 안전점검 증명서는 ../private/{$state['secrets']['private_file']} 로 이동됨",
                'file_tree' => [
                    ['name' => 'notice.txt', 'type' => 'file', 'zone' => 'public', 'label' => '문서 이관 공지'],
                    ['name' => 'equipment-checklist.md', 'type' => 'file', 'zone' => 'public', 'label' => 'AF-27 아침 점검'],
                    ['name' => 'private/', 'type' => 'directory', 'zone' => 'sibling', 'label' => '접근 제한'],
                ],
                'page' => ['template' => 'manual_viewer', 'path' => '/viewer', 'title' => 'Atlas 현장 매뉴얼', 'equipment' => 'AF-27 압력 밸브'],
            ],
            self::UPLOAD_VALIDATION => [
                'story' => '픽셀펫 반려동물 프로필의 아바타 관리 화면입니다. 업로더는 multipart 파트가 주장한 Content-Type만 이미지인지 확인합니다.',
                'endpoint' => '/avatar',
                'fields' => ['name', 'type', 'content'],
                'policy' => 'type이 image/로 시작하면 승인',
                'safety' => '모든 파일은 비공개 .bin으로 저장되며 실행되지 않습니다.',
                'page' => ['template' => 'pet_profile', 'path' => '/avatar', 'title' => '보리의 프로필', 'handle' => '@bori_on_walk', 'followers' => 1284],
                'records' => [
                    ['kind' => '현재 아바타', 'filename' => 'bori-summer.png', 'uploaded_at' => '2026-07-02', 'status' => '사용 중'],
                    ['kind' => '이전 아바타', 'filename' => 'bori-raincoat.jpg', 'uploaded_at' => '2026-06-11', 'status' => '보관'],
                ],
            ],
            self::JWT_VALIDATION => [
                'story' => '벡터 클라우드의 생성 배포 승인 대기열입니다. 외부 감사인 토큰으로 배포 상세는 읽을 수 있지만 승인 버튼은 admin claim에만 열립니다.',
                'endpoint' => '/approvals',
                'viewer_token' => $state['secrets']['viewer_token'],
                'required_role' => 'admin',
                'required_scope' => $state['secrets']['scope'],
                'challenge_scope' => '이 토큰은 LabEngine 밖에서 어떤 인증 권한도 갖지 않습니다.',
                'page' => ['template' => 'deployment_approval', 'path' => '/approvals', 'title' => '배포 승인', 'environment' => 'production-apne2'],
                'records' => [
                    ['release' => 'vector-api-2026.07.15-rc3', 'commit' => '9f3a11d', 'owner' => 'Platform API', 'risk' => '중간', 'status' => '승인 대기'],
                    ['release' => 'vector-web-2026.07.14-2', 'commit' => 'aa91c04', 'owner' => 'Console', 'risk' => '낮음', 'status' => '배포 완료'],
                ],
            ],
            self::SSRF => [
                'story' => '루멘 스튜디오의 캠페인 카드 미리보기입니다. preview-worker가 입력된 URL을 서버 네트워크에서 대신 가져오며 현재 host 제한이 없습니다.',
                'endpoint' => '/cards',
                'virtual_routes' => [
                    'https://images.training/campaign/summer-card.png',
                    'http://metadata.training/latest/lab-proof',
                ],
                'safety' => '모든 요청은 메모리 내 가상 디스패처에서만 처리됩니다.',
                'url' => 'https://images.training/campaign/summer-card.png',
                'page' => ['template' => 'campaign_cards', 'path' => '/cards', 'title' => '캠페인 카드 미리보기', 'workspace' => '2026 Summer Paper'],
                'records' => [
                    ['campaign' => '2026 Summer Paper', 'asset' => 'summer-card.png', 'owner' => '아트팀', 'status' => '검수 중'],
                    ['campaign' => 'Back to School', 'asset' => 'hero-v5.webp', 'owner' => '브랜드팀', 'status' => '승인됨'],
                ],
            ],
            self::OPERATION_NIGHTFALL => [
                'story' => '나이트폴 전력망 중계소의 외부 감사 포털입니다. 운영 보고서, 첨부 설정, 승인 API와 증거 보관소가 하나의 RelayOps 워크플로로 연결됩니다.',
                'stage' => $state['progress']['stage'],
                'self_id' => $state['secrets']['self_id'],
                'my_report_id' => $state['secrets']['self_id'],
                'audit_reference' => $state['secrets']['target_id'],
                'endpoint' => '/reports?id={id}',
                'page' => ['template' => 'relay_reports', 'path' => '/reports', 'title' => '운영 보고서', 'signed_in_as' => 'external.audit', 'clearance' => 'EXTERNAL'],
                'records' => [
                    ['id' => $state['secrets']['self_id'], 'station' => 'Relay K-04', 'title' => '중계소 K-04 외부 점검 준비', 'severity' => 'INFO', 'owner' => 'external.audit'],
                ],
                'activity_feed' => [
                    'message' => 'relay.ops가 보고서 #' . $state['secrets']['target_id'] . '의 공유 범위를 변경했습니다.',
                    'at' => '2026-07-15 01:41 KST',
                ],
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
        if ($path === '/discount/check' && (string) $request['method'] === 'GET') {
            $state['progress']['headers_observed'] = true;
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => [
                        'template' => 'discount_check',
                        'path' => '/discount/check',
                        'title' => '오늘의 할인 확인',
                        'subtitle' => '오로라 문구점 성수점',
                        'promotion' => ['name' => '한여름 필기구 위크', 'discount' => '20%', 'ends_at' => '2026-07-19 22:00 KST'],
                    ],
                    'records' => [
                        ['sku' => 'AUR-NB-A5-MNT', 'name' => '민트 라인 A5 노트', 'price' => '4,800원', 'discounted_price' => '3,840원', 'stock' => 47],
                        ['sku' => 'AUR-PEN-05-BK', 'name' => '아카이브 중성펜 0.5', 'price' => '2,200원', 'discounted_price' => '1,760원', 'stock' => 86],
                    ],
                    'health' => 'promotion-engine online',
                    'body_note' => '고객용 할인 조회가 정상 처리되었습니다.',
                ],
                $request,
                200,
                [
                    'Content-Type' => 'text/html; charset=utf-8',
                    'Cache-Control' => 'private, no-store',
                    'X-Aurora-Route' => $state['secrets']['operations_path'],
                ],
                ['type' => 'headers_observed', 'message' => '할인 확인 요청을 처리했습니다.']
            );
        }

        if ($path === '/discount/reconciliation') {
            $view = $this->queryString($request, 'batch');
            $storeChannel = strtolower(trim($this->headerValue($request, 'X-Store-Channel')));
            if (!(bool) $state['progress']['headers_observed']
                || !hash_equals((string) $state['secrets']['diagnostic_view'], $view)
                || $storeChannel !== 'operations') {
                return $this->makeResponse(
                    $state,
                    'browser',
                    [
                        'page' => ['template' => 'reconciliation_access', 'path' => '/discount/reconciliation', 'title' => '할인 정산 접근 제한'],
                        'error' => '이 정산 내역은 매장 운영 채널에서만 확인할 수 있습니다.',
                    ],
                    $request,
                    403,
                    ['Content-Type' => 'text/html; charset=utf-8'],
                    ['type' => 'access_denied', 'message' => '승인되지 않은 채널의 정산 요청을 거부했습니다.']
                );
            }

            $this->markCompleted($state);
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'discount_reconciliation', 'path' => '/discount/reconciliation', 'title' => 'SmartCoupon 일일 정산'],
                    'reconciliation' => [
                        'store' => '성수점',
                        'promotion' => 'SUMMER-STATIONERY-20',
                        'pricing_node' => 'aur-price-seoul-02',
                        'cache_age_seconds' => 18,
                        'coupon_rules_loaded' => 12,
                        'status' => 'healthy',
                    ],
                    'proof' => $state['completion_proof'],
                ],
                $request,
                200,
                ['Content-Type' => 'text/html; charset=utf-8'],
                ['type' => 'http_diagnostic_reached', 'message' => '매장 운영 채널의 SmartCoupon 일일 정산 내역을 열었습니다.']
            );
        }

        return $this->notFound($state, $request, 'browser');
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleClientTrust(array &$state, array $request): array
    {
        $path = (string) $request['path'];
        if ($path === '/inbox') {
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'client_token' => $state['secrets']['viewer_token'],
                    'cookie' => ['name' => 'leaf_role', 'value' => $state['secrets']['viewer_token'], 'http_only' => false],
                    'page' => ['template' => 'review_inbox', 'path' => '/inbox', 'title' => '내 리뷰 수신함', 'role' => 'reader'],
                    'records' => [
                        ['id' => 'LR-260715-018', 'title' => '신재료 안정성 초안', 'author' => '민서준', 'status' => '열람 가능', 'due' => '7월 18일'],
                        ['id' => 'LR-260714-092', 'title' => '시험 프로토콜 변경안', 'author' => '이아름', 'status' => '배정 대기', 'due' => '7월 21일'],
                    ],
                    'archive_link' => ['path' => '/inbox/archive', 'visible' => false, 'required_role' => 'reviewer'],
                ],
                $request,
                200,
                ['Set-Cookie' => 'leaf_role=' . $state['secrets']['viewer_token'] . '; Path=/; SameSite=Strict'],
                ['type' => 'inbox_viewed', 'message' => '외부 reader 권한으로 리뷰 수신함을 열었습니다.']
            );
        }
        if ($path !== '/inbox/archive') {
            return $this->notFound($state, $request, 'browser');
        }

        $token = $this->bodyString($request, 'token');
        if ($token === '') {
            $token = $this->cookieValue($request, 'leaf_role');
        }
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
        if ($role === 'reviewer' && hash_equals((string) $state['secrets']['nonce'], $nonce)) {
            $this->markCompleted($state);
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'review_archive', 'path' => '/inbox/archive', 'title' => '검토자 보관함', 'role' => 'reviewer'],
                    'role' => 'reviewer',
                    'records' => [
                        ['id' => 'LRA-2026-041', 'title' => '안전성 검토 보류 목록', 'owner' => '리프 안전성 위원회', 'classification' => '내부'],
                        ['id' => 'LRA-2026-039', 'title' => '6월 익명 동료평가 원본', 'owner' => 'People Ops', 'classification' => '대외비'],
                    ],
                    'proof' => $state['completion_proof'],
                ],
                $request,
                200,
                [],
                ['type' => 'review_archive_opened', 'message' => '변조한 클라이언트 역할로 검토 보관함을 열었습니다.']
            );
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'review_access_denied', 'path' => '/inbox/archive', 'title' => '보관함 접근 거부'],
                'role' => $role,
                'message' => 'reader 권한에는 검토자 보관함이 표시되지 않습니다.',
            ],
            $request,
            403,
            [],
            ['type' => 'role_denied', 'message' => '서버가 클라이언트 role 값을 그대로 신뢰하고 있습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleIdor(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/documents') {
            return $this->notFound($state, $request, 'browser');
        }

        $id = $this->queryString($request, 'id');
        if ((string) $request['method'] === 'GET' && $id === '') {
            return $this->startPageResponse($state, $request);
        }
        if ($id === '' || preg_match('/^[0-9]{1,10}$/', $id) !== 1) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '열람할 숫자 문서 id가 필요합니다.'],
                $request,
                400,
                ['Content-Type' => 'application/json'],
                ['type' => 'invalid_request', 'message' => 'id 쿼리 값을 확인하세요.']
            );
        }

        $pdo = $this->openDatabase($labDir);
        $query = $pdo->prepare('SELECT id, owner, title, category, updated_at, body, audit_marker FROM documents WHERE id = :id');
        $query->execute([':id' => (int) $id]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '문서를 찾을 수 없습니다.'],
                $request,
                404,
                ['Content-Type' => 'application/json'],
                ['type' => 'record_missing', 'message' => '다른 객체 식별자를 조사하세요.']
            );
        }

        $state['progress']['last_document_id'] = (int) $row['id'];
        $foreign = (int) $row['id'] === (int) $state['secrets']['target_id'];
        if ($foreign && hash_equals((string) $state['completion_proof'], (string) $row['audit_marker'])) {
            $this->markCompleted($state);
        }

        $publicRow = $row;
        $publicRow['access'] = $foreign ? '외부 소유자 · 인가 검사 없음' : '본인 소유';
        if (!$foreign) {
            unset($publicRow['audit_marker']);
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'document_viewer', 'path' => '/documents', 'title' => (string) $row['title'], 'document_id' => (int) $row['id']],
                'document' => $publicRow,
                'records' => [$publicRow],
                'authorization_check' => 'missing owner predicate',
            ],
            $request,
            200,
            ['Content-Type' => 'application/json'],
            $foreign
                ? ['type' => 'foreign_document_viewed', 'message' => '다른 소유자의 실제 인스턴스 SQLite 행을 조회했습니다.']
                : ['type' => 'own_document_viewed', 'message' => '내 문서를 조회했습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleSqliLogin(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] === '/login' && (string) $request['method'] === 'GET') {
            return $this->startPageResponse($state, $request);
        }
        if ((string) $request['path'] !== '/login' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'browser',
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
            return $this->inputTooLarge($state, $request, 'browser');
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
                'browser',
                [
                    'page' => ['template' => 'stockflow_login', 'path' => '/login', 'title' => '야간 재고 로그인'],
                    'database_error' => $exception->getMessage(),
                    'query_shape' => "SELECT ... FROM staff WHERE username = '<input>' AND password = '<input>'",
                    'query' => $sql,
                ],
                $request,
                400,
                [],
                ['type' => 'sqlite_error', 'message' => 'SQLite가 조합된 문자열을 해석하지 못했습니다.']
            );
        }

        if (!is_array($row)) {
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'stockflow_login', 'path' => '/login', 'title' => '야간 재고 로그인'],
                    'authenticated' => false,
                    'message' => '자격 증명이 일치하지 않습니다.',
                    'query' => $sql,
                ],
                $request,
                401,
                [],
                ['type' => 'login_failed', 'message' => '문자열 연결 지점을 조사하세요.']
            );
        }

        $isManager = ($row['role'] ?? '') === 'inventory_manager'
            && hash_equals((string) $state['completion_proof'], (string) ($row['proof'] ?? ''));
        if ($isManager) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'stockflow_dashboard', 'path' => '/login', 'title' => '야간 재고 현황', 'shift' => 'NIGHT-02'],
                'authenticated' => true,
                'user' => $row['username'],
                'role' => $row['role'],
                'query' => $sql,
                'records' => [
                    ['zone' => 'A-12', 'sku_count' => 384, 'variance' => -7, 'status' => '실사 필요'],
                    ['zone' => 'C-04', 'sku_count' => 221, 'variance' => 0, 'status' => '정상'],
                    ['zone' => 'COLD-02', 'sku_count' => 96, 'variance' => 2, 'status' => '온도 확인'],
                ],
                'proof' => $isManager ? $row['proof'] : null,
            ],
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
        if ((string) $request['path'] !== '/products') {
            return $this->notFound($state, $request, 'browser');
        }

        $term = $this->queryString($request, 'q');
        if ((string) $request['method'] === 'GET' && $term === '') {
            return $this->startPageResponse($state, $request);
        }
        if (strlen($term) > 512) {
            return $this->inputTooLarge($state, $request, 'browser');
        }
        $state['progress']['last_term'] = $term;

        $pdo = $this->openDatabase($labDir);
        $pdo->query('PRAGMA query_only = ON');
        // Deliberately vulnerable UNION surface, constrained to this SQLite file.
        $sql = "SELECT name, price FROM products WHERE name LIKE '%" . $term . "%'";
        try {
            $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $exception) {
            $state['progress']['column_hint_seen'] = true;
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'supply_catalog', 'path' => '/products', 'title' => '상품 검색 오류'],
                    'database_error' => $exception->getMessage(),
                    'visible_columns' => 2,
                    'query' => $sql,
                ],
                $request,
                400,
                [],
                ['type' => 'sqlite_error', 'message' => 'UNION 양쪽의 열 개수와 자료 위치를 맞추세요.']
            );
        }

        $extracted = false;
        foreach ($rows as $row) {
            if (str_contains((string) ($row['price'] ?? ''), (string) $state['completion_proof'])) {
                $extracted = true;
                break;
            }
        }
        if ($extracted) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'supply_catalog', 'path' => '/products', 'title' => '산업용품 검색', 'query' => $term],
                'rows' => $rows,
                'records' => $rows,
                'row_count' => count($rows),
                'visible_columns' => ['name', 'price'],
                'query' => $sql,
            ],
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
        if ((string) $request['method'] === 'GET' && $term === '') {
            return $this->startPageResponse($state, $request);
        }
        if (strlen($term) > 4096) {
            return $this->inputTooLarge($state, $request, 'browser');
        }

        $nonce = (string) $state['secrets']['nonce'];
        $rendered = '<section class="prism-empty-result"><p>“' . $term . '”에 대한 도움말을 찾지 못했습니다.</p></section>';
        $state['progress']['last_rendered'] = $rendered;
        $eventHandler = preg_match(
            '/<(?:img|svg)\b[^>]*\bon(?:error|load)\s*=\s*(?:["\'][^"\']{1,2048}["\']|[^\s>]{1,2048})[^>]*>/is',
            $term
        ) === 1;

        $headers = [
            'Content-Security-Policy' => "default-src 'none'; img-src data:; style-src 'nonce-{$nonce}'; script-src 'nonce-{$nonce}'",
            'X-Prism-Sandbox' => 'opaque-origin',
        ];
        if ($eventHandler) {
            $state['progress']['sandbox_event'] = true;
            $this->markCompleted($state);
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'rendered_fragment' => $rendered,
                    'page' => ['template' => 'help_search', 'path' => '/search', 'title' => '프리즘케어 도움말 검색', 'query' => $term],
                    'proof' => $state['completion_proof'],
                    'execution_model' => 'opaque-origin document; no portal origin, cookies, or outbound network',
                ],
                $request,
                200,
                $headers,
                ['type' => 'sandbox_script_executed', 'message' => '반사된 HTML 이벤트 처리기가 실행 가능한 응답을 만들었습니다.']
            );
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'rendered_fragment' => $rendered,
                'page' => ['template' => 'help_search', 'path' => '/search', 'title' => '프리즘케어 도움말 검색', 'query' => $term],
                'execution_model' => 'opaque-origin HTML response',
            ],
            $request,
            200,
            $headers,
            ['type' => 'fragment_rendered', 'message' => '검색어가 HTML 응답에 반사됐지만 완료 이벤트는 발생하지 않았습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handlePathTraversal(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/viewer') {
            return $this->notFound($state, $request, 'browser');
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
                'browser',
                [
                    'page' => ['template' => 'manual_viewer', 'path' => '/viewer', 'title' => '아틀라스 문서 뷰어'],
                    'error' => '인스턴스 가상 파일 루트 밖으로 나가는 경로는 차단되었습니다.',
                    'requested_file' => $file,
                ],
                $request,
                403,
                [],
                ['type' => 'instance_escape_blocked', 'message' => '실제 호스트 파일은 읽지 않았습니다.']
            );
        }
        if ($read['status'] === 'missing') {
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'manual_viewer', 'path' => '/viewer', 'title' => '문서를 찾을 수 없음'],
                    'error' => '가상 파일을 찾을 수 없습니다.',
                    'requested_file' => $file,
                    'file_tree' => ['notice.txt', 'equipment-checklist.md', 'private/'],
                ],
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
            'browser',
            [
                'page' => ['template' => 'manual_document', 'path' => '/viewer', 'title' => $read['private'] ? '안전점검 증명서' : '현장 문서', 'file' => $read['logical']],
                'file_tree' => ['notice.txt', 'equipment-checklist.md', 'private/'],
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
        if ((string) $request['path'] === '/avatar' && (string) $request['method'] === 'GET') {
            return $this->startPageResponse($state, $request);
        }
        if ((string) $request['path'] !== '/avatar' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => 'POST /avatar 업로드 요청이 필요합니다.'],
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
                [
                    'page' => ['template' => 'pet_profile', 'path' => '/avatar', 'title' => '아바타 업로드'],
                    'accepted' => false,
                    'validator' => 'multipart Content-Type prefix only',
                    'received_type' => $type,
                ],
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
        $dangerousExtension = in_array($extension, ['php', 'phtml', 'phar'], true);
        $hasMarker = str_contains($content, 'LAB_UPLOAD_MARKER');
        $dangerous = $dangerousExtension && $hasMarker;
        $state['progress']['uploads'][] = [
            'original_name' => basename(str_replace('\\', '/', $name)),
            'claimed_type' => $type,
            'stored_as' => 'private://' . $storageName,
            'dangerous_extension' => $dangerousExtension,
            'training_marker' => $hasMarker,
        ];
        $state['progress']['uploads'] = array_slice((array) $state['progress']['uploads'], -20);
        if ($dangerous) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'pet_profile', 'path' => '/avatar', 'title' => '보리의 아바타 관리'],
                'accepted' => true,
                'stored' => true,
                'original_name' => $name,
                'claimed_type' => $type,
                'extension' => $extension,
                'training_marker' => $hasMarker,
                'stored_as' => 'private://' . $storageName,
                'public_url' => null,
                'executable' => false,
                'validator' => 'multipart Content-Type prefix only',
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
        if ((string) $request['path'] === '/approvals' && (string) $request['method'] === 'GET') {
            return $this->startPageResponse($state, $request, [
                'X-Vector-Session' => 'Bearer ' . (string) $state['secrets']['viewer_token'],
            ]);
        }
        if ((string) $request['path'] !== '/approvals' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => 'POST /approvals 토큰 검증 요청이 필요합니다.'],
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
                'browser',
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
            && is_string($jwt['payload']['scope'] ?? null)
            && hash_equals((string) $state['secrets']['scope'], $jwt['payload']['scope'])
            && is_string($jwt['payload']['nonce'] ?? null)
            && hash_equals((string) $state['secrets']['nonce'], $jwt['payload']['nonce']);
        if ($accepted) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'deployment_approval', 'path' => '/approvals', 'title' => $accepted ? '배포 승인 권한 확인됨' : '배포 승인 거부'],
                'accepted' => $accepted,
                'decoded_header' => $jwt['header'],
                'decoded_payload' => $jwt['payload'],
                'decoded' => $jwt,
                'release' => ['name' => 'vector-api-2026.07.15-rc3', 'environment' => 'production-apne2', 'status' => $accepted ? '승인 권한 확인' : '승인 대기'],
                'validator_scope' => 'this challenge instance only',
                'proof' => $accepted ? $state['completion_proof'] : null,
            ],
            $request,
            $accepted ? 200 : 403,
            [],
            $accepted
                ? ['type' => 'admin_token_accepted', 'message' => '실습 전용 alg:none 토큰이 관리자 권한으로 승인되었습니다.']
                : ['type' => 'token_rejected', 'message' => '알고리즘, role, audience, scope, nonce를 점검하세요.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleSsrf(array &$state, array $request): array
    {
        if ((string) $request['path'] === '/cards' && (string) $request['method'] === 'GET') {
            return $this->startPageResponse($state, $request);
        }
        if ((string) $request['path'] !== '/cards' || (string) $request['method'] !== 'POST') {
            return $this->makeResponse(
                $state,
                'network',
                ['error' => 'POST /cards 미리보기 요청이 필요합니다.'],
                $request,
                405,
                ['Allow' => 'POST'],
                ['type' => 'method_not_allowed', 'message' => 'url 필드로 미리보기 요청을 보내세요.']
            );
        }

        $url = $this->bodyString($request, 'url');
        if ($url === '' || strlen($url) > 2048) {
            return $this->makeResponse(
                $state,
                'network',
                ['error' => '유효한 URL이 필요합니다.'],
                $request,
                400,
                [],
                ['type' => 'invalid_url', 'message' => 'http 또는 https URL을 입력하세요.']
            );
        }

        $parts = $this->parseVirtualUrl($url);
        if ($parts === null) {
            return $this->makeResponse(
                $state,
                'network',
                ['url' => $url, 'error' => 'URL 파서가 http/https 주소로 해석할 수 없습니다.'],
                $request,
                400,
                [],
                ['type' => 'invalid_url', 'message' => 'scheme과 hostname이 있는 URL을 입력하세요.']
            );
        }

        // No socket or HTTP client is used: this is a fixed in-memory network map.
        $final = $this->dispatchVirtualUrl($url, $state);
        $trace = [[
            'requester' => 'preview-worker.lumen.internal',
            'url' => $url,
            'scheme' => $parts['scheme'],
            'host' => $parts['host'],
            'path' => $parts['path'],
            'network_zone' => $parts['host'] === 'metadata.training' ? 'internal' : 'public',
            'status' => $final['status'],
        ]];

        $state['progress']['last_trace'] = $trace;
        $fetchedProof = $parts['host'] === 'metadata.training'
            && ($final['body']['assignment_id'] ?? null) === $state['secrets']['assignment_id']
            && ($final['body']['proof'] ?? null) === $state['completion_proof'];
        if ($fetchedProof) {
            $this->markCompleted($state);
        }

        return $this->makeResponse(
            $state,
            'network',
            [
                'page' => ['template' => 'campaign_preview', 'path' => '/cards', 'title' => '캠페인 카드 미리보기', 'requested_url' => $url],
                'url' => $url,
                'trace' => $trace,
                'response' => $final['body'],
                'body' => $final['body'],
                'requester' => 'preview-worker.lumen.internal',
                'network_mode' => 'fixed in-memory virtual dispatcher; zero outbound network',
                'application_policy' => 'URL host unchecked',
            ],
            $request,
            (int) $final['status'],
            (array) $final['headers'],
            $fetchedProof
                ? ['type' => 'metadata_proof_fetched', 'message' => '미리보기 서버의 네트워크 시야로 metadata.training 증거를 읽었습니다.']
                : ['type' => 'virtual_fetch_completed', 'message' => 'Lumen preview-worker가 가상 URL의 응답을 가져왔습니다.']
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
        if ($stage === 'vault') {
            return $this->handleNightfallVault($state, $request);
        }

        throw new RuntimeException('Unknown Nightfall stage.');
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallIdor(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/reports') {
            return $this->stageConflict($state, $request, 'browser', '먼저 접근 가능한 운영 보고서를 확인하세요.');
        }
        $id = $this->queryString($request, 'id');
        if ((string) $request['method'] === 'GET' && $id === '') {
            return $this->startPageResponse($state, $request);
        }
        if (preg_match('/^[0-9]{1,10}$/', $id) !== 1) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '숫자 보고서 id가 필요합니다.'],
                $request,
                400,
                [],
                ['type' => 'invalid_request', 'message' => '감사 로그의 참조 번호를 확인하세요.']
            );
        }

        $pdo = $this->openDatabase($labDir);
        $query = $pdo->prepare('SELECT id, owner, station, title, severity, updated_at, body, verifier_config FROM reports WHERE id = :id');
        $query->execute([':id' => (int) $id]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $this->makeResponse(
                $state,
                'browser',
                ['error' => '보고서를 찾지 못했습니다.'],
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
            [
                'page' => ['template' => 'relay_report', 'path' => '/reports', 'title' => (string) $row['title'], 'report_id' => (int) $row['id']],
                'report' => $row,
                'case' => $row,
                'authorization_check' => 'missing owner predicate',
                'next_endpoint' => $foreign ? '/reports/file?file={verifier_config}' : null,
            ],
            $request,
            200,
            [],
            $foreign
                ? ['type' => 'nightfall_idor_complete', 'message' => '다른 소유자의 Relay N-17 보고서에서 verifier 설정 경로를 확보했습니다.']
                : ['type' => 'nightfall_own_report', 'message' => '외부 감사 계정이 소유한 K-04 보고서를 확인했습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallTraversal(array &$state, string $labDir, array $request): array
    {
        if ((string) $request['path'] !== '/reports/file') {
            return $this->stageConflict($state, $request, 'browser', '보고서의 첨부 설정 경로를 파일 뷰어에서 확인하세요.');
        }
        $file = $this->queryString($request, 'file');
        $read = $this->readVirtualFile($labDir, $file);
        if ($read['status'] === 'blocked') {
            return $this->makeResponse(
                $state,
                'browser',
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
                'browser',
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
        $config = null;
        if ($correct) {
            try {
                $decoded = json_decode(trim((string) $read['content']), true, 32, JSON_THROW_ON_ERROR);
                $config = is_array($decoded) ? $decoded : null;
            } catch (JsonException) {
                $config = null;
            }
        }
        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'relay_config_viewer', 'path' => '/reports/file', 'title' => $correct ? 'relay-token-verifier 설정' : '보고서 첨부 뷰어'],
                'logical_file' => $read['logical'],
                'content' => $read['content'],
                'config' => $config,
                'viewer_token' => is_array($config) ? ($config['viewer_token'] ?? null) : null,
                'next_endpoint' => $correct ? '/reports/token' : null,
            ],
            $request,
            200,
            [],
            $correct
                ? ['type' => 'nightfall_traversal_complete', 'message' => 'allow_none=true인 레거시 verifier 설정과 viewer 토큰을 회수했습니다.']
                : ['type' => 'public_file_read', 'message' => '공개 첨부 파일을 읽었습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallJwt(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/reports/token' || (string) $request['method'] !== 'POST') {
            return $this->stageConflict($state, $request, 'browser', '승인 API에 올바른 Bearer 토큰을 제출하세요.');
        }

        $token = $this->bearerOrBodyToken($request);
        $jwt = $this->decodeJwt($token);
        $accepted = $jwt !== null
            && strtolower((string) ($jwt['header']['alg'] ?? '')) === 'none'
            && $jwt['signature'] === ''
            && ($jwt['payload']['role'] ?? null) === 'admin'
            && ($jwt['payload']['scope'] ?? null) === 'vault:open'
            && is_string($jwt['payload']['aud'] ?? null)
            && hash_equals((string) $state['secrets']['audience'], $jwt['payload']['aud'])
            && is_string($jwt['payload']['nonce'] ?? null)
            && hash_equals((string) $state['secrets']['nonce'], $jwt['payload']['nonce']);
        if (!$accepted) {
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'relay_token_verifier', 'path' => '/reports/token', 'title' => '운영 토큰 검증 거부'],
                    'accepted' => false,
                    'decoded' => $jwt,
                ],
                $request,
                403,
                [],
                ['type' => 'nightfall_token_rejected', 'message' => 'alg, role, scope, aud, nonce를 다시 확인하세요.']
            );
        }

        $state['progress']['stage'] = 'vault';
        $state['progress']['approved_token_hash'] = hash('sha256', $token);
        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'relay_token_verifier', 'path' => '/reports/token', 'title' => '관제 admin 토큰 승인'],
                'accepted' => true,
                'token_accepted' => true,
                'role' => 'admin',
                'scope' => 'vault:open',
                'vault' => ['name' => 'Relay Control Evidence Vault', 'path' => '/reports/vault', 'status' => '잠금 해제 대기'],
                'next_endpoint' => '/reports/vault',
            ],
            $request,
            200,
            [],
            ['type' => 'nightfall_admin_token_accepted', 'message' => 'audience와 scope를 유지한 admin 토큰이 레거시 verifier에서 승인됐습니다.']
        );
    }

    /** @param array<string, mixed> $state @param array<string, mixed> $request @return array<string, mixed> */
    private function handleNightfallVault(array &$state, array $request): array
    {
        if ((string) $request['path'] !== '/reports/vault' || (string) $request['method'] !== 'POST') {
            return $this->stageConflict($state, $request, 'browser', '승인된 Bearer 토큰으로 증거 보관소를 요청하세요.');
        }

        $token = $this->bearerOrBodyToken($request);
        $approvedHash = is_string($state['progress']['approved_token_hash'] ?? null)
            ? $state['progress']['approved_token_hash']
            : '';
        if ($approvedHash === '' || !hash_equals($approvedHash, hash('sha256', $token))) {
            return $this->makeResponse(
                $state,
                'browser',
                [
                    'page' => ['template' => 'relay_vault', 'path' => '/reports/vault', 'title' => 'Evidence Vault 접근 거부'],
                    'vault_status' => 'locked',
                    'error' => '바로 앞 단계에서 승인된 같은 admin 토큰이 필요합니다.',
                ],
                $request,
                403,
                [],
                ['type' => 'nightfall_vault_denied', 'message' => '승인 기록과 일치하지 않는 토큰입니다.']
            );
        }

        $state['progress']['stage'] = 'complete';
        $this->markCompleted($state);
        return $this->makeResponse(
            $state,
            'browser',
            [
                'page' => ['template' => 'relay_vault', 'path' => '/reports/vault', 'title' => 'Relay Control Evidence Vault'],
                'vault_status' => 'open',
                'shutdown_authorized' => false,
                'evidence' => [
                    ['station' => 'Relay N-17', 'artifact' => 'verifier-migration-audit.json', 'classification' => 'RESTRICTED'],
                    ['station' => 'Relay K-04', 'artifact' => 'external-assessment-log.ndjson', 'classification' => 'INTERNAL'],
                ],
                'proof' => $state['completion_proof'],
            ],
            $request,
            200,
            [],
            ['type' => 'nightfall_vault_opened', 'message' => '보고서 인가, 파일 경로, JWT 무결성의 세 경계를 연결해 RelayOps 증거 vault를 열었습니다.']
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

        if ($parts['host'] === 'images.training' && $parts['path'] === '/campaign/summer-card.png') {
            return [
                'status' => 200,
                'headers' => ['Content-Type' => 'image/png', 'ETag' => (string) $state['secrets']['asset_etag']],
                'body' => [
                    'asset' => 'summer-card.png',
                    'campaign' => '2026 Summer Paper',
                    'dimensions' => '1200x630',
                    'bytes' => 284193,
                    'palette' => ['#F6C453', '#F08A8A', '#2F5D62'],
                        'asset_manifest' => [
                            'fetched_by' => 'preview-worker.lumen.internal',
                            'health_reference' => 'http://metadata.training/latest/lab-proof',
                            'generated_at' => '2026-07-15T02:11:18Z',
                    ],
                ],
            ];
        }

        if ($parts['host'] === 'metadata.training' && $parts['path'] === '/latest/lab-proof') {
            return [
                'status' => 200,
                'headers' => ['Content-Type' => 'application/json', 'X-Lumen-Network-Zone' => 'internal'],
                'body' => [
                    'assignment_id' => $state['secrets']['assignment_id'],
                    'service' => 'lumen-preview-worker',
                    'workspace' => 'campaign-production',
                    'network_zone' => 'internal',
                    'classification' => 'INTERNAL / READ-ONLY CANARY',
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
        $labId = (string) $state['lab_id'];
        $target = self::TARGETS[$labId];
        if (!is_array($output['service'] ?? null)) {
            $output = array_merge([
                'service' => [
                    'name' => $target['product'],
                    'client' => $target['client'],
                    'hostname' => $target['host'],
                    'origin' => 'https://' . $target['host'],
                    'entry_path' => $target['entry_path'],
                    'sector' => $target['sector'],
                    'environment' => $target['environment'],
                    'mode' => 'isolated fictional training target',
                ],
            ], $output);
        }
        if (!is_array($output['page'] ?? null)) {
            $output['page'] = [
                'template' => 'service_response',
                'path' => (string) ($request['path'] ?? $target['entry_path']),
                'title' => self::LABS[$labId]['title'],
            ];
        }

        $response = [
            'mission_id' => $labId,
            'lab_id' => $labId,
            'lab_type' => self::LABS[$labId]['type'],
            'surface' => $surface,
            'title' => self::LABS[$labId]['title'],
            'target' => array_merge($target, [
                'origin' => 'https://' . $target['host'],
                'entry_url' => 'https://' . $target['host'] . $target['entry_path'],
            ]),
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

    /**
     * Render an ordinary service landing page for a real browser GET without
     * inventing a synthetic request or exposing the training control surface.
     *
     * @param array<string, mixed> $state
     * @param array<string, mixed> $request
     * @param array<string, string> $headers
     * @return array<string, mixed>
     */
    private function startPageResponse(array $state, array $request, array $headers = []): array
    {
        $response = $this->startView($state);
        $response['request'] = $request;
        $response['status'] = 200;
        $response['headers'] = $headers;
        $response['event'] = ['type' => 'page_viewed', 'message' => '페이지를 불러왔습니다.'];
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
        if ((string) $state['lab_id'] === self::OPERATION_NIGHTFALL) {
            return match ((string) $state['progress']['stage']) {
                'idor' => ['최근 활동에 남은 보고서 번호를 실제 URL 쿼리에 적용해 보세요.', '외부 소유 보고서의 첨부 설정 경로가 다음 단서입니다.'],
                'traversal' => ['보고서 첨부 뷰어가 상대 경로를 어떻게 처리하는지 확인하세요.', '서비스 파일 루트 밖으로 더 이동하는 경로는 차단됩니다.'],
                'jwt' => ['설정의 viewer JWT에서 aud, scope, nonce를 유지하세요.', '승인 API가 토큰 header의 알고리즘을 어떻게 검증하는지 확인하세요.'],
                'vault' => ['바로 앞에서 승인된 같은 admin 토큰을 증거 보관소 요청에 사용하세요.', '세 경계의 증거가 같은 접속 세션에 누적돼야 보관소가 열립니다.'],
                default => ['Operation Nightfall을 완료했습니다.'],
            };
        }

        return match ((string) $state['lab_id']) {
            self::HTTP_HEADERS => [
                '개발자 도구의 Network 패널에서 Response Headers를 펼쳐 보세요.',
                '응답이 안내하는 경로에 매장 운영 클라이언트가 보내는 채널 헤더를 재현해 보세요.',
            ],
            self::CLIENT_TRUST => [
                '토큰은 암호문이 아니라 base64url로 표현한 JSON입니다.',
                'leaf_role 쿠키의 nonce는 그대로 두고 role만 reviewer로 바꾼 뒤 /inbox/archive를 여세요.',
            ],
            self::IDOR => [
                '내 문서 id와 공유 해제 활동에 남은 문서 id를 비교하세요.',
                '서버가 조회 결과의 owner를 로그인 사용자와 비교하지 않습니다.',
            ],
            self::SQLI_LOGIN => [
                '입력값이 작은따옴표 사이에 직접 연결됩니다.',
                "참인 조건과 주석을 조합해 뒤의 password 비교를 무력화해 보세요.",
            ],
            self::SQLI_UNION => [
                '원래 검색 결과는 name과 price, 2개 열입니다.',
                'training_notes의 note_title과 note_body를 두 출력 열에 맞추세요.',
            ],
            self::REFLECTED_XSS => [
                '검색어에 단순 HTML 태그를 넣어 요소로 해석되는지 확인하세요.',
                '이벤트 속성이 실제 검색 결과 문서에서 실행되는지 관찰하세요. 응답 문서는 고유 출처로 격리됩니다.',
            ],
            self::PATH_TRAVERSAL => [
                'notice.txt에 private 파일의 상대 경로가 적혀 있습니다.',
                '가상 public 디렉터리에서 .. 한 번이면 sibling private에 도달합니다.',
            ],
            self::UPLOAD_VALIDATION => [
                '검증기는 파일 내용이나 확장자가 아니라 클라이언트 MIME만 봅니다.',
                'training.php에 LAB_UPLOAD_MARKER를 담고 image/png MIME을 주장하세요. 파일은 절대 실행되지 않습니다.',
            ],
            self::JWT_VALIDATION => [
                'JWT의 header와 payload는 각각 base64url JSON입니다.',
                'alg을 none, role을 admin으로 바꾸고 aud, scope, nonce를 유지한 뒤 빈 서명으로 끝내세요.',
            ],
            self::SSRF => [
                '정상 카드 URL을 미리보기한 뒤 페이지 소스의 asset manifest에서 가져오기 주체와 health reference를 확인하세요.',
                '발견한 http://metadata.training/latest/lab-proof를 카드 URL로 제출하세요.',
            ],
            self::OPERATION_NIGHTFALL => match ((string) $state['progress']['stage']) {
                'idor' => ['최근 활동의 보고서 번호를 URL 쿼리로 조회하세요.', '외부 소유 보고서의 첨부 설정 경로가 다음 단계 단서입니다.'],
                'traversal' => ['첨부 뷰어의 상대 경로 처리를 확인하세요.', '서비스 파일 루트 바깥으로 더 이동하는 경로는 차단됩니다.'],
                'jwt' => ['설정의 viewer JWT에서 aud, scope, nonce를 유지하세요.', '승인 API의 JWT 알고리즘 검증을 확인하세요.'],
                'vault' => ['승인된 admin 토큰을 증거 보관소 요청에 사용하세요.', '같은 접속 세션의 연쇄 증거가 필요합니다.'],
                default => ['Operation Nightfall을 완료했습니다.'],
            },
            default => [],
        };
    }

    /** @param array<string, mixed> $state @return array<string, mixed> */
    private function recommendedRequest(array $state): array
    {
        $canonical = match ((string) $state['lab_id']) {
            self::HTTP_HEADERS => ['method' => 'GET', 'path' => '/discount/check', 'query' => [], 'headers' => [], 'body' => [], 'files' => []],
            self::CLIENT_TRUST => ['method' => 'GET', 'path' => '/inbox', 'query' => [], 'headers' => [], 'body' => [], 'files' => []],
            self::IDOR => ['method' => 'GET', 'path' => '/documents', 'query' => ['id' => (string) $state['secrets']['self_id']], 'headers' => [], 'body' => [], 'files' => []],
            self::SQLI_LOGIN => ['method' => 'POST', 'path' => '/login', 'query' => [], 'headers' => [], 'body' => ['username' => '', 'password' => ''], 'files' => []],
            self::SQLI_UNION => ['method' => 'GET', 'path' => '/products', 'query' => ['q' => '커터'], 'headers' => [], 'body' => [], 'files' => []],
            self::REFLECTED_XSS => ['method' => 'GET', 'path' => '/search', 'query' => ['q' => '센서 초기화'], 'headers' => [], 'body' => [], 'files' => []],
            self::PATH_TRAVERSAL => ['method' => 'GET', 'path' => '/viewer', 'query' => ['file' => 'notice.txt'], 'headers' => [], 'body' => [], 'files' => []],
            self::UPLOAD_VALIDATION => ['method' => 'POST', 'path' => '/avatar', 'query' => [], 'headers' => [], 'body' => [], 'files' => ['file' => ['name' => 'bori.png', 'type' => 'image/png', 'content' => 'virtual-image-bytes']]],
            self::JWT_VALIDATION => ['method' => 'POST', 'path' => '/approvals', 'query' => [], 'headers' => ['Authorization' => 'Bearer {token}'], 'body' => [], 'files' => []],
            self::SSRF => ['method' => 'POST', 'path' => '/cards', 'query' => [], 'headers' => [], 'body' => ['url' => 'https://images.training/campaign/summer-card.png'], 'files' => []],
            self::OPERATION_NIGHTFALL => match ((string) $state['progress']['stage']) {
                'idor' => ['method' => 'GET', 'path' => '/reports', 'query' => ['id' => (string) $state['secrets']['self_id']], 'headers' => [], 'body' => [], 'files' => []],
                'traversal' => ['method' => 'GET', 'path' => '/reports/file', 'query' => ['file' => '../private/{verifier-config}'], 'headers' => [], 'body' => [], 'files' => []],
                'jwt' => ['method' => 'POST', 'path' => '/reports/token', 'query' => [], 'headers' => ['Authorization' => 'Bearer {token}'], 'body' => [], 'files' => []],
                default => ['method' => 'POST', 'path' => '/reports/vault', 'query' => [], 'headers' => ['Authorization' => 'Bearer {approved-token}'], 'body' => [], 'files' => []],
            },
            default => [],
        };
        return $canonical;
    }

    /** @param array<string, mixed> $state @return array<string, mixed> */
    private function publicProgress(array $state): array
    {
        return match ((string) $state['lab_id']) {
            self::HTTP_HEADERS => ['headers_observed' => (bool) $state['progress']['headers_observed']],
            self::CLIENT_TRUST => ['token_examined' => (bool) $state['progress']['token_examined']],
            self::IDOR => ['last_document_id' => $state['progress']['last_document_id']],
            self::SQLI_LOGIN => ['last_username' => $state['progress']['last_username']],
            self::SQLI_UNION => ['last_term' => $state['progress']['last_term'], 'column_hint_seen' => (bool) $state['progress']['column_hint_seen']],
            self::REFLECTED_XSS => ['sandbox_event' => (bool) $state['progress']['sandbox_event']],
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
        return self::LABS[(string) $state['lab_id']]['surface'];
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
    private function cookieValue(array $request, string $wanted): string
    {
        $cookieHeader = $this->headerValue($request, 'Cookie');
        foreach (explode(';', $cookieHeader) as $pair) {
            [$name, $value] = array_pad(explode('=', trim($pair), 2), 2, '');
            if (hash_equals($wanted, trim($name))) {
                return rawurldecode(trim($value));
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
            if (!is_array($state)) {
                throw new RuntimeException('The lab state is not a JSON object.');
            }
            if (($state['version'] ?? null) !== self::STATE_VERSION) {
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
            if (($state['lab_id'] ?? null) !== $labId
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
