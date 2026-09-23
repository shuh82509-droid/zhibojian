"""Lightweight WIS central-auth surface for dependent workbenches.

This process deliberately does not serve the video-center FastAPI app, so the
video scanning, cover generation, delivery, and metrics background loops are not
started.  It reuses the same live OA verification and permission database.
"""

from fastapi import Depends, FastAPI

from .auth import _organization_from_user, require_user
from .main import module_access_for_user, user_permissions


app = FastAPI(title="WIS Central Auth Sidecar", version="1.0.0")


@app.get("/api/live")
def live() -> dict:
    return {"ok": True, "service": "wis-central-auth"}


@app.get("/api/central-auth/me")
def central_auth_me(user: dict = Depends(require_user)) -> dict:
    department, center = _organization_from_user(user)

    def first_text(*fields: str) -> str:
        for field in fields:
            value = user.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def avatar_url() -> str:
        for field in (
            "avatarUrl",
            "avatar_url",
            "headImg",
            "head_img",
            "photo",
            "photoUrl",
            "profilePhotoUrl",
            "picture",
        ):
            value = user.get(field)
            if isinstance(value, str) and value.strip().startswith("https://"):
                return value.strip()
        avatar = user.get("avatar")
        if isinstance(avatar, str) and avatar.strip().startswith("https://"):
            return avatar.strip()
        if isinstance(avatar, dict):
            for field in ("avatar_origin", "avatar_640", "avatar_240", "avatar_72", "url"):
                value = avatar.get(field)
                if isinstance(value, str) and value.strip().startswith("https://"):
                    return value.strip()
        return ""

    safe_user = {
        field: user.get(field)
        for field in (
            "number",
            "userId",
            "id",
            "realName",
            "name",
            "groupName",
            "parentDept",
            "deptName",
            "status",
        )
        if user.get(field) is not None
    }
    safe_user["department"] = department
    safe_user["center"] = center
    safe_user["jobTitle"] = first_text(
        "jobTitle",
        "job_title",
        "positionName",
        "position_name",
        "position",
        "postName",
        "post_name",
        "jobName",
        "title",
    )
    safe_user["avatarUrl"] = avatar_url()
    return {
        "user": safe_user,
        "permissions": user_permissions(user),
        "access": module_access_for_user(user),
    }
