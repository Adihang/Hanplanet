"""HanDrive HLS on-demand transcoding engine.

흐름:
1. render_handrive_media_safely 가 data-hls-* 속성을 HTML에 심음
2. video_player.js 가 /handrive/api/hls/status 를 먼저 확인
3. "ready" → /handrive/api/hls/manifest 로 Video.js 소스 설정
4. 아직 안 된 경우 → fallback MP4로 즉시 재생 + 백그라운드 트랜스코딩 폴링
5. 완료 시 "HD 화질 사용 가능" 배지 표시 (재생 중단 없음)

각 캐시 항목(cache_key 디렉터리)에는 다음 파일들이 생성된다:
  status.json        — 트랜스코딩 상태/진행률 + 완성된 기능 플래그
  poster.jpg         — 대표 썸네일 (5초 지점 프레임)
  faststart.mp4      — moov-앞배치 MP4 복사본 (mp4/mov/m4v에만)
  sprite.jpg         — 썸네일 스프라이트 (6초 간격 프레임 타일)
  sprite.vtt         — 썸네일 VTT (스프라이트 좌표 매핑)
  {quality}/         — HLS 세그먼트 디렉터리 (360p, 480p, 720p, 1080p)
  master.m3u8        — HLS 마스터 플레이리스트
"""
from __future__ import annotations

import hashlib
import json
import logging
import queue
import re
import subprocess
import threading
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

# ── 경로 설정 ──────────────────────────────────────────────────────────
def _hls_cache_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "hls_cache"


# ffmpeg / ffprobe 절대 경로 (launchd 환경에 PATH가 없는 경우 대비)
import shutil as _shutil

def _ffmpeg() -> str:
    return _shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

def _ffprobe() -> str:
    return _shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"


# ── 화질 프리셋 (label, vf_scale, video_kbps, audio_kbps) ───────────────
_QUALITY_PRESETS: list[tuple[str, str, int, int]] = [
    ("1080p", "scale=-2:1080", 5000, 192),
    ("720p",  "scale=-2:720",  2800, 128),
    ("480p",  "scale=-2:480",  1400, 128),
    ("360p",  "scale=-2:360",  800,  96),
]

# ── Worker Queue (동시 트랜스코딩 최대 _WORKER_COUNT개 제한) ──────────────
_WORKER_COUNT = 2
_job_queue: queue.Queue = queue.Queue()
_workers_started = False
_queued: set[str] = set()   # 큐 중복 방지
_lock = threading.Lock()


def _ensure_workers() -> None:
    global _workers_started
    if _workers_started:
        return
    _workers_started = True
    for _ in range(_WORKER_COUNT):
        threading.Thread(target=_worker_loop, daemon=True).start()


def _worker_loop() -> None:
    while True:
        file_path, cache_key = _job_queue.get()
        with _lock:
            _queued.discard(cache_key)
        try:
            _transcode_all(file_path, cache_key)
        except Exception:
            logger.exception("[HLS] worker 예외: %s", cache_key)
        finally:
            _job_queue.task_done()


# ── 유틸 ─────────────────────────────────────────────────────────────────

def get_cache_key(file_path: Path) -> str:
    """파일 경로 + mtime → 16자 hex 캐시 키. mtime이 바뀌면 자동 무효화."""
    raw = f"{file_path.resolve()}:{file_path.stat().st_mtime}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _status_path(cache_dir: Path) -> Path:
    return cache_dir / "status.json"


def _read_status_dict(cache_dir: Path) -> dict:
    try:
        return json.loads(_status_path(cache_dir).read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_status(cache_dir: Path, status: str, progress: int, **extra) -> None:
    data = {"status": status, "progress": progress, **extra}
    _status_path(cache_dir).write_text(json.dumps(data), encoding="utf-8")


def get_status(cache_key: str) -> dict:
    """캐시 키에 대한 상태 반환.

    status 값: not_started / queued / transcoding / ready / error
    """
    p = _status_path(_hls_cache_root() / cache_key)
    if not p.exists():
        return {"status": "not_started", "progress": 0}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"status": "error", "progress": 0}


# ── 경로 검증 (path traversal 방지) ──────────────────────────────────────

def _valid_quality(q: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9]+p", q))


def _valid_segment(s: str) -> bool:
    return bool(re.fullmatch(r"seg\d{3,5}\.ts", s))


def get_master_playlist_path(cache_key: str) -> Path | None:
    p = _hls_cache_root() / cache_key / "master.m3u8"
    return p if p.exists() else None


def get_variant_playlist_path(cache_key: str, quality: str) -> Path | None:
    if not _valid_quality(quality):
        return None
    p = _hls_cache_root() / cache_key / quality / "playlist.m3u8"
    return p if p.exists() else None


def get_segment_path(cache_key: str, quality: str, segment: str) -> Path | None:
    if not _valid_quality(quality) or not _valid_segment(segment):
        return None
    p = _hls_cache_root() / cache_key / quality / segment
    return p if p.exists() else None


def get_poster_path(cache_key: str) -> Path | None:
    p = _hls_cache_root() / cache_key / "poster.jpg"
    return p if p.exists() else None


def ensure_first_frame_poster(src: Path, cache_key: str) -> Path | None:
    """poster.jpg가 없으면 첫 프레임으로 생성하고 경로를 반환한다."""
    existing = get_poster_path(cache_key)
    if existing:
        return existing
    cache_dir = _hls_cache_root() / cache_key
    cache_dir.mkdir(parents=True, exist_ok=True)
    if _make_poster(src, cache_dir, seek_seconds="0"):
        return get_poster_path(cache_key)
    return None


def get_faststart_path(cache_key: str) -> Path | None:
    p = _hls_cache_root() / cache_key / "faststart.mp4"
    return p if p.exists() else None


def get_sprite_path(cache_key: str) -> Path | None:
    p = _hls_cache_root() / cache_key / "sprite.jpg"
    return p if p.exists() else None


def get_sprite_vtt_path(cache_key: str) -> Path | None:
    p = _hls_cache_root() / cache_key / "sprite.vtt"
    return p if p.exists() else None


# ── 화질 레벨 선택 ────────────────────────────────────────────────────────

def _probe_video_info(file_path: Path) -> tuple[int, float]:
    """(세로해상도, 재생시간_초) 반환. 실패 시 (720, 0.0)."""
    try:
        r = subprocess.run(
            [
                _ffprobe(), "-v", "quiet",
                "-select_streams", "v:0",
                "-show_entries", "stream=height:format=duration",
                "-of", "json",
                str(file_path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(r.stdout)
        height   = int(data["streams"][0]["height"])
        duration = float(data.get("format", {}).get("duration", 0) or 0)
        return height, duration
    except Exception:
        return 720, 0.0


def _pick_qualities(source_height: int) -> list[tuple[str, str, int, int]]:
    """소스 해상도 이하의 프리셋만 반환. 최소 1개 보장."""
    chosen = [
        q for q in _QUALITY_PRESETS
        if int(q[1].split(":")[-1]) <= source_height
    ]
    return chosen if chosen else [_QUALITY_PRESETS[-1]]


# ── 트랜스코딩 시작 ───────────────────────────────────────────────────────

def start_transcoding(file_path: Path, cache_key: str) -> None:
    """이미 큐에 있거나 진행 중이거나 완료된 경우 아무것도 하지 않음."""
    _ensure_workers()
    with _lock:
        st = get_status(cache_key)
        if st["status"] in ("transcoding", "ready", "queued"):
            return
        _queued.add(cache_key)

    cache_dir = _hls_cache_root() / cache_key
    cache_dir.mkdir(parents=True, exist_ok=True)
    _write_status(cache_dir, "queued", 0)
    _job_queue.put((file_path, cache_key))


def _transcode_all(file_path: Path, cache_key: str) -> None:
    cache_dir = _hls_cache_root() / cache_key
    cache_dir.mkdir(parents=True, exist_ok=True)
    _write_status(cache_dir, "transcoding", 0)

    try:
        height, duration = _probe_video_info(file_path)
        qualities = _pick_qualities(height)
        n = len(qualities)

        # ① Poster (가장 먼저 — 사용자에게 빠르게 표시)
        if _make_poster(file_path, cache_dir):
            _write_status(cache_dir, "transcoding", 2, poster=True)

        # ② FastStart MP4 복사본
        faststart_ok = _make_faststart(file_path, cache_dir)

        # ③ HLS 화질별 세그먼트
        for i, (label, vf, vbr, abr) in enumerate(qualities):
            q_dir = cache_dir / label
            q_dir.mkdir(exist_ok=True)
            playlist    = q_dir / "playlist.m3u8"
            seg_pattern = str(q_dir / "seg%03d.ts")

            ok = _run_ffmpeg(file_path, vf, vbr, abr, playlist, seg_pattern)
            if not ok:
                _write_status(cache_dir, "error", 0)
                logger.error("[HLS] 트랜스코딩 실패: %s %s", file_path.name, label)
                return

            progress = 5 + int((i + 1) / n * 85)
            st = _read_status_dict(cache_dir)
            _write_status(cache_dir, "transcoding", progress,
                          poster=st.get("poster", False),
                          faststart=faststart_ok)

        # ④ Thumbnail sprite + VTT
        sprite_ok = False
        if duration > 0:
            sprite_ok = _make_thumbnail_sprite(file_path, cache_dir, duration)

        # ⑤ Master playlist
        _build_master(cache_dir, qualities)

        _write_status(cache_dir, "ready", 100,
                      poster=get_poster_path(cache_key) is not None,
                      faststart=faststart_ok,
                      sprite=sprite_ok)
        logger.info("[HLS] 완료: %s (key=%s)", file_path.name, cache_key)

    except Exception:
        logger.exception("[HLS] 예외 발생: %s", file_path.name)
        _write_status(cache_dir, "error", 0)


# ── ffmpeg 헬퍼 ──────────────────────────────────────────────────────────

def _run_ffmpeg(
    src: Path,
    vf: str,
    vbr: int,
    abr: int,
    playlist: Path,
    seg_pattern: str,
) -> bool:
    """VideoToolbox(hw) 시도 → 실패 시 libx264(sw) 재시도."""
    base_args = [
        _ffmpeg(), "-y", "-i", str(src),
        "-vf", vf,
        "-b:v", f"{vbr}k",
        "-c:a", "aac", "-b:a", f"{abr}k",
        "-hls_time", "6",
        "-hls_playlist_type", "vod",
        "-hls_segment_filename", seg_pattern,
        "-f", "hls", str(playlist),
    ]

    for codec in ("h264_videotoolbox", "libx264"):
        cmd = base_args[:4] + ["-c:v", codec] + base_args[4:]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=7200)
            if r.returncode == 0:
                return True
        except subprocess.TimeoutExpired:
            logger.error("[HLS] ffmpeg 타임아웃: %s", codec)
            return False
        except Exception as e:
            logger.error("[HLS] ffmpeg 실행 오류 (%s): %s", codec, e)

    return False


def _make_poster(src: Path, cache_dir: Path, seek_seconds: str = "5") -> bool:
    """지정한 시점의 프레임을 poster.jpg로 저장. 실패 시 False."""
    out = cache_dir / "poster.jpg"
    cmd = [
        _ffmpeg(), "-y",
        "-ss", seek_seconds,
        "-i", str(src),
        "-vframes", "1",
        "-vf", "scale='min(1280,iw)':-2",
        str(out),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=60)
        return r.returncode == 0
    except Exception:
        return False


def _make_faststart(src: Path, cache_dir: Path) -> bool:
    """moov atom을 파일 앞으로 이동한 MP4 복사본 생성. mp4/mov/m4v에만 적용."""
    if src.suffix.lower() not in (".mp4", ".mov", ".m4v"):
        return False
    out = cache_dir / "faststart.mp4"
    cmd = [
        _ffmpeg(), "-y",
        "-i", str(src),
        "-c", "copy",
        "-movflags", "+faststart",
        str(out),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=600)
        return r.returncode == 0
    except Exception:
        return False


def _make_thumbnail_sprite(src: Path, cache_dir: Path, duration: float) -> bool:
    """6초 간격 프레임 타일 → sprite.jpg + sprite.vtt 생성."""
    INTERVAL  = 6
    THUMB_W   = 160
    THUMB_H   = 90
    COLS      = 10

    sprite_path = cache_dir / "sprite.jpg"
    vtt_path    = cache_dir / "sprite.vtt"

    # ffmpeg: 6초마다 프레임 추출 → 10열 타일로 합치기
    fps_expr = (
        f"select='not(mod(t\\,{INTERVAL}))',"
        f"scale={THUMB_W}:{THUMB_H},"
        f"tile={COLS}x1000"
    )
    cmd = [
        _ffmpeg(), "-y",
        "-i", str(src),
        "-vf", fps_expr,
        "-frames:v", "1",
        "-q:v", "5",
        str(sprite_path),
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=300)
        if r.returncode != 0:
            return False
    except Exception:
        return False

    # Python에서 VTT 생성
    n_frames = max(1, int(duration / INTERVAL) + 1)
    lines = ["WEBVTT", ""]
    for i in range(n_frames):
        t_start = i * INTERVAL
        t_end   = min(t_start + INTERVAL, duration)
        col = i % COLS
        row = i // COLS
        x   = col * THUMB_W
        y   = row * THUMB_H
        lines += [
            f"{_vtt_time(t_start)} --> {_vtt_time(t_end)}",
            f"sprite.jpg#xywh={x},{y},{THUMB_W},{THUMB_H}",
            "",
        ]
    vtt_path.write_text("\n".join(lines), encoding="utf-8")
    return True


def _vtt_time(s: float) -> str:
    s   = max(0.0, s)
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    ms  = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{sec:02d}.{ms:03d}"


def _build_master(cache_dir: Path, qualities: list[tuple[str, str, int, int]]) -> None:
    """master.m3u8 작성 (절대 URL은 view에서 주입 — 여기선 상대 경로 사용)."""
    _RES = {"1080p": (1920, 1080), "720p": (1280, 720), "480p": (854, 480), "360p": (640, 360)}
    lines = ["#EXTM3U"]
    for label, _, vbr, abr in qualities:
        w, h = _RES.get(label, (0, int(label.rstrip("p"))))
        bw = (vbr + abr) * 1000
        lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bw},RESOLUTION={w}x{h},NAME="{label}"')
        lines.append(f"{label}/playlist.m3u8")
    (cache_dir / "master.m3u8").write_text("\n".join(lines) + "\n", encoding="utf-8")
