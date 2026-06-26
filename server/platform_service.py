# -*- coding: utf-8 -*-
"""平台 API 对接服务 - 支持 Shopfiy / 淘宝 mock / 拼多多 mock"""

import json
import random
import urllib.request
from datetime import datetime, timedelta

# ─── 模拟数据生成 ───

MOCK_PRODUCTS = [
    "2026 夏季新款连衣裙", "男士商务休闲鞋", "无线蓝牙耳机 Pro",
    "智能手表 S3", "真丝睡衣套装", "运动跑鞋 Air",
    "复古帆布包", "电子阅读器 Kindle", "电动牙刷 H9",
    "便携式充电宝 20000mAh"
]

MOCK_STATUSES = {
    "pending": "待发货", "shipped": "已发货", "delivered": "已签收",
    "cancelled": "已取消", "refunding": "退款中"
}

def _random_phone():
    prefixes = ["138", "139", "150", "186", "188", "135", "136", "137"]
    return random.choice(prefixes) + "".join([str(random.randint(0,9)) for _ in range(8)])

def _random_address():
    cities = ["北京市朝阳区", "上海市浦东新区", "广州市天河区", "深圳市南山区",
              "杭州市西湖区", "成都市武侯区", "武汉市洪山区", "南京市鼓楼区"]
    return random.choice(cities) + "某某路" + str(random.randint(100,999)) + "号"

def _random_logistics():
    companies = ["顺丰速运", "中通快递", "圆通速递", "韵达快递", "申通快递", "极兔速递"]
    return random.choice(companies), "SF" + str(random.randint(1000000000000, 9999999999999))

def generate_mock_order(platform="taobao"):
    """生成模拟订单数据"""
    now = datetime.now()
    days_ago = random.randint(1, 14)
    product = random.choice(MOCK_PRODUCTS)
    price = round(random.uniform(29.9, 599.9), 2)
    status = random.choices(
        ["pending", "shipped", "delivered", "cancelled", "refunding"],
        weights=[15, 35, 40, 5, 5]
    )[0]
    company, tracking = _random_logistics() if status in ("shipped", "delivered") else ("", "")

    order = {
        "platform": platform,
        "order_id": "".join(random.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=16)),
        "product": product,
        "price": price,
        "quantity": random.randint(1, 3),
        "status": status,
        "status_label": MOCK_STATUSES[status],
        "created_at": (now - timedelta(days=days_ago)).strftime("%Y-%m-%d %H:%M:%S"),
        "receiver": "张" + random.choice("明华强丽静"),
        "phone": _random_phone(),
        "address": _random_address(),
        "logistics_company": company,
        "tracking_number": tracking,
    }

    # 已发货的补充物流跟踪信息
    if status == "shipped":
        order["logistics_status"] = "运输中"
        order["logistics_events"] = [
            {"time": (now - timedelta(hours=random.randint(2, 24))).strftime("%m-%d %H:%M"), "desc": "包裹已出库"},
            {"time": (now - timedelta(hours=random.randint(24, 48))).strftime("%m-%d %H:%M"), "desc": "到达" + random.choice(["杭州", "上海", "广州", "北京"]) + "中转站"},
        ]
    elif status == "delivered":
        order["logistics_status"] = "已签收"
        order["logistics_events"] = [
            {"time": (now - timedelta(hours=random.randint(4, 12))).strftime("%m-%d %H:%M"), "desc": "已签收，感谢使用" + company},
            {"time": (now - timedelta(hours=random.randint(12, 24))).strftime("%m-%d %H:%M"), "desc": "派送中，预计今日送达"},
        ]
    else:
        order["logistics_status"] = "暂无物流信息"

    return order


# ─── 真实 API 对接 ───

async def query_shopify_order(shop_domain: str, access_token: str, order_name: str) -> dict:
    """查询 Shopify 订单（按订单号或名称）"""
    if not shop_domain or not access_token:
        return {"error": "Shopify 未配置"}
    try:
        api_url = f"https://{shop_domain}/admin/api/2024-01/orders.json?name={order_name}&status=any"
        req = urllib.request.Request(api_url, headers={"X-Shopify-Access-Token": access_token})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            orders = data.get("orders", [])
            if not orders:
                return {"error": f"未找到订单 {order_name}"}
            o = orders[0]
            return {
                "platform": "shopify",
                "order_id": o.get("order_number", ""),
                "product": ", ".join([i.get("title", "") for i in o.get("line_items", [])]),
                "price": float(o.get("total_price", 0)),
                "status": o.get("fulfillment_status", "unfulfilled") or "unfulfilled",
                "status_label": {"fulfilled": "已发货", "partial": "部分发货", "unfulfilled": "未发货"}.get(o.get("fulfillment_status"), "未发货"),
                "created_at": o.get("created_at", ""),
                "tracking_number": (o.get("fulfillments", [{}])[0].get("tracking_number", "") if o.get("fulfillments") else ""),
            }
    except Exception as e:
        return {"error": f"Shopify 查询失败: {str(e)}"}


# ─── 统一查询入口 ───

async def query_order(config: dict, query_text: str) -> dict:
    """统一查询入口：根据配置和用户查询，返回订单数据"""
    platform = config.get("platform", "mock")
    order_id = _extract_order_id(query_text)

    # 有真实平台配置 → 调真实 API
    if platform == "shopify" and config.get("app_key") and config.get("app_secret"):
        return await query_shopify_order(config.get("shop_domain", ""), config.get("app_secret", ""), order_id or query_text)

    # 否则返回模拟数据（带个提示）
    result = generate_mock_order(platform)
    result["_note"] = "（演示模式，非真实订单数据）"
    return result


def _extract_order_id(text: str) -> str:
    """从用户消息中提取订单号"""
    import re
    # 匹配常见订单号格式
    patterns = [
        r"订单[号:]?\s*([A-Za-z0-9]{8,})",
        r"([A-Za-z0-9]{12,})",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(1)
    return ""
