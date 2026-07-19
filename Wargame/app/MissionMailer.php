<?php
declare(strict_types=1);

final class MissionMailer
{
    private const DEFAULT_PUBLIC_URL = 'https://wargame.hanplanet.com/';

    public static function compose(array $user, array $mission): array
    {
        $missionId = trim((string) ($mission['id'] ?? ''));
        if (preg_match('/^web-v\d+-\d{2}-[a-z0-9-]{2,56}$/', $missionId) !== 1) {
            throw new InvalidArgumentException('invalid_mission');
        }

        $displayName = trim((string) ($user['display_name'] ?? $user['username'] ?? 'Operator')) ?: 'Operator';
        $caseNumber = str_pad((string) max(1, (int) (($mission['order'] ?? 10) / 10)), 2, '0', STR_PAD_LEFT);
        $mail = (array) ($mission['email'] ?? []);
        $sender = (array) ($mail['sender'] ?? []);
        $target = (array) ($mission['target'] ?? []);
        $clientValue = $mission['client'] ?? '비공개 의뢰인';
        $clientName = is_array($clientValue)
            ? trim((string) ($clientValue['name'] ?? '비공개 의뢰인'))
            : trim((string) $clientValue);
        $clientName = $clientName !== '' ? $clientName : '비공개 의뢰인';

        $senderName = trim((string) ($sender['name'] ?? '보안 담당자')) ?: '보안 담당자';
        $senderRole = trim((string) ($sender['role'] ?? '의뢰 담당자')) ?: '의뢰 담당자';
        $organization = trim((string) ($sender['organization'] ?? $clientName)) ?: $clientName;
        $senderAddress = self::safeDisplayAddress((string) ($sender['address'] ?? ''));
        $subject = self::cleanLine((string) ($mail['subject'] ?? ''));
        if ($subject === '') {
            $subject = '[FIELD//OPS] CASE ' . $caseNumber . ' · ' . self::cleanLine((string) ($mission['title'] ?? '새 보안 진단 의뢰'));
        }

        $story = trim((string) ($mission['story'] ?? $mission['brief'] ?? ''));
        $brief = trim((string) ($mission['brief'] ?? ''));
        $objective = trim((string) ($target['objective'] ?? '지정된 범위 안에서 증거를 확보하십시오.'));
        $serviceName = trim((string) ($target['service_name'] ?? $mission['title'] ?? 'Assessment target'));
        $hostname = self::safeVirtualHostname((string) ($target['hostname'] ?? 'target.instance'));
        $entryPath = self::safeVirtualPath((string) ($target['entry_path'] ?? '/'));
        $livePath = self::safeVirtualPath((string) ($target['entry_url'] ?? $entryPath));
        $accessMethod = trim((string) ($target['access_method'] ?? '아래 승인 링크에서 본인 확인 후 전용 접속 세션 발급'));
        $environment = trim((string) ($target['environment'] ?? '계정별 격리 검증 환경'));
        $surface = trim((string) ($target['surface'] ?? '승인된 웹 서비스 기능'));
        $urgency = trim((string) ($mail['urgency'] ?? '일반 · 일정 협의 가능'));
        $contactContext = trim((string) ($mail['contact_context'] ?? '아래 자산에 대한 제한적 블랙박스 보안 검증을 요청드립니다.'));
        $closing = trim((string) ($mail['closing'] ?? '완료 증거가 확인되면 다음 조치 일정을 협의하겠습니다.'));
        $scope = self::stringList((array) ($mail['scope'] ?? []));
        $deliverables = self::stringList((array) ($mail['deliverables'] ?? []));
        $cautions = self::stringList((array) ($mail['cautions'] ?? []));
        $ctaLabel = self::cleanLine((string) ($mail['cta_label'] ?? '검증 타깃 접속')) ?: '검증 타깃 접속';
        $launchUrl = self::launchUrl($missionId);
        $targetAddress = rtrim(self::publicBaseUrl(), '/') . $livePath;
        $authorizationRef = 'FO-' . $caseNumber . '-' . strtoupper(substr(hash('sha256', $missionId), 0, 8));

        $scope = $scope !== [] ? $scope : [
            '메일에 명시된 검증 타깃과 그 화면이 직접 안내하는 같은 서비스 경로만 조사',
            '타인의 계정, 다른 인터넷 자산과 제3자 host는 범위 외',
        ];
        $deliverables = $deliverables !== [] ? $deliverables : [
            '목표를 재현한 요청과 응답의 핵심 정보',
            '완료 화면 또는 검증 영수증',
            '원인과 우선 조치 제안',
        ];
        $cautions = $cautions !== [] ? $cautions : [
            '승인 자산 밖으로 요청을 보내거나 데이터를 변경하지 마세요.',
        ];

        $textSections = [
            'FIELD//OPS · AUTHORIZED SECURITY ENGAGEMENT',
            'CASE ' . $caseNumber . ' / ' . strtoupper($missionId),
            'AUTHORIZATION ' . $authorizationRef,
            '',
            $displayName . ' 오퍼레이터님께,',
            '',
            $contactContext,
            '',
            '[사건 배경]',
            $story,
            '',
            '[의뢰 연락처]',
            $organization . ' · ' . $senderName . ' ' . $senderRole . ($senderAddress !== '' ? ' · ' . $senderAddress : ''),
            '긴급도/일정: ' . $urgency,
            '',
            '[타깃 자산]',
            '서비스: ' . $serviceName,
            '서비스 식별 호스트: ' . $hostname,
            '초기 화면: ' . $entryPath,
            '접속 주소: ' . $targetAddress,
            '접근 방법: ' . $accessMethod,
            '환경: ' . $environment,
            '검증 표면: ' . $surface,
            '',
            '[작전 목표]',
            $objective,
            $brief !== '' ? '현장 브리핑: ' . $brief : '',
            '',
            '[허가 범위]',
            self::textList($scope),
            '',
            '[납품할 증거]',
            self::textList($deliverables),
            '',
            '[주의사항]',
            self::textList($cautions),
            '',
            $closing,
            '',
            '검증 타깃 연결: ' . $launchUrl,
            '이 링크에는 계정 토큰, 비밀번호, 완료 증표가 포함되어 있지 않습니다.',
            '접속 시 Hanplanet 계정과 진행 상태를 확인한 뒤 이 CASE의 개인별 인스턴스로 연결합니다.',
            '',
            '— ' . $senderName . ' / ' . $organization,
            'FIELD//OPS Secure Dispatch 경유',
        ];
        $text = implode("\n", array_values(array_filter(
            $textSections,
            static fn(mixed $line): bool => is_string($line),
        )));

        $html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
            . '<body style="margin:0;background:#071019;color:#dce8e3;font-family:Arial,\'Noto Sans KR\',sans-serif">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#071019"><tr><td align="center" style="padding:28px 12px">'
            . '<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#0d1a24;border:1px solid #27434d;border-radius:18px;overflow:hidden">'
            . '<tr><td style="padding:18px 26px;background:#102b32;border-bottom:1px solid #28505a">'
            . '<table role="presentation" width="100%"><tr><td style="color:#75f3c8;font:700 12px monospace;letter-spacing:2px">FIELD//OPS · SECURE DISPATCH</td>'
            . '<td align="right" style="color:#9bb3bb;font:12px monospace">CASE ' . self::escape($caseNumber) . '</td></tr></table></td></tr>'
            . '<tr><td style="padding:30px 32px 12px">'
            . '<p style="margin:0 0 8px;color:#7f9fac;font:12px monospace">AUTHORIZED ENGAGEMENT · ' . self::escape($authorizationRef) . '</p>'
            . '<h1 style="margin:0 0 12px;color:#f4f8f6;font-size:26px;line-height:1.35">' . self::escape($subject) . '</h1>'
            . '<span style="display:inline-block;padding:7px 11px;border-radius:999px;background:#332719;color:#ffd798;font:700 12px monospace">' . self::escape($urgency) . '</span>'
            . '</td></tr>'
            . '<tr><td style="padding:10px 32px 28px">'
            . '<p style="margin:0 0 16px;color:#e4ece9;font-size:15px;line-height:1.8">' . self::escape($displayName) . ' 오퍼레이터님께,</p>'
            . self::paragraph($contactContext)
            . self::sectionTitle('INCIDENT CONTEXT', '사건 배경')
            . self::paragraph($story)
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 24px;background:#09141d;border:1px solid #1d3742;border-radius:12px;overflow:hidden">'
            . self::row('CLIENT', $organization)
            . self::row('CONTACT', $senderName . ' · ' . $senderRole)
            . ($senderAddress !== '' ? self::row('CONTACT ID', $senderAddress) : '')
            . self::row('PRIORITY', $urgency)
            . '</table>'
            . self::sectionTitle('TARGET ASSET', '승인된 검증 타깃')
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 24px;background:#09141d;border:1px solid #1d3742;border-radius:12px;overflow:hidden">'
            . self::row('SERVICE', $serviceName)
            . self::row('HOST', $hostname)
            . self::row('ENTRY', $entryPath)
            . self::row('ACCESS URL', $targetAddress)
            . self::row('ACCESS', $accessMethod)
            . self::row('ENVIRONMENT', $environment)
            . self::row('SURFACE', $surface)
            . '</table>'
            . self::sectionTitle('OBJECTIVE', '작전 목표')
            . '<div style="margin:12px 0 10px;padding:16px 18px;background:#11272a;border-left:3px solid #75f3c8;color:#eff8f4;font-size:15px;line-height:1.75">' . nl2br(self::escape($objective)) . '</div>'
            . ($brief !== '' ? '<p style="margin:10px 0 24px;color:#aebfbd;font-size:14px;line-height:1.75">' . nl2br(self::escape($brief)) . '</p>' : '')
            . self::sectionTitle('RULES OF ENGAGEMENT', '허가 범위')
            . self::htmlList($scope, '#75f3c8')
            . self::sectionTitle('EVIDENCE PACKAGE', '납품할 증거')
            . self::htmlList($deliverables, '#79b8ff')
            . self::sectionTitle('CAUTION', '주의사항')
            . '<div style="margin:12px 0 22px;padding:15px 18px;background:#2b2015;border:1px solid #5b4328;border-radius:10px;color:#f2d7ad">'
            . self::htmlList($cautions, '#efb35c', 0)
            . '</div>'
            . self::paragraph($closing)
            . '<div style="margin:28px 0 14px;text-align:center"><a href="' . self::escape($launchUrl) . '" style="display:inline-block;padding:15px 22px;border-radius:10px;background:#75f3c8;color:#071019;text-decoration:none;font-weight:800">' . self::escape($ctaLabel) . ' ↗</a></div>'
            . '<p style="margin:0;text-align:center;color:#78929b;font-size:12px;line-height:1.65">' . self::escape($targetAddress) . '<br>본인 확인과 진행 상태 확인 후 이 CASE의 전용 접속 세션으로 연결됩니다.</p>'
            . '<div style="margin:24px 0 0;padding:14px 16px;background:#111b24;border:1px solid #223944;border-radius:10px;color:#8fa7ae;font-size:12px;line-height:1.65">이 메일과 링크에는 Bearer token, 비밀번호, challenge 비밀값 또는 완료 증표가 포함되어 있지 않습니다. 허가 범위는 Hanplanet Wargame이 생성한 개인별 격리 자산으로 제한됩니다.</div>'
            . '<p style="margin:24px 0 0;color:#c8d6d3;font-size:14px;line-height:1.7">' . self::escape($senderName) . '<br><span style="color:#859ea6">' . self::escape($senderRole) . ' · ' . self::escape($organization) . '</span></p>'
            . '</td></tr>'
            . '<tr><td style="padding:18px 32px;border-top:1px solid #1d3742;background:#09141d;color:#627d87;font-size:11px;line-height:1.6">FIELD//OPS Dispatch · Authorized isolated assessment · ' . self::escape(strtoupper($missionId)) . '</td></tr>'
            . '</table></td></tr></table></body></html>';

        return [
            'subject' => $subject,
            'text' => $text,
            'html' => $html,
            'cta_url' => $launchUrl,
            'target_address' => $targetAddress,
            'authorization_ref' => $authorizationRef,
        ];
    }

    public static function dispatch(string $recipient, array $user, array $mission): array
    {
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $recipient)) {
            return ['status' => 'failed', 'transport' => 'none', 'detail' => 'registered_email_unavailable'];
        }

        try {
            $message = self::compose($user, $mission);
        } catch (Throwable) {
            return ['status' => 'failed', 'transport' => 'none', 'detail' => 'invalid_mission'];
        }

        if ((string) getenv('WARGAME_DISPATCH_PREVIEW') === '1') {
            return ['status' => 'preview', 'transport' => 'preview', 'detail' => 'delivery_disabled'];
        }

        $transport = strtolower(trim((string) getenv('WARGAME_MAIL_TRANSPORT'))) ?: 'preview';
        try {
            return match ($transport) {
                'preview' => ['status' => 'preview', 'transport' => 'preview', 'detail' => 'delivery_disabled'],
                'mail' => self::sendWithMail($recipient, $message),
                'smtp' => self::sendWithSmtp($recipient, $message),
                default => ['status' => 'failed', 'transport' => $transport, 'detail' => 'unsupported_transport'],
            };
        } catch (Throwable $exception) {
            error_log('Mission mail failed: ' . self::cleanLine($exception->getMessage()));
            return ['status' => 'failed', 'transport' => $transport, 'detail' => 'transport_error'];
        }
    }

    private static function sendWithMail(string $recipient, array $message): array
    {
        $from = self::fromAddress();
        $mime = self::multipartBody($message);
        $headers = [
            'From: FIELD//OPS Dispatch <' . $from . '>',
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="' . $mime['boundary'] . '"',
        ];
        $sent = mail(
            $recipient,
            self::subjectHeader((string) $message['subject']),
            $mime['body'],
            implode("\r\n", $headers),
        );

        return [
            'status' => $sent ? 'sent' : 'failed',
            'transport' => 'mail',
            'detail' => $sent ? 'accepted' : 'mail_rejected',
        ];
    }

    private static function sendWithSmtp(string $recipient, array $message): array
    {
        $host = trim((string) getenv('WARGAME_SMTP_HOST'));
        if ($host === '' || preg_match('/[\r\n\s]/', $host)) {
            throw new RuntimeException('smtp_host_missing');
        }
        $security = strtolower(trim((string) getenv('WARGAME_SMTP_SECURITY'))) ?: 'none';
        if (!in_array($security, ['none', 'tls'], true)) {
            throw new RuntimeException('smtp_security_invalid');
        }
        $username = trim((string) getenv('WARGAME_SMTP_USERNAME'));
        $password = (string) getenv('WARGAME_SMTP_PASSWORD');
        if ($username !== '' && $security !== 'tls') {
            throw new RuntimeException('smtp_auth_requires_tls');
        }
        if ($username === '' && $password !== '') {
            throw new RuntimeException('smtp_username_missing');
        }
        $tlsPeerName = trim((string) getenv('WARGAME_SMTP_TLS_PEER_NAME')) ?: $host;
        if (preg_match('/[\r\n\s]/', $tlsPeerName)) {
            throw new RuntimeException('smtp_tls_peer_name_invalid');
        }
        $port = max(1, min(65535, (int) (getenv('WARGAME_SMTP_PORT') ?: 25)));
        $timeout = max(1, min(30, (int) (getenv('WARGAME_SMTP_TIMEOUT') ?: 5)));
        $context = stream_context_create([
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'peer_name' => $tlsPeerName,
                'SNI_enabled' => true,
            ],
        ]);
        $socket = @stream_socket_client(
            'tcp://' . $host . ':' . $port,
            $errorCode,
            $errorMessage,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context,
        );
        if (!is_resource($socket)) {
            throw new RuntimeException('smtp_connect_failed_' . $errorCode);
        }
        stream_set_timeout($socket, $timeout);

        try {
            self::expect($socket, [220]);
            self::command($socket, 'EHLO wargame.hanplanet.com', [250]);

            if ($security === 'tls') {
                self::command($socket, 'STARTTLS', [220]);
                if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('smtp_tls_failed');
                }
                self::command($socket, 'EHLO wargame.hanplanet.com', [250]);
            }

            if ($username !== '') {
                self::command($socket, 'AUTH LOGIN', [334]);
                self::command($socket, base64_encode($username), [334]);
                self::command($socket, base64_encode($password), [235]);
            }

            $from = self::fromAddress();
            self::command($socket, 'MAIL FROM:<' . $from . '>', [250]);
            self::command($socket, 'RCPT TO:<' . $recipient . '>', [250, 251]);
            self::command($socket, 'DATA', [354]);

            $mime = self::multipartBody($message);
            $headers = [
                'From: FIELD//OPS Dispatch <' . $from . '>',
                'To: <' . $recipient . '>',
                'Subject: ' . self::subjectHeader((string) $message['subject']),
                'Date: ' . date(DATE_RFC2822),
                'Message-ID: <' . bin2hex(random_bytes(12)) . '@wargame.hanplanet.com>',
                'MIME-Version: 1.0',
                'Content-Type: multipart/alternative; boundary="' . $mime['boundary'] . '"',
            ];
            $data = implode("\r\n", $headers) . "\r\n\r\n" . $mime['body'];
            $data = preg_replace('/(^|\r\n)\./', '$1..', $data) ?? $data;
            self::writeAll($socket, $data . "\r\n.\r\n");
            self::expect($socket, [250]);
            // DATA의 250 응답부터 메일은 relay에 인계된 상태입니다. 이후 QUIT 응답이
            // 유실돼도 실패로 뒤집어 재전송/중복 메일을 만들지 않습니다.
            try {
                self::command($socket, 'QUIT', [221]);
            } catch (Throwable) {
                // Best effort only after the server accepted the message.
            }
        } finally {
            fclose($socket);
        }

        return ['status' => 'sent', 'transport' => 'smtp', 'detail' => 'accepted'];
    }

    private static function multipartBody(array $message): array
    {
        $boundary = 'field_ops_' . bin2hex(random_bytes(12));
        $body = [
            'This is a multi-part message in MIME format.',
            '--' . $boundary,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            rtrim(chunk_split(base64_encode((string) $message['text']), 76, "\r\n")),
            '--' . $boundary,
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            '',
            rtrim(chunk_split(base64_encode((string) $message['html']), 76, "\r\n")),
            '--' . $boundary . '--',
        ];
        return ['boundary' => $boundary, 'body' => implode("\r\n", $body)];
    }

    private static function command($socket, string $command, array $expected): string
    {
        if (preg_match('/[\r\n]/', $command)) {
            throw new RuntimeException('smtp_command_invalid');
        }
        self::writeAll($socket, $command . "\r\n");
        return self::expect($socket, $expected);
    }

    private static function writeAll($socket, string $data): void
    {
        $offset = 0;
        $length = strlen($data);
        while ($offset < $length) {
            $written = fwrite($socket, substr($data, $offset));
            if ($written === false || $written === 0) {
                throw new RuntimeException('smtp_write_failed');
            }
            $offset += $written;
        }
    }

    private static function expect($socket, array $expected): string
    {
        $response = '';
        do {
            $line = fgets($socket, 1024);
            if (!is_string($line)) {
                throw new RuntimeException('smtp_response_missing');
            }
            $response .= $line;
            $continued = strlen($line) >= 4 && $line[3] === '-';
        } while ($continued);

        $code = (int) substr($response, 0, 3);
        if (!in_array($code, $expected, true)) {
            throw new RuntimeException('smtp_unexpected_' . $code);
        }
        return $response;
    }

    private static function launchUrl(string $missionId): string
    {
        return rtrim(self::publicBaseUrl(), '/') . '/?mission=' . rawurlencode($missionId) . '&launch=1';
    }

    private static function publicBaseUrl(): string
    {
        $configured = trim((string) getenv('WARGAME_PUBLIC_URL'));
        $base = $configured !== '' ? $configured : self::DEFAULT_PUBLIC_URL;
        if (preg_match('/[\r\n]/', $base) || filter_var($base, FILTER_VALIDATE_URL) === false) {
            $base = self::DEFAULT_PUBLIC_URL;
        }
        $parts = parse_url($base);
        if (!is_array($parts) || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true) || empty($parts['host'])) {
            return self::DEFAULT_PUBLIC_URL;
        }
        return rtrim($base, '/') . '/';
    }

    private static function fromAddress(): string
    {
        $from = trim((string) getenv('WARGAME_MAIL_FROM')) ?: 'operations@wargame.hanplanet.com';
        if (!filter_var($from, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $from)) {
            throw new RuntimeException('mail_from_invalid');
        }
        return $from;
    }

    private static function safeDisplayAddress(string $value): string
    {
        $value = self::cleanLine($value);
        return filter_var($value, FILTER_VALIDATE_EMAIL) ? $value : '';
    }

    private static function safeVirtualHostname(string $value): string
    {
        $value = strtolower(trim($value));
        return preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,16}$/', $value) === 1
            ? $value
            : 'target.instance';
    }

    private static function safeVirtualPath(string $value): string
    {
        $value = trim($value);
        if ($value === '' || !str_starts_with($value, '/') || str_starts_with($value, '//') || preg_match('/[\r\n?#]/', $value)) {
            return '/';
        }
        return $value;
    }

    private static function stringList(array $values): array
    {
        $result = [];
        foreach ($values as $value) {
            if (!is_string($value)) {
                continue;
            }
            $value = trim($value);
            if ($value !== '') {
                $result[] = $value;
            }
        }
        return $result;
    }

    private static function textList(array $values): string
    {
        return implode("\n", array_map(
            static fn(string $value): string => '- ' . $value,
            $values,
        ));
    }

    private static function htmlList(array $values, string $bulletColor, int $marginBottom = 24): string
    {
        $items = '';
        foreach ($values as $value) {
            $items .= '<li style="margin:0 0 9px;padding-left:3px;color:#c4d2cf;font-size:14px;line-height:1.7">' . self::escape($value) . '</li>';
        }
        return '<ul style="margin:12px 0 ' . $marginBottom . 'px;padding-left:22px;list-style-position:outside;color:' . self::escape($bulletColor) . '">' . $items . '</ul>';
    }

    private static function sectionTitle(string $label, string $title): string
    {
        return '<div style="margin:26px 0 8px"><span style="display:block;margin-bottom:4px;color:#75f3c8;font:700 10px monospace;letter-spacing:1.5px">' . self::escape($label) . '</span>'
            . '<h2 style="margin:0;color:#eff5f3;font-size:18px">' . self::escape($title) . '</h2></div>';
    }

    private static function paragraph(string $value): string
    {
        return '<p style="margin:0 0 18px;color:#bdcdca;font-size:14px;line-height:1.82">' . nl2br(self::escape($value)) . '</p>';
    }

    private static function row(string $label, string $value): string
    {
        return '<tr><td valign="top" style="padding:12px 14px;border-bottom:1px solid #172d37;color:#6f929f;font:11px monospace;width:105px">'
            . self::escape($label) . '</td><td style="padding:12px 14px;border-bottom:1px solid #172d37;color:#e3ece9;font-size:14px;line-height:1.55">'
            . self::escape($value) . '</td></tr>';
    }

    public static function subjectHeader(string $value): string
    {
        $value = self::cleanLine($value);
        if ($value === '') {
            return '';
        }

        // RFC 2047 encoded-word는 75자를 넘을 수 없습니다. UTF-8 문자를 쪼개지
        // 않으면서 각 encoded-word를 60자 이하로 유지하고 continuation line으로 접습니다.
        $characters = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY);
        if (!is_array($characters)) {
            $value = preg_replace('/[^\x20-\x7e]/', '?', $value) ?? '';
            $characters = str_split($value);
        }

        $words = [];
        $chunk = '';
        foreach ($characters as $character) {
            $candidate = $chunk . $character;
            $encoded = '=?UTF-8?B?' . base64_encode($candidate) . '?=';
            if ($chunk !== '' && strlen($encoded) > 60) {
                $words[] = '=?UTF-8?B?' . base64_encode($chunk) . '?=';
                $chunk = $character;
                continue;
            }
            $chunk = $candidate;
        }
        if ($chunk !== '') {
            $words[] = '=?UTF-8?B?' . base64_encode($chunk) . '?=';
        }

        return implode("\r\n ", $words);
    }

    private static function cleanLine(string $value): string
    {
        return trim((string) preg_replace('/[\r\n]+/', ' ', $value));
    }

    private static function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
