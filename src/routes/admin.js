'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const { db, UPLOADS_DIR, PROPERTY_TYPES, PROPERTY_STATUS, LEAD_STATUS, FEATURE_OPTIONS, DEFAULT_SETTINGS, getSettings, saveSettings, nextPropertyCode } = require('../db');
const captcha = require('../captcha');
const auth = require('../auth');
const { isValidEmail } = require('../utils');

const router = express.Router();

// ---------- Upload de imagens ----------
const MAX_IMAGES = 15;
const ALLOWED_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED_MIME[file.mimetype] || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: MAX_IMAGES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME[file.mimetype]) return cb(new Error('Formato inválido. Envie imagens JPG, PNG ou WEBP.'));
    cb(null, true);
  },
});

function flash(req, type, text) {
  req.session.flash = { type, text };
}

// ---------- Login ----------

router.get('/login', (req, res) => {
  if (auth.currentUser(req)) return res.redirect('/admin');
  const error = req.session.formError || null;
  delete req.session.formError;
  res.render('admin/login', { title: 'Acesso restrito', error, layout: false });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const ip = req.ip;

  const lockedMinutes = auth.isLocked(username, ip);
  if (lockedMinutes) {
    req.session.formError = `Muitas tentativas inválidas. Tente novamente em ${lockedMinutes} minuto(s).`;
    return res.redirect('/admin/login');
  }
  if (!captcha.verify(req, 'login', req.body.captcha)) {
    req.session.formError = 'Código de verificação incorreto.';
    return res.redirect('/admin/login');
  }
  const user = auth.authenticate(username, password);
  if (!user) {
    const remaining = auth.registerFailure(username, ip);
    req.session.formError = remaining > 0 ? `Usuário ou senha inválidos. ${remaining} tentativa(s) restante(s).` : `Muitas tentativas inválidas. Acesso bloqueado por ${auth.LOCK_MINUTES} minutos.`;
    return res.redirect('/admin/login');
  }
  auth.clearFailures(username, ip);
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) return res.redirect('/admin/login');
    req.session.userId = user.id;
    res.redirect(returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin');
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Tudo abaixo exige login
router.use(auth.requireLogin);

// Contador de mensagens não lidas (para o menu)
router.use((req, res, next) => {
  res.locals.unreadTotal = db
    .prepare("SELECT COUNT(*) AS c FROM messages m JOIN leads l ON l.id = m.lead_id WHERE m.sender = 'cliente' AND (l.broker_last_read IS NULL OR m.created_at > l.broker_last_read)")
    .get().c;
  res.locals.newLeads = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE status = 'novo'").get().c;
  next();
});

// ---------- Dashboard ----------

router.get('/', (req, res) => {
  const stats = {
    properties: db.prepare('SELECT COUNT(*) AS c FROM properties').get().c,
    available: db.prepare("SELECT COUNT(*) AS c FROM properties WHERE status = 'disponivel'").get().c,
    rented: db.prepare("SELECT COUNT(*) AS c FROM properties WHERE status = 'alugado'").get().c,
    leadsOpen: db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE status NOT IN ('contrato','recusado','cancelado')`).get().c,
    leadsNew: res.locals.newLeads,
    leadsMonth: db.prepare("SELECT COUNT(*) AS c FROM leads WHERE created_at >= date('now','start of month')").get().c,
    unread: res.locals.unreadTotal,
    views: db.prepare('SELECT COALESCE(SUM(views),0) AS c FROM properties').get().c,
  };
  const recentLeads = db
    .prepare(`SELECT l.*, p.title AS property_title, p.code AS property_code, u.name AS broker_name,
      (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.sender = 'cliente' AND (l.broker_last_read IS NULL OR m.created_at > l.broker_last_read)) AS unread
      FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users u ON u.id = l.broker_id ORDER BY l.updated_at DESC LIMIT 8`)
    .all();
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all();
  const topProps = db.prepare("SELECT code, title, views, status FROM properties ORDER BY views DESC LIMIT 5").all();
  res.render('admin/dashboard', { title: 'Visão geral', stats, recentLeads, byStatus, topProps });
});

// ---------- Imóveis ----------

router.get('/imoveis', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status && PROPERTY_STATUS[req.query.status]) { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.busca) { where.push('(p.title LIKE ? OR p.code LIKE ? OR p.neighborhood LIKE ? OR p.city LIKE ?)'); const l = `%${req.query.busca}%`; params.push(l, l, l, l); }
  const sql = `SELECT p.*, u.name AS broker_name,
    (SELECT filename FROM property_images pi WHERE pi.property_id = p.id ORDER BY is_cover DESC, sort_order ASC LIMIT 1) AS cover,
    (SELECT COUNT(*) FROM property_images pi WHERE pi.property_id = p.id) AS image_count,
    (SELECT COUNT(*) FROM leads l WHERE l.property_id = p.id) AS lead_count
    FROM properties p LEFT JOIN users u ON u.id = p.broker_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.updated_at DESC`;
  const props = db.prepare(sql).all(...params);
  res.render('admin/properties', { title: 'Imóveis', props, query: req.query });
});

function brokers() {
  return db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all();
}

function emptyProperty() {
  return {
    id: null, code: nextPropertyCode(), title: '', type: 'apartamento', status: 'disponivel', price: '', condo_fee: 0, iptu: 0, area: '',
    bedrooms: 0, suites: 0, bathrooms: 1, parking: 0, furnished: 0, pets_allowed: 0, address: '', neighborhood: '', city: '', state: 'SP', zip: '',
    description: '', features_list: [], featured: 0, broker_id: '', min_contract_months: 12, deposit_months: 0, video_url: '', images: [],
  };
}

function parsePropertyForm(body) {
  const num = (v, def = 0) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : def; };
  const int = (v) => Math.max(0, parseInt(v, 10) || 0);
  const featuresRaw = Array.isArray(body.features) ? body.features : body.features ? [body.features] : [];
  const features = featuresRaw.map((f) => String(f).trim()).filter(Boolean).slice(0, 40);
  const extra = String(body.features_extra || '').split(',').map((s) => s.trim()).filter(Boolean);
  const data = {
    title: String(body.title || '').trim(),
    type: String(body.type || ''),
    status: String(body.status || 'disponivel'),
    price: num(body.price),
    condo_fee: num(body.condo_fee),
    iptu: num(body.iptu),
    area: body.area ? num(body.area) : null,
    bedrooms: int(body.bedrooms), suites: int(body.suites), bathrooms: int(body.bathrooms), parking: int(body.parking),
    furnished: body.furnished ? 1 : 0, pets_allowed: body.pets_allowed ? 1 : 0, featured: body.featured ? 1 : 0,
    address: String(body.address || '').trim(), neighborhood: String(body.neighborhood || '').trim(), city: String(body.city || '').trim(),
    state: String(body.state || 'SP').trim().toUpperCase().slice(0, 2), zip: String(body.zip || '').trim(),
    description: String(body.description || '').trim(),
    features: JSON.stringify([...new Set([...features, ...extra])]),
    broker_id: body.broker_id ? Number(body.broker_id) : null,
    min_contract_months: int(body.min_contract_months) || 12,
    deposit_months: Math.min(3, int(body.deposit_months)),
    video_url: String(body.video_url || '').trim() || null,
  };
  const errors = [];
  if (data.title.length < 10) errors.push('O título deve ter ao menos 10 caracteres.');
  if (!PROPERTY_TYPES.some((t) => t.value === data.type)) errors.push('Tipo de imóvel inválido.');
  if (!PROPERTY_STATUS[data.status]) errors.push('Status inválido.');
  if (!(data.price > 0)) errors.push('Informe o valor do aluguel.');
  if (!data.city) errors.push('Informe a cidade.');
  if (data.suites > data.bedrooms) errors.push('O número de suítes não pode ser maior que o de dormitórios.');
  if (data.description.length < 30) errors.push('Descreva o imóvel com ao menos 30 caracteres.');
  if (data.broker_id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(data.broker_id)) errors.push('Corretor inválido.');
  return { data, errors };
}

router.get('/imoveis/novo', (req, res) => {
  res.render('admin/property-form', { title: 'Novo imóvel', prop: emptyProperty(), brokers: brokers(), errors: [] });
});

router.post('/imoveis', (req, res) => {
  const { data, errors } = parsePropertyForm(req.body);
  if (errors.length) {
    const prop = { ...emptyProperty(), ...data, features_list: JSON.parse(data.features) };
    return res.status(400).render('admin/property-form', { title: 'Novo imóvel', prop, brokers: brokers(), errors });
  }
  // Regra: anúncio só fica disponível com pelo menos 1 foto — novo imóvel nasce inativo até enviar fotos
  const requestedStatus = data.status;
  data.status = requestedStatus === 'disponivel' ? 'inativo' : requestedStatus;
  const code = nextPropertyCode();
  const cols = Object.keys(data);
  const r = db.prepare(`INSERT INTO properties(code, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).run(code, ...cols.map((c) => data[c]));
  const id = Number(r.lastInsertRowid);
  flash(req, 'success', requestedStatus === 'disponivel'
    ? `Imóvel ${code} cadastrado. Envie ao menos 1 foto e depois altere o status para "Disponível" para publicar.`
    : `Imóvel ${code} cadastrado.`);
  res.redirect(`/admin/imoveis/${id}/editar#fotos`);
});

function loadProperty(id) {
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(id));
  if (!prop) return null;
  try { prop.features_list = JSON.parse(prop.features || '[]'); } catch { prop.features_list = []; }
  prop.images = db.prepare('SELECT * FROM property_images WHERE property_id = ? ORDER BY is_cover DESC, sort_order ASC, id ASC').all(prop.id);
  return prop;
}

router.get('/imoveis/:id/editar', (req, res) => {
  const prop = loadProperty(req.params.id);
  if (!prop) return res.status(404).render('public/404', { title: 'Imóvel não encontrado' });
  const leads = db.prepare('SELECT id, protocol, name, status, created_at FROM leads WHERE property_id = ? ORDER BY created_at DESC LIMIT 10').all(prop.id);
  res.render('admin/property-form', { title: `Editar ${prop.code}`, prop, brokers: brokers(), errors: [], leads });
});

router.post('/imoveis/:id', (req, res) => {
  const existing = loadProperty(req.params.id);
  if (!existing) return res.status(404).render('public/404', { title: 'Imóvel não encontrado' });
  const { data, errors } = parsePropertyForm(req.body);
  if (data.status === 'disponivel' && existing.images.length === 0) errors.push('Para publicar como "Disponível", envie ao menos 1 foto do imóvel.');
  if (errors.length) {
    const prop = { ...existing, ...data, features_list: JSON.parse(data.features) };
    return res.status(400).render('admin/property-form', { title: `Editar ${existing.code}`, prop, brokers: brokers(), errors, leads: [] });
  }
  const cols = Object.keys(data);
  db.prepare(`UPDATE properties SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...cols.map((c) => data[c]), existing.id);
  flash(req, 'success', 'Imóvel atualizado com sucesso.');
  res.redirect(`/admin/imoveis/${existing.id}/editar`);
});

router.post('/imoveis/:id/status', (req, res) => {
  const prop = loadProperty(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Imóvel não encontrado' });
  const status = String(req.body.status || '');
  if (!PROPERTY_STATUS[status]) return res.status(400).json({ error: 'Status inválido' });
  if (status === 'disponivel' && prop.images.length === 0) {
    flash(req, 'error', `O imóvel ${prop.code} precisa de ao menos 1 foto para ficar disponível.`);
    return res.redirect('/admin/imoveis');
  }
  db.prepare("UPDATE properties SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, prop.id);
  flash(req, 'success', `Status do imóvel ${prop.code} alterado para "${PROPERTY_STATUS[status].label}".`);
  res.redirect(req.get('referer') || '/admin/imoveis');
});

router.post('/imoveis/:id/excluir', (req, res) => {
  const prop = loadProperty(req.params.id);
  if (!prop) return res.status(404).render('public/404', { title: 'Imóvel não encontrado' });
  const openLeads = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE property_id = ? AND status NOT IN ('contrato','recusado','cancelado')").get(prop.id).c;
  if (openLeads > 0 && req.user.role !== 'admin') {
    flash(req, 'error', `Este imóvel possui ${openLeads} solicitação(ões) em andamento. Finalize-as ou peça ao administrador para excluir. Dica: use o status "Inativo" para ocultar o anúncio.`);
    return res.redirect(`/admin/imoveis/${prop.id}/editar`);
  }
  for (const im of prop.images) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, im.filename)); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM properties WHERE id = ?').run(prop.id);
  flash(req, 'success', `Imóvel ${prop.code} excluído.`);
  res.redirect('/admin/imoveis');
});

router.post('/imoveis/:id/imagens', (req, res) => {
  const prop = loadProperty(req.params.id);
  if (!prop) return res.status(404).render('public/404', { title: 'Imóvel não encontrado' });
  upload.array('images', MAX_IMAGES)(req, res, (err) => {
    if (err) {
      flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? 'Cada imagem deve ter no máximo 8 MB.' : err.message);
      return res.redirect(`/admin/imoveis/${prop.id}/editar#fotos`);
    }
    const files = req.files || [];
    const room = MAX_IMAGES - prop.images.length;
    if (files.length === 0) {
      flash(req, 'error', 'Selecione ao menos uma imagem.');
      return res.redirect(`/admin/imoveis/${prop.id}/editar#fotos`);
    }
    const accepted = files.slice(0, Math.max(0, room));
    const rejected = files.slice(accepted.length);
    for (const f of rejected) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
    const ins = db.prepare('INSERT INTO property_images(property_id, filename, sort_order, is_cover) VALUES (?,?,?,?)');
    let order = prop.images.length;
    const hasCover = prop.images.some((i) => i.is_cover);
    accepted.forEach((f, idx) => ins.run(prop.id, path.basename(f.path), order++, !hasCover && idx === 0 ? 1 : 0));
    db.prepare("UPDATE properties SET updated_at = datetime('now','localtime') WHERE id = ?").run(prop.id);
    flash(req, rejected.length ? 'info' : 'success', `${accepted.length} foto(s) enviada(s).${rejected.length ? ` ${rejected.length} ignorada(s): limite de ${MAX_IMAGES} fotos por imóvel.` : ''}`);
    res.redirect(`/admin/imoveis/${prop.id}/editar#fotos`);
  });
});

router.post('/imoveis/:id/imagens/:imgId/capa', (req, res) => {
  const img = db.prepare('SELECT * FROM property_images WHERE id = ? AND property_id = ?').get(Number(req.params.imgId), Number(req.params.id));
  if (!img) return res.status(404).json({ error: 'Imagem não encontrada' });
  db.prepare('UPDATE property_images SET is_cover = 0 WHERE property_id = ?').run(img.property_id);
  db.prepare('UPDATE property_images SET is_cover = 1 WHERE id = ?').run(img.id);
  flash(req, 'success', 'Foto de capa atualizada.');
  res.redirect(`/admin/imoveis/${img.property_id}/editar#fotos`);
});

router.post('/imoveis/:id/imagens/:imgId/excluir', (req, res) => {
  const img = db.prepare('SELECT * FROM property_images WHERE id = ? AND property_id = ?').get(Number(req.params.imgId), Number(req.params.id));
  if (!img) return res.status(404).json({ error: 'Imagem não encontrada' });
  db.prepare('DELETE FROM property_images WHERE id = ?').run(img.id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, img.filename)); } catch { /* ignore */ }
  const remaining = db.prepare('SELECT * FROM property_images WHERE property_id = ? ORDER BY sort_order, id').all(img.property_id);
  if (remaining.length && !remaining.some((i) => i.is_cover)) db.prepare('UPDATE property_images SET is_cover = 1 WHERE id = ?').run(remaining[0].id);
  // Regra: sem fotos, o anúncio sai do ar
  if (remaining.length === 0) db.prepare("UPDATE properties SET status = 'inativo' WHERE id = ? AND status = 'disponivel'").run(img.property_id);
  flash(req, 'success', remaining.length ? 'Foto removida.' : 'Foto removida. O imóvel ficou inativo por não ter fotos.');
  res.redirect(`/admin/imoveis/${img.property_id}/editar#fotos`);
});

router.post('/imoveis/:id/imagens/ordenar', (req, res) => {
  const ids = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
  const upd = db.prepare('UPDATE property_images SET sort_order = ? WHERE id = ? AND property_id = ?');
  ids.forEach((id, i) => upd.run(i, id, Number(req.params.id)));
  res.json({ ok: true });
});

// ---------- Solicitações (leads) ----------

router.get('/solicitacoes', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status && LEAD_STATUS[req.query.status]) { where.push('l.status = ?'); params.push(req.query.status); }
  else if (req.query.status === 'abertas') where.push("l.status NOT IN ('contrato','recusado','cancelado')");
  if (req.query.busca) { where.push('(l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.protocol LIKE ? OR p.title LIKE ?)'); const l = `%${req.query.busca}%`; params.push(l, l, l, l, l); }
  if (req.query.minhas === '1') { where.push('l.broker_id = ?'); params.push(req.user.id); }
  const leads = db
    .prepare(`SELECT l.*, p.title AS property_title, p.code AS property_code, u.name AS broker_name,
      (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.sender = 'cliente' AND (l.broker_last_read IS NULL OR m.created_at > l.broker_last_read)) AS unread
      FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users u ON u.id = l.broker_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY unread DESC, l.updated_at DESC`)
    .all(...params);
  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all();
  res.render('admin/leads', { title: 'Solicitações', leads, counts, query: req.query });
});

function loadLead(id) {
  return db
    .prepare('SELECT l.*, p.title AS property_title, p.code AS property_code, p.status AS property_status, p.price AS property_price, u.name AS broker_name FROM leads l LEFT JOIN properties p ON p.id = l.property_id LEFT JOIN users u ON u.id = l.broker_id WHERE l.id = ?')
    .get(Number(id));
}

router.get('/solicitacoes/:id', (req, res) => {
  const lead = loadLead(req.params.id);
  if (!lead) return res.status(404).render('public/404', { title: 'Solicitação não encontrada' });
  const history = db.prepare('SELECT h.*, u.name AS user_name FROM lead_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.lead_id = ? ORDER BY h.created_at DESC, h.id DESC').all(lead.id);
  const messages = db.prepare('SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.lead_id = ? ORDER BY m.id ASC').all(lead.id);
  const otherLeads = db.prepare('SELECT l.id, l.protocol, l.status, l.created_at, p.code AS property_code FROM leads l LEFT JOIN properties p ON p.id = l.property_id WHERE lower(l.email) = ? AND l.phone = ? AND l.id <> ? ORDER BY l.created_at DESC').all(lead.email, lead.phone, lead.id);
  db.prepare("UPDATE leads SET broker_last_read = datetime('now','localtime') WHERE id = ?").run(lead.id);
  res.render('admin/lead-detail', { title: `Solicitação ${lead.protocol}`, lead, history, messages, otherLeads, brokers: brokers() });
});

router.post('/solicitacoes/:id/status', (req, res) => {
  const lead = loadLead(req.params.id);
  if (!lead) return res.status(404).render('public/404', { title: 'Solicitação não encontrada' });
  const status = String(req.body.status || '');
  const note = String(req.body.note || '').trim();
  if (!LEAD_STATUS[status]) { flash(req, 'error', 'Status inválido.'); return res.redirect(`/admin/solicitacoes/${lead.id}`); }

  const current = LEAD_STATUS[lead.status] || {};
  // Regra: solicitação encerrada só pode ser reaberta pelo administrador
  if (current.closed && !LEAD_STATUS[status].closed && req.user.role !== 'admin') {
    flash(req, 'error', 'Solicitações encerradas só podem ser reabertas pelo administrador.');
    return res.redirect(`/admin/solicitacoes/${lead.id}`);
  }
  // Regra: visita agendada exige data/hora
  let visitAt = lead.visit_at;
  if (status === 'visita_agendada') {
    if (!req.body.visit_at) { flash(req, 'error', 'Informe a data e hora da visita.'); return res.redirect(`/admin/solicitacoes/${lead.id}`); }
    visitAt = String(req.body.visit_at).replace('T', ' ');
    if (new Date(req.body.visit_at) < new Date()) { flash(req, 'error', 'A data da visita deve ser futura.'); return res.redirect(`/admin/solicitacoes/${lead.id}`); }
  }
  // Regra: recusa/cancelamento exigem justificativa
  if ((status === 'recusado' || status === 'cancelado') && note.length < 5) {
    flash(req, 'error', 'Informe o motivo da recusa/cancelamento (mín. 5 caracteres).');
    return res.redirect(`/admin/solicitacoes/${lead.id}`);
  }

  db.prepare("UPDATE leads SET status = ?, visit_at = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, visitAt, lead.id);
  db.prepare('INSERT INTO lead_history(lead_id, status, note, user_id) VALUES (?,?,?,?)').run(lead.id, status, note || null, req.user.id);

  // Mensagem automática no chat para o cliente
  let sysMsg = `Status atualizado para "${LEAD_STATUS[status].label}". ${LEAD_STATUS[status].desc}`;
  if (status === 'visita_agendada' && visitAt) {
    const d = new Date(req.body.visit_at);
    sysMsg += ` Data: ${d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`;
  }
  if (note && status !== 'recusado' && req.body.share_note) sysMsg += ` Observação do corretor: ${note}`;
  if (note && status === 'recusado' && req.body.share_note) sysMsg += ` Motivo: ${note}`;
  db.prepare("INSERT INTO messages(lead_id, sender, user_id, body) VALUES (?, 'sistema', ?, ?)").run(lead.id, req.user.id, sysMsg);

  // Regras que refletem no imóvel
  if (lead.property_id) {
    if (status === 'aprovado') db.prepare("UPDATE properties SET status = 'reservado', updated_at = datetime('now','localtime') WHERE id = ? AND status = 'disponivel'").run(lead.property_id);
    if (status === 'contrato') {
      db.prepare("UPDATE properties SET status = 'alugado', updated_at = datetime('now','localtime') WHERE id = ?").run(lead.property_id);
      // Demais solicitações abertas do mesmo imóvel são canceladas automaticamente
      const others = db.prepare("SELECT id FROM leads WHERE property_id = ? AND id <> ? AND status NOT IN ('contrato','recusado','cancelado')").all(lead.property_id, lead.id);
      for (const o of others) {
        db.prepare("UPDATE leads SET status = 'cancelado', updated_at = datetime('now','localtime') WHERE id = ?").run(o.id);
        db.prepare('INSERT INTO lead_history(lead_id, status, note, user_id) VALUES (?,?,?,?)').run(o.id, 'cancelado', 'Imóvel alugado para outro interessado.', req.user.id);
        db.prepare("INSERT INTO messages(lead_id, sender, body) VALUES (?, 'sistema', ?)").run(o.id, 'Infelizmente este imóvel acabou de ser alugado. Confira outras opções em nosso site ou fale com o corretor pelo WhatsApp.');
      }
    }
    if ((status === 'recusado' || status === 'cancelado') && lead.status === 'aprovado') {
      db.prepare("UPDATE properties SET status = 'disponivel', updated_at = datetime('now','localtime') WHERE id = ? AND status = 'reservado'").run(lead.property_id);
    }
  }

  flash(req, 'success', `Status alterado para "${LEAD_STATUS[status].label}".`);
  res.redirect(`/admin/solicitacoes/${lead.id}`);
});

router.post('/solicitacoes/:id/notas', (req, res) => {
  const lead = loadLead(req.params.id);
  if (!lead) return res.status(404).render('public/404', { title: 'Solicitação não encontrada' });
  db.prepare('UPDATE leads SET internal_notes = ? WHERE id = ?').run(String(req.body.internal_notes || '').trim().slice(0, 5000), lead.id);
  flash(req, 'success', 'Anotações internas salvas.');
  res.redirect(`/admin/solicitacoes/${lead.id}`);
});

router.post('/solicitacoes/:id/atribuir', (req, res) => {
  const lead = loadLead(req.params.id);
  if (!lead) return res.status(404).render('public/404', { title: 'Solicitação não encontrada' });
  const brokerId = Number(req.body.broker_id) || null;
  const broker = brokerId ? db.prepare('SELECT name FROM users WHERE id = ? AND active = 1').get(brokerId) : null;
  db.prepare("UPDATE leads SET broker_id = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(broker ? brokerId : null, lead.id);
  db.prepare('INSERT INTO lead_history(lead_id, status, note, user_id) VALUES (?,?,?,?)').run(lead.id, lead.status, broker ? `Atendimento atribuído a ${broker.name}.` : 'Atendimento sem corretor atribuído.', req.user.id);
  flash(req, 'success', 'Corretor responsável atualizado.');
  res.redirect(`/admin/solicitacoes/${lead.id}`);
});

router.post('/solicitacoes/:id/excluir', auth.requireAdmin, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(Number(req.params.id));
  flash(req, 'success', 'Solicitação excluída.');
  res.redirect('/admin/solicitacoes');
});

// ---------- API do chat (lado do corretor) ----------

router.get('/api/chat/:id/messages', (req, res) => {
  const lead = db.prepare('SELECT id, status FROM leads WHERE id = ?').get(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Solicitação não encontrada' });
  const after = Number(req.query.after) || 0;
  const messages = db.prepare('SELECT m.id, m.sender, m.body, m.created_at, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.lead_id = ? AND m.id > ? ORDER BY m.id ASC').all(lead.id, after);
  db.prepare("UPDATE leads SET broker_last_read = datetime('now','localtime') WHERE id = ?").run(lead.id);
  res.json({ messages, status: lead.status, closed: !!(LEAD_STATUS[lead.status] || {}).closed });
});

router.post('/api/chat/:id/messages', (req, res) => {
  const lead = db.prepare('SELECT id, status FROM leads WHERE id = ?').get(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Solicitação não encontrada' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Mensagem vazia' });
  if (body.length > 2000) return res.status(400).json({ error: 'Mensagem muito longa' });
  const r = db.prepare("INSERT INTO messages(lead_id, sender, user_id, body) VALUES (?, 'corretor', ?, ?)").run(lead.id, req.user.id, body);
  // Regra: primeira resposta do corretor move a solicitação de "Recebida" para "Em análise"
  if (lead.status === 'novo') {
    db.prepare("UPDATE leads SET status = 'em_analise' WHERE id = ?").run(lead.id);
    db.prepare('INSERT INTO lead_history(lead_id, status, note, user_id) VALUES (?,?,?,?)').run(lead.id, 'em_analise', 'Corretor iniciou o atendimento pelo chat.', req.user.id);
  }
  db.prepare("UPDATE leads SET updated_at = datetime('now','localtime'), broker_last_read = datetime('now','localtime') WHERE id = ?").run(lead.id);
  const msg = db.prepare('SELECT m.id, m.sender, m.body, m.created_at, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(Number(r.lastInsertRowid));
  res.json({ message: msg });
});

router.get('/api/notificacoes', (req, res) => {
  res.json({ unread: res.locals.unreadTotal, newLeads: res.locals.newLeads });
});

// ---------- Configurações do site ----------

router.get('/configuracoes', (req, res) => {
  res.render('admin/settings', { title: 'Configurações do site', s: getSettings(), keys: Object.keys(DEFAULT_SETTINGS) });
});

router.post('/configuracoes', (req, res) => {
  const data = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) data[k] = req.body[k] ?? '';
  data.whatsapp = String(data.whatsapp).replace(/\D/g, '');
  if (data.whatsapp && data.whatsapp.length < 12) {
    flash(req, 'error', 'O WhatsApp deve estar no formato internacional: 55 + DDD + número (ex.: 5511999999999).');
    return res.render('admin/settings', { title: 'Configurações do site', s: { ...getSettings(), ...data }, keys: Object.keys(DEFAULT_SETTINGS) });
  }
  for (const k of ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin']) {
    if (data[k] && !/^https?:\/\//i.test(data[k])) data[k] = 'https://' + data[k];
  }
  if (data.email && !isValidEmail(data.email)) {
    flash(req, 'error', 'E-mail de contato inválido.');
    return res.render('admin/settings', { title: 'Configurações do site', s: { ...getSettings(), ...data }, keys: Object.keys(DEFAULT_SETTINGS) });
  }
  saveSettings(data);
  flash(req, 'success', 'Configurações salvas.');
  res.redirect('/admin/configuracoes');
});

// ---------- Perfil ----------

router.get('/perfil', (req, res) => {
  res.render('admin/profile', { title: 'Meu perfil' });
});

router.post('/perfil', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const phone = String(req.body.phone || '').trim();
  const whatsapp = String(req.body.whatsapp || '').replace(/\D/g, '');
  const creci = String(req.body.creci || '').trim();
  if (name.length < 2) { flash(req, 'error', 'Informe seu nome.'); return res.redirect('/admin/perfil'); }
  if (email && !isValidEmail(email)) { flash(req, 'error', 'E-mail inválido.'); return res.redirect('/admin/perfil'); }
  db.prepare('UPDATE users SET name = ?, email = ?, phone = ?, whatsapp = ?, creci = ? WHERE id = ?').run(name, email, phone, whatsapp, creci, req.user.id);

  if (req.body.new_password) {
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(req.body.current_password || ''), user.password_hash)) { flash(req, 'error', 'Senha atual incorreta.'); return res.redirect('/admin/perfil'); }
    const err = passwordError(req.body.new_password);
    if (err) { flash(req, 'error', err); return res.redirect('/admin/perfil'); }
    if (req.body.new_password !== req.body.confirm_password) { flash(req, 'error', 'A confirmação da senha não confere.'); return res.redirect('/admin/perfil'); }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.new_password), 10), req.user.id);
  }
  flash(req, 'success', 'Perfil atualizado.');
  res.redirect('/admin/perfil');
});

function passwordError(p) {
  const s = String(p || '');
  if (s.length < 8) return 'A senha deve ter ao menos 8 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'A senha deve conter letras e números.';
  return null;
}

// ---------- Usuários (somente admin) ----------

router.get('/usuarios', auth.requireAdmin, (req, res) => {
  const users = db.prepare('SELECT u.*, (SELECT COUNT(*) FROM properties p WHERE p.broker_id = u.id) AS property_count, (SELECT COUNT(*) FROM leads l WHERE l.broker_id = u.id) AS lead_count FROM users u ORDER BY u.active DESC, u.role, u.name').all();
  res.render('admin/users', { title: 'Usuários', users });
});

router.post('/usuarios', auth.requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  const username = String(req.body.username || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'corretor';
  const email = String(req.body.email || '').trim();
  const whatsapp = String(req.body.whatsapp || '').replace(/\D/g, '');
  const errors = [];
  if (name.length < 2) errors.push('Informe o nome.');
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) errors.push('Usuário deve ter 3 a 30 caracteres (letras, números, ponto, hífen ou underline).');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) errors.push('Já existe um usuário com esse nome.');
  const pErr = passwordError(req.body.password);
  if (pErr) errors.push(pErr);
  if (email && !isValidEmail(email)) errors.push('E-mail inválido.');
  if (errors.length) { flash(req, 'error', errors.join(' ')); return res.redirect('/admin/usuarios'); }
  db.prepare('INSERT INTO users(name, username, password_hash, role, email, phone, whatsapp, creci) VALUES (?,?,?,?,?,?,?,?)').run(
    name, username, bcrypt.hashSync(String(req.body.password), 10), role, email, String(req.body.phone || '').trim(), whatsapp, String(req.body.creci || '').trim()
  );
  flash(req, 'success', `Usuário ${username} criado.`);
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id', auth.requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) { flash(req, 'error', 'Usuário não encontrado.'); return res.redirect('/admin/usuarios'); }
  const action = req.body.action;
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1").get().c;

  if (action === 'toggle') {
    if (target.id === req.user.id) { flash(req, 'error', 'Você não pode desativar o seu próprio usuário.'); return res.redirect('/admin/usuarios'); }
    if (target.role === 'admin' && target.active && adminCount <= 1) { flash(req, 'error', 'É necessário manter ao menos um administrador ativo.'); return res.redirect('/admin/usuarios'); }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(target.active ? 0 : 1, target.id);
    flash(req, 'success', `Usuário ${target.username} ${target.active ? 'desativado' : 'reativado'}.`);
  } else if (action === 'reset_password') {
    const err = passwordError(req.body.password);
    if (err) { flash(req, 'error', err); return res.redirect('/admin/usuarios'); }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.password), 10), target.id);
    flash(req, 'success', `Senha de ${target.username} redefinida.`);
  } else if (action === 'role') {
    const role = req.body.role === 'admin' ? 'admin' : 'corretor';
    if (target.id === req.user.id && role !== 'admin') { flash(req, 'error', 'Você não pode remover seu próprio acesso de administrador.'); return res.redirect('/admin/usuarios'); }
    if (target.role === 'admin' && role !== 'admin' && adminCount <= 1) { flash(req, 'error', 'É necessário manter ao menos um administrador.'); return res.redirect('/admin/usuarios'); }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
    flash(req, 'success', `Perfil de ${target.username} alterado para ${role}.`);
  } else if (action === 'delete') {
    if (target.id === req.user.id) { flash(req, 'error', 'Você não pode excluir o seu próprio usuário.'); return res.redirect('/admin/usuarios'); }
    if (target.role === 'admin' && adminCount <= 1) { flash(req, 'error', 'É necessário manter ao menos um administrador.'); return res.redirect('/admin/usuarios'); }
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    flash(req, 'success', `Usuário ${target.username} excluído.`);
  }
  res.redirect('/admin/usuarios');
});

module.exports = router;
