import base64
import re
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from .. import ai, db
from ..config import GRADES, MAX_UPLOAD_BYTES, SUBJECTS, UPLOAD_DIR
from ..deps import get_current_user

router = APIRouter(prefix="/api", tags=["错题"])

MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
IMAGE_NAME_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$")


class AnalyzeIn(BaseModel):
    image_path: str = Field(max_length=200)
    subject: str = Field(default="", max_length=20)


class QuestionIn(BaseModel):
    subject: str = Field(max_length=20)
    title: str = Field(default="", max_length=120)
    image_path: str = Field(default="", max_length=200)
    question_text: str = Field(default="", max_length=20000)
    answer_text: str = Field(default="", max_length=10000)
    knowledge_points: str = Field(default="", max_length=2000)
    error_reason: str = Field(default="", max_length=4000)
    solution: str = Field(default="", max_length=20000)


class QuestionPatch(BaseModel):
    subject: str | None = Field(default=None, max_length=20)
    title: str | None = Field(default=None, max_length=120)
    question_text: str | None = Field(default=None, max_length=20000)
    answer_text: str | None = Field(default=None, max_length=10000)
    knowledge_points: str | None = Field(default=None, max_length=2000)
    error_reason: str | None = Field(default=None, max_length=4000)
    solution: str | None = Field(default=None, max_length=20000)
    status: Literal["todo", "mastered"] | None = None


class ExerciseIn(BaseModel):
    level: Literal["easy", "medium", "hard"]


class ConsultMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ConsultIn(BaseModel):
    subject: str = Field(default="", max_length=20)
    question_text: str = Field(default="", max_length=20000)
    answer_text: str = Field(default="", max_length=10000)
    knowledge_points: str = Field(default="", max_length=2000)
    error_reason: str = Field(default="", max_length=4000)
    solution: str = Field(default="", max_length=20000)
    messages: list[ConsultMessage] = Field(min_length=1, max_length=20)


class AskIn(BaseModel):
    subject: str = Field(default="", max_length=20)
    image_path: str = Field(default="", max_length=200)
    messages: list[ConsultMessage] = Field(min_length=1, max_length=20)


def _provider_or_error():
    provider = db.get_default_provider()
    if provider is None:
        raise HTTPException(
            status_code=409,
            detail="管理员尚未配置 AI 服务，请先登录管理员账号完成设置",
        )
    return provider


def _resolve_owned_image(user_id: int, image_path: str) -> Path:
    prefix = f"/uploads/{user_id}/"
    if not image_path.startswith(prefix):
        raise HTTPException(status_code=400, detail="图片路径无效，请重新上传")
    name = image_path[len(prefix):]
    if not IMAGE_NAME_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail="图片路径无效，请重新上传")
    path = UPLOAD_DIR / str(user_id) / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="图片不存在，请重新上传")
    return path


def _image_data_url(user_id: int, image_path: str) -> str:
    path = _resolve_owned_image(user_id, image_path)
    mime = MIME_BY_EXT.get(path.suffix.lower())
    if mime is None:
        raise HTTPException(status_code=400, detail="图片格式不支持")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _delete_image(user_id: int, image_path: str | None) -> None:
    if not image_path:
        return
    try:
        path = _resolve_owned_image(user_id, image_path)
    except HTTPException:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _question_dict(row) -> dict:
    return {key: row[key] for key in row.keys()}


def _exercise_dict(row) -> dict:
    return {key: row[key] for key in row.keys()}


@router.get("/subjects")
def subjects(user: dict = Depends(get_current_user)):
    return {"subjects": SUBJECTS, "grades": GRADES}


@router.post("/uploads")
async def upload_image(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    ext = MIME_EXT.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status_code=400, detail="仅支持 JPG、PNG、WEBP 格式的图片")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=400, detail="上传的图片为空")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="图片过大，请压缩后重试")
    target_dir = UPLOAD_DIR / str(user["id"])
    target_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (target_dir / name).write_bytes(raw)
    return {"path": f"/uploads/{user['id']}/{name}"}


@router.post("/questions/analyze")
async def analyze(payload: AnalyzeIn, user: dict = Depends(get_current_user)):
    provider = _provider_or_error()
    data_url = _image_data_url(user["id"], payload.image_path)
    try:
        result = await ai.analyze_question(provider, payload.subject.strip(), user.get("grade", ""), data_url)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return result


@router.get("/questions")
def list_questions(
    subject: str = Query(default="", max_length=20),
    status: str = Query(default="", max_length=20),
    q: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    if status and status not in {"todo", "mastered"}:
        raise HTTPException(status_code=400, detail="状态筛选值不正确")
    rows, total, stats = db.list_questions(
        user["id"], subject.strip(), status, q.strip(), page, page_size
    )
    items = []
    for row in rows:
        text = row["question_text"] or ""
        items.append(
            {
                "id": row["id"],
                "subject": row["subject"],
                "title": row["title"],
                "image_path": row["image_path"],
                "knowledge_points": row["knowledge_points"],
                "status": row["status"],
                "created_at": row["created_at"],
                "excerpt": text[:110] + ("…" if len(text) > 110 else ""),
            }
        )
    return {"items": items, "total": total, "page": page, "page_size": page_size, "stats": stats}


@router.post("/questions/consult")
async def consult(payload: ConsultIn, user: dict = Depends(get_current_user)):
    messages = [
        {"role": item.role, "content": item.content.strip()}
        for item in payload.messages
        if item.content.strip()
    ]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="请输入你的疑问")
    provider = _provider_or_error()
    context = {
        "subject": payload.subject.strip(),
        "question_text": payload.question_text,
        "answer_text": payload.answer_text,
        "knowledge_points": payload.knowledge_points,
        "error_reason": payload.error_reason,
        "solution": payload.solution,
    }
    try:
        return await ai.consult_expert(provider, context, user.get("grade", ""), messages)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/ai/ask")
async def ask(payload: AskIn, user: dict = Depends(get_current_user)):
    messages = [
        {"role": item.role, "content": item.content.strip()}
        for item in payload.messages
        if item.content.strip()
    ]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="请输入你的问题")
    provider = _provider_or_error()
    image_data_url = _image_data_url(user["id"], payload.image_path) if payload.image_path else None
    try:
        reply = await ai.ask_expert(
            provider,
            user.get("grade", ""),
            payload.subject,
            messages,
            image_data_url=image_data_url,
        )
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"reply": reply}


@router.get("/questions/{question_id}")
def get_question(question_id: int, user: dict = Depends(get_current_user)):
    row = db.get_question(question_id, user["id"])
    if row is None:
        raise HTTPException(status_code=404, detail="错题不存在")
    exercises = db.list_exercises(question_id, user["id"])
    return {
        "question": _question_dict(row),
        "exercises": [_exercise_dict(item) for item in exercises],
    }


@router.post("/questions")
def create_question(payload: QuestionIn, user: dict = Depends(get_current_user)):
    subject = payload.subject.strip()
    if subject not in SUBJECTS:
        raise HTTPException(status_code=400, detail="请选择正确的科目")
    image_path = payload.image_path.strip()
    if image_path:
        _resolve_owned_image(user["id"], image_path)
    question_text = payload.question_text.strip()
    title = payload.title.strip()
    if not title:
        title = re.sub(r"\s+", " ", question_text)[:30] or (f"{subject}错题" if image_path else "未命名错题")
    question_id = db.create_question(
        user["id"],
        {
            "subject": subject,
            "title": title,
            "image_path": image_path,
            "question_text": question_text,
            "answer_text": payload.answer_text.strip(),
            "knowledge_points": payload.knowledge_points.strip(),
            "error_reason": payload.error_reason.strip(),
            "solution": payload.solution.strip(),
        },
    )
    row = db.get_question(question_id, user["id"])
    return {"question": _question_dict(row)}


@router.patch("/questions/{question_id}")
def update_question(question_id: int, payload: QuestionPatch, user: dict = Depends(get_current_user)):
    if db.get_question(question_id, user["id"]) is None:
        raise HTTPException(status_code=404, detail="错题不存在")
    fields = payload.model_dump(exclude_unset=True)
    for key, value in list(fields.items()):
        if isinstance(value, str):
            value = value.strip()
            fields[key] = value
        if key == "subject" and value not in SUBJECTS:
            raise HTTPException(status_code=400, detail="请选择正确的科目")
        if key == "title" and not value:
            fields.pop(key)
            continue
        if value is None:
            fields.pop(key)
    if fields.get("title"):
        fields["title"] = fields["title"][:120]
    row = db.update_question(question_id, user["id"], fields)
    return {"question": _question_dict(row)}


@router.delete("/questions/{question_id}")
def delete_question(question_id: int, user: dict = Depends(get_current_user)):
    row = db.delete_question(question_id, user["id"])
    if row is None:
        raise HTTPException(status_code=404, detail="错题不存在")
    _delete_image(user["id"], row["image_path"])
    return {"ok": True}


@router.post("/questions/{question_id}/exercises")
async def generate_exercises(question_id: int, payload: ExerciseIn, user: dict = Depends(get_current_user)):
    question = db.get_question(question_id, user["id"])
    if question is None:
        raise HTTPException(status_code=404, detail="错题不存在")
    if not question["question_text"] and not question["solution"] and not question["knowledge_points"]:
        raise HTTPException(status_code=400, detail="这道错题还没有分析内容，请先补充题目或知识点")
    provider = _provider_or_error()
    try:
        items = await ai.generate_exercises(provider, question, payload.level, user.get("grade", ""), count=3)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    ids = db.create_exercises(question_id, user["id"], payload.level, items)
    rows = db.list_exercises(question_id, user["id"])
    created = [_exercise_dict(row) for row in rows if row["id"] in set(ids)]
    return {"exercises": created}
