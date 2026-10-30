import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..config import GRADES
from ..deps import get_current_user
from ..security import create_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["认证"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$")
PHONE_RE = re.compile(r"^1[3-9]\d{9}$")


class RegisterIn(BaseModel):
    username: str = Field(max_length=40)
    phone: str = Field(max_length=20)
    password: str = Field(max_length=64)
    grade: str = Field(max_length=20)


class LoginIn(BaseModel):
    account: str = Field(max_length=40)
    password: str = Field(max_length=64)


class PasswordIn(BaseModel):
    old_password: str = Field(max_length=64)
    new_password: str = Field(max_length=64)


class GradeIn(BaseModel):
    grade: str = Field(max_length=20)


def _check_grade(grade: str) -> str:
    grade = grade.strip()
    if grade not in GRADES:
        raise HTTPException(status_code=400, detail="请选择正确的年级")
    return grade


def _auth_response(user) -> dict:
    public = db.public_user(user)
    return {"token": create_token(public["id"], public["role"]), "user": public}


@router.post("/register")
def register(payload: RegisterIn):
    username = payload.username.strip()
    phone = payload.phone.strip()
    password = payload.password
    grade = _check_grade(payload.grade)

    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="用户名需为 2-20 位中文、字母、数字或下划线")
    if not PHONE_RE.fullmatch(phone):
        raise HTTPException(status_code=400, detail="请输入正确的 11 位手机号")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少需要 6 位")

    with db.connect() as conn:
        if conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
            raise HTTPException(status_code=409, detail="该用户名已被注册")
        if conn.execute("SELECT id FROM users WHERE phone = ?", (phone,)).fetchone():
            raise HTTPException(status_code=409, detail="该手机号已被注册")
    try:
        user = db.create_user(username, phone, password, grade)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="用户名或手机号已被注册")
    return _auth_response(user)


@router.post("/login")
def login(payload: LoginIn):
    account = payload.account.strip()
    if not account:
        raise HTTPException(status_code=400, detail="请输入用户名或手机号")
    user = db.find_user_by_account(account)
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    return _auth_response(user)


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": user}


@router.put("/grade")
def update_grade(payload: GradeIn, user: dict = Depends(get_current_user)):
    grade = _check_grade(payload.grade)
    db.update_user_grade(user["id"], grade)
    row = db.get_user(user["id"])
    return {"user": db.public_user(row)}


@router.put("/password")
def change_password(payload: PasswordIn, user: dict = Depends(get_current_user)):
    row = db.get_user(user["id"])
    if row is None or not verify_password(payload.old_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少需要 6 位")
    db.update_user_password(user["id"], payload.new_password)
    return {"ok": True}
