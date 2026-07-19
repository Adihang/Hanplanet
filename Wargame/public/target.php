<?php
declare(strict_types=1);

require_once __DIR__ . '/../app/target_bootstrap.php';
require_once __DIR__ . '/../app/TargetSiteRenderer.php';

wargame_db();

$uriPath = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$uriPath = is_string($uriPath) ? rawurldecode($uriPath) : '/';
$segments = array_values(array_filter(explode('/', trim($uriPath, '/')), static fn (string $segment): bool => $segment !== ''));
$slug = strtolower((string) ($segments[0] ?? ''));
$missionId = LabSessionService::missionForTargetSlug($slug);

if (!is_string($missionId)) {
    target_security_headers();
    http_response_code(404);
    TargetSiteRenderer::renderUnavailable('요청한 서비스를 찾을 수 없습니다.', 404);
    exit;
}

target_security_headers($missionId);
$context = LabSessionService::targetContextForSlug($slug);
if (!is_array($context)) {
    http_response_code(410);
    TargetSiteRenderer::renderUnavailable('접속 세션이 만료되었습니다. 의뢰 링크에서 다시 연결해 주세요.', 410);
    exit;
}

try {
    $lastResponse = (array) ($context['response'] ?? []);
    if (($lastResponse['completed'] ?? false) === true) {
        $response = $lastResponse;
    } else {
        $request = target_http_request($slug);
        $response = LabSessionService::handleTargetRequest($context, $request);
    }
    target_dispatch_completion($context, $response);
    target_emit_engine_response($missionId, $response);
    TargetSiteRenderer::render($missionId, $response);
} catch (Throwable $exception) {
    error_log('Wargame target request failed: ' . $exception->getMessage());
    http_response_code(400);
    TargetSiteRenderer::renderUnavailable('요청을 처리하지 못했습니다. 입력값을 확인해 다시 시도해 주세요.', 400);
}
