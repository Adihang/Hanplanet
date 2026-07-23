<?php
declare(strict_types=1);

require_once __DIR__ . '/../../app/bootstrap.php';

try {
    $error = trim((string) ($_GET['error'] ?? ''));
    if ($error !== '') {
        throw new InvalidArgumentException('Hanplanet 로그인이 취소되었거나 실패했습니다.');
    }

    $state = trim((string) ($_GET['state'] ?? ''));
    $code = trim((string) ($_GET['code'] ?? ''));
    if ($state === '' || $code === '') {
        throw new InvalidArgumentException('OIDC 인증 응답이 올바르지 않습니다.');
    }

    $pending = wargame_oidc_pending_state($state);
    $tokenResponse = wargame_oidc_exchange_code($code, (string) $pending['verifier']);
    if ($tokenResponse['status'] !== 200 || !is_array($tokenResponse['data'])) {
        throw new InvalidArgumentException('Hanplanet 로그인 토큰을 발급받지 못했습니다.');
    }

    $tokens = $tokenResponse['data'];
    $accessToken = trim((string) ($tokens['access_token'] ?? ''));
    if ($accessToken === '') {
        throw new InvalidArgumentException('Hanplanet 로그인 토큰이 비어 있습니다.');
    }
    accept_oidc_access_token(
        $accessToken,
        trim((string) ($tokens['refresh_token'] ?? '')),
        (int) ($tokens['expires_in'] ?? 3600),
    );
    redirect_to((string) ($pending['return_path'] ?? '/'));
} catch (Throwable $exception) {
    flash_message('error', $exception->getMessage());
    redirect_to('/');
}
