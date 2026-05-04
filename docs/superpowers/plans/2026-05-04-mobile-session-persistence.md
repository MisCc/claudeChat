# Mobile Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side session persistence to the mobile chat, enabling auto-restore, session list, and session switching via localStorage.

**Architecture:** Frontend manages all session data in localStorage. Backend adds one WebSocket message type (`switch_session`) to set the Claude CLI session ID. SessionManager module handles CRUD operations. A slide-out drawer provides session list UI.

**Tech Stack:** Vanilla JS, localStorage, WebSocket, Express (existing)

---

## File Structure

| File | Role |
|------|------|
| `server.js` | Add `switch_session` case in WebSocket handler (line 235) |
| `public/app.js` | Add SessionManager module, integrate persistence into existing message flow |
| `public/index.html` | Add session drawer HTML + hamburger button |
| `public/style.css` | Add drawer/overlay/panel styles |

---

### Task 1: Backend — Add `switch_session` Handler

**Files:**
- Modify: `server.js:235-239`

- [ ] **Step 1: Add switch_session case**

In `server.js`, after the `select_option` handler (line 239), add:

```js
if (msg.type === 'switch_session' && msg.sessionId) {
  currentSessionId = msg.sessionId;
  safeSend(ws, JSON.stringify({ type: 'session_switched', sessionId: currentSessionId }));
}
```

- [ ] **Step 2: Verify server starts**

Run: `node server.js`
Expected: Server starts normally, QR code generated. No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add switch_session WebSocket handler"
```

---

### Task 2: Frontend — SessionManager Module

**Files:**
- Modify: `public/app.js` (add module at top of IIFE, before existing code)

- [ ] **Step 1: Add SessionManager module**

At the top of the IIFE in `app.js` (after `var audioCtx = null;` on line 13), add the complete SessionManager:

```js
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
```

- [ ] **Step 2: Verify no syntax errors**

Open browser dev tools console, reload page. Expected: No errors related to SessionManager.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add SessionManager module for localStorage persistence"
```

---

### Task 3: Frontend — Session List Drawer HTML + CSS

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`

- [ ] **Step 1: Add drawer HTML to index.html**

Before the `<script>` tag in `index.html`, add:

```html
  <div id="session-drawer" class="drawer hidden">
    <div class="drawer-overlay" id="drawer-overlay"></div>
    <div class="drawer-panel">
      <div class="drawer-header">
        <span class="drawer-title">会话列表</span>
        <button id="new-session-btn" class="drawer-action">+</button>
      </div>
      <div id="session-list" class="session-list"></div>
    </div>
  </div>
```

Also add a hamburger button in the header, before the title span:

```html
      <button id="menu-btn" class="menu-btn">&#9776;</button>
```

- [ ] **Step 2: Add drawer CSS to style.css**

Append to the end of `style.css`:

```css
/* ── Session Drawer ── */
.menu-btn {
  background: none;
  border: none;
  color: #fff;
  font-size: 22px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.2s;
}

.menu-btn:active {
  background: rgba(255,255,255,0.2);
}

.drawer {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
}

.drawer.hidden {
  display: none;
}

.drawer-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.drawer-panel {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px;
  background: #fff;
  box-shadow: 4px 0 20px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
}

.drawer.open .drawer-panel {
  transform: translateX(0);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 16px 12px;
  border-bottom: 1px solid #eee;
}

.drawer-title {
  font-size: 17px;
  font-weight: 700;
  color: #333;
}

.drawer-action {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #06ae56, #059a4c);
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s;
}

.drawer-action:active {
  transform: scale(0.92);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.session-item {
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.session-item:active {
  background: #f5f5f5;
}

.session-item.active {
  background: #f0fdf4;
  border-left: 3px solid #06ae56;
}

.session-item .session-title {
  font-size: 15px;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.session-item .session-meta {
  font-size: 12px;
  color: #999;
}

.session-item .session-delete {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: #f0f0f0;
  color: #999;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.session-item:hover .session-delete {
  opacity: 1;
}

.session-item .session-delete:active {
  background: #fee;
  color: #d32f2f;
}

.session-empty {
  padding: 40px 20px;
  text-align: center;
  color: #aaa;
  font-size: 14px;
}
```

- [ ] **Step 3: Verify drawer renders**

Reload page. Expected: Hamburger button visible in header. Clicking it should open drawer (even without JS wiring yet, the HTML/CSS should be present).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: add session drawer HTML and CSS"
```

---

### Task 4: Frontend — Drawer Toggle + Session List Rendering

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add drawer toggle and list rendering functions**

In `app.js`, after the `setEnabled` function (around line 356), add:

```js
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
      delBtn.onclick = (function(id, e) {
        e.stopPropagation();
        SessionManager.deleteSession(id);
        renderSessionList();
        var activeId = SessionManager.getActiveSessionId();
        if (activeId) {
          restoreSession(activeId);
        } else {
          SessionManager.createSession();
          messagesEl.innerHTML = '';
        }
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

    SessionManager.setActiveSessionId(id);
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
```

- [ ] **Step 2: Wire up event listeners**

After the existing `sendBtn.addEventListener` and `inputEl.addEventListener` blocks (around line 367), add:

```js
  menuBtn.addEventListener('click', openDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
  newSessionBtn.addEventListener('click', function() {
    var session = SessionManager.createSession();
    messagesEl.innerHTML = '';
    closeDrawer();
  });
```

- [ ] **Step 3: Verify drawer opens/closes**

Reload page, click hamburger. Expected: Drawer slides in from left, shows empty state. Click overlay or + button. Expected: Drawer closes, new session created.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add session drawer toggle and list rendering"
```

---

### Task 5: Frontend — Persist Messages to localStorage

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Integrate persistence into message flow**

Modify the `sendMessage` function to save user messages. Replace the existing `sendMessage` function (line 312-321):

```js
  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    SessionManager.addMessage('user', text);
    addMessage(text, 'user');
    inputEl.value = '';
    setEnabled(false);

    ws.send(JSON.stringify({ type: 'chat', content: text }));
  }
```

Modify `handleDone` to save assistant responses. In the `handleDone` function (line 217-232), after the `playBeep()` call, add:

```js
    if (fullText) {
      SessionManager.addMessage('assistant', fullText);
    }
```

Also modify `handleStream` to save the final assistant text when done streaming. Actually, the cleanest approach is to save in `handleDone` since that's when the full response is available. The `handleDone` already receives `fullText`.

Modify the `ws.onmessage` handler to capture `session_id` from backend. In the `switch` statement (line 54-76), add a new case:

```js
        case 'session_switched':
          if (msg.sessionId) {
            SessionManager.setClaudeSessionId(msg.sessionId);
          }
          break;
```

- [ ] **Step 2: Verify messages persist**

1. Open page, send a message, get a response
2. Refresh page
3. Expected: Previous messages are gone from UI (because we haven't added auto-restore yet), but check localStorage in dev tools: `chat_sessions` should contain the messages.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: persist chat messages to localStorage"
```

---

### Task 6: Frontend — Auto-Restore on Page Load

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add auto-restore logic**

In `app.js`, at the very end of the IIFE (before the closing `})();`), after `connect();`, add:

```js
  // ── Auto-restore last session ──
  (function restoreOnLoad() {
    var activeId = SessionManager.getActiveSessionId();
    if (activeId && SessionManager.getSession(activeId)) {
      restoreSession(activeId);
    } else {
      SessionManager.createSession();
    }
  })();
```

- [ ] **Step 2: Verify auto-restore**

1. Open page, send messages, get responses
2. Refresh page
3. Expected: Previous messages appear automatically in the UI. The backend also replays history, but the frontend restore from localStorage is instant.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: auto-restore last session on page load"
```

---

### Task 7: Frontend — Handle Backend History Replay Coexistence

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Prevent duplicate messages from history replay**

The backend replays `messageHistory` via `{ type: 'history' }` on connect. When we auto-restore from localStorage, the backend's history replay would duplicate messages. Modify `handleHistory` to check if we already have messages loaded:

Replace the existing `handleHistory` function (line 255-262):

```js
  function handleHistory(messages) {
    if (messagesEl.children.length > 0) return;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      addMessage(m.content, m.role === 'user' ? 'user' : 'ai');
    }
    scrollToBottom();
  }
```

- [ ] **Step 2: Verify no duplicate messages**

1. Send messages, refresh page
2. Expected: Messages appear once from localStorage restore, not duplicated by backend history replay.
3. Open a completely fresh browser (no localStorage): Expected: Backend history replay works as fallback.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "fix: prevent duplicate messages from history replay"
```

---

### Task 8: Integration Test — Full Flow Verification

**Files:** None (manual testing)

- [ ] **Step 1: Test new session creation**

1. Open page in mobile browser
2. Verify empty state or auto-restored session
3. Send a message, verify response appears
4. Check localStorage: `chat_sessions` should have 1 entry with messages

- [ ] **Step 2: Test session persistence**

1. Refresh page
2. Verify previous messages are restored
3. Send another message, verify it appends to the same session

- [ ] **Step 3: Test session list**

1. Click hamburger menu
2. Verify session appears in list with correct title and time
3. Click + to create new session
4. Verify new empty session created, drawer closes

- [ ] **Step 4: Test session switching**

1. Create 2-3 sessions with messages
2. Open drawer, click on an older session
3. Verify UI shows that session's messages
4. Send a message in the old session, verify it continues

- [ ] **Step 5: Test session deletion**

1. Open drawer, long-press or hover on a session
2. Click delete button
3. Verify session removed from list

- [ ] **Step 6: Test backend restart recovery**

1. Send messages in a session
2. Restart server (`node server.js`)
3. Refresh phone page
4. Verify localStorage restores messages and `--resume` works

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: mobile session persistence and restoration"
```
