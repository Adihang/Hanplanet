import os
import uuid

from django.conf import settings


def sanitize_upload_segment(raw_value: str) -> str:
    value = "".join(
        char if char.isalnum() or char in "._-" else "_"
        for char in str(raw_value or "").strip()
    )
    return value.strip("._-")


def make_new_path(path_ext: str, dirname: str, new_filename: str) -> str:
    ext = path_ext.split(".")[-1]
    filename = "{}.{}".format(new_filename, ext)
    path = os.path.join(settings.MEDIA_ROOT, dirname)
    if not os.path.isdir(path):
        os.makedirs(path)

    return os.path.join(dirname, filename)


def build_user_upload_dir(username: str) -> str:
    safe_username = sanitize_upload_segment(username) or "anon"
    return os.path.join("uploads", safe_username)


def build_user_profile_upload_path(username: str, filename: str) -> str:
    safe_username = sanitize_upload_segment(username) or "anon"
    dirname = build_user_upload_dir(safe_username)
    ext = filename.split(".")[-1] if "." in str(filename or "") else ""
    image_name = safe_username if not ext else f"{safe_username}.{ext}"
    return os.path.join(dirname, image_name)


def build_user_folder_icon_dir(username: str) -> str:
    base_dir = build_user_upload_dir(username)
    return os.path.join(base_dir, "folder_icons")


def build_user_folder_icon_upload_path(username: str, folder_name: str, filename: str) -> str:
    safe_folder_name = sanitize_upload_segment(folder_name) or "folder"
    dirname = build_user_folder_icon_dir(username)
    ext = filename.split(".")[-1] if "." in str(filename or "") else ""
    icon_name = safe_folder_name if not ext else f"{safe_folder_name}.{ext}"
    return os.path.join(dirname, icon_name)


def build_model_field_upload_path(owner_key: str, model_name: str, field_name: str, filename: str) -> str:
    safe_owner_key = sanitize_upload_segment(owner_key) or "shared"
    safe_model_name = sanitize_upload_segment(model_name) or "model"
    safe_field_name = sanitize_upload_segment(field_name) or "file"
    ext = filename.split(".")[-1] if "." in str(filename or "") else ""
    generated_name = uuid.uuid4().hex
    stored_name = generated_name if not ext else f"{generated_name}.{ext}"
    return os.path.join("uploads", safe_owner_key, safe_model_name, safe_field_name, stored_name)
