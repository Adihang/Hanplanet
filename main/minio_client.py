"""MinIO (S3 호환) 클라이언트 래퍼."""
import logging
import time
from pathlib import Path
from typing import Optional

import boto3
from botocore.client import Config
from django.conf import settings

logger = logging.getLogger(__name__)
_MINIO_DISABLED_UNTIL = 0.0
_MINIO_DISABLE_SECONDS = 60.0


def _build_endpoint_url(endpoint: str, secure: bool) -> str:
    return f"{'https' if secure else 'http'}://{endpoint}"


def _local_blob_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "_sync_blobs"


def _local_blob_path(key: str) -> Path:
    safe_parts = [part for part in str(key).replace("\\", "/").split("/") if part not in {"", ".", ".."}]
    return _local_blob_root().joinpath(*safe_parts)


def _minio_temporarily_disabled() -> bool:
    return _MINIO_DISABLED_UNTIL > time.monotonic()


def _disable_minio_temporarily() -> None:
    global _MINIO_DISABLED_UNTIL
    _MINIO_DISABLED_UNTIL = time.monotonic() + _MINIO_DISABLE_SECONDS


def get_minio_client(*, endpoint: Optional[str] = None, secure: Optional[bool] = None):
    """boto3 S3 클라이언트 반환 (MinIO 엔드포인트 설정 포함)."""
    resolved_endpoint = endpoint or settings.MINIO_ENDPOINT
    resolved_secure = settings.MINIO_SECURE if secure is None else secure
    endpoint_url = _build_endpoint_url(resolved_endpoint, resolved_secure)
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4", retries={"max_attempts": 0}),
        region_name="us-east-1",
    )


def ensure_bucket_exists():
    """버킷이 없으면 생성."""
    client = get_minio_client()
    bucket = settings.MINIO_BUCKET
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        client.create_bucket(Bucket=bucket)


def generate_presigned_upload_url(key: str, expires: int = 3600) -> str:
    """업로드용 presigned PUT URL 반환.

    Args:
        key: MinIO 오브젝트 키 (형식: "{user_id}/{file_id}")
        expires: URL 유효 시간 (초)
    """
    # 서버 내부 MinIO와 외부 클라이언트 접근 주소를 분리할 수 있도록
    # presigned URL은 public endpoint 기준으로 생성한다.
    client = get_minio_client(
        endpoint=settings.MINIO_PUBLIC_ENDPOINT,
        secure=settings.MINIO_PUBLIC_SECURE,
    )
    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.MINIO_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def generate_presigned_download_url(key: str, expires: int = 3600) -> str:
    """다운로드용 presigned GET URL 반환.

    Args:
        key: MinIO 오브젝트 키 (형식: "{user_id}/{file_id}")
        expires: URL 유효 시간 (초)
    """
    client = get_minio_client(
        endpoint=settings.MINIO_PUBLIC_ENDPOINT,
        secure=settings.MINIO_PUBLIC_SECURE,
    )
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.MINIO_BUCKET, "Key": key},
        ExpiresIn=expires,
    )


def delete_object(key: str) -> None:
    """MinIO 오브젝트 삭제.

    Args:
        key: MinIO 오브젝트 키 (형식: "{user_id}/{file_id}")
    """
    local_path = _local_blob_path(key)
    try:
        if _minio_temporarily_disabled():
            raise RuntimeError("minio temporarily disabled after recent connection failure")
        client = get_minio_client()
        client.delete_object(Bucket=settings.MINIO_BUCKET, Key=key)
    except Exception:
        _disable_minio_temporarily()
        if local_path.exists():
            local_path.unlink()
        logger.warning("[sync-storage] delete fallback key=%s backend=local", key, exc_info=True)
        return
    if local_path.exists():
        local_path.unlink()


def put_object_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """서버 내부 MinIO에 바이트를 직접 업로드."""
    local_path = _local_blob_path(key)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(data)
    try:
        if _minio_temporarily_disabled():
            raise RuntimeError("minio temporarily disabled after recent connection failure")
        client = get_minio_client()
        client.put_object(
            Bucket=settings.MINIO_BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except Exception:
        _disable_minio_temporarily()
        logger.warning("[sync-storage] put fallback key=%s bytes=%s backend=local", key, len(data), exc_info=True)


def get_object_bytes(key: str) -> bytes:
    """서버 내부 MinIO에서 바이트를 직접 읽는다."""
    local_path = _local_blob_path(key)
    try:
        if _minio_temporarily_disabled():
            raise RuntimeError("minio temporarily disabled after recent connection failure")
        client = get_minio_client()
        response = client.get_object(Bucket=settings.MINIO_BUCKET, Key=key)
        try:
            return response["Body"].read()
        finally:
            response["Body"].close()
    except Exception:
        _disable_minio_temporarily()
        if local_path.exists():
            logger.warning("[sync-storage] get fallback key=%s backend=local", key, exc_info=True)
            return local_path.read_bytes()
        raise
