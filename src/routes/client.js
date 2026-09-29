'use strict';

const express = require('express');
const { db, normalizePhone, LEAD_STATUS } = require('../db');
const captcha = require('../captcha');
const { isValidEmail } = require('../utils');

const router = express.Router();

function leadsForClient(client) {
  return db
    .prepare(`SELECT l.*, p.title AS property_title, p.code AS property_code,
        (SELECT filename FROM property_images pi WHERE pi.property_id = p.id ORDER BY is_cover DESC, sort_order ASC LIMIT 1) AS property_cover,
        (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.sender <> 'cliente' AND (l.client_last_read IS NULL OR m.created_at > l.client_last_read)) AS unread
      FROM leads l LEFT JOIN properties p ON p.id = l.property_id
      WHERE lower(l.email) = ? AND l.phone = ? ORDER BY l.updated_at DESC`)
    .all(client.email, client.phone);
}

function findClientLead(req, protocol) {
  const client = req.session.client;
  if (!client) return null;
  return db
    .prepare('SELECT l.*, p.title AS property_title, p.code AS property_code, p.city AS property_city, p.neighborhood AS property_neighborhood FROM leads l LEFT JOIN properties p ON p.id = l.property_id WHERE l.protocol = ? AND lower(l.email) = ? AND l.phone = ?')
    .get(String(protocol), client.email, client.phone);
}

router.get('/acompanhar', (req, res) => {
  const client = req.session.client;
  const leads = client ? leadsForClient(client) : [];
  const formError = req.session.formError || null;
  delete req.session.formError;
  res.render('public/track', { title: 'Acompanhar solicitação', leads, formError });
});

router.post('/acompanhar', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = normalizePhone(req.body.phone);
  const errors = [];
  if (!isValidEmail(email)) errors.push('Informe um e-mail válido.');
  if (phone.length < 10 || phone.length > 11) errors.push('Informe o celular com DDD.');
  if (!captcha.verify(req, 'acompanhar', req.body.captcha)) errors.push('Código de verificação incorreto.');
  if (errors.length) {
    req.session.formError = errors.join(' ');
    return res.redirect('/acompanhar');
  }
  const found = db.prepare('SELECT name FROM leads WHERE lower(email) = ? AND phone = ? LIMIT 1').get(email, phone);
  if (!found) {
    req.session.formError = 'Não encontramos solicitações para esse e-mail e celular. Verifique os dados informados (use exatamente os mesmos do formulário).';
    return res.redirect('/acompanhar');
  }
  req.session.client = { email, phone, name: found.name };
  res.redirect('/acompanhar');
});

router.get('/acompanhar/sair', (req, res) => {
  delete req.session.client;
  res.redirect('/acompanhar');
});

router.get('/acompanhar/:protocol', (req, res) => {
  const lead = findClientLead(req, req.params.protocol);
  if (!lead) {
    req.session.formError = 'Para ver esta solicitação, identifique-se com o e-mail e celular usados no formulário.';
    return res.redirect('/acompanhar');
  }
  const history = db.prepare('SELECT h.*, u.name AS user_name FROM lead_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.lead_id = ? ORDER BY h.created_at ASC, h.id ASC').all(lead.id);
  const messages = db.prepare('SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.lead_id = ? ORDER BY m.id ASC').all(lead.id);
  const broker = lead.broker_id ? db.prepare('SELECT name, whatsapp, phone, creci FROM users WHERE id = ?').get(lead.broker_id) : null;
  db.prepare("UPDATE leads SET client_last_read = datetime('now','localtime') WHERE id = ?").run(lead.id);
  const steps = Object.entries(LEAD_STATUS).filter(([, s]) => s.step > 0).sort((a, b) => a[1].step - b[1].step);
  res.render('public/track-detail', { title: `Protocolo ${lead.protocol}`, lead, history, messages, broker, steps });
});

// ---- API do chat (lado do cliente) ----

router.get('/api/chat/:protocol/messages', (req, res) => {
  const lead = findClientLead(req, req.params.protocol);
  if (!lead) return res.status(403).json({ error: 'Sessão inválida' });
  const after = Number(req.query.after) || 0;
  const messages = db.prepare('SELECT m.id, m.sender, m.body, m.created_at, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.lead_id = ? AND m.id > ? ORDER BY m.id ASC').all(lead.id, after);
  db.prepare("UPDATE leads SET client_last_read = datetime('now','localtime') WHERE id = ?").run(lead.id);
  const status = LEAD_STATUS[lead.status] || {};
  res.json({ messages, status: lead.status, statusLabel: status.label, closed: !!status.closed });
});

router.post('/api/chat/:protocol/messages', (req, res) => {
  const lead = findClientLead(req, req.params.protocol);
  if (!lead) return res.status(403).json({ error: 'Sessão inválida' });
  const status = LEAD_STATUS[lead.status] || {};
  if (status.closed) return res.status(400).json({ error: 'Esta solicitação foi encerrada. Para novo atendimento, envie uma nova solicitação.' });
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Mensagem vazia' });
  if (body.length > 1000) return res.status(400).json({ error: 'Mensagem muito longa (máx. 1000 caracteres)' });
  const r = db.prepare("INSERT INTO messages(lead_id, sender, body) VALUES (?, 'cliente', ?)").run(lead.id, body);
  db.prepare("UPDATE leads SET updated_at = datetime('now','localtime'), client_last_read = datetime('now','localtime') WHERE id = ?").run(lead.id);
  const msg = db.prepare('SELECT id, sender, body, created_at FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
  res.json({ message: msg });
});

module.exports = router;
