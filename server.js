'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const { getSettings, UPLOADS_DIR, LEAD_STATUS, PROPERTY_TYPES, PROPERTY_STATUS, FEATURE_OPTIONS } = require('./src/db');
const utils = require('./src/utils');
const captcha = require('./src/captcha');
const { currentUser } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(
  session({
    name: 'imoveis.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// Variáveis disponíveis em todas as views
app.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.user = currentUser(req);
  res.locals.utils = utils;
  res.locals.LEAD_STATUS = LEAD_STATUS;
  res.locals.PROPERTY_TYPES = PROPERTY_TYPES;
  res.locals.PROPERTY_STATUS = PROPERTY_STATUS;
  res.locals.FEATURE_OPTIONS = FEATURE_OPTIONS;
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.clientSession = req.session.client || null;
  next();
});

app.get('/captcha/:scope', captcha.route);

app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/client'));
app.use('/admin', require('./src/routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('public/404', { title: 'Página não encontrada' });
});

// Erros
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: err.message || 'Erro interno' });
  res.status(500).render('public/500', { title: 'Erro', message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n  Imóveis Aluguel rodando em http://localhost:${PORT}`);
  console.log(`  Painel do corretor:      http://localhost:${PORT}/admin\n`);
});
