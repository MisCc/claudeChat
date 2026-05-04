(function() {
  var messagesEl = document.getElementById('messages');
  var inputEl = document.getElementById('msg-input');
  var sendBtn = document.getElementById('send-btn');
  var statusEl = document.getElementById('status');

  var ws = null;
  var reconnectDelay = 1000;
  var maxReconnectDelay = 30000;
  var currentAiBubble = null;
  var currentAiText = '';
  var processingSessionId = null;

  var audioCtx = null;

  var SessionManager = {
    SESSIONS_KEY: 'chat_sessions',
    ACTIVE_KEY: 'chat_active_session',
    MAX_SESSIONS: 20,

    getSessions: function() {
      try {
        return JSON.parse(localStorage.getItem(this.SESSIONS_KEY)) || [];
      } catch (e) {
        return [];
      }
    },

    saveSessions: function(sessions) {
      try {
        localStorage.setItem(this.SESSIONS_KEY, JSON.stringify(sessions));
      } catch (e) {
        console.warn('Failed to save sessions:', e);
      }
    },

    getActiveSessionId: function() {
      return localStorage.getItem(this.ACTIVE_KEY);
    },

    setActiveSessionId: function(id) {
      localStorage.setItem(this.ACTIVE_KEY, id);
    },

    getSession: function(id) {
      var sessions = this.getSessions();
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === id) return sessions[i];
      }
      return null;
    },

    createSession: function() {
      var id = 'local-' + Date.now();
      var session = {
        id: id,
        title: '新会话',
        claudeSessionId: null,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      var sessions = this.getSessions();
      sessions.unshift(session);
      if (sessions.length > this.MAX_SESSIONS) {
        sessions = sessions.slice(0, this.MAX_SESSIONS);
      }
      this.saveSessions(sessions);
      this.setActiveSessionId(id);
      return session;
    },

    addMessage: function(role, content) {
      var id = this.getActiveSessionId();
      if (!id) return;
      var sessions = this.getSessions();
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === id) {
          var session = sessions[i];
          session.messages.push({
            role: role,
            content: content,
            time: Date.now()
          });
          session.updatedAt = Date.now();
          if (role === 'user' && session.messages.length === 1 && session.title === '新会话') {
            session.title = content.substring(0, 20) + (content.length > 20 ? '...' : '');
          }
          this.saveSessions(sessions);
          return;
        }
      }
    },

    setClaudeSessionId: function(claudeSessionId) {
      var id = this.getActiveSessionId();
      if (!id) return;
      var sessions = this.getSessions();
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === id) {
          sessions[i].claudeSessionId = claudeSessionId;
          this.saveSessions(sessions);
          return;
        }
      }
    },

    deleteSession: function(id) {
      var sessions = this.getSessions();
      sessions = sessions.filter(function(s) { return s.id !== id; });
      this.saveSessions(sessions);
      if (this.getActiveSessionId() === id) {
        if (sessions.length > 0) {
          this.setActiveSessionId(sessions[0].id);
        } else {
          localStorage.removeItem(this.ACTIVE_KEY);
        }
      }
    }
  };

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playBeep() {
    if (!audioCtx) return;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start(audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.stop(audioCtx.currentTime + 0.2);
  }

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host);

    ws.onopen = function() {
      reconnectDelay = 1000;
      setStatus('Connected', true);
    };

    ws.onmessage = function(event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (msg.type) {
        case 'status':
          handleStatus(msg.content);
          break;
        case 'stream':
          handleStream(msg.content);
          break;
        case 'done':
          handleDone(msg.content);
          break;
        case 'error':
          handleError(msg.content);
          break;
        case 'history':
          handleHistory(msg.messages);
          break;
        case 'notify':
          playBeep();
          break;
        case 'tool_request':
          handleToolInfo(msg.requests);
          break;
        case 'session_switched':
          if (msg.sessionId) {
            SessionManager.setClaudeSessionId(msg.sessionId);
          }
          break;
      }
    };

    ws.onclose = function() {
      setStatus('Disconnected', false);
      setEnabled(false);
      setTimeout(function() {
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        connect();
      }, reconnectDelay);
    };

    ws.onerror = function() {
      ws.close();
    };
  }

  function handleStatus(status) {
    switch (status) {
      case 'ready':
        processingSessionId = null;
        setStatus('Connected', true);
        setEnabled(true);
        currentAiBubble = null;
        currentAiText = '';
        break;
      case 'thinking':
        processingSessionId = SessionManager.getActiveSessionId();
        setStatus('AI thinking...', false);
        setEnabled(false);
        currentAiText = '';
        currentAiBubble = addMessage('', 'ai');
        break;
      case 'connecting':
        setStatus('Connecting...', false);
        setEnabled(false);
        break;
    }
  }

  function handleStream(text) {
    if (currentAiBubble) {
      currentAiText += text;
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.innerHTML = formatText(currentAiText);
      scrollToBottom();
    }
  }

  function formatText(text) {
    if (!text) return '';
    var html = escapeHtml(text);
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return html;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function detectOptions(text) {
    var lines = text.split('\n');
    var optionLines = [];
    var prefixLines = [];
    var foundOptions = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var match = line.match(/^(\d+)\.\s+(.+)/);
      if (match) {
        foundOptions = true;
        optionLines.push({ num: match[1], text: match[2], full: line });
      } else if (foundOptions) {
        break;
      } else {
        prefixLines.push(line);
      }
    }

    if (optionLines.length < 2) return null;
    return { prefix: prefixLines.join('\n'), options: optionLines };
  }

  function renderOptions(result, prefix) {
    var container = document.createElement('div');
    container.className = 'msg ai';

    if (prefix && prefix.trim()) {
      var prefixBubble = document.createElement('div');
      prefixBubble.className = 'bubble';
      prefixBubble.innerHTML = formatText(prefix);
      container.appendChild(prefixBubble);
    }

    var optionGroup = document.createElement('div');
    optionGroup.className = 'option-group';

    for (var i = 0; i < result.options.length; i++) {
      var opt = result.options[i];
      var btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.setAttribute('data-option', opt.num);

      var numSpan = document.createElement('span');
      numSpan.className = 'opt-num';
      numSpan.textContent = opt.num;

      var textSpan = document.createElement('span');
      textSpan.className = 'opt-text';
      textSpan.textContent = opt.text;

      btn.appendChild(numSpan);
      btn.appendChild(textSpan);

      btn.onclick = (function(num, btnEl) {
        return function() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'select_option', content: num }));
            var allBtns = optionGroup.querySelectorAll('.option-btn');
            for (var j = 0; j < allBtns.length; j++) {
              allBtns[j].disabled = true;
              allBtns[j].classList.add('disabled');
            }
            btnEl.classList.add('selected');
            addMessage(num, 'user');
          }
        };
      })(opt.num, btn);
      optionGroup.appendChild(btn);
    }

    container.appendChild(optionGroup);
    messagesEl.appendChild(container);
    scrollToBottom();
    return container;
  }

  function handleDone(fullText) {
    if (currentAiBubble && fullText) {
      var result = detectOptions(fullText);
      if (result) {
        currentAiBubble.remove();
        renderOptions(result, result.prefix);
      } else {
        var bubbleEl = currentAiBubble.querySelector('.bubble');
        bubbleEl.innerHTML = formatText(fullText);
      }
    }
    if (fullText) {
      SessionManager.addMessage('assistant', fullText);
    }
    currentAiBubble = null;
    currentAiText = '';
    scrollToBottom();
    playBeep();
  }

  function handleError(errMsg) {
    if (currentAiBubble) {
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.className = 'bubble error';
      bubbleEl.textContent = 'Error: ' + errMsg;
      currentAiBubble = null;
      currentAiText = '';
    } else {
      var msgDiv = document.createElement('div');
      msgDiv.className = 'msg ai';

      var bubble = document.createElement('div');
      bubble.className = 'bubble error';
      bubble.textContent = 'Error: ' + errMsg;

      msgDiv.appendChild(bubble);
      messagesEl.appendChild(msgDiv);
    }
    scrollToBottom();
  }

  function handleHistory(messages) {
    if (messagesEl.children.length > 0) return;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      addMessage(m.content, m.role === 'user' ? 'user' : 'ai');
    }
    scrollToBottom();
  }

  var pendingToolRequests = [];

  function handleToolInfo(requests) {
    for (var i = 0; i < requests.length; i++) {
      var r = requests[i];
      var inputStr = r.input;
      try {
        var parsed = JSON.parse(r.input);
        inputStr = formatToolInput(r.tool, parsed);
      } catch (e) {}
      var toolText = '🔧 ' + r.tool + '\n' + inputStr;
      addMessage(toolText, 'ai');
    }
  }

  function formatToolInput(toolName, input) {
    var lines = [];
    if (toolName === 'Bash' && input.command) {
      lines.push('$ ' + input.command);
    } else if (toolName === 'Read' && input.file_path) {
      lines.push('📄 ' + input.file_path);
    } else if (toolName === 'Write' && input.file_path) {
      lines.push('📝 ' + input.file_path);
    } else if (toolName === 'Edit') {
      if (input.file_path) lines.push('📝 ' + input.file_path);
      if (input.old_string) lines.push('旧: ' + input.old_string.substring(0, 80));
      if (input.new_string) lines.push('新: ' + input.new_string.substring(0, 80));
    } else if (toolName === 'Glob') {
      if (input.pattern) lines.push('🔍 ' + input.pattern);
    } else if (toolName === 'Grep') {
      if (input.pattern) lines.push('🔍 ' + input.pattern);
    } else if (toolName === 'TodoWrite' && input.todos) {
      for (var j = 0; j < input.todos.length; j++) {
        var t = input.todos[j];
        var icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '⏳' : '⬜';
        lines.push(icon + ' ' + t.content);
      }
    } else {
      var keys = Object.keys(input);
      for (var k = 0; k < keys.length; k++) {
        var val = String(input[keys[k]]);
        if (val.length > 100) val = val.substring(0, 100) + '...';
        lines.push(keys[k] + ': ' + val);
      }
    }
    return lines.join('\n');
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    SessionManager.addMessage('user', text);
    addMessage(text, 'user');
    inputEl.value = '';
    setEnabled(false);

    ws.send(JSON.stringify({ type: 'chat', content: text }));
  }

  function addMessage(text, type, isError) {
    var msgDiv = document.createElement('div');
    msgDiv.className = 'msg ' + type;

    var bubble = document.createElement('div');
    bubble.className = 'bubble' + (isError ? ' error' : '');
    if (type === 'ai') {
      bubble.innerHTML = formatText(text);
    } else {
      bubble.textContent = text;
    }

    msgDiv.appendChild(bubble);
    messagesEl.appendChild(msgDiv);
    scrollToBottom();
    return msgDiv;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(text, connected) {
    statusEl.textContent = text;
    statusEl.style.opacity = connected ? '1' : '0.7';
  }

  function setEnabled(enabled) {
    sendBtn.disabled = !enabled;
    inputEl.disabled = !enabled;
    if (enabled) {
      inputEl.focus();
    }
  }

  // ── Session Drawer ──
  var drawerEl = document.getElementById('session-drawer');
  var drawerOverlay = document.getElementById('drawer-overlay');
  var menuBtn = document.getElementById('menu-btn');
  var newSessionBtn = document.getElementById('new-session-btn');
  var sessionListEl = document.getElementById('session-list');

  function openDrawer() {
    drawerEl.classList.remove('hidden');
    requestAnimationFrame(function() {
      drawerEl.classList.add('open');
    });
    renderSessionList();
  }

  function closeDrawer() {
    drawerEl.classList.remove('open');
    setTimeout(function() {
      drawerEl.classList.add('hidden');
    }, 250);
  }

  function renderSessionList() {
    var sessions = SessionManager.getSessions();
    var activeId = SessionManager.getActiveSessionId();
    sessionListEl.innerHTML = '';

    if (sessions.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'session-empty';
      empty.textContent = '暂无会话，点击 + 开始新对话';
      sessionListEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var item = document.createElement('div');
      item.className = 'session-item' + (s.id === activeId ? ' active' : '');
      item.setAttribute('data-id', s.id);

      var title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = s.title;

      var meta = document.createElement('div');
      meta.className = 'session-meta';
      var msgCount = s.messages.length;
      var timeDiff = Date.now() - s.updatedAt;
      var timeStr = timeDiff < 60000 ? '刚刚' :
                    timeDiff < 3600000 ? Math.floor(timeDiff / 60000) + ' 分钟前' :
                    timeDiff < 86400000 ? Math.floor(timeDiff / 3600000) + ' 小时前' :
                    Math.floor(timeDiff / 86400000) + ' 天前';
      meta.textContent = timeStr + ' · ' + msgCount + ' 条消息';

      var delBtn = document.createElement('button');
      delBtn.className = 'session-delete';
      delBtn.textContent = '×';
      delBtn.onclick = (function(sessionId) {
        return function(e) {
          e.stopPropagation();
          SessionManager.deleteSession(sessionId);
          renderSessionList();
          var aid = SessionManager.getActiveSessionId();
          if (aid) {
            restoreSession(aid);
          } else {
            SessionManager.createSession();
            messagesEl.innerHTML = '';
          }
        };
      })(s.id);

      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(delBtn);

      item.onclick = (function(id) {
        return function() {
          switchToSession(id);
          closeDrawer();
        };
      })(s.id);

      sessionListEl.appendChild(item);
    }
  }

  function switchToSession(id) {
    var session = SessionManager.getSession(id);
    if (!session) return;

    var prevActiveId = SessionManager.getActiveSessionId();
    var switchingFromProcessing = (processingSessionId === prevActiveId);

    SessionManager.setActiveSessionId(id);
    messagesEl.innerHTML = '';

    for (var i = 0; i < session.messages.length; i++) {
      var m = session.messages[i];
      addMessage(m.content, m.role === 'user' ? 'user' : 'ai');
    }
    scrollToBottom();

    if (switchingFromProcessing && processingSessionId !== id) {
      currentAiBubble = null;
      currentAiText = '';
      setStatus('Connected', true);
      setEnabled(true);
    }

    if (session.claudeSessionId && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'switch_session', sessionId: session.claudeSessionId }));
    }

    var lastMsg = session.messages.length > 0 ? session.messages[session.messages.length - 1] : null;
    if (lastMsg && lastMsg.role === 'user' && processingSessionId !== id) {
      setTimeout(function() {
        if (ws && ws.readyState === WebSocket.OPEN && !processingSessionId) {
          ws.send(JSON.stringify({ type: 'chat', content: '请继续' }));
        }
      }, 300);
    }
  }

  function restoreSession(id) {
    var session = SessionManager.getSession(id);
    if (!session) return;

    messagesEl.innerHTML = '';
    for (var i = 0; i < session.messages.length; i++) {
      var m = session.messages[i];
      addMessage(m.content, m.role === 'user' ? 'user' : 'ai');
    }
    scrollToBottom();

    if (session.claudeSessionId && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'switch_session', sessionId: session.claudeSessionId }));
    }
  }

  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('click', initAudio, { once: true });

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      sendMessage();
    }
  });

  menuBtn.addEventListener('click', openDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
  newSessionBtn.addEventListener('click', function() {
    var session = SessionManager.createSession();
    messagesEl.innerHTML = '';
    closeDrawer();
  });

  setEnabled(false);
  connect();

  // ── Auto-restore last session ──
  (function restoreOnLoad() {
    var activeId = SessionManager.getActiveSessionId();
    if (activeId && SessionManager.getSession(activeId)) {
      restoreSession(activeId);
    } else {
      SessionManager.createSession();
    }
  })();
})();
