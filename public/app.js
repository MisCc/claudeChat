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

  var audioCtx = null;

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
          handleToolRequest(msg.requests);
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
        setStatus('Connected', true);
        setEnabled(true);
        currentAiBubble = null;
        currentAiText = '';
        break;
      case 'thinking':
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
      bubbleEl.textContent = currentAiText;
      scrollToBottom();
    }
  }

  function handleDone(fullText) {
    if (currentAiBubble && fullText) {
      var bubbleEl = currentAiBubble.querySelector('.bubble');
      bubbleEl.textContent = fullText;
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
      addMessage('Error: ' + errMsg, 'ai', true);
    }
    scrollToBottom();
  }

  function handleHistory(messages) {
    messagesEl.innerHTML = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      addMessage(m.content, m.role === 'user' ? 'user' : 'ai');
    }
    scrollToBottom();
  }

  var toolModal = document.getElementById('tool-modal');
  var toolList = document.getElementById('tool-list');
  var toolCount = document.getElementById('tool-count');
  var approveAllBtn = document.getElementById('approve-all');
  var rejectAllBtn = document.getElementById('reject-all');
  var pendingToolRequests = [];

  function handleToolRequest(requests) {
    pendingToolRequests = requests;
    toolCount.textContent = requests.length;
    toolList.innerHTML = '';

    for (var i = 0; i < requests.length; i++) {
      var r = requests[i];
      var item = document.createElement('div');
      item.className = 'tool-item';
      item.setAttribute('data-id', r.id);

      var info = document.createElement('div');
      info.className = 'tool-info';

      var name = document.createElement('div');
      name.className = 'tool-name';
      name.textContent = r.tool;

      var input = document.createElement('div');
      input.className = 'tool-input';
      input.textContent = r.input;

      info.appendChild(name);
      info.appendChild(input);

      var buttons = document.createElement('div');
      buttons.className = 'tool-buttons';

      var approveBtn = document.createElement('button');
      approveBtn.className = 'btn-approve-item';
      approveBtn.textContent = 'OK';
      approveBtn.onclick = (function(id) {
        return function() { respondTool(id, true); };
      })(r.id);

      var rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn-reject-item';
      rejectBtn.textContent = 'NO';
      rejectBtn.onclick = (function(id) {
        return function() { respondTool(id, false); };
      })(r.id);

      buttons.appendChild(approveBtn);
      buttons.appendChild(rejectBtn);

      item.appendChild(info);
      item.appendChild(buttons);
      toolList.appendChild(item);
    }

    toolModal.classList.remove('hidden');
    setEnabled(false);
  }

  function respondTool(id, approved) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'tool_response', id: id, approved: approved }));

    // Remove item from list
    var item = toolList.querySelector('[data-id="' + id + '"]');
    if (item) item.remove();

    // If no more items, close modal
    if (toolList.children.length === 0) {
      toolModal.classList.add('hidden');
      setEnabled(true);
    }
  }

  approveAllBtn.onclick = function() {
    for (var i = 0; i < pendingToolRequests.length; i++) {
      respondTool(pendingToolRequests[i].id, true);
    }
    pendingToolRequests = [];
  };

  rejectAllBtn.onclick = function() {
    for (var i = 0; i < pendingToolRequests.length; i++) {
      respondTool(pendingToolRequests[i].id, false);
    }
    pendingToolRequests = [];
  };

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

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
    bubble.textContent = text;

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

  document.addEventListener('touchstart', initAudio, { once: true });
  document.addEventListener('click', initAudio, { once: true });

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      sendMessage();
    }
  });

  setEnabled(false);
  connect();
})();
