<?php
declare(strict_types=1);

require_once __DIR__ . '/runtime.php';
require_once __DIR__ . '/LabSessionService.php';

function target_security_headers(string $sandboxNonce = ''): void
{
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('Pragma: no-cache');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    $nonceSource = preg_match('/^[a-f0-9]{16,64}$/', $sandboxNonce) ? " 'nonce-{$sandboxNonce}'" : '';
    header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'" . $nonceSource . "; script-src 'self'" . $nonceSource . "; connect-src 'none'; frame-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}

function target_request_from_json(string $raw): array
{
    if ($raw === '' || strlen($raw) > 131072) {
        throw new InvalidArgumentException('가상 요청은 128KB 이하여야 합니다.');
    }
    try {
        $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        throw new InvalidArgumentException('요청 JSON을 해석할 수 없습니다: ' . $exception->getMessage(), 0, $exception);
    }
    if (!is_array($decoded)) {
        throw new InvalidArgumentException('요청은 JSON 객체여야 합니다.');
    }
    return $decoded;
}

function target_pretty_json(mixed $value): string
{
    return (string) json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE);
}
