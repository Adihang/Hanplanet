<?php
declare(strict_types=1);

function wargame_markdown_render(string $markdown): string
{
    $lines = preg_split('/\R/u', $markdown) ?: [];
    $output = [];
    $lineCount = count($lines);

    for ($index = 0; $index < $lineCount;) {
        $line = $lines[$index];
        if (trim($line) === '') {
            $index++;
            continue;
        }

        if (preg_match('/^```([a-z0-9_-]*)\s*$/i', $line, $match)) {
            $language = strtolower((string) ($match[1] ?? ''));
            $codeLines = [];
            $index++;
            while ($index < $lineCount && !preg_match('/^```\s*$/', $lines[$index])) {
                $codeLines[] = $lines[$index];
                $index++;
            }
            if ($index < $lineCount) {
                $index++;
            }
            $class = $language === '' ? '' : ' class="language-' . wargame_html($language) . '"';
            $output[] = '<pre><code' . $class . '>' . wargame_html(implode("\n", $codeLines)) . '</code></pre>';
            continue;
        }

        if ($index + 1 < $lineCount && wargame_markdown_is_table_row($line) && wargame_markdown_is_table_divider($lines[$index + 1])) {
            $headers = wargame_markdown_table_cells($line);
            $index += 2;
            $rows = [];
            while ($index < $lineCount && wargame_markdown_is_table_row($lines[$index])) {
                $rows[] = wargame_markdown_table_cells($lines[$index]);
                $index++;
            }
            $output[] = wargame_markdown_render_table($headers, $rows);
            continue;
        }

        if (preg_match('/^(#{1,6})\s+(.+?)\s*#*\s*$/u', $line, $match)) {
            $level = min(6, strlen((string) $match[1]));
            $output[] = '<h' . $level . '>' . wargame_markdown_inline((string) $match[2]) . '</h' . $level . '>';
            $index++;
            continue;
        }

        if (preg_match('/^\s*>\s?(.*)$/u', $line, $match)) {
            $quoteLines = [];
            while ($index < $lineCount && preg_match('/^\s*>\s?(.*)$/u', $lines[$index], $quoteMatch)) {
                $quoteLines[] = wargame_markdown_inline((string) $quoteMatch[1]);
                $index++;
            }
            $output[] = '<blockquote><p>' . implode('<br>', $quoteLines) . '</p></blockquote>';
            continue;
        }

        if (preg_match('/^\s*[-*+]\s+(.+)$/u', $line, $match)) {
            $items = [];
            while ($index < $lineCount && preg_match('/^\s*[-*+]\s+(.+)$/u', $lines[$index], $listMatch)) {
                $items[] = '<li>' . wargame_markdown_inline((string) $listMatch[1]) . '</li>';
                $index++;
            }
            $output[] = '<ul>' . implode('', $items) . '</ul>';
            continue;
        }

        if (preg_match('/^\s*\d+\.\s+(.+)$/u', $line, $match)) {
            $items = [];
            while ($index < $lineCount && preg_match('/^\s*\d+\.\s+(.+)$/u', $lines[$index], $listMatch)) {
                $items[] = '<li>' . wargame_markdown_inline((string) $listMatch[1]) . '</li>';
                $index++;
            }
            $output[] = '<ol>' . implode('', $items) . '</ol>';
            continue;
        }

        if (preg_match('/^\s*(?:---+|\*\*\*+|___+)\s*$/', $line)) {
            $output[] = '<hr>';
            $index++;
            continue;
        }

        $paragraph = [];
        while ($index < $lineCount && trim($lines[$index]) !== '' && !wargame_markdown_is_block_start($lines, $index)) {
            $paragraph[] = wargame_markdown_inline($lines[$index]);
            $index++;
        }
        if ($paragraph === []) {
            $paragraph[] = wargame_markdown_inline($lines[$index]);
            $index++;
        }
        $output[] = '<p>' . implode('<br>', $paragraph) . '</p>';
    }

    return implode("\n", $output);
}

function wargame_markdown_is_block_start(array $lines, int $index): bool
{
    $line = (string) ($lines[$index] ?? '');
    if ($index === 0) {
        return false;
    }
    return preg_match('/^(?:```|#{1,6}\s|\s*>\s?|\s*[-*+]\s+|\s*\d+\.\s+|\s*(?:---+|\*\*\*+|___+)\s*$)/u', $line) === 1
        || ($index + 1 < count($lines) && wargame_markdown_is_table_row($line) && wargame_markdown_is_table_divider((string) $lines[$index + 1]));
}

function wargame_markdown_is_table_row(string $line): bool
{
    return str_contains($line, '|') && trim($line) !== '';
}

function wargame_markdown_is_table_divider(string $line): bool
{
    $cells = wargame_markdown_table_cells($line);
    if ($cells === []) {
        return false;
    }
    foreach ($cells as $cell) {
        if (preg_match('/^:?-{3,}:?$/', trim($cell)) !== 1) {
            return false;
        }
    }
    return true;
}

function wargame_markdown_table_cells(string $line): array
{
    return array_map(
        static fn(string $cell): string => trim($cell),
        explode('|', trim(trim($line), '|')),
    );
}

function wargame_markdown_render_table(array $headers, array $rows): string
{
    $head = '<tr>' . implode('', array_map(static fn(string $cell): string => '<th scope="col">' . wargame_markdown_inline($cell) . '</th>', $headers)) . '</tr>';
    $body = [];
    foreach ($rows as $row) {
        $cells = [];
        foreach ($headers as $columnIndex => $_header) {
            $cells[] = '<td>' . wargame_markdown_inline((string) ($row[$columnIndex] ?? '')) . '</td>';
        }
        $body[] = '<tr>' . implode('', $cells) . '</tr>';
    }
    return '<table><thead>' . $head . '</thead><tbody>' . implode('', $body) . '</tbody></table>';
}

function wargame_markdown_inline(string $text): string
{
    $escaped = wargame_html($text);
    $tokens = [];
    $tokenize = static function (string $html) use (&$tokens): string {
        $token = '@@WARGAME_MARKDOWN_' . count($tokens) . '@@';
        $tokens[$token] = $html;
        return $token;
    };

    $escaped = (string) preg_replace_callback('/`([^`]+)`/', static function (array $match) use ($tokenize): string {
        return $tokenize('<code>' . $match[1] . '</code>');
    }, $escaped);
    $escaped = (string) preg_replace_callback('/\[([^\]]+)]\((https:\/\/[^)\s]+)\)/', static function (array $match) use ($tokenize): string {
        $href = html_entity_decode((string) $match[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $parts = parse_url($href);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || !isset($parts['host'])) {
            return $match[0];
        }
        return $tokenize('<a href="' . wargame_html($href) . '" target="_blank" rel="noopener noreferrer">' . $match[1] . '</a>');
    }, $escaped);
    $escaped = (string) preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $escaped);
    $escaped = (string) preg_replace('/(?<!\*)\*([^*\n]+)\*(?!\*)/', '<em>$1</em>', $escaped);

    return strtr($escaped, $tokens);
}

function wargame_mission_markdown(array $mission): array
{
    $lesson = (array) ($mission['lesson'] ?? []);
    $target = (array) ($mission['target'] ?? []);
    $table = (array) ($lesson['table'] ?? []);
    $code = (array) ($lesson['code'] ?? []);

    $objectives = array_values(array_filter((array) ($mission['objectives'] ?? []), 'is_string'));
    $objectiveList = implode("\n", array_map(static fn(string $item): string => '- ' . $item, $objectives));
    $paragraphs = array_values(array_filter((array) ($lesson['paragraphs'] ?? []), 'is_string'));
    $technicalIntro = '## ' . ((string) ($lesson['summary'] ?? '핵심 원리')) . "\n\n" . implode("\n\n", $paragraphs);

    $technicalDetails = '';
    if (!empty($table['columns']) && !empty($table['rows'])) {
        $columns = array_map('strval', (array) $table['columns']);
        $technicalDetails .= wargame_markdown_table_source($columns, (array) $table['rows']);
    }
    if ((string) ($code['content'] ?? '') !== '') {
        $language = preg_replace('/[^a-z0-9_-]/i', '', (string) ($code['language'] ?? 'text')) ?: 'text';
        $technicalDetails .= ($technicalDetails === '' ? '' : "\n\n") . '```' . $language . "\n" . (string) $code['content'] . "\n```";
    }

    $resourceItems = [];
    foreach ((array) ($mission['resources'] ?? []) as $resource) {
        $url = trim((string) ($resource['url'] ?? ''));
        if (str_starts_with($url, 'https://')) {
            $resourceItems[] = '- [' . ((string) ($resource['label'] ?? $url)) . '](' . $url . ')';
        }
    }

    return [
        'dossier' => '## 의뢰 배경' . "\n\n> " . ((string) ($mission['story'] ?? '')),
        'objective' => '## 이번 목표' . "\n\n" . ((string) ($target['objective'] ?? '')) . ($objectiveList === '' ? '' : "\n\n" . $objectiveList),
        'technical_intro' => $technicalIntro,
        'technical_details' => $technicalDetails,
        'resources' => '## 더 깊이 읽기' . "\n\n실습 전후에 공식 문서와 보안 아카데미 자료로 개념을 교차 확인하세요." . ($resourceItems === [] ? '' : "\n\n" . implode("\n", $resourceItems)),
        'hints_intro' => '## 막혔을 때만 열기' . "\n\n다음 단서가 필요할 때만 한 단계씩 확인하세요.",
    ];
}

function wargame_markdown_table_source(array $columns, array $rows): string
{
    $header = '| ' . implode(' | ', array_map(static fn(string $cell): string => str_replace('|', '\\|', $cell), $columns)) . ' |';
    $divider = '| ' . implode(' | ', array_fill(0, count($columns), '---')) . ' |';
    $tableRows = [];
    foreach ($rows as $row) {
        $rowValues = (array) $row;
        $cells = [];
        foreach ($columns as $index => $_column) {
            $cells[] = str_replace('|', '\\|', (string) ($rowValues[$index] ?? ''));
        }
        $tableRows[] = '| ' . implode(' | ', $cells) . ' |';
    }
    return implode("\n", array_merge([$header, $divider], $tableRows));
}
