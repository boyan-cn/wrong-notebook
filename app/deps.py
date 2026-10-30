from fastapi import Depends, Header, HTTPException

from . import db
from .security import decode_token


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="登录状态已失效，请重新登录")
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="登录状态无效，请重新登录")
    user = db.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在，请重新登录")
    return db.public_user(user)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可以执行此操作")
    return user
