import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data"))).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
WEB_DIR = BASE_DIR / "web"
DB_PATH = DATA_DIR / "app.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _load_secret() -> str:
    env_secret = os.environ.get("APP_SECRET", "").strip()
    if env_secret:
        return env_secret
    secret_file = DATA_DIR / "secret.key"
    if secret_file.is_file():
        saved = secret_file.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    generated = secrets.token_urlsafe(48)
    secret_file.write_text(generated, encoding="utf-8")
    return generated


SECRET_KEY = _load_secret()
TOKEN_DAYS = int(os.environ.get("TOKEN_DAYS", "30"))
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "12")) * 1024 * 1024

SUBJECTS = [
    "语文",
    "数学",
    "英语",
    "物理",
    "化学",
    "生物",
    "政治",
    "历史",
    "地理",
    "科学",
    "其他",
]

GRADES = [
    "小学一年级",
    "小学二年级",
    "小学三年级",
    "小学四年级",
    "小学五年级",
    "小学六年级",
    "初中一年级",
    "初中二年级",
    "初中三年级",
    "高中一年级",
    "高中二年级",
    "高中三年级",
]
