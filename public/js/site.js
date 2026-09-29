(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Barra de progresso de navegação ----
  const progress = document.getElementById('pageProgress');
  if (progress) {
    progress.style.width = '70%';
    progress.classList.add('active');
    window.addEventListener('load', () => {
      progress.style.width = '100%';
      setTimeout(() => { progress.classList.remove('active'); progress.style.width = '0'; }, 450);
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.href.startsWith('mailto:') || a.href.startsWith('tel:') || a.href.includes('#')) return;
      if (new URL(a.href, location.href).origin !== location.origin) return;
      progress.style.width = '40%';
      progress.classList.add('active');
    });
  }

  // ---- Header: encolhe ao rolar ----
  const header = document.getElementById('siteHeader');
  const backTop = document.getElementById('backTop');
  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    if (header) header.classList.toggle('scrolled', y > 24);
    if (backTop) backTop.classList.toggle('show', y > 480);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (backTop) backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  // ---- Reveal ao rolar ----
  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  if (revealEls.length) {
    if ('IntersectionObserver' in window && !reduceMotion) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      revealEls.forEach((el) => io.observe(el));
      // Garantia extra: nada fica invisível se o observer não disparar (abas em segundo plano, navegadores antigos).
      const sweep = () => {
        const limit = window.innerHeight + 40;
        revealEls.forEach((el) => { if (!el.classList.contains('in') && el.getBoundingClientRect().top < limit) el.classList.add('in'); });
      };
      window.addEventListener('scroll', sweep, { passive: true });
      window.addEventListener('load', sweep);
      setTimeout(sweep, 800);
    } else {
      revealEls.forEach((el) => el.classList.add('in'));
    }
  }

  // ---- Contadores ----
  const counters = document.querySelectorAll('[data-count]');
  const runCounter = (el) => {
    const target = Number(el.getAttribute('data-count')) || 0;
    if (reduceMotion || target === 0) { el.textContent = target; return; }
    const duration = 1400; const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (counters.length) {
    if ('IntersectionObserver' in window) {
      const cio = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); } });
      }, { threshold: 0.4 });
      counters.forEach((el) => cio.observe(el));
    } else counters.forEach(runCounter);
  }

  // ---- Hero slideshow ----
  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length > 1 && !reduceMotion) {
    let cur = 0;
    setInterval(() => {
      slides[cur].classList.remove('active');
      cur = (cur + 1) % slides.length;
      slides[cur].classList.add('active');
    }, 7000);
  }

  // ---- Abas da busca ----
  const tabs = document.querySelectorAll('[data-search-tab]');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    const key = tab.getAttribute('data-search-tab');
    tabs.forEach((t) => { const on = t === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('[data-search-panel]').forEach((p) => { p.hidden = p.getAttribute('data-search-panel') !== key; });
    const first = document.querySelector('[data-search-panel="' + key + '"] input, [data-search-panel="' + key + '"] select');
    if (first && key === 'code') first.focus();
  }));

  // ---- Carrossel ----
  document.querySelectorAll('[data-carousel]').forEach((car) => {
    const track = car.querySelector('.carousel-track');
    const dotsWrap = car.querySelector('[data-carousel-dots]');
    const id = car.id;
    if (!track) return;
    const items = () => Array.from(track.children);
    const pageSize = () => Math.max(1, Math.round(track.clientWidth / (items()[0]?.getBoundingClientRect().width || track.clientWidth)));
    const pages = () => Math.max(1, Math.ceil(items().length / pageSize()));
    const stepWidth = () => { const w = items()[0]?.getBoundingClientRect().width || 1; const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0; return (w + gap) * pageSize(); };
    const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);
    const currentPage = () => {
      if (track.scrollLeft >= maxScroll() - 2) return pages() - 1;
      return Math.min(pages() - 1, Math.round(track.scrollLeft / stepWidth()));
    };
    const goTo = (page) => {
      const total = pages();
      const p = ((page % total) + total) % total;
      const left = p === total - 1 ? maxScroll() : p * stepWidth();
      track.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    const renderDots = () => {
      if (!dotsWrap) return;
      const total = pages();
      dotsWrap.innerHTML = '';
      if (total <= 1) return;
      for (let i = 0; i < total; i++) {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('aria-label', 'Ir para página ' + (i + 1));
        b.addEventListener('click', () => goTo(i));
        dotsWrap.appendChild(b);
      }
      syncDots();
    };
    const syncDots = () => {
      if (!dotsWrap) return;
      const cp = currentPage();
      Array.from(dotsWrap.children).forEach((d, i) => d.classList.toggle('active', i === cp));
    };
    track.addEventListener('scroll', () => { window.requestAnimationFrame(syncDots); }, { passive: true });
    window.addEventListener('resize', renderDots);
    renderDots();
    document.querySelectorAll('[data-carousel-prev="' + id + '"]').forEach((b) => b.addEventListener('click', () => goTo(currentPage() - 1)));
    document.querySelectorAll('[data-carousel-next="' + id + '"]').forEach((b) => b.addEventListener('click', () => goTo(currentPage() + 1)));

    // arrastar com o mouse
    let down = false, startX = 0, startLeft = 0, moved = false;
    track.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; down = true; moved = false; startX = e.clientX; startLeft = track.scrollLeft; track.classList.add('dragging'); });
    window.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - startX; if (Math.abs(dx) > 4) moved = true; track.scrollLeft = startLeft - dx; });
    window.addEventListener('pointerup', () => { if (!down) return; down = false; track.classList.remove('dragging'); goTo(currentPage()); });
    track.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);

    // autoplay
    const delay = Number(car.getAttribute('data-autoplay')) || 0;
    if (delay && !reduceMotion) {
      let timer = null;
      const start = () => { stop(); timer = setInterval(() => { if (document.hidden) return; goTo(currentPage() + 1); }, delay); };
      const stop = () => { if (timer) clearInterval(timer); timer = null; };
      car.addEventListener('mouseenter', stop); car.addEventListener('mouseleave', start);
      car.addEventListener('focusin', stop); car.addEventListener('focusout', start);
      car.addEventListener('touchstart', stop, { passive: true });
      start();
    }
  });

  // ---- Tilt 3D suave nos cards (somente com mouse) ----
  if (window.matchMedia('(pointer: fine)').matches && !reduceMotion) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      let raf = null;
      card.addEventListener('mousemove', (e) => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width - 0.5;
          const py = (e.clientY - r.top) / r.height - 0.5;
          card.style.transform = 'translateY(-6px) rotateX(' + (-py * 4).toFixed(2) + 'deg) rotateY(' + (px * 5).toFixed(2) + 'deg)';
          raf = null;
        });
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  // ---- WhatsApp widget ----
  const waToggle = document.getElementById('waToggle');
  const waPopup = document.getElementById('waPopup');
  const waClose = document.getElementById('waClose');
  const waSend = document.getElementById('waSend');
  const waMessage = document.getElementById('waMessage');
  if (waToggle && waPopup) {
    const setOpen = (open) => { waPopup.hidden = !open; waToggle.setAttribute('aria-expanded', String(open)); if (open && waMessage) setTimeout(() => waMessage.focus(), 50); };
    waToggle.addEventListener('click', () => setOpen(waPopup.hidden));
    if (waClose) waClose.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !waPopup.hidden) setOpen(false); });
    document.addEventListener('click', (e) => { if (!waPopup.hidden && !e.target.closest('#waWidget')) setOpen(false); });
    if (waSend && waMessage) {
      const sync = () => {
        const phone = waSend.getAttribute('data-phone');
        const text = waMessage.value.trim();
        waSend.href = 'https://wa.me/' + phone + (text ? '?text=' + encodeURIComponent(text) : '');
      };
      waMessage.addEventListener('input', sync);
      sync();
      waMessage.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); waSend.click(); } });
    }
  }

  // ---- Aviso de cookies ----
  const cookieBar = document.getElementById('cookieBar');
  const cookieOk = document.getElementById('cookieOk');
  if (cookieBar && cookieOk) {
    let accepted = false;
    try { accepted = localStorage.getItem('cookie_ok') === '1'; } catch { /* sem storage */ }
    if (!accepted) setTimeout(() => { cookieBar.hidden = false; }, 1200);
    cookieOk.addEventListener('click', () => { cookieBar.hidden = true; try { localStorage.setItem('cookie_ok', '1'); } catch { /* ignore */ } });
  }

  // ---- Menu mobile ----
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const open = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (mainNav.classList.contains('open') && !e.target.closest('#mainNav') && !e.target.closest('#navToggle')) {
        mainNav.classList.remove('open'); navToggle.setAttribute('aria-expanded', 'false');
      }
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
    // swipe no toque
    const swipe = (el) => {
      let x0 = null;
      el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0; x0 = null;
        if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
      });
    };
    swipe(main);
    if (lightbox) swipe(lightbox);
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
