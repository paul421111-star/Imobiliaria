'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('./db');

// Regra de negócio: bloqueio temporário após tentativas de login inválidas
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const attempts = new Map(); // chave: username|ip -> { count, lockedUntil }

function attemptKey(username, ip) {
  return `${String(username).toLowerCase()}|${ip}`;
}

function isLocked(username, ip) {
  const a = attempts.get(attemptKey(username, ip));
  if (!a) return 0;
  if (a.lockedUntil && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 60000);
  if (a.lockedUntil && a.lockedUntil <= Date.now()) attempts.delete(attemptKey(username, ip));
  return 0;
}

function registerFailure(username, ip) {
  const key = attemptKey(username, ip);
  const a = attempts.get(key) || { count: 0, lockedUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    a.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
    a.count = 0;
  }
  attempts.set(key, a);
  return MAX_ATTEMPTS - a.count;
}

function clearFailures(username, ip) {
  attempts.delete(attemptKey(username, ip));
}

function authenticate(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (!user) return null;
  if (!bcrypt.compareSync(String(password || ''), user.password_hash)) return null;
  return user;
}

function currentUser(req) {
  if (!req.session.userId) return null;
  const user = db.prepare('SELECT id, name, username, role, email, phone, whatsapp, creci, active FROM users WHERE id = ? AND active = 1').get(req.session.userId);
  return user || null;
}

function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    if (req.xhr || req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado' });
    req.session.returnTo = req.originalUrl;
    return res.redirect('/admin/login');
  }
  req.user = user;
  res.locals.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    if (req.xhr || req.path.startsWith('/api/')) return res.status(403).json({ error: 'Acesso restrito ao administrador' });
    req.session.flash = { type: 'error', text: 'Acesso restrito ao administrador.' };
    return res.redirect('/admin');
  }
  next();
}

module.exports = { authenticate, currentUser, requireLogin, requireAdmin, isLocked, registerFailure, clearFailures, MAX_ATTEMPTS, LOCK_MINUTES };
