'use strict';

const svgCaptcha = require('svg-captcha');

/**
 * Captcha próprio (sem dependência de serviços externos).
 * Cada "escopo" (login, contato, acompanhar) guarda seu próprio código na sessão
 * e o código é invalidado após a primeira verificação (uso único).
 */

function generate(req, scope) {
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 3,
    ignoreChars: '0oO1ilI',
    color: true,
    background: '#f1f5f9',
    width: 170,
    height: 56,
    fontSize: 48,
  });
  req.session.captcha = req.session.captcha || {};
  req.session.captcha[scope] = { text: captcha.text.toLowerCase(), ts: Date.now() };
  return captcha.data;
}

function verify(req, scope, answer) {
  const store = req.session.captcha && req.session.captcha[scope];
  if (req.session.captcha) delete req.session.captcha[scope]; // uso único
  if (!store) return false;
  if (Date.now() - store.ts > 10 * 60 * 1000) return false; // expira em 10 min
  return String(answer || '').trim().toLowerCase() === store.text;
}

/** Rota GET /captcha/:scope — devolve SVG */
// Somente para testes automatizados locais: CAPTCHA_DEBUG=1 expõe a resposta num header.
// Nunca é ativado quando NODE_ENV=production.
const DEBUG = process.env.CAPTCHA_DEBUG === '1' && process.env.NODE_ENV !== 'production';

function route(req, res) {
  const scope = String(req.params.scope || 'default').replace(/[^a-z_]/gi, '').slice(0, 30) || 'default';
  const svg = generate(req, scope);
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' });
  if (DEBUG) res.set('X-Captcha-Debug', req.session.captcha[scope].text);
  res.send(svg);
}

module.exports = { generate, verify, route };
