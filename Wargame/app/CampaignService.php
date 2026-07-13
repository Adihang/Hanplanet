<?php
declare(strict_types=1);

require_once __DIR__ . '/MissionMailer.php';

final class CampaignService
{
    public static function dispatchMission(array $user, array $mission, string $reason, bool $retry = false): array
    {
        $ownerKey = wargame_owner_key((string) $user['username']);
        $missionId = (string) ($mission['id'] ?? '');
        if ($missionId === '') {
            throw new InvalidArgumentException('의뢰 식별자가 없습니다.');
        }

        $pdo = wargame_db();
        $lookup = $pdo->prepare('SELECT * FROM mission_dispatches WHERE owner_key_hash = :owner AND mission_id = :mission LIMIT 1');
        $lookup->execute(['owner' => $ownerKey, 'mission' => $missionId]);
        $existing = $lookup->fetch();
        if (is_array($existing) && !$retry) {
            return $existing;
        }

        $now = time();
        if (!is_array($existing)) {
            $reserve = $pdo->prepare(
                'INSERT OR IGNORE INTO mission_dispatches '
                . '(owner_key_hash, mission_id, reason, transport, status, detail, created_at) '
                . "VALUES (:owner, :mission, :reason, 'pending', 'queued', '', :created)"
            );
            $reserve->execute([
                'owner' => $ownerKey,
                'mission' => $missionId,
                'reason' => substr($reason, 0, 32),
                'created' => $now,
            ]);
            if ($reserve->rowCount() !== 1) {
                $lookup->execute(['owner' => $ownerKey, 'mission' => $missionId]);
                return (array) $lookup->fetch();
            }
        }

        $claim = $pdo->prepare(
            "UPDATE mission_dispatches SET reason = :reason, transport = 'pending', status = 'sending', detail = '', created_at = :created "
            . "WHERE owner_key_hash = :owner AND mission_id = :mission AND (status != 'sending' OR created_at <= :stale)"
        );
        $claim->execute([
            'owner' => $ownerKey,
            'mission' => $missionId,
            'reason' => substr($reason, 0, 32),
            'created' => $now,
            'stale' => $now - 90,
        ]);
        if ($claim->rowCount() !== 1) {
            $lookup->execute(['owner' => $ownerKey, 'mission' => $missionId]);
            return (array) $lookup->fetch();
        }

        $delivery = MissionMailer::dispatch((string) ($user['email'] ?? ''), $user, $mission);
        $detail = substr((string) ($delivery['detail'] ?? ''), 0, 160);
        $values = [
            'owner' => $ownerKey,
            'mission' => $missionId,
            'reason' => substr($reason, 0, 32),
            'transport' => substr((string) ($delivery['transport'] ?? 'none'), 0, 24),
            'status' => substr((string) ($delivery['status'] ?? 'failed'), 0, 24),
            'detail' => $detail,
            'created' => time(),
        ];

        $statement = $pdo->prepare(
            'UPDATE mission_dispatches SET reason = :reason, transport = :transport, status = :status, detail = :detail, created_at = :created '
            . "WHERE owner_key_hash = :owner AND mission_id = :mission AND status = 'sending'"
        );
        $statement->execute($values);

        $lookup->execute(['owner' => $ownerKey, 'mission' => $missionId]);
        return (array) $lookup->fetch();
    }

    public static function dispatchesFor(string $ownerKey): array
    {
        $statement = wargame_db()->prepare(
            'SELECT mission_id, reason, transport, status, detail, created_at FROM mission_dispatches '
            . 'WHERE owner_key_hash = :owner ORDER BY created_at DESC'
        );
        $statement->execute(['owner' => $ownerKey]);
        $rows = [];
        foreach ($statement->fetchAll() as $row) {
            $rows[(string) $row['mission_id']] = $row;
        }
        return $rows;
    }

    public static function maskedEmail(string $email): string
    {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return '등록 이메일 확인 필요';
        }
        [$local, $domain] = explode('@', $email, 2);
        $visible = substr($local, 0, min(2, strlen($local)));
        return $visible . str_repeat('•', max(3, strlen($local) - strlen($visible))) . '@' . $domain;
    }

    public static function nextMission(string $missionId): ?array
    {
        $missions = array_values(wargame_missions());
        foreach ($missions as $index => $mission) {
            if ((string) ($mission['id'] ?? '') === $missionId) {
                return isset($missions[$index + 1]) && is_array($missions[$index + 1]) ? $missions[$index + 1] : null;
            }
        }
        return null;
    }
}
