(function () {
  'use strict';
  const chat = document.getElementById('chat');
  if (!chat) return;

  const endpoint = chat.dataset.endpoint;
  const self = chat.dataset.self; // 'cliente' ou 'corretor'
  let closed = chat.dataset.closed === '1';
  const list = document.getElementById('chatMessages');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  let lastId = 0;
  list.querySelectorAll('.msg[data-id]').forEach((m) => { lastId = Math.max(lastId, Number(m.dataset.id)); });

  const fmt = (s) => {
    const d = new Date(String(s).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const scrollBottom = () => { list.scrollTop = list.scrollHeight; };

  function render(m) {
    const div = document.createElement('div');
    div.className = 'msg msg-' + m.sender + (m.sender === self ? ' msg-self' : '');
    div.dataset.id = m.id;
    let html = '';
    if (m.sender === 'corretor' && m.user_name) html += '<span class="msg-author">' + escapeHtml(m.user_name) + '</span>';
    if (m.sender === 'cliente' && self === 'corretor' && chat.dataset.clientName) html += '<span class="msg-author">' + escapeHtml(chat.dataset.clientName) + '</span>';
    html += '<p>' + escapeHtml(m.body) + '</p><time>' + fmt(m.created_at) + '</time>';
    div.innerHTML = html;
    list.appendChild(div);
    lastId = Math.max(lastId, Number(m.id));
  }

  let errorBox = null;
  function showError(text) {
    if (!errorBox) {
      errorBox = document.createElement('div');
      errorBox.className = 'chat-error';
      chat.insertBefore(errorBox, form || null);
    }
    errorBox.textContent = text;
    setTimeout(() => { if (errorBox) { errorBox.remove(); errorBox = null; } }, 4000);
  }

  async function poll() {
    try {
      const r = await fetch(endpoint + '?after=' + lastId, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (data.messages && data.messages.length) {
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        data.messages.forEach(render);
        if (atBottom || data.messages.some((m) => m.sender === self)) scrollBottom();
        if (document.hidden && data.messages.some((m) => m.sender !== self)) {
          document.title = '(nova mensagem) ' + document.title.replace(/^\(nova mensagem\) /, '');
        }
      }
      if (data.closed && !closed) {
        closed = true;
        if (form) { form.remove(); }
        const note = document.createElement('div');
        note.className = 'chat-closed';
        note.textContent = 'Esta solicitação foi encerrada. O chat está apenas para leitura.';
        chat.appendChild(note);
      }
      const statusEl = document.getElementById('leadStatusLabel');
      if (statusEl && data.statusLabel && statusEl.textContent !== data.statusLabel) statusEl.textContent = data.statusLabel;
    } catch { /* offline — tenta de novo no próximo ciclo */ }
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = document.title.replace(/^\(nova mensagem\) /, ''); });

  if (form && input) {
    const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; };
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ body }) });
        const data = await r.json();
        if (!r.ok) { showError(data.error || 'Não foi possível enviar.'); return; }
        input.value = '';
        autosize();
        render(data.message);
        scrollBottom();
      } catch {
        showError('Falha de conexão. Tente novamente.');
      } finally {
        btn.disabled = false;
        input.focus();
      }
    });
  }

  scrollBottom();
  setInterval(poll, 3000);
})();
