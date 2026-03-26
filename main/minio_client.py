"""MinIO (S3 호환) 클라이언트 래퍼."""
from typing import Optional

import boto3
from botocore.client import Config
from django.conf import settings


def _build_endpoint_url(endpoint: str, secure: bool) -> str:
    return f"{'https' if secure else 'http'}://{endpoint}"


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
        config=Config(signature_version="s3v4"),
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
    client = get_minio_client()
    client.delete_object(Bucket=settings.MINIO_BUCKET, Key=key)
