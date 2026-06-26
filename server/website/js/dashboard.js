// ─── 全局状态 ───
let conversations = [];
let currentConvId = null;
let currentFilter = 'all';
let messagesCache = {};

// ─── 初始化 ───
document.addEventListener('DOMContentLoaded', () => {
  loadConversations();
  loadQuickReplies();
  startPolling();
});

// ─── 对话列表 ───
async function loadConversations() {
  try {
    const params = currentFilter !== 'all' ? `?status=${currentFilter}` : '';
    const res = await fetch(`/api/conversations${params}`);
    conversations = await res.json();
    renderConversationList();
    updateStats();
  } catch (e) {
    console.error('加载对话失败:', e);
  }
}

function renderConversationList() {
  const list = document.getElementById('conversationList');
  if (conversations.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:32px;color:var(--gray-400);font-size:13px;">暂无对话</div>`;
    return;
  }
  list.innerHTML = conversations.map(c => {
    const initial = c.customer_name.charAt(0);
    const colors = ['#4F46E5','#EC4899','#10B981','#F59E0B','#3B82F6','#8B5CF6','#EF4444','#14B8A6'];
    const colorIdx = c.customer_name.length % colors.length;
    const isActive = c.id === currentConvId;
    const time = formatTime(c.updated_at);
    return `<div class="conversation-item ${isActive ? 'active' : ''}" onclick="selectConversation('${c.id}')">
      <div class="avatar" style="background:${colors[colorIdx]};position:relative;">${initial}</div>
      <div class="info">
        <div class="name-row">
          <span class="name">${escapeHtml(c.customer_name)}</span>
          <span style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:10px;color:var(--gray-400);background:var(--gray-100);padding:0 6px;border-radius:4px;font-weight:500;">${getSourceLabel(c.source)}</span>
            <span class="time">${time}</span>
          </span>
        </div>
        <div class="preview">
          <span class="status-dot ${c.status}"></span>
          ${c.status === 'needs_human' ? '<span style="display:inline-block;margin-right:4px;padding:0 6px;background:#EF4444;color:white;border-radius:4px;font-size:10px;font-weight:600;">需人工</span>' : ''}
          ${escapeHtml(c.last_message || '暂无消息')}
          ${c.unread > 0 ? `<span class="badge">${c.unread}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── 选择对话 ───
async function selectConversation(cid) {
  currentConvId = cid;
  const conv = conversations.find(c => c.id === cid);
  if (!conv) return;

  // 标记已读
  await fetch(`/api/conversations/${cid}/read`, { method: 'POST' });
  conv.unread = 0;

  // 切换 UI
  document.getElementById('chatEmpty').style.display = 'none';
  document.getElementById('chatActive').style.display = 'flex';

  // 更新聊天头部
  const initial = conv.customer_name.charAt(0);
  const colors = ['#4F46E5','#EC4899','#10B981','#F59E0B','#3B82F6','#8B5CF6','#EF4444','#14B8A6'];
  const colorIdx = conv.customer_name.length % colors.length;
  document.getElementById('chatAvatar').style.background = colors[colorIdx];
  document.getElementById('chatAvatar').textContent = initial;
  document.getElementById('chatCustomerName').textContent = conv.customer_name;
  const statusText = conv.status === 'active' ? '在线' : conv.status === 'waiting' ? '等待中' : '已关闭';
  document.getElementById('chatStatus').textContent = statusText;
  document.getElementById('chatSourceBadge').textContent = ' · ' + getSourceLabel(conv.source);

  // 右侧面板
  document.getElementById('panelAvatar').style.background = colors[colorIdx];
  document.getElementById('panelAvatar').textContent = initial;
  document.getElementById('panelName').textContent = conv.customer_name;
  document.getElementById('panelEmail').textContent = conv.customer_email || '-';
  document.getElementById('panelStatus').textContent = conv.status === 'active' ? '进行中' : conv.status === 'waiting' ? '等待中' : '已关闭';
  document.getElementById('panelSource').textContent = conv.source || '网页';
  document.getElementById('panelTime').textContent = formatTime(conv.created_at);

  // 加载消息
  await loadMessages(cid);
  renderConversationList();
  document.getElementById('messageInput').focus();
}

async function loadMessages(cid) {
  try {
    const res = await fetch(`/api/conversations/${cid}/messages`);
    const messages = await res.json();
    messagesCache[cid] = messages;
    renderMessages(messages);
  } catch (e) {
    console.error('加载消息失败:', e);
  }
}

function renderMessages(messages) {
  const container = document.getElementById('chatMessages');
  container.innerHTML = messages.map(m => {
    if (m.role === 'system') return '';
    const isUser = m.role === 'user';
    return `<div class="message ${isUser ? 'user' : 'assistant'}">
      <div class="msg-avatar" style="background:${isUser ? '#6366F1' : '#10B981'};">${isUser ? '客' : 'AI'}</div>
      <div>
        <div class="msg-bubble">${escapeHtml(m.content)}</div>
        <div class="msg-time">${formatTime(m.created_at)}</div>
      </div>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// ─── 发送消息 ───
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const btn = document.getElementById('sendBtn');
  const msg = input.value.trim();
  if (!msg || !currentConvId) return;

  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;

  // 立即显示用户消息
  const container = document.getElementById('chatMessages');
  container.innerHTML += `<div class="message user">
    <div class="msg-avatar" style="background:#6366F1;">客</div>
    <div>
      <div class="msg-bubble">${escapeHtml(msg)}</div>
      <div class="msg-time">刚刚</div>
    </div>
  </div>`;

  // 显示打字指示器
  const typingId = 'typing-indicator';
  container.innerHTML += `<div class="message assistant" id="${typingId}">
    <div class="msg-avatar" style="background:#10B981;">AI</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  </div>`;
  container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: currentConvId, message: msg })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || '发送失败');
      document.getElementById(typingId)?.remove();
      btn.disabled = false;
      return;
    }

    // 处理流式响应
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    // 移除打字指示器，添加 AI 消息
    document.getElementById(typingId)?.remove();

    const aiMsgId = 'streaming-msg';
    container.innerHTML += `<div class="message assistant" id="${aiMsgId}">
      <div class="msg-avatar" style="background:#10B981;">AI</div>
      <div>
        <div class="msg-bubble" id="${aiMsgId}-bubble"></div>
        <div class="msg-time">刚刚</div>
      </div>
    </div>`;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) {
            showToast(data.error);
            break;
          }
          if (data.content) {
            fullContent += data.content;
            document.getElementById(`${aiMsgId}-bubble`).textContent = fullContent;
            container.scrollTop = container.scrollHeight;
          }
          if (data.done && !data.error) {
            // 更新对话列表
            setTimeout(loadConversations, 500);
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    showToast('网络错误，请检查服务器连接');
    document.getElementById(typingId)?.remove();
  }

  btn.disabled = false;
  container.scrollTop = container.scrollHeight;
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ─── 过滤 ───
function switchFilter(el, filter) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentFilter = filter;
  loadConversations();
}

function filterConversations() {
  const query = document.getElementById('searchInput').value.toLowerCase();
  const items = document.querySelectorAll('.conversation-item');
  items.forEach(item => {
    const name = item.querySelector('.name')?.textContent?.toLowerCase() || '';
    const preview = item.querySelector('.preview')?.textContent?.toLowerCase() || '';
    item.style.display = (name.includes(query) || preview.includes(query)) ? 'flex' : 'none';
  });
}

// ─── 快捷回复 ───
async function loadQuickReplies() {
  try {
    const res = await fetch('/api/quick-replies');
    const replies = await res.json();
    const list = document.getElementById('quickReplyList');
    if (replies.length === 0) {
      list.innerHTML = `<div style="font-size:12px;color:var(--gray-400);text-align:center;padding:8px;">暂无快捷回复</div>`;
      return;
    }
    list.innerHTML = replies.map(r => `
      <div class="quick-reply-item" onclick="useQuickReply(\`${escapeHtml(r.content)}\`)">
        <div class="qr-title">${escapeHtml(r.title)}</div>
        <div class="qr-preview">${escapeHtml(r.content)}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('加载快捷回复失败:', e);
  }
}

function useQuickReply(content) {
  const input = document.getElementById('messageInput');
  input.value = content;
  input.focus();
  autoResize(input);
}

function showAddQuickReply() {
  const title = prompt('请输入快捷回复标题：');
  if (!title) return;
  const content = prompt('请输入快捷回复内容：');
  if (!content) return;
  fetch('/api/quick-replies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content })
  }).then(() => {
    loadQuickReplies();
    showToast('快捷回复已添加');
  });
}

// ─── 关闭对话 ───
async function closeConversation() {
  if (!currentConvId) return;
  try {
    await fetch(`/api/conversations/${currentConvId}/read`, { method: 'POST' });
    // 不删除，只是回到空状态
    currentConvId = null;
    document.getElementById('chatEmpty').style.display = 'flex';
    document.getElementById('chatActive').style.display = 'none';
    loadConversations();
  } catch (e) {
    console.error('关闭对话失败:', e);
  }
}

// ─── 统计 ───
async function updateStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    // 在对话列表顶部显示统计
    const header = document.querySelector('.conversation-header');
    let statBar = document.getElementById('statsBar');
    if (!statBar) {
      statBar = document.createElement('div');
      statBar.id = 'statsBar';
      statBar.style.cssText = 'display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid var(--gray-100);font-size:11px;color:var(--gray-500);';
      header.after(statBar);
    }
    statBar.innerHTML = `
      <span>&#128202; 今日 ${stats.today}</span>
      <span style="color:var(--warning);">&#9679; 等待 ${stats.waiting}</span>
      <span style="color:var(--danger);">&#9679; 需人工 ${stats.needs_human || 0}</span>
      <span style="color:var(--success);">&#9679; 进行 ${stats.active}</span>
      <span style="color:var(--gray-300);">&#9679; 关闭 ${stats.closed}</span>
    `;
  } catch (e) {}
}

// ─── 轮询 ───
function startPolling() {
  setInterval(() => {
    loadConversations();
  }, 5000);
}

// ─── 工具函数 ───
function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff/60) + '分钟前';
  if (diff < 86400) return Math.floor(diff/3600) + '小时前';
  if (diff < 172800) return '昨天';
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
// ─── 设置页面功能 ───
function showSettings() {
  const modal = document.getElementById('settingsModal');
  modal.style.display = 'flex';
  loadSettings();
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    document.getElementById('set-api-key').value = s.llm_api_key || '';
    document.getElementById('set-base-url').value = s.llm_base_url || 'https://api.openai.com/v1';
    document.getElementById('set-model').value = s.llm_model || 'gpt-4o-mini';
    document.getElementById('set-bot-name').value = s.bot_name || '小智';
    document.getElementById('set-welcome').value = s.welcome_message || '';
    document.getElementById('set-prompt').value = s.system_prompt || '';
    document.getElementById('set-color').value = s.widget_primary_color || '#4F46E5';
    document.getElementById('set-color-text').textContent = s.widget_primary_color || '#4F46E5';
    document.getElementById('set-position').value = s.widget_position || 'right';

    document.getElementById('set-color').addEventListener('input', function() {
      document.getElementById('set-color-text').textContent = this.value;
    });
  } catch (e) {
    console.error('加载设置失败:', e);
  }
}

async function saveSettings() {
  const body = {
    llm_api_key: document.getElementById('set-api-key').value,
    llm_base_url: document.getElementById('set-base-url').value,
    llm_model: document.getElementById('set-model').value,
    bot_name: document.getElementById('set-bot-name').value,
    welcome_message: document.getElementById('set-welcome').value,
    system_prompt: document.getElementById('set-prompt').value,
    widget_primary_color: document.getElementById('set-color').value,
    widget_position: document.getElementById('set-position').value,
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showToast('设置已保存');
      closeSettings();
    } else {
      showToast('保存失败');
    }
  } catch (e) {
    showToast('网络错误');
  }
}

// ═══════════════════ 设置页面（增强版） ═══════════════════

function switchSettingsTab(el, tab) {
  document.querySelectorAll("[data-set-tab]").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.querySelectorAll(".set-tab").forEach(t => t.style.display = "none");
  document.getElementById("set-tab-" + tab).style.display = "block";
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const s = await res.json();
    document.getElementById("set-api-key").value = s.llm_api_key || "";
    document.getElementById("set-base-url").value = s.llm_base_url || "https://api.openai.com/v1";
    document.getElementById("set-model").value = s.llm_model || "gpt-4o-mini";
    document.getElementById("set-bot-name").value = s.bot_name || "小智";
    document.getElementById("set-welcome").value = s.welcome_message || "";
    document.getElementById("set-prompt").value = s.system_prompt || "";
    document.getElementById("set-knowledge-enabled").checked = s.knowledge_enabled !== "0";
    document.getElementById("set-color").value = s.widget_primary_color || "#4F46E5";
    document.getElementById("set-color-text").textContent = s.widget_primary_color || "#4F46E5";
    document.getElementById("set-position").value = s.widget_position || "right";
    document.getElementById("set-color").addEventListener("input", function() {
      document.getElementById("set-color-text").textContent = this.value;
    });
    loadPlatforms();
  } catch (e) {
    console.error("加载设置失败:", e);
  }
}

async function saveSettings() {
  const body = {
    llm_api_key: document.getElementById("set-api-key").value,
    llm_base_url: document.getElementById("set-base-url").value,
    llm_model: document.getElementById("set-model").value,
    bot_name: document.getElementById("set-bot-name").value,
    welcome_message: document.getElementById("set-welcome").value,
    system_prompt: document.getElementById("set-prompt").value,
    knowledge_enabled: document.getElementById("set-knowledge-enabled").checked ? "1" : "0",
    widget_primary_color: document.getElementById("set-color").value,
    widget_position: document.getElementById("set-position").value,
  };
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showToast("设置已保存");
      closeSettings();
    } else {
      showToast("保存失败");
    }
  } catch (e) {
    showToast("网络错误");
  }
}


// ═══════════════════ 知识库管理 ═══════════════════

function showKnowledgeBase() {
  document.getElementById("knowledgeModal").style.display = "flex";
  loadKnowledge();
}

function closeKnowledgeBase() {
  document.getElementById("knowledgeModal").style.display = "none";
}

async function loadKnowledge() {
  const cat = document.getElementById("kb-filter-cat").value;
  const params = cat ? "?category=" + encodeURIComponent(cat) : "";
  try {
    const res = await fetch("/api/knowledge" + params);
    const list = await res.json();
    const container = document.getElementById("knowledgeList");
    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--gray-400);">
        <div style="font-size:40px;margin-bottom:12px;">&#128214;</div>
        <div style="font-size:14px;">暂无知识条目</div>
        <div style="font-size:12px;margin-top:4px;">点击上方"新增"按钮添加</div>
      </div>`;
      return;
    }
    container.innerHTML = list.map(k => {
      const colors = ["#EEF2FF","#F0FDF4","#FEF3C7","#FDF2F8","#EFF6FF","#F5F3FF"];
      const ci = k.id % colors.length;
      return `<div style="display:flex;gap:12px;padding:14px;border-radius:var(--radius);border:1px solid var(--gray-200);background:white;transition:all .15s;">
        <div style="width:4px;border-radius:2px;background:var(--primary);flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <span style="font-weight:600;font-size:14px;color:var(--gray-800);">${escapeHtml(k.question)}</span>
              <span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;font-size:10px;background:${colors[ci]};color:var(--gray-600);">${escapeHtml(k.category)}</span>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              <button class="btn btn-ghost btn-sm" onclick="editKnowledge(${k.id})" style="font-size:11px;padding:4px 8px;">&#9998;</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteKnowledge(${k.id})" style="font-size:11px;padding:4px 8px;color:var(--danger);">&#10005;</button>
            </div>
          </div>
          <div style="font-size:12.5px;color:var(--gray-600);margin-top:6px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(k.answer)}</div>
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    console.error("加载知识库失败:", e);
  }
}

function showAddKnowledge() {
  document.getElementById("kbEditTitle").textContent = "新增知识条目";
  document.getElementById("kb-edit-id").value = "";
  document.getElementById("kb-edit-question").value = "";
  document.getElementById("kb-edit-answer").value = "";
  document.getElementById("kb-edit-cat").value = "通用";
  document.getElementById("knowledgeEditModal").style.display = "flex";
}

function editKnowledge(id) {
  fetch("/api/knowledge").then(r => r.json()).then(list => {
    const k = list.find(x => x.id === id);
    if (!k) return;
    document.getElementById("kbEditTitle").textContent = "编辑知识条目";
    document.getElementById("kb-edit-id").value = k.id;
    document.getElementById("kb-edit-question").value = k.question;
    document.getElementById("kb-edit-answer").value = k.answer;
    document.getElementById("kb-edit-cat").value = k.category;
    document.getElementById("knowledgeEditModal").style.display = "flex";
  });
}

function closeKnowledgeEdit() {
  document.getElementById("knowledgeEditModal").style.display = "none";
}

async function saveKnowledge() {
  const id = document.getElementById("kb-edit-id").value;
  const question = document.getElementById("kb-edit-question").value.trim();
  const answer = document.getElementById("kb-edit-answer").value.trim();
  const category = document.getElementById("kb-edit-cat").value;
  if (!question || !answer) {
    showToast("请填写问题和答案");
    return;
  }
  try {
    let res;
    if (id) {
      res = await fetch("/api/knowledge/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, category })
      });
    } else {
      res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, category })
      });
    }
    if (res.ok) {
      showToast(id ? "已更新" : "已添加");
      closeKnowledgeEdit();
      loadKnowledge();
    } else {
      showToast("操作失败");
    }
  } catch (e) {
    showToast("网络错误");
  }
}

async function deleteKnowledge(id) {
  if (!confirm("确定删除这条知识条目吗？")) return;
  try {
    await fetch("/api/knowledge/" + id, { method: "DELETE" });
    showToast("已删除");
    loadKnowledge();
  } catch (e) {
    showToast("删除失败");
  }
}


// ═══════════════════ 平台对接 ═══════════════════

function showAddPlatform() {
  document.getElementById("plat-type").value = "taobao";
  document.getElementById("plat-key").value = "";
  document.getElementById("plat-secret").value = "";
  document.getElementById("plat-shop-id").value = "";
  document.getElementById("platformEditModal").style.display = "flex";
}

function closePlatformEdit() {
  document.getElementById("platformEditModal").style.display = "none";
}

async function savePlatform() {
  const platform = document.getElementById("plat-type").value;
  const key = document.getElementById("plat-key").value.trim();
  const secret = document.getElementById("plat-secret").value.trim();
  const shopId = document.getElementById("plat-shop-id").value.trim();
  if (!key || !secret) {
    showToast("请填写 App Key 和 App Secret");
    return;
  }
  try {
    const res = await fetch("/api/platforms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: platform,
        config: { app_key: key, app_secret: secret, shop_id: shopId }
      })
    });
    if (res.ok) {
      showToast("平台已添加");
      closePlatformEdit();
      loadPlatforms();
    } else {
      showToast("保存失败");
    }
  } catch (e) {
    showToast("网络错误");
  }
}

async function loadPlatforms() {
  try {
    const res = await fetch("/api/platforms");
    const list = await res.json();
    const container = document.getElementById("platformList");
    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px;">暂无平台对接配置</div>`;
      return;
    }
    const platformNames = { taobao: "淘宝/天猫", pdd: "拼多多", shopify: "Shopify", douyin: "抖音小店", weixin: "微信小店", jds: "京东", other: "其他" };
    container.innerHTML = list.map(p => {
      const cfg = JSON.parse(p.config_json || "{}");
      const name = platformNames[p.platform] || p.platform;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--gray-200);border-radius:var(--radius);margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:13px;font-weight:600;">${name}</span>
          <span style="font-size:11px;color:var(--gray-500);">${cfg.app_key || ""}</span>
          <span style="font-size:11px;padding:1px 6px;border-radius:8px;background:${p.enabled ? "var(--success)" : "var(--gray-300)"};color:white;">${p.enabled ? "已启用" : "已禁用"}</span>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-ghost btn-sm" onclick="togglePlatform(${p.id})" style="font-size:11px;">${p.enabled ? "禁用" : "启用"}</button>
          <button class="btn btn-ghost btn-sm" onclick="deletePlatform(${p.id})" style="font-size:11px;color:var(--danger);">删除</button>
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    console.error("加载平台失败:", e);
  }
}

async function togglePlatform(id) {
  try {
    await fetch("/api/platforms/" + id + "/toggle", { method: "POST" });
    loadPlatforms();
  } catch (e) {
    showToast("操作失败");
  }
}

async function deletePlatform(id) {
  if (!confirm("确定删除此平台对接？")) return;
  try {
    await fetch("/api/platforms/" + id, { method: "DELETE" });
    showToast("已删除");
    loadPlatforms();
  } catch (e) {
    showToast("删除失败");
  }
}


// 来源/平台标签映射
function getSourceLabel(source) {
  var labels = { web: "网页", taobao: "淘宝", pdd: "拼多多", shopify: "Shopify", douyin: "抖音", weixin: "微信", jds: "京东" };
  return labels[source] || source || "网页";
}
// ═══════════════════ 数据看板（全屏版） ═══════════════════

var _analyticsCharts = [];

function showAnalytics() {
  var page = document.getElementById("analyticsPage");
  page.style.display = "flex";
  document.getElementById("analytics-loading").style.display = "flex";
  document.getElementById("analytics-content").style.display = "none";

  // 等待 Chart.js 加载完成
  var waitCount = 0;
  var maxWait = 50; // 最多等 5 秒
  function tryLoad() {
    if (typeof Chart !== "undefined") {
      setTimeout(loadAnalytics, 200);
    } else if (waitCount < maxWait) {
      waitCount++;
      setTimeout(tryLoad, 100);
    } else {
      document.getElementById("analytics-loading").innerHTML = '<div style="text-align:center;color:#EF4444;font-size:14px;">图表库加载超时，请<a href="javascript:location.reload()" style="color:#4F46E5;">刷新页面</a>重试</div>';
    }
  }
  tryLoad();
}

function closeAnalytics() {
  document.getElementById("analyticsPage").style.display = "none";
  // 销毁所有图表
  _analyticsCharts.forEach(function(c) { try { c.destroy(); } catch(e) {} });
  _analyticsCharts = [];
}

function _makeChart(id, config) {
  try {
    if (typeof Chart === "undefined") {
      document.getElementById(id).parentNode.innerHTML = "<div style=\"text-align:center;padding:20px;color:#EF4444;font-size:13px;\">Chart.js 未加载，请刷新页面重试</div>";
      return null;
    }
    var canvas = document.getElementById(id);
    if (!canvas) return null;
    var ctx = canvas.getContext("2d");
    var chart = new Chart(ctx, config);
    _analyticsCharts.push(chart);
    return chart;
  } catch(e) {
    console.error("图表 " + id + " 创建失败:", e);
    return null;
  }
}

async function loadAnalytics() {
  try {
    var res = await fetch("/api/analytics");
    var data = await res.json();

    // 概览卡片
    document.getElementById("stat-today").textContent = data.today_conversations;
    document.getElementById("stat-ai").textContent = data.today_ai_responses;
    document.getElementById("stat-resp").textContent = (data.response_time_avg || 0) < 1 ? "<1s" : Math.round(data.response_time_avg) + "s";
    var tr = data.total_conversations > 0 ? Math.round(data.needs_human / data.total_conversations * 100) : 0;
    document.getElementById("stat-transfer").textContent = tr + "%";

    // 隐藏 loading，显示内容
    document.getElementById("analytics-loading").style.display = "none";
    document.getElementById("analytics-content").style.display = "block";

    // 1. 每日对话趋势
    var days = data.daily_trend.map(function(d) { var p = d.day.split("-"); return p[1] + "/" + p[2]; });
    var counts = data.daily_trend.map(function(d) { return d.count; });
    _makeChart("chart-trend", {
      type: "line",
      data: {
        labels: days.length > 0 ? days : ["暂无"],
        datasets: [{ label: "对话数", data: days.length > 0 ? counts : [0], borderColor: "#4F46E5", backgroundColor: "rgba(79,70,229,.1)", fill: true, tension: .4, pointRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { ticks: { maxTicksLimit: 15 } } } }
    });

    // 2. 知识库命中率
    var kt = data.kb_hits + data.kb_misses;
    _makeChart("chart-kb", {
      type: "doughnut",
      data: {
        labels: kt > 0 ? ["命中", "未命中"] : ["暂无数据"],
        datasets: [{ data: kt > 0 ? [data.kb_hits, data.kb_misses] : [1], backgroundColor: kt > 0 ? ["#10B981", "#EF4444"] : ["#E5E7EB"], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });

    // 3. 响应时间分布
    var avg = data.response_time_avg || 0;
    _makeChart("chart-response", {
      type: "bar",
      data: {
        labels: ["<3s", "3-10s", "10-30s", ">30s"],
        datasets: [{
          label: "占比%",
          data: avg < 3 ? [60, 25, 10, 5] : avg < 10 ? [20, 50, 20, 10] : avg < 30 ? [10, 30, 40, 20] : [5, 15, 30, 50],
          backgroundColor: ["#10B981", "#3B82F6", "#F59E0B", "#EF4444"], borderRadius: 4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function(v) { return v + "%"; } } } } }
    });

    // 4. 对话状态分布
    var sr = await fetch("/api/stats");
    var st = await sr.json();
    _makeChart("chart-status", {
      type: "doughnut",
      data: {
        labels: st.total > 0 ? ["等待中", "进行中", "需人工", "已关闭"] : ["暂无"],
        datasets: [{ data: st.total > 0 ? [st.waiting, st.active, st.needs_human, st.closed] : [1], backgroundColor: ["#F59E0B", "#3B82F6", "#EF4444", "#9CA3AF"], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });

  } catch (e) {
    document.getElementById("analytics-loading").innerHTML = "<div style=\"text-align:center;color:#EF4444;\">加载失败：" + e.message + "</div>";
    console.error("看板加载失败:", e);
  }
}


