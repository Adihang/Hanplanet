<?php
declare(strict_types=1);

require __DIR__ . '/../app/bootstrap.php';

$pdo = db();

// Seed level2_users if empty
$stmt = $pdo->query('SELECT COUNT(*) FROM level2_users');
$level2UserCount = (int) $stmt->fetchColumn();
if ($level2UserCount === 0) {
    $pdo->exec("INSERT INTO level2_users (username, password) VALUES ('admin', 'super_secret_admin_password_9823!#')");
}

// Seed level12_flag if empty
$stmt = $pdo->query('SELECT COUNT(*) FROM sqlite_master WHERE type="table" AND name="level12_flag"');
if ((bool) $stmt->fetchColumn()) {
    $stmt = $pdo->query('SELECT COUNT(*) FROM level12_flag');
    $level12FlagCount = (int) $stmt->fetchColumn();
    if ($level12FlagCount === 0) {
        $pdo->exec("INSERT INTO level12_flag (flag) VALUES ('flag{union_based_sqli_data_extraction_12}')");
    }
}

// Generate physical flag files for L6, L7 and L11
file_put_contents(WARGAME_ROOT . '/data/flag6.txt', "flag{path_traversal_file_leak_success_6}\n");
file_put_contents(WARGAME_ROOT . '/data/flag7.txt', "flag{command_injection_rce_is_dangerous_7}\n");
file_put_contents(WARGAME_ROOT . '/data/flag11.txt', "flag{xxe_xml_external_entity_leak_11}\n");

$userCount = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
$solveCount = (int) $pdo->query('SELECT COUNT(*) FROM solves')->fetchColumn();
$dbPath = realpath(WARGAME_DB_PATH) ?: WARGAME_DB_PATH;

echo "Initialized {$dbPath}\n";
echo "Users: {$userCount}\n";
echo "Solves: {$solveCount}\n";


