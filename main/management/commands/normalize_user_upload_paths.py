from __future__ import annotations

import shutil
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from config.utils import (
    build_user_folder_icon_dir,
    build_user_profile_upload_path,
    sanitize_upload_segment,
)
from portfolio.models import PortfolioProject
from portfolio.models import PortfolioProfile


FOLDER_ICON_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}


class Command(BaseCommand):
    help = "Normalize profile images and HanDrive folder icons into username-based upload paths."

    def handle(self, *args, **options):
        media_root = Path(settings.MEDIA_ROOT)
        uploads_root = media_root / "uploads"
        uploads_root.mkdir(parents=True, exist_ok=True)

        profile_updates = self._migrate_profile_images(media_root)
        db_asset_updates = self._migrate_db_bound_assets(media_root)
        folder_icon_updates = self._migrate_folder_icons(media_root, uploads_root)

        self.stdout.write(
            self.style.SUCCESS(
                f"normalized uploads: profile_images={profile_updates} db_assets={db_asset_updates} folder_icons={folder_icon_updates}"
            )
        )

    def _migrate_profile_images(self, media_root: Path) -> int:
        updated = 0
        profiles = PortfolioProfile.objects.select_related("user").exclude(profile_img="")
        for profile in profiles:
            if not profile.profile_img:
                continue
            current_name = str(profile.profile_img.name or "").strip()
            if not current_name:
                continue
            current_path = Path(profile.profile_img.path)
            if not current_path.exists() or not current_path.is_file():
                continue

            target_relative = build_user_profile_upload_path(profile.user.username, current_path.name)
            target_path = media_root / target_relative
            target_path.parent.mkdir(parents=True, exist_ok=True)

            if current_path.resolve() != target_path.resolve():
                if target_path.exists():
                    target_path.unlink()
                shutil.move(str(current_path), str(target_path))
                self._cleanup_empty_parents(current_path.parent, uploads_root=media_root / "uploads")

            if current_name != target_relative:
                profile.profile_img.name = target_relative
                profile.save(update_fields=["profile_img"])
            updated += 1
        return updated

    def _migrate_db_bound_assets(self, media_root: Path) -> int:
        updated = 0
        for instance in PortfolioProject.objects.select_related("user").all():
            file_field = getattr(instance, "banner_img", None)
            if not file_field:
                continue
            current_name = str(file_field.name or "").strip()
            if not current_name:
                continue
            current_path = Path(file_field.path)
            if not current_path.exists() or not current_path.is_file():
                continue

            owner_key = sanitize_upload_segment(getattr(getattr(instance, "user", None), "username", "")) or "anon"
            ext = current_path.suffix.lower()
            target_relative = f"uploads/{owner_key}/portfolioproject/banner_img/{current_path.stem}{ext}"
            target_path = media_root / target_relative
            if target_path.exists() and target_path.resolve() != current_path.resolve():
                target_relative = f"uploads/{owner_key}/portfolioproject/banner_img/{current_path.stem}_{instance.pk}{ext}"
                target_path = media_root / target_relative
            target_path.parent.mkdir(parents=True, exist_ok=True)

            if current_path.resolve() != target_path.resolve():
                if target_path.exists():
                    target_path.unlink()
                shutil.move(str(current_path), str(target_path))
                self._cleanup_empty_parents(current_path.parent, uploads_root=media_root / "uploads")

            if current_name != target_relative:
                instance.banner_img.name = target_relative
                instance.save(update_fields=["banner_img"])
            updated += 1
        return updated

    def _migrate_folder_icons(self, media_root: Path, uploads_root: Path) -> int:
        updated = 0
        User = get_user_model()
        for user in User.objects.only("id", "username"):
            owner_key = sanitize_upload_segment(user.username) or "anon"
            target_dir = media_root / build_user_folder_icon_dir(owner_key)
            target_dir.mkdir(parents=True, exist_ok=True)

            username_dir = uploads_root / owner_key
            legacy_id_dir = uploads_root / str(user.id)
            candidate_dirs = []
            for candidate_dir in [username_dir, legacy_id_dir]:
                if candidate_dir.exists() and candidate_dir.is_dir():
                    candidate_dirs.append(candidate_dir)

            for candidate_dir in candidate_dirs:
                for item in candidate_dir.iterdir():
                    if not item.is_file():
                        continue
                    suffix = item.suffix.lower()
                    if suffix not in FOLDER_ICON_EXTENSIONS:
                        continue
                    if candidate_dir == username_dir and item.stem == owner_key:
                        continue
                    folder_stem = sanitize_upload_segment(item.stem) or "folder"
                    target_path = target_dir / f"{folder_stem}{suffix}"
                    if item.resolve() == target_path.resolve():
                        continue
                    if target_path.exists():
                        target_path.unlink()
                    shutil.move(str(item), str(target_path))
                    updated += 1
                self._cleanup_empty_parents(candidate_dir, uploads_root=uploads_root)
        return updated

    def _cleanup_empty_parents(self, start_dir: Path, uploads_root: Path) -> None:
        current = start_dir
        while current != uploads_root and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent
