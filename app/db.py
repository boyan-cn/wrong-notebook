import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any

from .config import ADMIN_PASSWORD, ADMIN_USERNAME, DB_PATH
from .security import hash_password

logger = logging.getLogger("wrong_notebook")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    grade TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    title TEXT NOT NULL,
    image_path TEXT,
    question_text TEXT NOT NULL DEFAULT '',
    answer_text TEXT NOT NULL DEFAULT '',
    knowledge_points TEXT NOT NULL DEFAULT '',
    error_reason TEXT NOT NULL DEFAULT '',
    solution TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    content TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    explanation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_user ON questions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(user_id, subject);
CREATE INDEX IF NOT EXISTS idx_exercises_question ON exercises(question_id, level);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    if "grade" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN grade TEXT NOT NULL DEFAULT ''")
        logger.info("已为 users 表补充 grade 字段")


def init_db() -> None:
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        _migrate(conn)
        row = conn.execute("SELECT id FROM users WHERE username = ?", (ADMIN_USERNAME,)).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO users (username, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (ADMIN_USERNAME, None, hash_password(ADMIN_PASSWORD), "admin", now_iso()),
            )
            logger.info("已初始化管理员账号：%s", ADMIN_USERNAME)


# ---------------------------------------------------------------------------
# 用户
# ---------------------------------------------------------------------------

def public_user(row: sqlite3.Row | dict) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "username": row["username"],
        "phone": row["phone"],
        "role": row["role"],
        "grade": row["grade"] if "grade" in keys else "",
        "created_at": row["created_at"],
    }


def get_user(user_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def find_user_by_account(account: str) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE username = ? OR phone = ? LIMIT 1",
            (account, account),
        ).fetchone()


def create_user(username: str, phone: str, password: str, grade: str) -> sqlite3.Row:
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO users (username, phone, password_hash, role, grade, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (username, phone, hash_password(password), "user", grade, now_iso()),
        )
        user_id = cursor.lastrowid
    return get_user(user_id)


def update_user_grade(user_id: int, grade: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE users SET grade = ? WHERE id = ?", (grade, user_id))


def update_user_password(user_id: int, new_password: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )


# ---------------------------------------------------------------------------
# AI 服务商
# ---------------------------------------------------------------------------

def list_providers() -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM api_providers ORDER BY is_default DESC, id ASC"
        ).fetchall()


def get_provider(provider_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute("SELECT * FROM api_providers WHERE id = ?", (provider_id,)).fetchone()


def get_default_provider() -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM api_providers ORDER BY is_default DESC, id ASC LIMIT 1"
        ).fetchone()


def create_provider(name: str, base_url: str, model: str, api_key: str, is_default: bool) -> sqlite3.Row:
    timestamp = now_iso()
    with connect() as conn:
        has_any = conn.execute("SELECT COUNT(*) AS c FROM api_providers").fetchone()["c"] > 0
        make_default = is_default or not has_any
        if make_default:
            conn.execute("UPDATE api_providers SET is_default = 0")
        cursor = conn.execute(
            "INSERT INTO api_providers (name, base_url, model, api_key, is_default, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, base_url, model, api_key, 1 if make_default else 0, timestamp, timestamp),
        )
        provider_id = cursor.lastrowid
    return get_provider(provider_id)


def update_provider(
    provider_id: int,
    name: str,
    base_url: str,
    model: str,
    api_key: str | None,
    is_default: bool,
) -> sqlite3.Row | None:
    with connect() as conn:
        existing = conn.execute("SELECT * FROM api_providers WHERE id = ?", (provider_id,)).fetchone()
        if existing is None:
            return None
        key_value = existing["api_key"] if not api_key else api_key
        if is_default:
            conn.execute("UPDATE api_providers SET is_default = 0")
        conn.execute(
            "UPDATE api_providers SET name = ?, base_url = ?, model = ?, api_key = ?,"
            " is_default = ?, updated_at = ? WHERE id = ?",
            (
                name,
                base_url,
                model,
                key_value,
                1 if is_default else existing["is_default"],
                now_iso(),
                provider_id,
            ),
        )
    return get_provider(provider_id)


def set_default_provider(provider_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        existing = conn.execute("SELECT id FROM api_providers WHERE id = ?", (provider_id,)).fetchone()
        if existing is None:
            return None
        conn.execute("UPDATE api_providers SET is_default = 0")
        conn.execute(
            "UPDATE api_providers SET is_default = 1, updated_at = ? WHERE id = ?",
            (now_iso(), provider_id),
        )
    return get_provider(provider_id)


def delete_provider(provider_id: int) -> bool:
    with connect() as conn:
        existing = conn.execute("SELECT * FROM api_providers WHERE id = ?", (provider_id,)).fetchone()
        if existing is None:
            return False
        conn.execute("DELETE FROM api_providers WHERE id = ?", (provider_id,))
        if existing["is_default"]:
            remaining = conn.execute("SELECT id FROM api_providers ORDER BY id ASC LIMIT 1").fetchone()
            if remaining:
                conn.execute("UPDATE api_providers SET is_default = 1 WHERE id = ?", (remaining["id"],))
    return True


# ---------------------------------------------------------------------------
# 错题
# ---------------------------------------------------------------------------

def create_question(user_id: int, data: dict) -> int:
    timestamp = now_iso()
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO questions (user_id, subject, title, image_path, question_text, answer_text,"
            " knowledge_points, error_reason, solution, status, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                data["subject"],
                data["title"],
                data.get("image_path") or None,
                data.get("question_text", ""),
                data.get("answer_text", ""),
                data.get("knowledge_points", ""),
                data.get("error_reason", ""),
                data.get("solution", ""),
                data.get("status", "todo"),
                timestamp,
                timestamp,
            ),
        )
        return cursor.lastrowid


def list_questions(
    user_id: int,
    subject: str = "",
    status: str = "",
    keyword: str = "",
    page: int = 1,
    page_size: int = 12,
) -> tuple[list[sqlite3.Row], int, dict]:
    where = ["user_id = ?"]
    params: list[Any] = [user_id]
    if subject:
        where.append("subject = ?")
        params.append(subject)
    if status:
        where.append("status = ?")
        params.append(status)
    if keyword:
        escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        where.append("(title LIKE ? ESCAPE '\\' OR question_text LIKE ? ESCAPE '\\'"
                     " OR knowledge_points LIKE ? ESCAPE '\\')")
        params.extend([like, like, like])

    where_sql = " AND ".join(where)
    offset = (page - 1) * page_size
    with connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM questions WHERE {where_sql}", params
        ).fetchone()["c"]
        rows = conn.execute(
            f"SELECT id, subject, title, image_path, knowledge_points, status, question_text, created_at"
            f" FROM questions WHERE {where_sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
        stats_row = conn.execute(
            "SELECT COUNT(*) AS total,"
            " COALESCE(SUM(status = 'todo'), 0) AS todo,"
            " COALESCE(SUM(status = 'mastered'), 0) AS mastered"
            " FROM questions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    stats = {
        "total": stats_row["total"],
        "todo": stats_row["todo"],
        "mastered": stats_row["mastered"],
    }
    return rows, total, stats


def get_question(question_id: int, user_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM questions WHERE id = ? AND user_id = ?",
            (question_id, user_id),
        ).fetchone()


def update_question(question_id: int, user_id: int, fields: dict) -> sqlite3.Row | None:
    if not fields:
        return get_question(question_id, user_id)
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values = [*fields.values(), now_iso(), question_id, user_id]
    with connect() as conn:
        conn.execute(
            f"UPDATE questions SET {assignments}, updated_at = ? WHERE id = ? AND user_id = ?",
            values,
        )
    return get_question(question_id, user_id)


def delete_question(question_id: int, user_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM questions WHERE id = ? AND user_id = ?",
            (question_id, user_id),
        ).fetchone()
        if row is not None:
            conn.execute(
                "DELETE FROM questions WHERE id = ? AND user_id = ?",
                (question_id, user_id),
            )
    return row


# ---------------------------------------------------------------------------
# 举一反三练习
# ---------------------------------------------------------------------------

def create_exercises(question_id: int, user_id: int, level: str, items: list[dict]) -> list[int]:
    timestamp = now_iso()
    ids: list[int] = []
    with connect() as conn:
        for item in items:
            cursor = conn.execute(
                "INSERT INTO exercises (question_id, user_id, level, content, answer, explanation, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    question_id,
                    user_id,
                    level,
                    item["content"],
                    item.get("answer", ""),
                    item.get("explanation", ""),
                    timestamp,
                ),
            )
            ids.append(cursor.lastrowid)
    return ids


def list_exercises(question_id: int, user_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT id, level, content, answer, explanation, created_at FROM exercises"
            " WHERE question_id = ? AND user_id = ? ORDER BY id ASC",
            (question_id, user_id),
        ).fetchall()
