# -*- coding: utf-8 -*-
"""平台 API 对接 - 拼多多 / 淘宝 / 抖音"""

import json, hashlib, urllib.request, urllib.parse, random
from datetime import datetime, timedelta

# ============ 拼多多 ============
PDD_URL = "https://gw-api.pinduoduo.com/api/router"

def _pdd_sign(params, secret):
    keys = sorted(params.keys())
    raw = secret + "".join(f"{k}{params[k]}" for k in keys) + secret
    return hashlib.md5(raw.encode()).hexdigest().upper()

async def query_pinduoduo(cid, sec, tok, order_sn):
    if not all([cid, sec, tok]):
        return {"error": "拼多多未完整配置"}
    params = {
        "type": "pdd.order.information.get",
        "client_id": cid, "access_token": tok,
        "timestamp": str(int(datetime.now().timestamp())),
        "data_type": "JSON", "order_sn": order_sn or "",
    }
    params["sign"] = _pdd_sign(params, sec)
    data = urllib.parse.urlencode(params).encode()
    try:
        req = urllib.request.Request(PDD_URL, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        with urllib.request.urlopen(req, timeout=10) as r:
            return {"platform": "pdd", "data": json.loads(r.read().decode()), "_note": "拼多多实时数据"}
    except Exception as e:
        return {"error": f"拼多多查询失败: {e}"}

# ============ 淘宝 ============
TB_URL = "https://eco.taobao.com/router/rest"

def _tb_sign(params, secret):
    keys = sorted(params.keys())
    raw = "".join(f"{k}{params[k]}" for k in keys)
    raw = secret + raw + secret
    return hashlib.md5(raw.encode()).hexdigest().upper()

async def query_taobao(ak, asec, sess, oid):
    if not all([ak, asec, sess]):
        return {"error": "淘宝未完整配置"}
    p = {
        "method": "taobao.trade.fullinfo.get",
        "app_key": ak, "session": sess,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "format": "json", "v": "2.0", "sign_method": "md5",
        "fields": "tid,status,payment,orders,created,logistics_company",
        "tid": oid or "0",
    }
    p["sign"] = _tb_sign(p, asec)
    data = urllib.parse.urlencode(p).encode()
    try:
        req = urllib.request.Request(TB_URL, data=data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        with urllib.request.urlopen(req, timeout=10) as r:
            return {"platform": "taobao", "data": json.loads(r.read().decode()), "_note": "淘宝实时数据"}
    except Exception as e:
        return {"error": f"淘宝查询失败: {e}"}

# ============ 抖音 ============
DY_URL = "https://open-api-fxg.jinritemai.com/"

async def query_douyin(ak, asec, tok, oid):
    if not all([ak, asec, tok]):
        return {"error": "抖音未完整配置"}
    q = urllib.parse.urlencode({
        "method": "order.orderDetail",
        "param_json": json.dumps({"order_id": oid or ""}, ensure_ascii=False),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "v": "2", "app_key": ak, "access_token": tok,
    })
    try:
        req = urllib.request.Request(DY_URL + "?" + q, method="GET")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=10) as r:
            return {"platform": "douyin", "data": json.loads(r.read().decode()), "_note": "抖音实时数据"}
    except Exception as e:
        return {"error": f"抖音查询失败: {e}"}

# ============ 模拟数据(兜底) ============
MOCK_PRODUCTS = ["2026新款连衣裙", "男士休闲鞋", "蓝牙耳机Pro", "智能手表S3", "真丝睡衣套装", "运动跑鞋Air"]

def _gen_mock(platform, query):
    product = random.choice(MOCK_PRODUCTS)
    status = random.choice(["pending", "shipped", "delivered"])
    label = {"pending": "待发货", "shipped": "已发货", "delivered": "已签收"}[status]
    oid = query or "MOCK" + "".join(random.choices("0123456789", k=12))
    return {
        "platform": platform, "order_id": oid, "product": product,
        "price": round(random.uniform(29, 599), 2),
        "status": status, "status_label": label,
        "created_at": (datetime.now() - timedelta(days=random.randint(1,14))).strftime("%m-%d %H:%M"),
        "receiver": "张" + random.choice("明华强丽"),
        "_note": "（演示数据，非真实订单）",
    }

# ============ 统一查询入口 ============
async def query_order(config, query_text):
    platform = config.get("platform", "mock")
    import re
    m = re.search(r"[0-9A-Za-z]{8,}", query_text)
    oid = m.group(0) if m else ""

    if platform == "pdd":
        cid = config.get("app_key", ""); sec = config.get("app_secret", ""); tok = config.get("access_token", "")
        if cid and sec and tok:
            return await query_pinduoduo(cid, sec, tok, oid)
    elif platform == "taobao":
        ak = config.get("app_key", ""); asec = config.get("app_secret", ""); sess = config.get("session_key", "")
        if ak and asec and sess:
            return await query_taobao(ak, asec, sess, oid)
    elif platform == "douyin":
        ak = config.get("app_key", ""); asec = config.get("app_secret", ""); tok = config.get("access_token", "")
        if ak and asec and tok:
            return await query_douyin(ak, asec, tok, oid)

    return _gen_mock(platform, oid)
