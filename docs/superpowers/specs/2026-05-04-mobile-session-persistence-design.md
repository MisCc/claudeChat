# Mobile Session Persistence & Restoration Design

## Overview

Add client-side session persistence to the mobile chat interface, enabling users to store conversation history in localStorage, auto-restore the last active session on page load, and switch between historical sessions to continue conversations.

## Goals

- Store all session data (messages, metadata) in the phone's localStorage
- Auto-restore the last active session when the page loads
- Provide a session list UI for browsing and switching between sessions
- Allow continuing conversations from any historical session via Claude CLI `--resume`
- Keep backend changes minimal (pure relay philosophy)

## Non-Goals

- Server-side persistence (aligns with "后端纯转发" design)
- Multi-device sync
- IndexedDB or Service Worker complexity

## Data Model

### localStorage Keys

**`chat_sessions`** — Array of session objects:

```json
[
  {
    "id": "local-1714828800000",
    "title": "帮我写一个函数",
    "claudeSessionId": "abc123def456",
    "messages": [
      {
        "role": "user",
        "content": "帮我写一个排序函数",
        "time": 1714828800000
      },
      {
        "role": "assistant",
        "content": "好的，这是一个快速排序实现...",
        "time": 1714828805000
      }
    ],
    "createdAt": 1714828800000,
    "updatedAt": 1714828860000
  }
]
```

**`chat_active_session`** — String ID of the currently active session.

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Client-generated unique ID (timestamp-based) |
| `title` | string | Auto-generated from first user message, truncated to 20 chars |
| `claudeSessionId` | string | Claude CLI session ID returned by backend, used for `--resume` |
| `messages` | array | Ordered list of user/assistant message pairs |
| `messages[].role` | string | `"user"` or `"assistant"` |
| `messages[].content` | string | Full message text |
| `messages[].time` | number | Unix timestamp (ms) |
| `createdAt` | number | Session creation timestamp |
| `updatedAt` | number | Last message timestamp |

## Backend Changes

### server.js

Add one new WebSocket message type in the existing message handler:

```js
case 'switch_session':
  currentSessionId = msg.sessionId;
  ws.send(JSON.stringify({ type: 'session_switched', sessionId: currentSessionId }));
  break;
```

This is the only backend change. The existing `session_id` propagation from Claude CLI responses already provides the `claudeSessionId` value that the frontend needs.

## Frontend Changes

### app.js — SessionManager Module

A new module managing all localStorage operations:

```js
const SessionManager = {
  // Get all sessions
  getSessions() { ... },

  // Get active session ID
  getActiveSessionId() { ... },

  // Get session by ID
  getSession(id) { ... },

  // Create new session, returns session object
  createSession() { ... },

  // Save/update a session
  saveSession(session) { ... },

  // Set active session
  setActiveSession(id) { ... },

  // Delete a session
  deleteSession(id) { ... },

  // Add message to active session
  addMessage(role, content) { ... },

  // Update claudeSessionId for active session
  setClaudeSessionId(sessionId) { ... },

  // Get total storage size (approximate)
  getStorageSize() { ... },

  // Enforce max sessions limit (20)
  enforceLimit() { ... }
};
```

### app.js — Session List UI

A slide-out drawer or dropdown showing all sessions:

- Each item shows: session title, last message preview, timestamp
- Active session highlighted
- Swipe-to-delete or long-press to delete
- "+" button to create new session
- Empty state when no sessions exist

### app.js — Page Load Restoration

```
1. Read chat_active_session from localStorage
2. If exists and session found in chat_sessions:
   a. Load messages into UI
   b. Send switch_session to backend
   c. Server replays history (existing behavior)
3. If no active session:
   a. Create new session
   b. Show empty state
```

### app.js — Message Flow Update

Current flow → Updated flow:

1. User sends message → **Save to current session in localStorage**
2. Backend returns stream chunks → Display as before
3. Stream completes → **Save assistant response to session in localStorage**
4. If backend returns new `session_id` → **Update session's claudeSessionId**

### app.js — Session Switching

```
1. User taps session in list
2. SessionManager.setActiveSession(id)
3. Send { type: "switch_session", sessionId: session.claudeSessionId }
4. Clear current UI messages
5. Load selected session's messages into UI
6. Close drawer
```

## Storage Management

- **Max sessions**: 20 (oldest auto-deleted when exceeded)
- **Storage limit warning**: When localStorage approaches 5MB, show toast suggesting cleanup
- **Message truncation**: If a single message exceeds 10KB, truncate with "[消息过长，已截断]"

## Edge Cases

| Scenario | Handling |
|----------|----------|
| localStorage full | Show cleanup prompt, prevent new session creation |
| Claude session expired | Mark session as "unrecoverable", still show history |
| Backend restarted | Frontend reconnects, restores session, sends switch_session |
| First-time user | Create new session, show empty state |
| Clear browser data | Sessions lost, start fresh (Claude CLI sessions still exist) |

## UI Mockup

### Session List (Drawer)

```
┌─────────────────────────┐
│  会话列表            [+] │
├─────────────────────────┤
│ ● 帮我写一个排序函数     │
│   2 分钟前 · 6 条消息    │
├─────────────────────────┤
│   解释一下 React hooks   │
│   1 小时前 · 12 条消息   │
├─────────────────────────┤
│   写个 Python 爬虫      │
│   昨天 · 8 条消息        │
└─────────────────────────┘
```

## Files to Modify

| File | Changes |
|------|---------|
| `server.js` | Add `switch_session` message handler (1 case block) |
| `public/app.js` | Add SessionManager, session list UI, localStorage integration |
| `public/style.css` | Add drawer/panel styles for session list |
| `public/index.html` | Add session list drawer HTML |

## Testing Plan

1. Create a new session, send messages, verify localStorage persistence
2. Refresh page, verify auto-restoration of last session
3. Create multiple sessions, verify list display and switching
4. Switch to old session, verify Claude `--resume` works
5. Test storage limit handling
6. Test with backend restart (session recovery)
