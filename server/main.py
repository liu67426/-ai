# -*- coding: utf-8 -*-
"""
AI 客服系统 - 后端服务
"""

import os
import json
import sqlite3
import threading
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

# 平台 API 对接服务
from platform_service import query_order
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import openai

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

BASE_DIR = Path(__file__).resolve().parent
WEBSITE_DIR = BASE_DIR / "website"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = os.getenv("DATABASE_PATH") or str(DATA_DIR / "chatbot.db")

_local = threading.local()


def get_db():
    if not hasattr(_local, "conn") or _local.conn is None:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("""CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY, customer_name TEXT NOT NULL DEFAULT '访客',
            customer_avatar TEXT DEFAULT '', customer_email TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'waiting', source TEXT DEFAULT 'web',
            unread INTEGER DEFAULT 0, last_message TEXT DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
            role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS quick_replies (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
            content TEXT NOT NULL, category TEXT DEFAULT '通用', created_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS knowledge (
            id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL,
            answer TEXT NOT NULL, category TEXT DEFAULT '通用',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS platform_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
            config_json TEXT NOT NULL, enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT NOT NULL
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS knowledge_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
            hit INTEGER NOT NULL, created_at TEXT NOT NULL
        )""")
        conn.commit()
        _local.conn = conn
    return _local.conn


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def gen_id():
    import uuid
    return uuid.uuid4().hex[:12]


def get_openai_client():
    api_key = os.getenv("LLM_API_KEY", "")
    base_url = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    if not api_key or api_key == "sk-your-api-key-here":
        return None
    return openai.AsyncOpenAI(api_key=api_key, base_url=base_url)


# ─── 数据模型 ───
class ChatRequest(BaseModel):
    conversation_id: str
    message: str


class ConversationCreate(BaseModel):
    customer_name: str = "访客"
    customer_email: str = ""


class QuickReplyCreate(BaseModel):
    title: str
    content: str
    category: str = "通用"


class KnowledgeCreate(BaseModel):
    question: str
    answer: str
    category: str = "通用"


class KnowledgeUpdate(BaseModel):
    question: str
    answer: str
    category: str = "通用"


class PlatformConfigCreate(BaseModel):
    platform: str
    config: dict = {}
    shop_domain: str = ""


class SettingsUpdate(BaseModel):
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    system_prompt: str = ""
    bot_name: str = "小智"
    welcome_message: str = ""
    widget_primary_color: str = "#4F46E5"
    widget_position: str = "right"
    knowledge_enabled: str = "1"


# ─── 应用 ───
@asynccontextmanager
async def lifespan(app: FastAPI):
    get_db()
    yield

app = FastAPI(title="智联AI客服", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# ═══════════════════ 对话 API ═══════════════════

@app.get("/api/conversations")
def list_conversations(status: Optional[str] = None):
    db = get_db()
    if status:
        rows = db.execute("SELECT * FROM conversations WHERE status=? ORDER BY updated_at DESC", (status,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM conversations ORDER BY updated_at DESC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/conversations")
def create_conversation(body: ConversationCreate):
    db = get_db()
    cid = gen_id()
    now = now_str()
    db.execute("INSERT INTO conversations (id,customer_name,customer_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
               (cid, body.customer_name, body.customer_email, "waiting", now, now))
    settings = get_settings_dict()
    welcome = settings.get("welcome_message", "") or "你好！我是" + settings.get("bot_name", "小智") + "，很高兴为您服务！请问有什么可以帮您的？"
    db.execute("INSERT INTO messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)",
               (cid, "assistant", welcome, now))
    db.commit()
    return {"id": cid, "customer_name": body.customer_name, "welcome": welcome}


@app.get("/api/conversations/{cid}")
def get_conversation(cid: str):
    db = get_db()
    row = db.execute("SELECT * FROM conversations WHERE id=?", (cid,)).fetchone()
    if not row:
        raise HTTPException(404, "对话不存在")
    return dict(row)


@app.get("/api/conversations/{cid}/messages")
def get_messages(cid: str):
    db = get_db()
    rows = db.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC", (cid,)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/conversations/{cid}/read")
def mark_read(cid: str):
    db = get_db()
    db.execute("UPDATE conversations SET unread=0 WHERE id=?", (cid,))
    db.commit()
    return {"ok": True}


@app.delete("/api/conversations/{cid}")
def delete_conversation(cid: str):
    db = get_db()
    db.execute("DELETE FROM messages WHERE conversation_id=?", (cid,))
    db.execute("DELETE FROM conversations WHERE id=?", (cid,))
    db.commit()
    return {"ok": True}


# ═══════════════════ 聊天 API（知识增强版） ═══════════════════

@app.post("/api/chat")
async def chat(body: ChatRequest):
    client = get_openai_client()
    if not client:
        return JSONResponse(status_code=400, content={"error": "请先到设置页面配置 API Key"})

    db = get_db()
    now = now_str()

    db.execute("INSERT INTO messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)",
               (body.conversation_id, "user", body.message, now))
    history = db.execute("SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id ASC",
                         (body.conversation_id,)).fetchall()
    db.execute("UPDATE conversations SET last_message=?, status='active', updated_at=? WHERE id=?",
               (body.message, now, body.conversation_id))
    db.commit()

    settings = get_settings_dict()
    sys_prompt = settings.get("system_prompt", "你是一个专业、热情的电商客服助手。你叫小智，来自智联客服团队。")

    # ── 知识库增强 ──
    knowledge_context = ""
    knowledge_matched = False
    if settings.get("knowledge_enabled", "1") == "1":
        try:
            rows = db.execute("SELECT question, answer FROM knowledge ORDER BY id DESC").fetchall()
            if rows:
                matched = []
                user_msg_lower = body.message.lower()
                for r in rows:
                    q = (r["question"] or "").lower()
                    if any(kw in user_msg_lower for kw in q.split()) or any(w in q for w in user_msg_lower.split()):
                        matched.append(r)
                if matched:
                    knowledge_matched = True
                    kb_parts = []
                    for r in matched[:5]:
                        kb_parts.append(f"Q: {r['question']}\nA: {r['answer']}")
                    knowledge_context = "\n\n以下知识库内容可供参考：\n" + "\n---\n".join(kb_parts)
        except Exception:
            pass

    if not knowledge_matched:
        sys_prompt += "\n\n注意：如果客户的问题不在你已有的知识范围内，请如实告知客户你无法回答这个问题，并建议转接人工客服处理。回复中请包含「我帮您转接人工客服来处理」。"

    # ── 平台订单查询 ──
    platform_context = ""
    try:
        order_keywords = ["订单", "物流", "快递", "发货", "到哪", "签收", "退换", "退款"]
        if any(kw in body.message for kw in order_keywords):
            plat_rows = db.execute("SELECT platform, config_json FROM platform_configs WHERE enabled=1").fetchall()
            for pr in plat_rows:
                cfg = json.loads(pr["config_json"] or "{}")
                cfg["platform"] = pr["platform"]
                import asyncio
                order_data = await query_order(cfg, body.message)
                if order_data and "error" not in order_data:
                    note = order_data.pop("_note", "")
                    platform_context = "\n\n以下是从" + pr["platform"] + "查询到的订单信息：\n" + json.dumps(order_data, ensure_ascii=False, indent=2)
                    if note:
                        platform_context += "\n" + note
                    break
                elif order_data and "error" in order_data:
                    platform_context = "\n\n尝试查询订单时遇到问题：" + order_data["error"]
    except Exception as e:
        print(f"平台查询异常: {e}")

    system_content = sys_prompt + knowledge_context + platform_context
    messages = [{"role": "system", "content": system_content}]
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})

    async def generate():
        full_content = ""
        try:
            stream = await client.chat.completions.create(
                model=settings.get("llm_model", "gpt-4o-mini"),
                messages=messages, stream=True, temperature=0.7, max_tokens=2000,
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    full_content += content
                    yield f"data: {json.dumps({'content': content, 'done': False})}\n\n"
            db.execute("INSERT INTO messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)",
                       (body.conversation_id, "assistant", full_content, now_str()))
            db.commit()
            try:
                db.execute("INSERT INTO knowledge_log (conversation_id, hit, created_at) VALUES (?,?,?)",
                    (body.conversation_id, 1 if knowledge_matched else 0, now_str()))
                db.commit()
            except:
                pass
            nh = not knowledge_matched
            yield f"data: {json.dumps({'content': '', 'done': True, 'needs_human': nh})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ═══════════════════ 数据看板 API ═══════════════════

@app.get("/api/analytics")
def get_analytics():
    db = get_db()

    # 1. 每日对话趋势（近30天）
    daily_rows = db.execute("""
        SELECT date(created_at) as day, COUNT(*) as count
        FROM conversations
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY date(created_at)
        ORDER BY day ASC
    """).fetchall()

    # 2. 平均响应时间（用户消息 -> AI回复的秒数）
    resp_rows = db.execute("""
        SELECT m1.created_at as user_time, m2.created_at as ai_time
        FROM messages m1
        JOIN messages m2 ON m1.id + 1 = m2.id
            AND m1.conversation_id = m2.conversation_id
        WHERE m1.role = 'user' AND m2.role = 'assistant'
    """).fetchall()

    from datetime import datetime as dt
    avg_resp = 0.0
    if resp_rows:
        diffs = []
        for r in resp_rows:
            ut = dt.strptime(r["user_time"], "%Y-%m-%d %H:%M:%S")
            at = dt.strptime(r["ai_time"], "%Y-%m-%d %H:%M:%S")
            secs = (at - ut).total_seconds()
            if secs > 0:
                diffs.append(secs)
        if diffs:
            avg_resp = round(sum(diffs) / len(diffs), 1)

    # 3. 知识库命中率
    kb_hits = db.execute("SELECT COUNT(*) FROM knowledge_log WHERE hit=1").fetchone()[0]
    kb_misses = db.execute("SELECT COUNT(*) FROM knowledge_log WHERE hit=0").fetchone()[0]

    # 4. 转人工率
    total = db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    needs_human = db.execute("SELECT COUNT(*) FROM conversations WHERE status='needs_human'").fetchone()[0]

    # 5. 今日概览
    today = db.execute("SELECT COUNT(*) FROM conversations WHERE date(created_at)=date('now')").fetchone()[0]
    today_ai = db.execute("SELECT COUNT(*) FROM messages WHERE role='assistant' AND date(created_at)=date('now')").fetchone()[0]

    return {
        "daily_trend": [{"day": r["day"], "count": r["count"]} for r in daily_rows],
        "response_time_avg": avg_resp,
        "kb_hits": kb_hits, "kb_misses": kb_misses,
        "total_conversations": total, "needs_human": needs_human,
        "today_conversations": today, "today_ai_responses": today_ai,
    }


# ═══════════════════ 转人工 API ═══════════════════

@app.post("/api/conversations/{cid}/transfer")
def transfer_to_human(cid: str):
    db = get_db()
    now = now_str()
    db.execute("UPDATE conversations SET status='needs_human', updated_at=? WHERE id=?", (now, cid))
    db.execute("INSERT INTO messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)",
               (cid, "assistant", "&#128222; 已转接人工客服，请稍候，客服人员将尽快为您服务！", now))
    db.commit()
    return {"ok": True, "status": "needs_human"}


# ═══════════════════ 快捷回复 API ═══════════════════

@app.get("/api/quick-replies")
def list_quick_replies(category: Optional[str] = None):
    db = get_db()
    if category:
        rows = db.execute("SELECT * FROM quick_replies WHERE category=? ORDER BY id ASC", (category,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM quick_replies ORDER BY id ASC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/quick-replies")
def create_quick_reply(body: QuickReplyCreate):
    db = get_db()
    now = now_str()
    db.execute("INSERT INTO quick_replies (title,content,category,created_at) VALUES (?,?,?,?)",
               (body.title, body.content, body.category, now))
    db.commit()
    return {"ok": True}


@app.delete("/api/quick-replies/{rid}")
def delete_quick_reply(rid: int):
    db = get_db()
    db.execute("DELETE FROM quick_replies WHERE id=?", (rid,))
    db.commit()
    return {"ok": True}


# ═══════════════════ 知识库 API ═══════════════════

@app.get("/api/knowledge")
def list_knowledge(category: Optional[str] = None):
    db = get_db()
    if category:
        rows = db.execute("SELECT * FROM knowledge WHERE category=? ORDER BY id DESC", (category,)).fetchall()
    else:
        rows = db.execute("SELECT * FROM knowledge ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/knowledge")
def create_knowledge(body: KnowledgeCreate):
    db = get_db()
    now = now_str()
    db.execute("INSERT INTO knowledge (question,answer,category,created_at,updated_at) VALUES (?,?,?,?,?)",
               (body.question, body.answer, body.category, now, now))
    db.commit()
    return {"ok": True, "id": db.execute("SELECT last_insert_rowid()").fetchone()[0]}


@app.put("/api/knowledge/{kid}")
def update_knowledge(kid: int, body: KnowledgeUpdate):
    db = get_db()
    now = now_str()
    db.execute("UPDATE knowledge SET question=?, answer=?, category=?, updated_at=? WHERE id=?",
               (body.question, body.answer, body.category, now, kid))
    db.commit()
    return {"ok": True}


@app.delete("/api/knowledge/{kid}")
def delete_knowledge(kid: int):
    db = get_db()
    db.execute("DELETE FROM knowledge WHERE id=?", (kid,))
    db.commit()
    return {"ok": True}


# ═══════════════════ 平台对接 API ═══════════════════

@app.get("/api/platforms")
def list_platforms():
    db = get_db()
    rows = db.execute("SELECT * FROM platform_configs ORDER BY id ASC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/platforms")
def create_platform(body: PlatformConfigCreate):
    db = get_db()
    now = now_str()
    existing = db.execute("SELECT id FROM platform_configs WHERE platform=?", (body.platform,)).fetchone()
    if existing:
        db.execute("UPDATE platform_configs SET config_json=?, updated_at=? WHERE id=?",
                   (json.dumps(body.config, ensure_ascii=False), now, existing["id"]))
    else:
        db.execute("INSERT INTO platform_configs (platform,config_json,enabled,created_at,updated_at) VALUES (?,?,1,?,?)",
                   (body.platform, json.dumps(body.config, ensure_ascii=False), now, now))
    db.commit()
    return {"ok": True}


@app.delete("/api/platforms/{pid}")
def delete_platform(pid: int):
    db = get_db()
    db.execute("DELETE FROM platform_configs WHERE id=?", (pid,))
    db.commit()
    return {"ok": True}


@app.post("/api/platforms/{pid}/toggle")
def toggle_platform(pid: int):
    db = get_db()
    row = db.execute("SELECT enabled FROM platform_configs WHERE id=?", (pid,)).fetchone()
    if not row:
        raise HTTPException(404)
    new_val = 0 if row["enabled"] else 1
    db.execute("UPDATE platform_configs SET enabled=?, updated_at=? WHERE id=?", (new_val, now_str(), pid))
    db.commit()
    return {"ok": True, "enabled": new_val}


# ═══════════════════ 设置 API ═══════════════════

def get_settings_dict():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    s = {r["key"]: r["value"] for r in rows}
    return {
        "llm_api_key": s.get("llm_api_key", ""),
        "llm_base_url": s.get("llm_base_url", "https://api.openai.com/v1"),
        "llm_model": s.get("llm_model", "gpt-4o-mini"),
        "system_prompt": s.get("system_prompt", "你是一个专业、热情的电商客服助手。你叫小智，来自智联客服团队。你回答简洁专业，对客户的问题给予清晰准确的解答。"),
        "bot_name": s.get("bot_name", "小智"),
        "welcome_message": s.get("welcome_message", ""),
        "widget_primary_color": s.get("widget_primary_color", "#4F46E5"),
        "widget_position": s.get("widget_position", "right"),
        "knowledge_enabled": s.get("knowledge_enabled", "1"),
    }


@app.get("/api/settings")
def get_settings():
    return get_settings_dict()


@app.post("/api/settings")
def update_settings(body: SettingsUpdate):
    db = get_db()
    pairs = {
        "llm_api_key": body.llm_api_key, "llm_base_url": body.llm_base_url,
        "llm_model": body.llm_model, "system_prompt": body.system_prompt,
        "bot_name": body.bot_name, "welcome_message": body.welcome_message,
        "widget_primary_color": body.widget_primary_color, "widget_position": body.widget_position,
        "knowledge_enabled": body.knowledge_enabled,
    }
    for k, v in pairs.items():
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", (k, v))
    db.commit()
    if body.llm_api_key:
        os.environ["LLM_API_KEY"] = body.llm_api_key
    if body.llm_base_url:
        os.environ["LLM_BASE_URL"] = body.llm_base_url
    return {"ok": True}


# ═══════════════════ 统计 API ═══════════════════

@app.get("/api/stats")
def get_stats():
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    active = db.execute("SELECT COUNT(*) FROM conversations WHERE status='active'").fetchone()[0]
    waiting = db.execute("SELECT COUNT(*) FROM conversations WHERE status='waiting'").fetchone()[0]
    needs_human = db.execute("SELECT COUNT(*) FROM conversations WHERE status='needs_human'").fetchone()[0]
    closed = db.execute("SELECT COUNT(*) FROM conversations WHERE status='closed'").fetchone()[0]
    today = db.execute("SELECT COUNT(*) FROM conversations WHERE date(created_at)=date('now')").fetchone()[0]
    kb_count = db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0]
    return {"total": total, "active": active, "waiting": waiting, "needs_human": needs_human, "closed": closed, "today": today, "kb_count": kb_count}


# ─── 静态文件 ───
app.mount("/", StaticFiles(directory=str(WEBSITE_DIR), html=True), name="website")


# ─── 启动 ───
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    print(f"  AI 客服系统启动：http://localhost:{port}")
    print(f"  客服工作台：http://localhost:{port}/dashboard.html")
    print(f"  聊天浮窗示例：http://localhost:{port}/widget-demo.html")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)






