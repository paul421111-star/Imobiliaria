(function () {
  'use strict';

  // ---- Menu mobile ----
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const open = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  // ---- Filtros mobile ----
  const filtersToggle = document.getElementById('filtersToggle');
  const filters = document.getElementById('filters');
  if (filtersToggle && filters) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-outline btn-sm filters-close';
    close.textContent = 'Fechar';
    close.style.cssText = 'position:absolute;top:1rem;right:1rem;';
    close.addEventListener('click', () => filters.classList.remove('open'));
    filters.appendChild(close);
    filtersToggle.addEventListener('click', () => filters.classList.add('open'));
  }

  // ---- Máscaras ----
  document.querySelectorAll('[data-phone]').forEach((el) => {
    const mask = () => {
      let v = el.value.replace(/\D/g, '').slice(0, 11);
      if (v.length > 6) v = v.replace(/^(\d{2})(\d{4,5})(\d{0,4}).*/, '($1) $2-$3');
      else if (v.length > 2) v = v.replace(/^(\d{2})(\d{0,5})/, '($1) $2');
      else if (v.length > 0) v = v.replace(/^(\d{0,2})/, '($1');
      el.value = v;
    };
    el.addEventListener('input', mask);
    if (el.value) mask();
  });

  document.querySelectorAll('[data-money]').forEach((el) => {
    const mask = () => {
      const v = el.value.replace(/\D/g, '');
      el.value = v ? Number(v).toLocaleString('pt-BR') : '';
    };
    el.addEventListener('input', mask);
    if (el.value) mask();
  });

  // ---- Captcha refresh ----
  document.querySelectorAll('[data-captcha-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-captcha-refresh');
      const img = document.getElementById('captcha-img-' + scope);
      if (img) img.src = '/captcha/' + scope + '?t=' + Date.now();
      btn.classList.add('spin');
      setTimeout(() => btn.classList.remove('spin'), 500);
      const input = document.getElementById('captcha-' + scope);
      if (input) { input.value = ''; input.focus(); }
    });
  });

  // ---- Galeria ----
  const gallery = document.getElementById('gallery');
  const main = document.getElementById('galleryMain');
  const thumbs = document.getElementById('galleryThumbs');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  if (gallery && main) {
    const sources = thumbs
      ? Array.from(thumbs.querySelectorAll('button')).map((b) => b.getAttribute('data-src'))
      : [main.getAttribute('src')];
    let index = 0;
    const show = (i) => {
      if (!sources.length) return;
      index = (i + sources.length) % sources.length;
      main.src = sources[index];
      const counter = document.getElementById('galleryIndex');
      if (counter) counter.textContent = index + 1;
      if (thumbs) {
        thumbs.querySelectorAll('button').forEach((b, bi) => b.classList.toggle('active', bi === index));
        const active = thumbs.querySelector('button.active');
        if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
      if (lightbox && !lightbox.hidden && lightboxImg) lightboxImg.src = sources[index];
    };
    if (thumbs) thumbs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.index))));
    gallery.querySelectorAll('.gallery-nav').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); show(index + Number(b.dataset.dir)); }));
    if (lightbox && lightboxImg) {
      main.addEventListener('click', () => { lightboxImg.src = sources[index]; lightbox.hidden = false; document.body.style.overflow = 'hidden'; });
      const closeLb = () => { lightbox.hidden = true; document.body.style.overflow = ''; };
      lightbox.querySelector('.lightbox-close').addEventListener('click', closeLb);
      lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLb(); });
      lightbox.querySelectorAll('.gallery-nav').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); show(index + Number(b.dataset.dir)); }));
      document.addEventListener('keydown', (e) => {
        if (lightbox.hidden) return;
        if (e.key === 'Escape') closeLb();
        if (e.key === 'ArrowRight') show(index + 1);
        if (e.key === 'ArrowLeft') show(index - 1);
      });
    }
  }

  // ---- Compartilhar ----
  const shareWa = document.querySelector('[data-share-wa]');
  if (shareWa) shareWa.href = shareWa.href.replace('%7B%7BURL%7D%7D', encodeURIComponent(location.href)).replace('{{URL}}', encodeURIComponent(location.href));
  const copyBtn = document.querySelector('[data-copy-link]');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const original = copyBtn.innerHTML;
        copyBtn.textContent = 'Link copiado!';
        setTimeout(() => (copyBtn.innerHTML = original), 1800);
      } catch {
        prompt('Copie o link:', location.href);
      }
    });
  }

  // ---- Alerts auto-hide ----
  document.querySelectorAll('.alert-floating').forEach((el) => setTimeout(() => el.remove(), 9000));

  // ---- Validação leve dos formulários ----
  document.querySelectorAll('form.lead-form, form[action="/acompanhar"]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      const required = form.querySelectorAll('[required]');
      let ok = true;
      required.forEach((el) => {
        const valid = el.type === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim()) : el.value.trim().length > 0;
        el.style.borderColor = valid ? '' : '#dc2626';
        if (!valid) ok = false;
      });
      if (!ok) {
        e.preventDefault();
        const first = form.querySelector('[style*="border-color"]');
        if (first) first.focus();
      } else {
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = 'Enviando...'; }
      }
    });
  });
})();
