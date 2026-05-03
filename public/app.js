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
          handleToolInfo(msg.requests);
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
    messagesEl.innerHTML = '';
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
