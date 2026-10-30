from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import ai, db
from ..deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["管理员"])


class ProviderIn(BaseModel):
    name: str = Field(max_length=60)
    base_url: str = Field(max_length=300)
    model: str = Field(max_length=120)
    api_key: str = Field(max_length=500)
    is_default: bool = False


class ProviderUpdateIn(BaseModel):
    name: str = Field(max_length=60)
    base_url: str = Field(max_length=300)
    model: str = Field(max_length=120)
    api_key: str = Field(default="", max_length=500)


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "••••••"
    return f"{key[:4]}••••{key[-4:]}"


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "base_url": row["base_url"],
        "model": row["model"],
        "api_key_masked": _mask_key(row["api_key"]),
        "is_default": bool(row["is_default"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _validate_fields(name: str, base_url: str, model: str, api_key: str) -> tuple[str, str, str, str]:
    name = name.strip()
    base_url = base_url.strip().rstrip("/")
    model = model.strip()
    api_key = api_key.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请填写服务商名称")
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="BaseURL 需以 http:// 或 https:// 开头")
    if not model:
        raise HTTPException(status_code=400, detail="请填写模型名称")
    if not api_key:
        raise HTTPException(status_code=400, detail="请填写 API Key")
    return name, base_url, model, api_key


@router.get("/providers")
def list_providers(user: dict = Depends(require_admin)):
    return {"providers": [_serialize(row) for row in db.list_providers()]}


@router.post("/providers")
def create_provider(payload: ProviderIn, user: dict = Depends(require_admin)):
    name, base_url, model, api_key = _validate_fields(
        payload.name, payload.base_url, payload.model, payload.api_key
    )
    row = db.create_provider(name, base_url, model, api_key, payload.is_default)
    return {"provider": _serialize(row)}


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, payload: ProviderUpdateIn, user: dict = Depends(require_admin)):
    existing = db.get_provider(provider_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="AI 服务不存在")
    name, base_url, model, api_key = _validate_fields(
        payload.name,
        payload.base_url,
        payload.model,
        payload.api_key or existing["api_key"],
    )
    row = db.update_provider(
        provider_id,
        name,
        base_url,
        model,
        api_key if payload.api_key.strip() else None,
        bool(existing["is_default"]),
    )
    return {"provider": _serialize(row)}


@router.post("/providers/{provider_id}/default")
def make_default(provider_id: int, user: dict = Depends(require_admin)):
    row = db.set_default_provider(provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail="AI 服务不存在")
    return {"provider": _serialize(row)}


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: int, user: dict = Depends(require_admin)):
    row = db.get_provider(provider_id)
    if row is None:
        raise HTTPException(status_code=404, detail="AI 服务不存在")
    try:
        reply = await ai.test_provider(row)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"ok": True, "message": f"连接成功，模型返回：{reply}"}


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int, user: dict = Depends(require_admin)):
    if not db.delete_provider(provider_id):
        raise HTTPException(status_code=404, detail="AI 服务不存在")
    return {"ok": True}
