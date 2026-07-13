<?php
declare(strict_types=1);

require_once __DIR__ . '/labs/LabEngine.php';

final class LabSessionService
{
    private const INSTANCE_TTL = 7200;
    private const TICKET_TTL = 600;
    private const TARGET_COOKIE = 'wargame_target';
    private const COMPLETION_COOKIE = 'wargame_completion';

    public static function launchFor(array $user, string $missionId): array
    {
        if (!in_array($missionId, LabEngine::stableIds(), true) || wargame_mission($missionId) === null) {
            throw new InvalidArgumentException('존재하지 않는 실습입니다.');
        }

        self::cleanupExpired();
        $ownerKey = wargame_owner_key((string) $user['username']);
        $active = $_SESSION['active_targets'][$missionId] ?? null;
        if (is_array($active)) {
            $instanceId = (string) ($active['id'] ?? '');
            $token = (string) ($active['token'] ?? '');
            $row = self::instanceRow($instanceId);
            if (is_array($row)
                && (string) $row['owner_key_hash'] === $ownerKey
                && (int) $row['expires_at'] > time()
                && hash_equals((string) $row['access_token_hash'], hash('sha256', $token))) {
                self::setTargetCookie($instanceId, $token, (int) $row['expires_at']);
                return $row;
            }
        }

        $instanceId = bin2hex(random_bytes(16));
        $accessToken = bin2hex(random_bytes(32));
        $createdAt = time();
        $expiresAt = $createdAt + self::INSTANCE_TTL;
        $instanceDir = self::instanceDirectory($instanceId, false);
        if (!mkdir($instanceDir, 0700, true) && !is_dir($instanceDir)) {
            throw new RuntimeException('격리 실습 디렉터리를 만들 수 없습니다.');
        }
        chmod($instanceDir, 0700);

        try {
            $engine = new LabEngine($instanceDir);
            $initial = $engine->start($missionId);
            $statement = wargame_db()->prepare(
                'INSERT INTO lab_instances (id, challenge_id, owner_key_hash, access_token_hash, state_json, created_at, expires_at) '
                . 'VALUES (:id, :challenge, :owner, :access, :state, :created, :expires)'
            );
            $statement->execute([
                'id' => $instanceId,
                'challenge' => $missionId,
                'owner' => $ownerKey,
                'access' => hash('sha256', $accessToken),
                'state' => wargame_json(['last_response' => $initial]),
                'created' => $createdAt,
                'expires' => $expiresAt,
            ]);
        } catch (Throwable $exception) {
            self::removeInstanceDirectory($instanceDir);
            throw $exception;
        }

        $_SESSION['active_targets'][$missionId] = ['id' => $instanceId, 'token' => $accessToken];
        self::setTargetCookie($instanceId, $accessToken, $expiresAt);
        self::recordEvent($instanceId, 'instance_started', ['challenge_id' => $missionId]);
        return self::instanceRow($instanceId) ?? throw new RuntimeException('실습 인스턴스를 저장하지 못했습니다.');
    }

    public static function targetContext(): ?array
    {
        $cookie = (string) ($_COOKIE[self::TARGET_COOKIE] ?? '');
        if (!preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/', $cookie, $match)) {
            return null;
        }
        [, $instanceId, $accessToken] = $match;
        $row = self::instanceRow($instanceId);
        if (!is_array($row) || (int) $row['expires_at'] <= time()
            || !hash_equals((string) $row['access_token_hash'], hash('sha256', $accessToken))) {
            self::clearTargetCookie();
            return null;
        }

        $directory = self::instanceDirectory($instanceId, true);
        if ($directory === null) {
            self::clearTargetCookie();
            return null;
        }
        $state = json_decode((string) $row['state_json'], true);
        $lastResponse = is_array($state) && is_array($state['last_response'] ?? null)
            ? $state['last_response']
            : (new LabEngine($directory))->serialize((string) $row['challenge_id']);

        return [
            'row' => $row,
            'instance_id' => $instanceId,
            'access_token' => $accessToken,
            'directory' => $directory,
            'engine' => new LabEngine($directory),
            'response' => $lastResponse,
        ];
    }

    public static function targetCsrf(array $context): string
    {
        return hash_hmac('sha256', 'target-form:' . (string) $context['instance_id'], (string) $context['access_token']);
    }

    public static function requireTargetCsrf(array $context, mixed $submitted): void
    {
        if (!is_string($submitted) || !hash_equals(self::targetCsrf($context), $submitted)) {
            throw new InvalidArgumentException('실습 요청이 만료되었습니다.');
        }
    }

    public static function handleTargetRequest(array $context, array $request): array
    {
        /** @var LabEngine $engine */
        $engine = $context['engine'];
        $challengeId = (string) $context['row']['challenge_id'];
        $response = $engine->handle($challengeId, $request);
        self::saveResponse((string) $context['instance_id'], $response);
        $event = (array) ($response['event'] ?? []);
        self::recordEvent((string) $context['instance_id'], (string) ($event['type'] ?? 'request'), [
            'status' => (int) ($response['status'] ?? 0),
            'completed' => (bool) ($response['completed'] ?? false),
        ]);
        return $response;
    }

    public static function resetTarget(array $context): array
    {
        /** @var LabEngine $engine */
        $engine = $context['engine'];
        $response = $engine->reset((string) $context['row']['challenge_id']);
        wargame_db()->prepare('DELETE FROM completion_tickets WHERE instance_id = :instance')
            ->execute(['instance' => (string) $context['instance_id']]);
        self::clearCompletionCookie();
        self::saveResponse((string) $context['instance_id'], $response);
        self::recordEvent((string) $context['instance_id'], 'instance_reset', []);
        return $response;
    }

    public static function issueCompletionTicket(array $context): string
    {
        /** @var LabEngine $engine */
        $engine = $context['engine'];
        $snapshot = $engine->serialize((string) $context['row']['challenge_id']);
        if (($snapshot['completed'] ?? false) !== true) {
            throw new RuntimeException('완료 조건이 아직 충족되지 않았습니다.');
        }

        $existingCookie = (string) ($_COOKIE[self::COMPLETION_COOKIE] ?? '');
        if (preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/', $existingCookie, $match)
            && hash_equals((string) $context['instance_id'], $match[1])) {
            $existing = wargame_db()->prepare(
                'SELECT 1 FROM completion_tickets WHERE ticket_hash = :ticket AND instance_id = :instance '
                . 'AND consumed_at IS NULL AND expires_at >= :now LIMIT 1'
            );
            $existing->execute([
                'ticket' => hash('sha256', $match[2]),
                'instance' => (string) $context['instance_id'],
                'now' => time(),
            ]);
            if ($existing->fetchColumn()) {
                return $match[2];
            }
        }

        $ticket = bin2hex(random_bytes(32));
        $expiresAt = time() + self::TICKET_TTL;
        $statement = wargame_db()->prepare(
            'INSERT INTO completion_tickets (ticket_hash, instance_id, challenge_id, owner_key_hash, expires_at, consumed_at) '
            . 'VALUES (:ticket, :instance, :challenge, :owner, :expires, NULL)'
        );
        $statement->execute([
            'ticket' => hash('sha256', $ticket),
            'instance' => (string) $context['instance_id'],
            'challenge' => (string) $context['row']['challenge_id'],
            'owner' => (string) $context['row']['owner_key_hash'],
            'expires' => $expiresAt,
        ]);
        self::setCompletionCookie((string) $context['instance_id'], $ticket, $expiresAt);
        self::recordEvent((string) $context['instance_id'], 'completion_ticket_issued', []);
        return $ticket;
    }

    public static function claimCompletion(array $user, string $ticket): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $ticket)) {
            throw new InvalidArgumentException('완료 증표 형식이 올바르지 않습니다.');
        }

        $ticketHash = hash('sha256', $ticket);
        $statement = wargame_db()->prepare(
            'SELECT * FROM completion_tickets WHERE ticket_hash = :ticket AND consumed_at IS NULL AND expires_at >= :now LIMIT 1'
        );
        $statement->execute(['ticket' => $ticketHash, 'now' => time()]);
        $row = $statement->fetch();
        if (!is_array($row)) {
            throw new InvalidArgumentException('완료 증표가 만료되었거나 이미 사용되었습니다.');
        }
        $ownerKey = wargame_owner_key((string) $user['username']);
        if (!hash_equals((string) $row['owner_key_hash'], $ownerKey)) {
            throw new InvalidArgumentException('이 완료 증표는 현재 계정의 것이 아닙니다.');
        }
        $challengeId = (string) $row['challenge_id'];
        if (wargame_mission($challengeId) === null) {
            throw new RuntimeException('완료 증표의 커리큘럼 버전이 올바르지 않습니다.');
        }

        mark_solved_with_django($user, $challengeId, $ticketHash);
        $consume = wargame_db()->prepare(
            'UPDATE completion_tickets SET consumed_at = :now WHERE ticket_hash = :ticket AND consumed_at IS NULL'
        );
        $consume->execute(['now' => time(), 'ticket' => $ticketHash]);
        if ($consume->rowCount() !== 1) {
            throw new RuntimeException('완료 증표가 동시에 사용되었습니다. 진행 기록은 계정에 안전하게 저장되었습니다.');
        }
        self::clearCompletionCookie();
        self::recordEvent((string) $row['instance_id'], 'completion_claimed', ['challenge_id' => $challengeId]);
        return ['challenge_id' => $challengeId, 'ticket_hash' => $ticketHash];
    }

    public static function clearTargetCookie(): void
    {
        setcookie(self::TARGET_COOKIE, '', [
            'expires' => 1,
            'path' => '/lab.php',
            'domain' => '',
            'secure' => function_exists('wargame_is_https') ? wargame_is_https() : self::requestIsHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        self::clearCompletionCookie();
    }

    private static function setCompletionCookie(string $instanceId, string $ticket, int $expiresAt): void
    {
        setcookie(self::COMPLETION_COOKIE, $instanceId . '.' . $ticket, [
            'expires' => $expiresAt,
            'path' => '/lab.php',
            'domain' => '',
            'secure' => function_exists('wargame_is_https') ? wargame_is_https() : self::requestIsHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        $_COOKIE[self::COMPLETION_COOKIE] = $instanceId . '.' . $ticket;
    }

    private static function clearCompletionCookie(): void
    {
        setcookie(self::COMPLETION_COOKIE, '', [
            'expires' => 1,
            'path' => '/lab.php',
            'domain' => '',
            'secure' => function_exists('wargame_is_https') ? wargame_is_https() : self::requestIsHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        unset($_COOKIE[self::COMPLETION_COOKIE]);
    }

    private static function setTargetCookie(string $instanceId, string $accessToken, int $expiresAt): void
    {
        setcookie(self::TARGET_COOKIE, $instanceId . '.' . $accessToken, [
            'expires' => $expiresAt,
            'path' => '/lab.php',
            'domain' => '',
            'secure' => function_exists('wargame_is_https') ? wargame_is_https() : self::requestIsHttps(),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }

    private static function requestIsHttps(): bool
    {
        if ((string) getenv('WARGAME_FORCE_SECURE_COOKIE') === '1') {
            return true;
        }
        return !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    }

    private static function instanceRow(string $instanceId): ?array
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $instanceId)) {
            return null;
        }
        $statement = wargame_db()->prepare('SELECT * FROM lab_instances WHERE id = :id LIMIT 1');
        $statement->execute(['id' => $instanceId]);
        $row = $statement->fetch();
        return is_array($row) ? $row : null;
    }

    private static function instanceDirectory(string $instanceId, bool $mustExist): string|null
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $instanceId)) {
            throw new InvalidArgumentException('잘못된 인스턴스 식별자입니다.');
        }
        $path = WARGAME_INSTANCE_DIR . '/' . $instanceId;
        if (!$mustExist) {
            return $path;
        }
        $base = realpath(WARGAME_INSTANCE_DIR);
        $real = realpath($path);
        if ($base === false || $real === false || !is_dir($real)
            || ($real !== $base && !str_starts_with($real, $base . DIRECTORY_SEPARATOR))) {
            return null;
        }
        return $real;
    }

    private static function saveResponse(string $instanceId, array $response): void
    {
        $statement = wargame_db()->prepare('UPDATE lab_instances SET state_json = :state WHERE id = :id');
        $statement->execute(['state' => wargame_json(['last_response' => $response]), 'id' => $instanceId]);
    }

    private static function recordEvent(string $instanceId, string $eventName, array $event): void
    {
        $eventName = preg_replace('/[^a-z0-9_-]/i', '_', $eventName) ?: 'event';
        $statement = wargame_db()->prepare(
            'INSERT INTO lab_events (instance_id, event_name, event_json, created_at) VALUES (:instance, :event, :json, :created)'
        );
        $statement->execute([
            'instance' => $instanceId,
            'event' => substr($eventName, 0, 96),
            'json' => wargame_json($event),
            'created' => time(),
        ]);
    }

    private static function cleanupExpired(): void
    {
        $statement = wargame_db()->prepare('SELECT id FROM lab_instances WHERE expires_at < :now LIMIT 25');
        $statement->execute(['now' => time()]);
        foreach ($statement->fetchAll() as $row) {
            $instanceId = (string) ($row['id'] ?? '');
            if (!preg_match('/^[a-f0-9]{32}$/', $instanceId)) {
                continue;
            }
            wargame_db()->prepare('DELETE FROM lab_instances WHERE id = :id')->execute(['id' => $instanceId]);
            self::removeInstanceDirectory(WARGAME_INSTANCE_DIR . '/' . $instanceId);
        }
    }

    private static function removeInstanceDirectory(string $path): void
    {
        $base = realpath(WARGAME_INSTANCE_DIR);
        $real = realpath($path);
        if ($base === false || $real === false || $real === $base || !str_starts_with($real, $base . DIRECTORY_SEPARATOR)) {
            return;
        }
        $items = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($items as $item) {
            if ($item->isLink() || $item->isFile()) {
                @unlink($item->getPathname());
            } elseif ($item->isDir()) {
                @rmdir($item->getPathname());
            }
        }
        @rmdir($real);
    }
}
