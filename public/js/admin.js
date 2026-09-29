(function () {
  'use strict';

  // Sidebar mobile
  const sidebar = document.getElementById('adminSidebar');
  const toggle = document.getElementById('sidebarToggle');
  if (sidebar && toggle) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) sidebar.classList.remove('open');
    });
  }

  // Confirmações
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Mostrar/ocultar senha
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // Modais
  document.querySelectorAll('[data-open-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = document.getElementById('modal-' + btn.getAttribute('data-open-modal'));
      if (m) { m.hidden = false; const i = m.querySelector('input:not([type=hidden])'); if (i) i.focus(); }
    });
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
    m.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => (m.hidden = true)));
  });

  // Upload: preview + dropzone
  const input = document.getElementById('imagesInput');
  const preview = document.getElementById('uploadPreview');
  const uploadBtn = document.getElementById('uploadBtn');
  const dropzone = document.querySelector('.dropzone');
  if (input && preview && uploadBtn) {
    const renderPreview = () => {
      preview.innerHTML = '';
      const files = Array.from(input.files || []);
      files.slice(0, 15).forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        preview.appendChild(img);
      });
      uploadBtn.disabled = files.length === 0;
      uploadBtn.innerHTML = files.length ? `Enviar ${files.length} foto(s)` : 'Enviar fotos';
    };
    input.addEventListener('change', renderPreview);
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
      dropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; renderPreview(); }
      });
    }
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) uploadForm.addEventListener('submit', () => { uploadBtn.disabled = true; uploadBtn.textContent = 'Enviando...'; });
  }

  // Reordenar imagens (drag & drop)
  const grid = document.getElementById('imageGrid');
  if (grid) {
    let dragging = null;
    grid.querySelectorAll('.image-item').forEach((item) => {
      item.addEventListener('dragstart', () => { dragging = item; item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragging = null; save(); });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragging || dragging === item) return;
        const rect = item.getBoundingClientRect();
        const after = (e.clientX - rect.left) / rect.width > 0.5;
        grid.insertBefore(dragging, after ? item.nextSibling : item);
      });
    });
    function save() {
      const order = Array.from(grid.querySelectorAll('.image-item')).map((i) => Number(i.dataset.id));
      fetch(grid.dataset.sortUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }).catch(() => {});
    }
  }

  // Formulário de status: mostrar campo de visita
  const statusSel = document.getElementById('status');
  const visitField = document.getElementById('visitField');
  if (statusSel && visitField && document.getElementById('statusForm')) {
    const sync = () => { visitField.hidden = statusSel.value !== 'visita_agendada'; };
    statusSel.addEventListener('change', sync);
    sync();
  }

  // Respostas rápidas do chat
  document.querySelectorAll('[data-quick]').forEach((b) => {
    b.addEventListener('click', () => {
      const ta = document.getElementById('chatInput');
      if (!ta) return;
      ta.value = b.getAttribute('data-quick');
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    });
  });

  // Notificações no menu (mensagens não lidas)
  const navUnread = document.getElementById('navUnread');
  if (navUnread) {
    setInterval(async () => {
      try {
        const r = await fetch('/admin/api/notificacoes', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        navUnread.textContent = d.unread;
        navUnread.hidden = d.unread === 0;
      } catch { /* ignore */ }
    }, 15000);
  }
})();
