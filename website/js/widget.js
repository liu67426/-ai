// ─── 客户侧聊天浮窗 ───
(function() {
  const CONFIG = window.ZHILIAN_CONFIG || {};
  const SERVER_URL = CONFIG.serverUrl || "";
  const BOT_NAME = CONFIG.botName || "小智";
  const PRIMARY_COLOR = CONFIG.primaryColor || "#4F46E5";

  let conversationId = null;
  let messages = [];
  let isOpen = false;
  let isLoading = false;

  // 样式
  const style = document.createElement("style");
  style.textContent = `
    .zl-widget * { box-sizing: border-box; margin: 0; padding: 0; }
    .zl-widget-trigger {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 56px; height: 56px; border-radius: 50%;
      background: ${PRIMARY_COLOR}; color: white; border: none;
      cursor: pointer; box-shadow: 0 4px 16px ${PRIMARY_COLOR}66;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; transition: all .25s;
    }
    .zl-widget-trigger:hover { transform: scale(1.08); }
    .zl-unread-badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 20px; height: 20px; padding: 0 5px;
      background: #EF4444; color: white; border-radius: 10px;
      font-size: 11px; font-weight: 700; display: none; align-items: center; justify-content: center;
    }
    .zl-widget-window {
      position: fixed; bottom: 92px; right: 24px; z-index: 999999;
      width: 380px; height: 580px; max-height: calc(100vh - 120px);
      background: white; border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0,0,0,.2);
      display: none; flex-direction: column; overflow: hidden;
      animation: zlIn .3s ease;
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    }
    @keyframes zlIn { from { opacity: 0; transform: translateY(16px) scale(.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .zl-widget-window.open { display: flex; }
    .zl-w-header { padding: 16px 20px; background: ${PRIMARY_COLOR}; color: white; display: flex; align-items: center; gap: 10px; }
    .zl-w-avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.2); display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .zl-w-info { flex: 1; }
    .zl-w-name { font-weight: 700; font-size: 14px; }
    .zl-w-status { font-size: 11px; opacity: .8; }
    .zl-w-close { background: none; border: none; color: white; opacity: .8; cursor: pointer; font-size: 20px; padding: 4px; line-height: 1; }
    .zl-w-close:hover { opacity: 1; }
    .zl-w-body { flex: 1; overflow-y: auto; padding: 16px; background: #F9FAFB; }
    .zl-w-msg { margin-bottom: 12px; display: flex; gap: 8px; }
    .zl-w-msg.user { flex-direction: row-reverse; }
    .zl-w-msg .zl-wb { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; word-break: break-word; }
    .zl-w-msg.bot .zl-wb { background: white; color: #1F2937; border: 1px solid #E5E7EB; border-top-left-radius: 4px; }
    .zl-w-msg.user .zl-wb { background: ${PRIMARY_COLOR}; color: white; border-top-right-radius: 4px; }
    .zl-w-footer { padding: 12px 16px; border-top: 1px solid #E5E7EB; background: white; }
    .zl-w-input-row { display: flex; gap: 8px; }
    .zl-w-input-row input { flex: 1; padding: 10px 14px; border: 1.5px solid #E5E7EB; border-radius: 24px; font-size: 13px; outline: none; }
    .zl-w-input-row input:focus { border-color: ${PRIMARY_COLOR}; }
    .zl-w-send { width: 38px; height: 38px; border-radius: 50%; background: ${PRIMARY_COLOR}; color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 16px; }
    .zl-w-send:disabled { opacity: .5; cursor: not-allowed; }
    .zl-transfer-btn { background:none; border:none; color:#9CA3AF; cursor:pointer; text-decoration:underline; font-size:11px; padding:2px 4px; }
    .zl-transfer-btn:hover { color:#4F46E5; }
    .zl-transfer-btn:disabled { color:#9CA3AF; cursor:default; text-decoration:none; }
    .zl-typing { display: flex; align-items: center; gap: 4px; padding: 4px; }
    .zl-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: #9CA3AF; animation: zlBounce 1.4s infinite; }
    .zl-typing-dot:nth-child(2) { animation-delay: .2s; }
    .zl-typing-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes zlBounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }
    @media (max-width: 480px) { .zl-widget-window { width: 100vw; height: 100vh; bottom: 0; right: 0; border-radius: 0; max-height: 100vh; } }
  `;
  document.head.appendChild(style);

  // DOM
  const widgetDiv = document.getElementById("zhilian-widget") || document.body;

  const trigger = document.createElement("button");
  trigger.className = "zl-widget-trigger";
  trigger.innerHTML = '\uD83D\uDCD8 <span class="zl-unread-badge" id="zl-unread">0</span>';
  trigger.onclick = function() { toggleWidget(); };

  const window_ = document.createElement("div");
  window_.className = "zl-widget-window";
  window_.innerHTML = [
    '<div class="zl-w-header">',
    '  <div class="zl-w-avatar">\uD83E\uDD16</div>',
    '  <div class="zl-w-info">',
    '    <div class="zl-w-name">' + BOT_NAME + '</div>',
    '    <div class="zl-w-status">在线 | 通常几秒内回复</div>',
    '  </div>',
    '  <button class="zl-w-close" onclick="closeWidget()">\u2715</button>',
    '</div>',
    '<div class="zl-w-body" id="zl-w-body"><div style="text-align:center;padding:20px;color:#9CA3AF;font-size:13px;">正在连接...</div></div>',
    '<div class="zl-w-footer">',
    '  <div class="zl-w-input-row">',
    '    <input type="text" id="zl-input" placeholder="输入您的问题..." onkeydown="if(event.key===\'Enter\')sendWidgetMsg()">',
    '    <button class="zl-w-send" id="zl-send-btn" onclick="sendWidgetMsg()">\u27A1</button>',
    '  </div>',
    '  <div style="text-align:center;margin-top:6px;"><button id="zl-transfer-btn" class="zl-transfer-btn" onclick="transferToHuman()">\uD83D\uDCDE 转人工客服</button></div>',
    '</div>'
  ].join("\n");

  widgetDiv.appendChild(trigger);
  widgetDiv.appendChild(window_);

  // closeWidget needs to be global
  window.closeWidget = function() {
    document.querySelector(".zl-widget-window").classList.remove("open");
    document.querySelector(".zl-widget-trigger").style.display = "flex";
    isOpen = false;
  };

  // toggleWidget
  window.toggleWidget = function() {
    isOpen = !isOpen;
    window_.classList.toggle("open", isOpen);
    trigger.style.display = isOpen ? "none" : "flex";
    if (isOpen && !conversationId) { initWidget(); }
    if (isOpen) {
      document.getElementById("zl-unread").style.display = "none";
      setTimeout(function() {
        var bd = document.getElementById("zl-w-body");
        if (bd) bd.scrollTop = bd.scrollHeight;
      }, 100);
    }
  };

  // 初始化对话
  window.initWidget = async function() {
    try {
      var res = await fetch(SERVER_URL + "/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: "访客" })
      });
      var data = await res.json();
      conversationId = data.id;
      messages = [{ role: "assistant", content: data.welcome }];
      renderWidgetMessages();
    } catch (e) {
      document.getElementById("zl-w-body").innerHTML = '<div style="text-align:center;padding:20px;color:#EF4444;font-size:13px;">连接失败，请刷新重试</div>';
    }
  };

  // 渲染消息
  window.renderWidgetMessages = function() {
    var body = document.getElementById("zl-w-body");
    body.innerHTML = messages.map(function(m) {
      return "<div class=\"zl-w-msg " + (m.role === "user" ? "user" : "bot") + "\"><div class=\"zl-wb\">" + escapeHtml(m.content) + "</div></div>";
    }).join("");
    body.scrollTop = body.scrollHeight;
  };

  // 发送消息
  window.sendWidgetMsg = async function() {
    var input = document.getElementById("zl-input");
    var btn = document.getElementById("zl-send-btn");
    var msg = input.value.trim();
    if (!msg || isLoading || !conversationId) return;

    input.value = "";
    btn.disabled = true;
    isLoading = true;

    messages.push({ role: "user", content: msg });
    renderWidgetMessages();

    // 打字指示器
    var body = document.getElementById("zl-w-body");
    var typingDiv = document.createElement("div");
    typingDiv.className = "zl-w-msg bot";
    typingDiv.id = "zl-typing";
    typingDiv.innerHTML = "<div class=\"zl-wb\"><div class=\"zl-typing\"><span class=\"zl-typing-dot\"></span><span class=\"zl-typing-dot\"></span><span class=\"zl-typing-dot\"></span></div></div>";
    body.appendChild(typingDiv);
    body.scrollTop = body.scrollHeight;

    try {
      var res = await fetch(SERVER_URL + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message: msg })
      });

      if (!res.ok) {
        var err = await res.json();
        document.getElementById("zl-typing").remove();
        messages.push({ role: "assistant", content: "抱歉，我暂时无法回复。" + (err.error || "") });
        renderWidgetMessages();
        isLoading = false; btn.disabled = false;
        return;
      }

      document.getElementById("zl-typing").remove();

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var fullContent = "";

      var aiMsgDiv = document.createElement("div");
      aiMsgDiv.className = "zl-w-msg bot";
      aiMsgDiv.innerHTML = '<div class="zl-wb" id="zl-streaming"></div>';
      body.appendChild(aiMsgDiv);

      while (true) {
        var r = await reader.read();
        if (r.done) break;
        var chunk = decoder.decode(r.value);
        var lines = chunk.split("\n").filter(function(l) { return l.startsWith("data: "); });
        for (var _i = 0; _i < lines.length; _i++) {
          try {
            var d = JSON.parse(lines[_i].slice(6));
            if (d.content) {
              fullContent += d.content;
              document.getElementById("zl-streaming").textContent = fullContent;
              body.scrollTop = body.scrollHeight;
            }
            if (d.done && fullContent) {
              messages.push({ role: "assistant", content: fullContent });
              if (d.needs_human) {
                setTimeout(function() {
                  var sb = document.getElementById("zl-suggestion-bar");
                  if (sb) return;
                  var bar = document.createElement("div");
                  bar.id = "zl-suggestion-bar";
                  bar.style.cssText = "text-align:center;padding:8px 12px;font-size:12px;color:#6B7280;";
                  bar.innerHTML = "<span>如果没有解决您的问题，</span><button onclick=\"transferToHuman()\" style=\"background:none;border:none;color:#4F46E5;cursor:pointer;text-decoration:underline;font-size:12px;\">点击转接人工客服</button>";
                  body.appendChild(bar);
                  body.scrollTop = body.scrollHeight;
                }, 300);
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      var t = document.getElementById("zl-typing");
      if (t) t.remove();
      messages.push({ role: "assistant", content: "网络连接异常，请稍后重试。" });
      renderWidgetMessages();
    }

    isLoading = false;
    btn.disabled = false;
    body.scrollTop = body.scrollHeight;
  };

  // 转人工
  window.transferToHuman = async function() {
    if (!conversationId) return;
    var btn = document.getElementById("zl-transfer-btn");
    btn.disabled = true;
    btn.textContent = "\u23F3 转接中...";
    try {
      var res = await fetch(SERVER_URL + "/api/conversations/" + conversationId + "/transfer", { method: "POST" });
      if (res.ok) {
        messages.push({ role: "assistant", content: "\uD83D\uDCDE 已转接人工客服，请稍候，客服人员将尽快为您服务！" });
        renderWidgetMessages();
        btn.textContent = "\u2705 已转接";
        btn.style.color = "#10B981";
      } else {
        btn.disabled = false;
        btn.textContent = "\uD83D\uDCDE 转人工客服";
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "\uD83D\uDCDE 转人工客服";
    }
  };

  function escapeHtml(str) {
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  window.ZHILIAN = {
    open: function() { if (!isOpen) toggleWidget(); },
    close: function() { if (isOpen) closeWidget(); },
    setConversation: function(id) { conversationId = id; },
  };

  console.log("  智联AI客服已加载");
})();
