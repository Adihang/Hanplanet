<?php
declare(strict_types=1);

const WARGAME_SCHEMA_VERSION = 1;
const WARGAME_ROOT = __DIR__ . '/..';
const WARGAME_DATA_DIR = WARGAME_ROOT . '/data';
const WARGAME_DB_PATH = WARGAME_DATA_DIR . '/wargame.sqlite3';
const WARGAME_SCHEMA_PATH = WARGAME_ROOT . '/database/schema.sql';

umask(0007);

function ensure_directory(string $path, int $mode): void
{
    if (is_link($path)) {
        throw new RuntimeException("Refusing to use a symbolic link as a runtime directory: {$path}");
    }
    if (!is_dir($path) && !mkdir($path, $mode, true) && !is_dir($path)) {
        throw new RuntimeException("Unable to create runtime directory: {$path}");
    }

    @chmod($path, $mode);
    if (!is_writable($path)) {
        throw new RuntimeException("Runtime directory is not writable: {$path}");
    }
}

function sqlite_connection(string $path): PDO
{
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 5000');
    return $pdo;
}

function table_exists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name LIMIT 1"
    );
    $stmt->execute(['name' => $table]);
    return (bool) $stmt->fetchColumn();
}

function remove_database_files(string $path): void
{
    foreach ([$path, $path . '-wal', $path . '-shm'] as $candidate) {
        if ((is_file($candidate) || is_link($candidate)) && !unlink($candidate)) {
            throw new RuntimeException("Unable to remove legacy database file: {$candidate}");
        }
    }
}

try {
    ensure_directory(WARGAME_DATA_DIR, 0770);
    ensure_directory(WARGAME_DATA_DIR . '/sessions', 0700);
    ensure_directory(WARGAME_DATA_DIR . '/instances', 0770);

    $lockPath = WARGAME_DATA_DIR . '/.init.lock';
    if (is_link($lockPath)) {
        throw new RuntimeException('Refusing to follow a symbolic link for the initialization lock.');
    }
    $lockHandle = fopen($lockPath, 'c');
    if ($lockHandle === false || !flock($lockHandle, LOCK_EX)) {
        throw new RuntimeException('Unable to acquire the database initialization lock.');
    }

    $removedLegacyDatabase = false;
    if (is_link(WARGAME_DB_PATH)) {
        throw new RuntimeException('Refusing to initialize a database through a symbolic link.');
    }

    if (is_file(WARGAME_DB_PATH) && filesize(WARGAME_DB_PATH) > 0) {
        $probe = sqlite_connection(WARGAME_DB_PATH);
        if (!table_exists($probe, 'schema_meta')) {
            $probe = null;
            remove_database_files(WARGAME_DB_PATH);
            $removedLegacyDatabase = true;
        } else {
            $currentVersion = (int) $probe->query('SELECT COALESCE(MAX(version), 0) FROM schema_meta')->fetchColumn();
            $probe = null;
            if ($currentVersion > WARGAME_SCHEMA_VERSION) {
                throw new RuntimeException(
                    "Database schema {$currentVersion} is newer than supported version " . WARGAME_SCHEMA_VERSION . '.'
                );
            }
        }
    }

    $schema = file_get_contents(WARGAME_SCHEMA_PATH);
    if ($schema === false || trim($schema) === '') {
        throw new RuntimeException('Schema file is missing or empty.');
    }

    $pdo = sqlite_connection(WARGAME_DB_PATH);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA foreign_keys = OFF');
    $pdo->beginTransaction();
    try {
        $pdo->exec($schema);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
    $pdo->exec('PRAGMA foreign_keys = ON');

    $version = (int) $pdo->query('SELECT COALESCE(MAX(version), 0) FROM schema_meta')->fetchColumn();
    if ($version !== WARGAME_SCHEMA_VERSION) {
        throw new RuntimeException("Database schema initialization ended at unexpected version {$version}.");
    }

    $integrity = (string) $pdo->query('PRAGMA integrity_check')->fetchColumn();
    if ($integrity !== 'ok') {
        throw new RuntimeException("SQLite integrity check failed: {$integrity}");
    }

    $foreignKeyErrors = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
    if ($foreignKeyErrors !== []) {
        throw new RuntimeException('SQLite foreign key check failed.');
    }

    @chmod(WARGAME_DB_PATH, 0660);
    @chmod(WARGAME_DB_PATH . '-wal', 0660);
    @chmod(WARGAME_DB_PATH . '-shm', 0660);

    if ($removedLegacyDatabase) {
        echo "Removed legacy Wargame database schema.\n";
    }
    echo 'Initialized ' . WARGAME_DB_PATH . ' at schema version ' . WARGAME_SCHEMA_VERSION . ".\n";
} catch (Throwable $exception) {
    fwrite(STDERR, 'Wargame database initialization failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
