"""
Forgejo API 클라이언트

설정:
  settings.FORGEJO_BASE_URL    — Forgejo 서버 내부 URL (예: http://localhost:3000)
  settings.FORGEJO_ADMIN_TOKEN — Forgejo 관리자 API 토큰
"""
import base64
import secrets
import requests
from urllib.parse import urlparse, urlunparse
from django.conf import settings


class ForgejoClient:

    @property
    def _base_url(self) -> str:
        return str(getattr(settings, "FORGEJO_BASE_URL", "http://localhost:3000")).rstrip("/")

    @property
    def _token(self) -> str:
        return str(getattr(settings, "FORGEJO_ADMIN_TOKEN", ""))

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"token {self._token}"}

    # ──────────────────────────────────────────
    # User
    # ──────────────────────────────────────────

    def ensure_user(self, username: str, email: str = "") -> dict:
        """Gitea 계정이 없으면 admin API로 자동 생성, 있으면 그대로 반환."""
        resp = requests.get(
            f"{self._base_url}/api/v1/users/{username}",
            headers=self._headers,
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()

        local_email = f"{username}@hanplanet.local"
        create_email = email if email else local_email
        resp = requests.post(
            f"{self._base_url}/api/v1/admin/users",
            headers=self._headers,
            json={
                "username":             username,
                "email":                create_email,
                "password":             secrets.token_urlsafe(24),
                "must_change_password": False,
                "source_id":            0,
                "login_name":           username,
                "send_notify":          False,
            },
            timeout=15,
        )
        # 이메일 충돌(422)인 경우 로컬 placeholder 이메일로 재시도
        if resp.status_code == 422 and create_email != local_email:
            resp = requests.post(
                f"{self._base_url}/api/v1/admin/users",
                headers=self._headers,
                json={
                    "username":             username,
                    "email":                local_email,
                    "password":             secrets.token_urlsafe(24),
                    "must_change_password": False,
                    "source_id":            0,
                    "login_name":           username,
                    "send_notify":          False,
                },
                timeout=15,
            )
        if not resp.ok:
            raise requests.HTTPError(
                f"Failed to create Forgejo user {username!r}: {resp.status_code} {resp.text[:200]}",
                response=resp,
            )
        return resp.json()

    def _basic_auth_headers(self, username: str, password: str) -> dict:
        cred = base64.b64encode(f"{username}:{password}".encode()).decode()
        return {"Authorization": f"Basic {cred}"}

    def _set_user_password(self, username: str, password: str) -> None:
        """admin API로 유저 비밀번호 변경 — 토큰 발급을 위한 임시 BasicAuth 준비"""
        resp = requests.patch(
            f"{self._base_url}/api/v1/admin/users/{username}",
            headers=self._headers,
            json={
                "source_id":            0,
                "login_name":           username,
                "password":             password,
                "must_change_password": False,
            },
            timeout=15,
        )
        resp.raise_for_status()

    def ensure_user_with_token(self, username: str, email: str = "") -> tuple:
        """Gitea 계정 생성(없을 때만) + 개인 액세스 토큰 발급.
        Django 유저가 git CLI에서 username:token 으로 인증할 수 있게 함.

        /api/v1/users/{username}/tokens 는 BasicAuth 전용이므로:
        1. admin API로 유저 비밀번호를 임시 랜덤값으로 설정
        2. BasicAuth로 토큰 발급
        (유저는 Gitea에 직접 로그인하지 않고 토큰으로만 git 인증)

        Returns:
            (gitea_user_dict, token_str)
        """
        gitea_user = self.ensure_user(username, email)

        # 임시 비밀번호 설정 → BasicAuth 사용 가능하게
        temp_pw = secrets.token_urlsafe(24)
        self._set_user_password(username, temp_pw)

        basic = self._basic_auth_headers(username, temp_pw)
        tokens_url = f"{self._base_url}/api/v1/users/{username}/tokens"

        # 기존 'hanplanet' 토큰 삭제
        resp = requests.get(tokens_url, headers=basic, timeout=15)
        if resp.status_code == 200:
            for tok in resp.json():
                if tok.get("name") == "hanplanet":
                    requests.delete(
                        f"{tokens_url}/{tok['id']}",
                        headers=basic,
                        timeout=15,
                    )

        # 새 토큰 발급 (Gitea 1.19+ 는 scopes 필수)
        resp = requests.post(
            tokens_url,
            headers={**basic, "Content-Type": "application/json"},
            json={
                "name":   "hanplanet",
                "scopes": [
                    "write:repository", "read:repository",
                    "read:user", "write:user",   # write:user — 아바타 업데이트에 필요
                ],
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_value = resp.json().get("sha1") or resp.json().get("token", "")
        return gitea_user, token_value

    def update_user_avatar(self, forgejo_token: str, image_bytes: bytes) -> None:
        """유저 본인 토큰으로 아바타 업데이트 (write:user 스코프 필요).
        image_bytes: PNG 또는 JPEG 바이너리.
        """
        b64 = base64.b64encode(image_bytes).decode()
        resp = requests.post(
            f"{self._base_url}/api/v1/user/avatar",
            headers={"Authorization": f"token {forgejo_token}", "Content-Type": "application/json"},
            json={"image": b64},
            timeout=30,
        )
        resp.raise_for_status()

    def internal_authed_clone_url(self, owner: str, repo_name: str) -> str:
        """서버 내부 git 작업용 인증 URL — FORGEJO_BASE_URL(localhost) 기반.
        Gitea API clone_url은 공개 도메인을 반환하므로 내부 작업에 사용 불가.
        """
        parsed = urlparse(self._base_url)
        netloc = f"admin:{self._token}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urlunparse(parsed._replace(netloc=netloc, path=f"/{owner}/{repo_name}.git"))

    def user_authed_clone_url(self, clone_url: str, username: str, token: str) -> str:
        """공개 clone_url에 유저 토큰을 삽입 — 유저가 git CLI에서 사용할 URL"""
        parsed = urlparse(clone_url)
        netloc = f"{username}:{token}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urlunparse(parsed._replace(netloc=netloc))

    # ──────────────────────────────────────────
    # Repository
    # ──────────────────────────────────────────

    def create_repo(self, username: str, repo_name: str) -> dict:
        """Django 유저 소유의 private 저장소 생성.
        유저 계정 준비는 호출 전에 ensure_user / ensure_user_with_token 으로 처리.
        """
        url = f"{self._base_url}/api/v1/admin/users/{username}/repos"
        resp = requests.post(
            url,
            headers=self._headers,
            json={
                "name":      repo_name,
                "private":   True,
                "auto_init": False,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def get_repo(self, owner: str, repo_name: str) -> dict:
        """저장소 조회 — create 실패 시 fallback"""
        url = f"{self._base_url}/api/v1/repos/{owner}/{repo_name}"
        resp = requests.get(url, headers=self._headers, timeout=15)
        resp.raise_for_status()
        return resp.json()

    def delete_repo(self, owner: str, repo_name: str) -> None:
        """저장소 삭제"""
        url = f"{self._base_url}/api/v1/repos/{owner}/{repo_name}"
        resp = requests.delete(url, headers=self._headers, timeout=15)
        if resp.status_code not in (204, 404):
            resp.raise_for_status()

    # ──────────────────────────────────────────
    # Collaborators
    # ──────────────────────────────────────────

    def add_collaborator(self, owner: str, repo_name: str, username: str, permission: str) -> None:
        """협업자 추가 (permission: read / write / admin)"""
        url = f"{self._base_url}/api/v1/repos/{owner}/{repo_name}/collaborators/{username}"
        resp = requests.put(
            url,
            headers=self._headers,
            json={"permission": permission},
            timeout=15,
        )
        resp.raise_for_status()

    def remove_collaborator(self, owner: str, repo_name: str, username: str) -> None:
        """협업자 제거"""
        url = f"{self._base_url}/api/v1/repos/{owner}/{repo_name}/collaborators/{username}"
        resp = requests.delete(url, headers=self._headers, timeout=15)
        if resp.status_code not in (204, 404):
            resp.raise_for_status()

    def list_collaborators(self, owner: str, repo_name: str) -> list[dict]:
        """협업자 목록 조회"""
        url = f"{self._base_url}/api/v1/repos/{owner}/{repo_name}/collaborators"
        resp = requests.get(url, headers=self._headers, timeout=15)
        resp.raise_for_status()
        return resp.json()

    def get_collaborator_permission(self, owner: str, repo_name: str, username: str) -> str:
        """협업자 권한 조회"""
        url = f"{self._base_url}/api/v1/repos/{owner}/{repo_name}/collaborators/{username}/permission"
        resp = requests.get(url, headers=self._headers, timeout=15)
        resp.raise_for_status()
        payload = resp.json() or {}
        return str(payload.get("permission") or payload.get("role_name") or "read").strip().lower()
