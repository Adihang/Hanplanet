<?php
declare(strict_types=1);

final class MissionMailer
{
    public static function compose(array $user, array $mission): array
    {
        $displayName = trim((string) ($user['display_name'] ?? $user['username'] ?? 'Operator')) ?: 'Operator';
        $mail = (array) ($mission['email'] ?? []);
        $clientValue = $mission['client'] ?? [];
        $client = is_array($clientValue) ? $clientValue : ['name' => (string) $clientValue];
        $target = (array) ($mission['target'] ?? []);
        $caseNumber = str_pad((string) max(1, (int) (($mission['order'] ?? 10) / 10)), 2, '0', STR_PAD_LEFT);
        $subject = trim((string) ($mail['subject'] ?? ''))
            ?: '[FIELD//OPS] CASE ' . $caseNumber . ' · ' . (string) ($mission['title'] ?? '새 보안 진단 의뢰');
        $story = trim((string) ($mission['story'] ?? $mission['brief'] ?? ''));
        $objective = trim((string) ($target['objective'] ?? '지정된 범위 안에서 증거를 확보하십시오.'));
        $entry = trim((string) ($target['entry'] ?? $target['entry_url'] ?? $target['url'] ?? '/'));
        $clientName = trim((string) ($client['name'] ?? '의뢰인 비공개'));
        $clientRole = trim((string) ($client['role'] ?? '보안 담당자'));
        $missionId = (string) ($mission['id'] ?? 'unknown');

        $text = implode("\n", [
            'FIELD//OPS SECURE DISPATCH',
            'CASE ' . strtoupper($missionId),
            '',
            $displayName . ' 오퍼레이터께,',
            '',
            $story,
            '',
            '의뢰인: ' . $clientName . ' / ' . $clientRole,
            '목표: ' . $objective,
            '타깃 진입점: ' . $entry,
            '',
            '허가 범위: 이 메일과 Hanplanet Wargame이 제공한 가상 자산만 진단하십시오.',
            '작전 콘솔: https://wargame.hanplanet.com/?mission=' . rawurlencode($missionId),
            '',
            '— FIELD//OPS Dispatch',
        ]);

        $html = '<!doctype html><html lang="ko"><body style="margin:0;background:#071019;color:#dce8e3;font-family:Arial,sans-serif">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">'
            . '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#0e1b25;border:1px solid #244351;border-radius:18px;overflow:hidden">'
            . '<tr><td style="padding:18px 24px;background:#102b32;color:#75f3c8;font:700 12px monospace;letter-spacing:2px">FIELD//OPS · SECURE DISPATCH</td></tr>'
            . '<tr><td style="padding:30px 30px 10px"><p style="margin:0 0 8px;color:#7f9fac;font:12px monospace">CASE ' . self::escape(strtoupper($missionId)) . '</p>'
            . '<h1 style="margin:0;color:#f3f7f5;font-size:26px;line-height:1.3">새 의뢰가 도착했습니다</h1></td></tr>'
            . '<tr><td style="padding:12px 30px 28px"><p style="line-height:1.7">' . self::escape($displayName) . ' 오퍼레이터께,</p>'
            . '<p style="line-height:1.75;color:#c3d2cf">' . nl2br(self::escape($story)) . '</p>'
            . '<table role="presentation" width="100%" style="margin:24px 0;background:#09141d;border:1px solid #1d3742;border-radius:12px">'
            . self::row('CLIENT', $clientName . ' / ' . $clientRole)
            . self::row('OBJECTIVE', $objective)
            . self::row('ENTRY', $entry)
            . '</table>'
            . '<p style="padding:14px 16px;background:#281f14;border-left:3px solid #efb35c;color:#f4d8ad;font-size:13px;line-height:1.6">허가 범위는 Hanplanet Wargame이 제공한 가상 자산으로 제한됩니다. 실제 시스템에는 시도하지 마십시오.</p>'
            . '<p style="margin:28px 0 8px"><a href="https://wargame.hanplanet.com/?mission=' . rawurlencode($missionId) . '" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#75f3c8;color:#071019;text-decoration:none;font-weight:700">작전 콘솔 열기</a></p>'
            . '</td></tr><tr><td style="padding:18px 30px;border-top:1px solid #1d3742;color:#66808c;font-size:12px">FIELD//OPS Dispatch · Training simulation</td></tr>'
            . '</table></td></tr></table></body></html>';

        return ['subject' => $subject, 'text' => $text, 'html' => $html];
    }

    public static function dispatch(string $recipient, array $user, array $mission): array
    {
        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $recipient)) {
            return ['status' => 'failed', 'transport' => 'none', 'detail' => 'registered_email_unavailable'];
        }

        $message = self::compose($user, $mission);
        $transport = strtolower(trim((string) getenv('WARGAME_MAIL_TRANSPORT'))) ?: 'preview';
        try {
            if ($transport === 'preview') {
                return ['status' => 'preview', 'transport' => 'preview', 'detail' => 'delivery_disabled'];
            }
            if ($transport === 'mail') {
                return self::sendWithMail($recipient, $message);
            }
            if ($transport === 'smtp') {
                return self::sendWithSmtp($recipient, $message);
            }
            return ['status' => 'failed', 'transport' => $transport, 'detail' => 'unsupported_transport'];
        } catch (Throwable $exception) {
            error_log('Mission mail failed: ' . $exception->getMessage());
            return ['status' => 'failed', 'transport' => $transport, 'detail' => 'transport_error'];
        }
    }

    private static function sendWithMail(string $recipient, array $message): array
    {
        $from = self::fromAddress();
        $headers = [
            'From: FIELD//OPS <' . $from . '>',
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
        ];
        $sent = mail(
            $recipient,
            self::encodeHeader((string) $message['subject']),
            chunk_split(base64_encode((string) $message['html'])),
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
        if ($host === '' || preg_match('/[\r\n]/', $host)) {
            throw new RuntimeException('smtp_host_missing');
        }
        $port = max(1, min(65535, (int) (getenv('WARGAME_SMTP_PORT') ?: 25)));
        $timeout = max(1, min(30, (int) (getenv('WARGAME_SMTP_TIMEOUT') ?: 5)));
        $socketContext = stream_context_create([
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'peer_name' => $host,
                'SNI_enabled' => true,
            ],
        ]);
        $socket = @stream_socket_client(
            'tcp://' . $host . ':' . $port,
            $errorCode,
            $errorMessage,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $socketContext,
        );
        if (!is_resource($socket)) {
            throw new RuntimeException('smtp_connect_failed_' . $errorCode);
        }
        stream_set_timeout($socket, $timeout);

        try {
            self::expect($socket, [220]);
            self::command($socket, 'EHLO wargame.hanplanet.com', [250]);

            if (strtolower(trim((string) getenv('WARGAME_SMTP_SECURITY'))) === 'tls') {
                self::command($socket, 'STARTTLS', [220]);
                if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('smtp_tls_failed');
                }
                self::command($socket, 'EHLO wargame.hanplanet.com', [250]);
            }

            $username = trim((string) getenv('WARGAME_SMTP_USERNAME'));
            if ($username !== '') {
                $password = (string) getenv('WARGAME_SMTP_PASSWORD');
                self::command($socket, 'AUTH LOGIN', [334]);
                self::command($socket, base64_encode($username), [334]);
                self::command($socket, base64_encode($password), [235]);
            }

            $from = self::fromAddress();
            self::command($socket, 'MAIL FROM:<' . $from . '>', [250]);
            self::command($socket, 'RCPT TO:<' . $recipient . '>', [250, 251]);
            self::command($socket, 'DATA', [354]);

            $headers = [
                'From: FIELD//OPS <' . $from . '>',
                'To: <' . $recipient . '>',
                'Subject: ' . self::encodeHeader((string) $message['subject']),
                'Date: ' . date(DATE_RFC2822),
                'Message-ID: <' . bin2hex(random_bytes(12)) . '@wargame.hanplanet.com>',
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
                'Content-Transfer-Encoding: base64',
            ];
            $data = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode((string) $message['html']), 76, "\r\n");
            $data = preg_replace('/(^|\r\n)\./', '$1..', $data) ?? $data;
            self::writeAll($socket, $data . "\r\n.\r\n");
            self::expect($socket, [250]);
            self::command($socket, 'QUIT', [221]);
        } finally {
            fclose($socket);
        }

        return ['status' => 'sent', 'transport' => 'smtp', 'detail' => 'accepted'];
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

    private static function fromAddress(): string
    {
        $from = trim((string) getenv('WARGAME_MAIL_FROM')) ?: 'operations@wargame.hanplanet.com';
        if (!filter_var($from, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $from)) {
            throw new RuntimeException('mail_from_invalid');
        }
        return $from;
    }

    private static function row(string $label, string $value): string
    {
        return '<tr><td style="padding:12px 14px;border-bottom:1px solid #172d37;color:#6f929f;font:11px monospace;width:92px">'
            . self::escape($label) . '</td><td style="padding:12px 14px;border-bottom:1px solid #172d37;color:#e3ece9;font-size:14px">'
            . self::escape($value) . '</td></tr>';
    }

    private static function encodeHeader(string $value): string
    {
        return '=?UTF-8?B?' . base64_encode($value) . '?=';
    }

    private static function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
