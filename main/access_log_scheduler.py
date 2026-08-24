import platform
import logging
import os
import sys
import threading
import time
import tarfile
from datetime import timedelta
from pathlib import Path
from pathlib import PurePosixPath

# 윈도우에서 fcntl 대신 msvcrt 사용
if platform.system() == 'Windows':
    import msvcrt
else:
    import fcntl

from django.utils import timezone
from django.conf import settings

from .access_log_summary import build_daily_summary, resolve_summary_dir, write_summary_files

logger = logging.getLogger(__name__)

_scheduler_started = False
_scheduler_lock_fd = None
_scheduler_thread = None
_last_generated_date = None
_last_backup_date = None


def _env_bool(name, default):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _should_start_in_this_process():
    if not _env_bool("DJANGO_ACCESS_SUMMARY_SCHEDULER_ENABLED", True):
        return False

    argv0 = Path(sys.argv[0]).name
    command = sys.argv[1] if len(sys.argv) > 1 else ""

    # Prevent scheduler from running on one-off management commands.
    if argv0 == "manage.py":
        if command != "runserver":
            return False
        # Django dev server reloader spawns duplicate process.
        if os.environ.get("RUN_MAIN") != "true":
            return False

    return True


def _acquire_scheduler_lock():
    lock_path = Path(
        os.environ.get(
            "DJANGO_ACCESS_SUMMARY_SCHEDULER_LOCK_FILE",
            "/tmp/hanplanet-access-summary-scheduler.lock",
        )
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        if platform.system() == 'Windows':
            # 윈도우에서는 msvcrt.locking 사용
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError:
                os.close(fd)
                return None
        else:
            # Unix/Linux에서는 fcntl 사용
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None

    os.ftruncate(fd, 0)
    os.write(fd, str(os.getpid()).encode("utf-8"))
    os.fsync(fd)
    return fd


def _resolve_top_n():
    try:
        value = int(os.environ.get("DJANGO_ACCESS_SUMMARY_TOP_N", "10"))
    except ValueError:
        value = 10
    return max(1, min(value, 100))


def _resolve_slow_n():
    try:
        value = int(os.environ.get("DJANGO_ACCESS_SUMMARY_SLOW_N", "20"))
    except ValueError:
        value = 20
    return max(1, min(value, 200))


def _summary_json_path(target_date):
    return Path(resolve_summary_dir()) / f"access_summary_{target_date.isoformat()}.json"


def _resolve_backup_root():
    from_env = os.environ.get("DJANGO_DATA_BACKUP_ROOT", "").strip()
    if from_env:
        return Path(from_env)
    configured = str(getattr(settings, "DATA_BACKUP_ROOT", "") or "").strip()
    if configured:
        return Path(configured)
    return None


def _resolve_backup_retention_days():
    raw_env = os.environ.get("DJANGO_DATA_BACKUP_RETENTION_DAYS", "").strip()
    if raw_env:
        try:
            return max(1, int(raw_env))
        except ValueError:
            return 3
    try:
        return max(1, int(getattr(settings, "DATA_BACKUP_RETENTION_DAYS", 3)))
    except (TypeError, ValueError):
        return 3


def _build_backup_target_paths():
    targets = [
        Path(str(getattr(settings, "MEDIA_ROOT", "") or "").strip()),
        Path(str(getattr(settings, "FORGEJO_REPOS_ROOT", "") or "").strip()),
    ]
    return [target for target in targets if str(target).strip() and target.exists()]


def _backup_archive_path(backup_root, target_date):
    return backup_root / f"hanplanet_data_{target_date.isoformat()}.tar.gz"


def _backup_member_filter(source_path, arcname):
    """Return a tar filter that omits per-user HanDrive files from media backups."""
    configured_media_root = str(getattr(settings, "MEDIA_ROOT", "") or "").strip()
    if not configured_media_root:
        return None
    media_root = Path(configured_media_root).resolve(strict=False)
    if Path(source_path).resolve(strict=False) != media_root:
        return None

    archive_root = PurePosixPath(str(arcname).replace("\\", "/"))
    excluded_root = PurePosixPath("HanDrive/users")

    def filter_member(member):
        member_path = PurePosixPath(str(member.name).replace("\\", "/"))
        try:
            relative_path = member_path.relative_to(archive_root)
        except ValueError:
            relative_path = member_path
        if relative_path == excluded_root or excluded_root in relative_path.parents:
            return None
        return member

    return filter_member


def _cleanup_old_backup_archives(backup_root, retention_days):
    archives = sorted(backup_root.glob("hanplanet_data_*.tar.gz"), key=lambda p: p.name)
    if len(archives) <= retention_days:
        return
    remove_count = len(archives) - retention_days
    for archive in archives[:remove_count]:
        try:
            archive.unlink()
            logger.info("Removed old backup archive: %s", archive)
        except OSError as exc:
            logger.warning("Failed to remove old backup archive %s: %s", archive, exc)


def _create_data_backup_archive(backup_root, target_date):
    backup_root.mkdir(parents=True, exist_ok=True)
    archive_path = _backup_archive_path(backup_root, target_date)
    source_paths = _build_backup_target_paths()

    if not source_paths:
        logger.info("No data targets found for backup.")
        return None

    base_dir = Path(getattr(settings, "BASE_DIR", Path(__file__).resolve().parent.parent))
    with tarfile.open(archive_path, "w:gz") as tar:
        for source_path in source_paths:
            try:
                arcname = source_path.relative_to(base_dir)
            except ValueError:
                arcname = source_path.name
            tar.add(
                source_path,
                arcname=str(arcname),
                filter=_backup_member_filter(source_path, arcname),
            )

    return archive_path


def _maybe_generate_previous_day_summary():
    global _last_generated_date

    now = timezone.localtime()
    trigger_at = now.replace(hour=0, minute=5, second=0, microsecond=0)
    if now < trigger_at:
        return

    target_date = (now - timedelta(days=1)).date()
    if _last_generated_date == target_date:
        return

    existing_json = _summary_json_path(target_date)
    if existing_json.exists():
        _last_generated_date = target_date
        return

    top_n = _resolve_top_n()
    slow_n = _resolve_slow_n()
    summary = build_daily_summary(target_date=target_date, top_n=top_n, slow_n=slow_n)
    json_path, md_path = write_summary_files(summary)
    _last_generated_date = target_date
    logger.info(
        "Generated daily access summary date=%s requests=%s path=%s md=%s",
        target_date,
        summary.get("total_requests", 0),
        json_path,
        md_path,
    )


def _maybe_backup_data_files():
    global _last_backup_date

    now = timezone.localtime()
    trigger_at = now.replace(hour=0, minute=5, second=0, microsecond=0)
    if now < trigger_at:
        return

    backup_date = now.date()
    backup_root = _resolve_backup_root()
    if backup_root is None:
        logger.info("DATA_BACKUP_ROOT is empty. Skipping daily data backup.")
        return

    # Always retry retention cleanup after the daily trigger time.
    # This self-heals transient sync/lock issues without waiting for the next day.
    _cleanup_old_backup_archives(backup_root, _resolve_backup_retention_days())

    if _last_backup_date == backup_date:
        return

    archive_path = _backup_archive_path(backup_root, backup_date)
    retention_days = _resolve_backup_retention_days()

    if archive_path.exists():
        _last_backup_date = backup_date
        _cleanup_old_backup_archives(backup_root, retention_days)
        return

    created_archive = _create_data_backup_archive(backup_root, backup_date)
    if created_archive is not None:
        _last_backup_date = backup_date
        logger.info("Created daily data backup: %s", created_archive)
        _cleanup_old_backup_archives(backup_root, retention_days)


def _scheduler_loop():
    interval_sec = 30
    while True:
        try:
            _maybe_generate_previous_day_summary()
            _maybe_backup_data_files()
        except Exception as exc:  # pragma: no cover - defensive loop guard
            logger.exception("Access summary scheduler error: %s", exc)
        time.sleep(interval_sec)


def start_access_log_scheduler():
    global _scheduler_started, _scheduler_lock_fd, _scheduler_thread

    if _scheduler_started:
        return False

    if not _should_start_in_this_process():
        return False

    lock_fd = _acquire_scheduler_lock()
    if lock_fd is None:
        logger.info("Access summary scheduler already running in another process.")
        return False

    _scheduler_lock_fd = lock_fd
    _scheduler_thread = threading.Thread(
        target=_scheduler_loop,
        name="access-log-summary-scheduler",
        daemon=True,
    )
    _scheduler_thread.start()
    _scheduler_started = True
    logger.info("Access summary scheduler started (pid=%s).", os.getpid())
    return True
