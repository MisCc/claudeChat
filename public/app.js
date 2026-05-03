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
      bubbleEl.textContent = currentAiText;
      scrollToBottom();
    }
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
      prefixBubble.textContent = prefix;
      container.appendChild(prefixBubble);
    }

    var optionGroup = document.createElement('div');
    optionGroup.className = 'option-group';

    for (var i = 0; i < result.options.length; i++) {
      var opt = result.options[i];
      var btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt.full;
      btn.setAttribute('data-option', opt.num);
      btn.onclick = (function(num) {
        return function() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'select_option', content: num }));
            var allBtns = optionGroup.querySelectorAll('.option-btn');
            for (var j = 0; j < allBtns.length; j++) {
              allBtns[j].disabled = true;
              allBtns[j].className = 'option-btn disabled';
            }
            addMessage(num, 'user');
          }
        };
      })(opt.num);
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
        bubbleEl.textContent = fullText;
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

  var pendingToolRequests = [];

  function handleToolInfo(requests) {
    for (var i = 0; i < requests.length; i++) {
      var r = requests[i];
      addMessage('Tool: ' + r.tool + ' - ' + r.input, 'ai');
    }
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
