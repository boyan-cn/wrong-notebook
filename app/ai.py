import json
import logging
import re
import sqlite3

import httpx

from .config import SUBJECTS

logger = logging.getLogger("wrong_notebook.ai")

LEVEL_NAMES = {
    "easy": "简单（基础巩固）",
    "medium": "适中（常规提高）",
    "hard": "困难（综合拔高）",
}

ANALYZE_PROMPT = """你是一位经验丰富、耐心细致的中小学老师，擅长分析学生的错题。请用中文完成下面的错题分析。

学生情况：{grade_note}

要求：
1. question_text：完整识别图片中的题目原文（包含题干、选项、小问、已知条件），数学公式用纯文本表达。
2. answer_text：给出这道题的正确答案；如果图片中有学生的作答，同时指出学生错在哪里。
3. knowledge_points：提炼本题考查的知识点，2-5 个，用中文顿号「、」分隔。
4. error_reason：分析学生做错的原因，1-3 句话，语气温和、具体，并从该年级学生常见的认知误区出发。
5. solution：给出清晰的正确解题思路和步骤，分步骤书写。
6. subject：从以下科目中选择最匹配的一项：{subjects}。
7. 所有讲解都必须严格贴合该学生的年级：只使用该年级已经学过的知识、符号和方法，不使用超纲解法；如果必须涉及后续知识，要用该年级能听懂的方式解释。

如果图片中没有可见的题目，不要编造：question_text 填写「未能识别图片中的题目，请重新拍摄清晰的题目照片」，其余字段留空。
只输出一个 JSON 对象，不要输出 Markdown 代码块或任何额外解释。JSON 字符串内部的换行必须写成 \\n 转义。JSON 格式如下：
{{"subject": "数学", "question_text": "...", "answer_text": "...", "knowledge_points": "...", "error_reason": "...", "solution": "..."}}"""

EXERCISE_PROMPT = """你是一位资深命题老师。下面是一道学生的错题，请围绕这道题考查的知识点和解题方法，原创 {count} 道难度为「{level}」的同类练习题（举一反三），用于巩固训练。

学生年级：{grade}
{grade_note}

错题信息：
- 科目：{subject}
- 题目：{question_text}
- 正确答案：{answer_text}
- 知识点：{knowledge_points}
- 错因：{error_reason}
- 解题思路：{solution}

命题要求：
- 考查相同的知识点和解题方法，但情境、数据、设问要有变化，不要直接复制原题。
- 难度与考查方式必须符合该学生年级的课程进度：只使用该年级已学的知识、符号和方法，不出超纲题。
- 每道题必须自洽可解，答案与解析准确，语言和步骤符合该年级学生的理解水平。
- content 为题面（含选项或小问），answer 为参考答案，explanation 为分步骤的解题思路。
- 只输出 JSON，不要输出 Markdown 代码块或任何额外解释。JSON 字符串内部的换行必须写成 \\n 转义。格式：
{{"exercises": [{{"content": "...", "answer": "...", "explanation": "..."}}]}}"""

CONSULT_PROMPT = """你是一位耐心、专业的中小学老师，正在和一位家长或学生讨论一道错题的解析。请用中文回答。

学生情况：{grade_note}

题目与当前解析：
- 科目：{subject}
- 题目：{question_text}
- 当前答案：{answer_text}
- 知识点：{knowledge_points}
- 错因：{error_reason}
- 当前解题思路：{solution}

要求：
1. 认真对待用户的疑问。如果用户说得对，或原解析有错误、不严谨，要明确承认，并给出修正后的答案与解题思路。
2. 如果原解析正确，用该年级学生能听懂的方式解释清楚，指出用户的理解偏差在哪里，不要敷衍。
3. 回答要具体、分步骤，涉及计算时写出关键步骤；语气平和，不要贬低用户。
4. 只使用该学生年级已经学过的知识和方法，不使用超纲内容。
5. reply 是给用户看的完整回答，可以分段。
6. 只有在确实需要修改题目、答案或思路时，才填写 revised；不需要修改时 revised 必须是空对象 {{}}。revised 中的字段是修改后的完整内容，而不是差异片段，可用字段为 question_text、answer_text、knowledge_points、error_reason、solution。
只输出一个 JSON 对象，不要输出 Markdown 代码块或任何额外解释。JSON 字符串内部的换行必须写成 \\n 转义。格式：
{{"reply": "...", "revised": {{"answer_text": "...", "solution": "..."}}}}"""

ASK_PROMPT = """你是一位耐心、专业的中小学老师，正在回答学生或家长的学习提问。请用中文回答。

学生情况：{grade_note}
{subject_line}

要求：
1. 先直接给出结论或答案，再分步骤解释；涉及计算时写出关键步骤。
2. 只使用该学生年级已经学过的知识和方法，不使用超纲内容。如果问题本身超出该年级范围，用通俗的方式说明，并告诉孩子以后会学到。
3. 如果问题描述不清楚，先指出缺少哪些信息，再给出你能做的分析，并请对方补充。
4. 语气温和、鼓励，不要贬低孩子；可以举生活中的例子帮助理解。
5. 如果用户提供了题目照片，请先看清照片中的题目和孩子的作答，再针对性讲解；照片不清晰时请指出需要重拍的部分，不要凭空编造题目。
6. 用纯文本回答，可以用短段落或编号列出步骤，不要输出 JSON、Markdown 代码块或多余的格式说明。"""


def grade_note(grade: str) -> str:
    grade = (grade or "").strip()
    if not grade:
        return "未填写年级，请根据题目推断学段，使用中小学通用、不过度超纲的表述。"
    stage_hints = {
        "小学": "只使用该年级已学的算术、图形与简单数量关系，避免方程、函数、负数等未学内容；讲解要浅显具体，多用生活化例子。",
        "初中": "使用该年级已学的代数、几何、函数等知识，步骤完整，避免高中才学的方法（如导数、复杂解析几何技巧）。",
        "高中": "可使用高中阶段的方法与符号，强调逻辑推理与综合运用。",
    }
    return f"学生年级为「{grade}」。" + stage_hints.get(grade[:2], "")


class AIError(Exception):
    pass


def _clip(text: str, limit: int) -> str:
    text = str(text or "").strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _chat_url(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def _error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
        error = payload.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error)
        if isinstance(error, str):
            return error
        if payload.get("message"):
            return str(payload["message"])
    except ValueError:
        pass
    return (response.text or "").strip()[:300] or "未知错误"


def _extract_content(data: dict) -> str:
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise AIError("AI 服务返回的数据格式异常，请检查模型是否兼容 OpenAI 接口")
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif isinstance(item, str):
                parts.append(item)
        content = "\n".join(parts)
    if not isinstance(content, str) or not content.strip():
        raise AIError("AI 服务返回了空内容，请稍后重试")
    return content.strip()


async def _chat(provider: sqlite3.Row, messages: list, temperature: float, max_tokens: int) -> str:
    url = _chat_url(provider["base_url"])
    headers = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": provider["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(150.0, connect=20.0)) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.TimeoutException:
        raise AIError("AI 服务响应超时，请稍后重试，或检查模型是否支持图片输入")
    except httpx.RequestError:
        raise AIError(f"无法连接 AI 服务（{url}），请检查 BaseURL 和服务器网络")
    if response.status_code >= 400:
        raise AIError(f"AI 服务请求失败（HTTP {response.status_code}）：{_error_detail(response)}")
    try:
        data = response.json()
    except ValueError:
        raise AIError("AI 服务返回的内容不是合法 JSON，请检查 BaseURL 是否指向兼容接口")
    return _extract_content(data)


def _strip_wrappers(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _slice_json(text: str) -> str:
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    array_start, array_end = text.find("["), text.rfind("]")
    if array_start != -1 and array_end > array_start:
        return text[array_start : array_end + 1]
    return ""


def _scan_json(text: str) -> tuple[list[str], list[str], bool]:
    """Walk JSON text tracking string state; escape raw control chars inside strings."""
    out: list[str] = []
    stack: list[str] = []
    in_string = False
    escape = False
    for ch in text:
        if in_string:
            if escape:
                escape = False
                out.append(ch)
            elif ch == "\\":
                escape = True
                out.append(ch)
            elif ch == '"':
                in_string = False
                out.append(ch)
            elif ch == "\n":
                out.append("\\n")
            elif ch == "\r":
                out.append("\\r")
            elif ch == "\t":
                out.append("\\t")
            else:
                out.append(ch)
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
            out.append(ch)
        elif ch in "}]":
            if stack:
                stack.pop()
            out.append(ch)
        else:
            out.append(ch)
    return out, stack, in_string


def _close_candidates(text: str) -> list[str]:
    """Try to repair JSON that was cut off mid-output."""
    out, stack, in_string = _scan_json(text)
    if in_string:
        out.append('"')
    joined = "".join(out).rstrip()
    joined = re.sub(r",\s*$", "", joined)
    closers = "".join(reversed(stack))
    if joined.endswith(":"):
        return [joined + ' ""' + closers]
    if joined.endswith('"'):
        return [joined + closers, joined + ': ""' + closers]
    return [joined + closers]


def _parse_json(text: str) -> dict | list:
    cleaned = _strip_wrappers(text)
    bases = []
    for item in (cleaned, _slice_json(cleaned)):
        if item and item not in bases:
            bases.append(item)

    tried: set[str] = set()
    for base in bases:
        variants = [base]
        out, _stack, _in_str = _scan_json(base)
        sanitized = "".join(out)
        variants.append(sanitized)
        variants.append(re.sub(r",\s*([}\]])", r"\1", sanitized))
        variants.extend(_close_candidates(base))
        for variant in variants:
            if not variant or variant in tried:
                continue
            tried.add(variant)
            try:
                return json.loads(variant)
            except json.JSONDecodeError:
                continue
    raise AIError("AI 返回的内容无法解析为 JSON，请重试")


RETRY_PROMPT = (
    "你上一次的输出无法被解析为合法的 JSON。请重新输出：只输出一个合法的 JSON 对象，"
    "使用标准双引号，字符串内部不要出现未转义的换行（需要换行时写成 \\n），"
    "不要包含 Markdown 代码块、注释或任何解释文字。"
)


async def _chat_json(provider: sqlite3.Row, messages: list, temperature: float, max_tokens: int):
    content = await _chat(provider, messages, temperature, max_tokens)
    try:
        return _parse_json(content)
    except AIError:
        logger.warning("AI 返回内容无法解析为 JSON，将自动重试一次。原始内容片段：%s", content[:300])
    retry_messages = [
        *messages,
        {"role": "assistant", "content": content[:2000]},
        {"role": "user", "content": RETRY_PROMPT},
    ]
    retry_content = await _chat(provider, retry_messages, temperature, max_tokens)
    try:
        return _parse_json(retry_content)
    except AIError:
        logger.warning("AI 重试后仍无法解析为 JSON。重试内容片段：%s", retry_content[:300])
        raise AIError(
            "AI 连续两次未能返回可解析的结果，请重试；若反复出现，建议更换支持图片理解、输出稳定的模型"
        )


def _text(value) -> str:
    if isinstance(value, list):
        return "、".join(str(item).strip() for item in value if str(item).strip())
    if value is None:
        return ""
    return str(value).strip()


async def analyze_question(
    provider: sqlite3.Row,
    subject_hint: str,
    grade: str,
    image_data_url: str,
) -> dict:
    prompt = ANALYZE_PROMPT.format(
        subjects="、".join(SUBJECTS),
        grade_note=grade_note(grade),
    )
    if subject_hint:
        prompt += f"\n\n提示：家长选择的科目是「{subject_hint}」，请优先参考。"
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }
    ]
    data = await _chat_json(provider, messages, temperature=0.2, max_tokens=3000)
    if not isinstance(data, dict):
        raise AIError("AI 返回的分析结果格式不正确，请重试")

    subject = _text(data.get("subject"))
    if subject not in SUBJECTS:
        subject = next((item for item in SUBJECTS if item and item in subject), "")
    return {
        "subject": subject,
        "question_text": _clip(_text(data.get("question_text")), 20000),
        "answer_text": _clip(_text(data.get("answer_text")), 10000),
        "knowledge_points": _clip(_text(data.get("knowledge_points")), 2000),
        "error_reason": _clip(_text(data.get("error_reason")), 4000),
        "solution": _clip(_text(data.get("solution")), 20000),
    }


async def generate_exercises(
    provider: sqlite3.Row,
    question: sqlite3.Row,
    level: str,
    grade: str = "",
    count: int = 3,
) -> list[dict]:
    level_name = LEVEL_NAMES.get(level)
    if not level_name:
        raise AIError("难度等级不正确")
    grade = (grade or "").strip()
    prompt = EXERCISE_PROMPT.format(
        count=count,
        level=level_name,
        grade=grade or "未填写（按题目推断学段）",
        grade_note=grade_note(grade),
        subject=question["subject"],
        question_text=_clip(question["question_text"], 5000),
        answer_text=_clip(question["answer_text"], 3000),
        knowledge_points=_clip(question["knowledge_points"], 1000),
        error_reason=_clip(question["error_reason"], 1500),
        solution=_clip(question["solution"], 5000),
    )
    messages = [{"role": "user", "content": prompt}]
    data = await _chat_json(provider, messages, temperature=0.8, max_tokens=4000)

    raw_items = None
    if isinstance(data, dict):
        raw_items = data.get("exercises") or data.get("questions") or data.get("items")
    elif isinstance(data, list):
        raw_items = data
    if not isinstance(raw_items, list):
        raise AIError("AI 没有返回可用的练习题，请重试")

    exercises = []
    for item in raw_items[:10]:
        if not isinstance(item, dict):
            continue
        question_text = _text(item.get("content") or item.get("question") or item.get("title"))
        if not question_text:
            continue
        exercises.append(
            {
                "content": _clip(question_text, 10000),
                "answer": _clip(_text(item.get("answer")), 10000),
                "explanation": _clip(_text(item.get("explanation") or item.get("analysis")), 10000),
            }
        )
    if not exercises:
        raise AIError("AI 没有返回可用的练习题，请重试")
    return exercises


async def consult_expert(
    provider: sqlite3.Row,
    context: dict,
    grade: str,
    history: list[dict],
) -> dict:
    grade = (grade or "").strip()
    prompt = CONSULT_PROMPT.format(
        grade_note=grade_note(grade),
        subject=_clip(context.get("subject"), 20) or "未填写",
        question_text=_clip(context.get("question_text"), 5000) or "（未填写）",
        answer_text=_clip(context.get("answer_text"), 3000) or "（未填写）",
        knowledge_points=_clip(context.get("knowledge_points"), 1000) or "（未填写）",
        error_reason=_clip(context.get("error_reason"), 1500) or "（未填写）",
        solution=_clip(context.get("solution"), 5000) or "（未填写）",
    )
    messages = [{"role": "system", "content": prompt}]
    for item in history[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = _clip(item.get("content"), 4000)
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    if messages[-1]["role"] != "user":
        raise AIError("请先输入你的疑问")

    data = await _chat_json(provider, messages, temperature=0.4, max_tokens=3000)
    if not isinstance(data, dict):
        raise AIError("专家回复的格式不正确，请重试")

    reply = _clip(_text(data.get("reply")), 8000)
    if not reply:
        raise AIError("专家没有给出有效回复，请重试")

    limits = {
        "question_text": 20000,
        "answer_text": 10000,
        "knowledge_points": 2000,
        "error_reason": 4000,
        "solution": 20000,
    }
    revised = {}
    raw_revised = data.get("revised")
    if isinstance(raw_revised, dict):
        for key, limit in limits.items():
            value = _text(raw_revised.get(key))
            if value:
                revised[key] = _clip(value, limit)
    return {"reply": reply, "revised": revised}


async def ask_expert(
    provider: sqlite3.Row,
    grade: str,
    subject: str,
    history: list[dict],
    image_data_url: str | None = None,
) -> str:
    subject = (subject or "").strip()
    prompt = ASK_PROMPT.format(
        grade_note=grade_note(grade),
        subject_line=f"当前提问科目：{subject}，请尽量围绕该科目回答。" if subject else "当前没有指定科目，请根据问题内容判断。",
    )
    messages = [{"role": "system", "content": prompt}]
    for item in history[-12:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = _clip(item.get("content"), 4000)
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    if messages[-1]["role"] != "user":
        raise AIError("请先输入你的问题")
    if image_data_url:
        messages[-1]["content"] = [
            {"type": "text", "text": messages[-1]["content"]},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]

    content = await _chat(provider, messages, temperature=0.4, max_tokens=2500)
    reply = _clip(content, 8000)
    if not reply:
        raise AIError("AI 没有给出有效回复，请重试")
    return reply


async def test_provider(provider: sqlite3.Row) -> str:
    messages = [{"role": "user", "content": "请只回复两个字：可用"}]
    content = await _chat(provider, messages, temperature=0.0, max_tokens=20)
    return content.strip()[:50]
