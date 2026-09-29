'use strict';

const express = require('express');
const { db, PROPERTY_TYPES, generateProtocol, normalizePhone, LEAD_STATUS } = require('../db');
const captcha = require('../captcha');
const { isValidEmail, slugify } = require('../utils');

const router = express.Router();
const PAGE_SIZE = 9;

function attachCover(props) {
  if (!props.length) return props;
  const ids = props.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const imgs = db
    .prepare(`SELECT property_id, filename, is_cover, sort_order FROM property_images WHERE property_id IN (${placeholders}) ORDER BY is_cover DESC, sort_order ASC, id ASC`)
    .all(...ids);
  const map = new Map();
  for (const im of imgs) {
    if (!map.has(im.property_id)) map.set(im.property_id, { cover: im.filename, count: 0 });
    map.get(im.property_id).count += 1;
  }
  for (const p of props) {
    const m = map.get(p.id);
    p.cover = m ? '/uploads/' + m.cover : null;
    p.image_count = m ? m.count : 0;
    p.total = Number(p.price) + Number(p.condo_fee || 0) + Number(p.iptu || 0);
    try { p.features_list = JSON.parse(p.features || '[]'); } catch { p.features_list = []; }
    p.url = `/imovel/${p.code}/${slugify(p.title)}`;
  }
  return props;
}

function getFilterOptions() {
  const cities = db.prepare("SELECT city, COUNT(*) AS n FROM properties WHERE status = 'disponivel' GROUP BY city ORDER BY n DESC, city").all();
  const neighborhoods = db.prepare("SELECT DISTINCT neighborhood FROM properties WHERE status = 'disponivel' AND neighborhood IS NOT NULL AND neighborhood <> '' ORDER BY neighborhood").all();
  return { cities, neighborhoods: neighborhoods.map((n) => n.neighborhood) };
}

router.get('/', (req, res) => {
  const featured = attachCover(db.prepare("SELECT * FROM properties WHERE status = 'disponivel' AND featured = 1 ORDER BY updated_at DESC LIMIT 6").all());
  const latest = attachCover(db.prepare("SELECT * FROM properties WHERE status = 'disponivel' ORDER BY created_at DESC LIMIT 6").all());
  const stats = {
    available: db.prepare("SELECT COUNT(*) AS c FROM properties WHERE status = 'disponivel'").get().c,
    rented: db.prepare("SELECT COUNT(*) AS c FROM properties WHERE status = 'alugado'").get().c,
    cities: db.prepare("SELECT COUNT(DISTINCT city) AS c FROM properties WHERE status = 'disponivel'").get().c,
  };
  const typeCounts = db.prepare("SELECT type, COUNT(*) AS n FROM properties WHERE status = 'disponivel' GROUP BY type").all();
  const types = PROPERTY_TYPES.map((t) => ({ ...t, count: (typeCounts.find((c) => c.type === t.value) || { n: 0 }).n }));
  res.render('public/home', { title: null, featured, latest, stats, types, filters: getFilterOptions() });
});

router.get('/imoveis', (req, res) => {
  const q = req.query;
  const where = ["status = 'disponivel'"];
  const params = [];

  if (q.tipo && PROPERTY_TYPES.some((t) => t.value === q.tipo)) { where.push('type = ?'); params.push(q.tipo); }
  if (q.cidade) { where.push('city = ?'); params.push(String(q.cidade)); }
  if (q.bairro) { where.push('neighborhood = ?'); params.push(String(q.bairro)); }
  if (q.busca) {
    where.push('(title LIKE ? OR neighborhood LIKE ? OR city LIKE ? OR address LIKE ? OR code LIKE ? OR description LIKE ?)');
    const like = `%${String(q.busca).trim()}%`;
    params.push(like, like, like, like, like, like);
  }
  const min = Number(String(q.min || '').replace(/\D/g, ''));
  const max = Number(String(q.max || '').replace(/\D/g, ''));
  if (min > 0) { where.push('price >= ?'); params.push(min); }
  if (max > 0) { where.push('price <= ?'); params.push(max); }
  const quartos = Number(q.quartos);
  if (quartos > 0) { where.push('bedrooms >= ?'); params.push(quartos); }
  const vagas = Number(q.vagas);
  if (vagas > 0) { where.push('parking >= ?'); params.push(vagas); }
  if (q.pets === '1') where.push('pets_allowed = 1');
  if (q.mobiliado === '1') where.push('furnished = 1');

  const sorts = {
    recentes: 'created_at DESC',
    menor_preco: 'price ASC',
    maior_preco: 'price DESC',
    maior_area: 'area DESC',
  };
  const orderBy = sorts[q.ordem] || 'featured DESC, created_at DESC';

  const page = Math.max(1, parseInt(q.pagina, 10) || 1);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM properties WHERE ${where.join(' AND ')}`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const props = attachCover(
    db.prepare(`SELECT * FROM properties WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE)
  );

  const qs = { ...q };
  delete qs.pagina;
  const baseQuery = new URLSearchParams(qs).toString();

  res.render('public/listing', {
    title: 'Imóveis para alugar',
    props, total, page, pages, baseQuery, query: q, filters: getFilterOptions(),
  });
});

router.get('/imovel/:code/:slug?', (req, res) => {
  const prop = db.prepare('SELECT * FROM properties WHERE code = ?').get(String(req.params.code).toUpperCase());
  if (!prop || prop.status === 'inativo') return res.status(404).render('public/404', { title: 'Imóvel não encontrado' });
  attachCover([prop]);
  prop.images = db.prepare('SELECT * FROM property_images WHERE property_id = ? ORDER BY is_cover DESC, sort_order ASC, id ASC').all(prop.id);
  prop.broker = prop.broker_id ? db.prepare('SELECT id, name, phone, whatsapp, email, creci FROM users WHERE id = ? AND active = 1').get(prop.broker_id) : null;
  db.prepare('UPDATE properties SET views = views + 1 WHERE id = ?').run(prop.id);

  const similar = attachCover(
    db.prepare("SELECT * FROM properties WHERE status = 'disponivel' AND id <> ? AND (type = ? OR city = ?) ORDER BY ABS(price - ?) ASC LIMIT 3").all(prop.id, prop.type, prop.city, prop.price)
  );

  const formData = req.session.formData || {};
  const formError = req.session.formError || null;
  delete req.session.formData;
  delete req.session.formError;

  res.render('public/property', { title: prop.title, prop, similar, formData, formError });
});

// Regras de negócio da solicitação de interesse
function createLead({ property, name, email, phone, message, source }) {
  const phoneNorm = normalizePhone(phone);
  const emailNorm = String(email).trim().toLowerCase();

  // 1) Não duplicar solicitação aberta do mesmo cliente para o mesmo imóvel
  if (property) {
    const closed = Object.keys(LEAD_STATUS).filter((k) => LEAD_STATUS[k].closed);
    const existing = db
      .prepare(`SELECT protocol FROM leads WHERE property_id = ? AND lower(email) = ? AND phone = ? AND status NOT IN (${closed.map(() => '?').join(',')})`)
      .get(property.id, emailNorm, phoneNorm, ...closed);
    if (existing) return { duplicate: true, protocol: existing.protocol };
  }

  // 2) Corretor responsável: o do imóvel; se não houver, o primeiro corretor ativo
  let brokerId = property && property.broker_id ? property.broker_id : null;
  if (!brokerId) {
    const b = db.prepare("SELECT id FROM users WHERE active = 1 ORDER BY CASE role WHEN 'corretor' THEN 0 ELSE 1 END, id LIMIT 1").get();
    brokerId = b ? b.id : null;
  }

  const protocol = generateProtocol();
  const r = db
    .prepare('INSERT INTO leads(protocol, property_id, name, email, phone, message, status, broker_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(protocol, property ? property.id : null, String(name).trim(), emailNorm, phoneNorm, String(message || '').trim() || null, 'novo', brokerId);
  const leadId = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO lead_history(lead_id, status, note) VALUES (?,?,?)').run(leadId, 'novo', source || 'Solicitação recebida pelo site.');
  db.prepare("INSERT INTO messages(lead_id, sender, body) VALUES (?, 'sistema', ?)").run(
    leadId,
    property
      ? `Olá, ${String(name).trim().split(' ')[0]}! Recebemos seu interesse no imóvel ${property.code} — ${property.title}. Em breve o corretor responderá por aqui.`
      : `Olá, ${String(name).trim().split(' ')[0]}! Recebemos sua mensagem. Em breve um corretor responderá por aqui.`
  );
  return { duplicate: false, protocol, leadId };
}

function validateLeadForm(body) {
  const errors = [];
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const phone = normalizePhone(body.phone);
  if (name.length < 3) errors.push('Informe seu nome completo.');
  if (!isValidEmail(email)) errors.push('Informe um e-mail válido.');
  if (phone.length < 10 || phone.length > 11) errors.push('Informe um celular válido com DDD.');
  if (body.message && String(body.message).length > 1500) errors.push('A mensagem deve ter no máximo 1500 caracteres.');
  if (body.website) errors.push('Envio inválido.'); // honeypot
  return { errors, name, email, phone, message: body.message };
}

router.post('/imovel/:code/interesse', (req, res) => {
  const prop = db.prepare('SELECT * FROM properties WHERE code = ?').get(String(req.params.code).toUpperCase());
  if (!prop) return res.status(404).render('public/404', { title: 'Imóvel não encontrado' });
  const url = `/imovel/${prop.code}/${slugify(prop.title)}#contato`;

  const v = validateLeadForm(req.body);
  if (!captcha.verify(req, 'contato', req.body.captcha)) v.errors.push('Código de verificação incorreto. Tente novamente.');
  if (prop.status !== 'disponivel') v.errors.push('Este imóvel não está disponível para novas solicitações no momento.');

  if (v.errors.length) {
    req.session.formData = { name: req.body.name, email: req.body.email, phone: req.body.phone, message: req.body.message };
    req.session.formError = v.errors.join(' ');
    return res.redirect(url);
  }

  const result = createLead({ property: prop, ...v, source: 'Interesse enviado pela página do imóvel.' });
  req.session.client = { email: v.email.toLowerCase(), phone: v.phone, name: v.name };
  req.session.flash = result.duplicate
    ? { type: 'info', text: `Você já possui uma solicitação em andamento para este imóvel (protocolo ${result.protocol}). Acompanhe abaixo.` }
    : { type: 'success', text: `Solicitação enviada! Seu protocolo é ${result.protocol}. Guarde este número para acompanhar o andamento.` };
  res.redirect(`/acompanhar/${result.protocol}`);
});

router.get('/contato', (req, res) => {
  const formData = req.session.formData || {};
  const formError = req.session.formError || null;
  delete req.session.formData;
  delete req.session.formError;
  res.render('public/contact', { title: 'Fale conosco', formData, formError });
});

router.post('/contato', (req, res) => {
  const v = validateLeadForm(req.body);
  if (!captcha.verify(req, 'contato', req.body.captcha)) v.errors.push('Código de verificação incorreto. Tente novamente.');
  if (!String(req.body.message || '').trim()) v.errors.push('Escreva sua mensagem.');
  if (v.errors.length) {
    req.session.formData = { name: req.body.name, email: req.body.email, phone: req.body.phone, message: req.body.message };
    req.session.formError = v.errors.join(' ');
    return res.redirect('/contato#form');
  }
  const result = createLead({ property: null, ...v, source: 'Mensagem enviada pela página de contato.' });
  req.session.client = { email: v.email.toLowerCase(), phone: v.phone, name: v.name };
  req.session.flash = { type: 'success', text: `Mensagem enviada! Seu protocolo é ${result.protocol}.` };
  res.redirect(`/acompanhar/${result.protocol}`);
});

router.get('/sobre', (req, res) => {
  const brokers = db.prepare("SELECT name, role, creci, phone, whatsapp, email FROM users WHERE active = 1 ORDER BY CASE role WHEN 'corretor' THEN 0 ELSE 1 END, name").all();
  res.render('public/about', { title: 'Sobre nós', brokers });
});

module.exports = router;
