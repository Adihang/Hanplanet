"""
Git Repository 서비스 계층

핵심 원칙:
  - Git 저장소 여부는 .git 폴더가 아니라 DB 기준으로 판단
  - 실제 Git 작업은 반드시 Celery Worker로 위임
"""
import re

from git.models import GitRepository


_VALID_REPO_NAME = re.compile(r'^[a-zA-Z0-9._-]+$')


def _validate_repo_name(repo_name: str) -> None:
    if not repo_name or not _VALID_REPO_NAME.match(repo_name):
        raise ValueError("repo_name은 영문자, 숫자, ., -, _ 만 허용됩니다.")
    if len(repo_name) > 255:
        raise ValueError("repo_name은 255자를 초과할 수 없습니다.")


class GitRepositoryService:

    def exists(self, path: str) -> bool:
        """handrive_path 기준으로 저장소 존재 여부 판단 (.git 여부 무관)"""
        return GitRepository.objects.filter(handrive_path=path).exists()

    def create_repo(self, user, path: str, repo_name: str) -> GitRepository:
        """일반 폴더 → Forgejo Git repo 생성 (Worker 비동기)"""
        from .git_tasks import create_repo_task

        _validate_repo_name(repo_name)

        repo = GitRepository.objects.create(
            owner=user,
            repo_name=repo_name,
            handrive_path=path,
            status="pending_create",
        )
        create_repo_task.delay(repo.id)
        return repo

    def import_repo(self, user, path: str, repo_name: str) -> GitRepository:
        """기존 .git 폴더 → Forgejo mirror push 후 .git 제거 (Worker 비동기)"""
        from .git_tasks import import_repo_task

        _validate_repo_name(repo_name)

        repo = GitRepository.objects.create(
            owner=user,
            repo_name=repo_name,
            handrive_path=path,
            status="pending_import",
        )
        import_repo_task.delay(repo.id)
        return repo
