'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'imoveis.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','corretor')),
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  creci TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel','reservado','alugado','inativo')),
  price REAL NOT NULL,
  condo_fee REAL NOT NULL DEFAULT 0,
  iptu REAL NOT NULL DEFAULT 0,
  area REAL,
  bedrooms INTEGER NOT NULL DEFAULT 0,
  suites INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  parking INTEGER NOT NULL DEFAULT 0,
  furnished INTEGER NOT NULL DEFAULT 0,
  pets_allowed INTEGER NOT NULL DEFAULT 0,
  address TEXT,
  neighborhood TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'SP',
  zip TEXT,
  description TEXT,
  features TEXT NOT NULL DEFAULT '[]',
  featured INTEGER NOT NULL DEFAULT 0,
  broker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  min_contract_months INTEGER NOT NULL DEFAULT 12,
  deposit_months INTEGER NOT NULL DEFAULT 0,
  video_url TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS property_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  protocol TEXT NOT NULL UNIQUE,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  broker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visit_at TEXT,
  internal_notes TEXT,
  client_last_read TEXT,
  broker_last_read TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS lead_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('cliente','corretor','sistema')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads(email, phone);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
`);

// ---------- Constantes de negócio ----------

const PROPERTY_TYPES = [
  { value: 'casa', label: 'Casa' },
  { value: 'apartamento', label: 'Apartamento' },
  { value: 'sobrado', label: 'Sobrado' },
  { value: 'kitnet', label: 'Kitnet / Studio' },
  { value: 'cobertura', label: 'Cobertura' },
  { value: 'comercial', label: 'Sala / Ponto comercial' },
  { value: 'galpao', label: 'Galpão' },
  { value: 'terreno', label: 'Terreno' },
];

const PROPERTY_STATUS = {
  disponivel: { label: 'Disponível', color: 'success' },
  reservado: { label: 'Reservado', color: 'warning' },
  alugado: { label: 'Alugado', color: 'muted' },
  inativo: { label: 'Inativo', color: 'muted' },
};

// Fluxo de acompanhamento da solicitação (regras de negócio)
const LEAD_STATUS = {
  novo: { label: 'Recebida', desc: 'Sua solicitação foi recebida e aguarda análise do corretor.', step: 1 },
  em_analise: { label: 'Em análise', desc: 'O corretor está analisando sua solicitação.', step: 2 },
  contato: { label: 'Contato realizado', desc: 'O corretor entrou em contato com você.', step: 3 },
  visita_agendada: { label: 'Visita agendada', desc: 'Visita ao imóvel agendada.', step: 4 },
  documentacao: { label: 'Documentação', desc: 'Análise de documentos e cadastro.', step: 5 },
  aprovado: { label: 'Aprovado', desc: 'Cadastro aprovado! Próximo passo: assinatura do contrato.', step: 6 },
  contrato: { label: 'Contrato assinado', desc: 'Contrato assinado. Bem-vindo ao seu novo lar!', step: 7, closed: true },
  recusado: { label: 'Não aprovado', desc: 'Infelizmente a solicitação não foi aprovada.', step: 0, closed: true },
  cancelado: { label: 'Cancelada', desc: 'Solicitação cancelada.', step: 0, closed: true },
};

const FEATURE_OPTIONS = [
  'Piscina', 'Churrasqueira', 'Academia', 'Portaria 24h', 'Elevador', 'Área de serviço',
  'Varanda / Sacada', 'Ar-condicionado', 'Armários embutidos', 'Quintal', 'Jardim',
  'Playground', 'Salão de festas', 'Interfone', 'Aquecimento a gás', 'Câmeras de segurança',
  'Acessibilidade', 'Lavanderia', 'Espaço gourmet', 'Bicicletário', 'Próximo ao metrô', 'Próximo a escolas',
];

const DEFAULT_SETTINGS = {
  site_name: 'Prime Imóveis',
  site_tagline: 'Alugue com segurança, more com tranquilidade.',
  hero_title: 'Encontre o imóvel perfeito para alugar',
  hero_subtitle: 'Casas, apartamentos e salas comerciais com atendimento personalizado e sem burocracia.',
  phone: '(11) 4002-8922',
  whatsapp: '5511999999999',
  whatsapp_message: 'Olá! Vi um imóvel no site e gostaria de mais informações.',
  email: 'contato@primeimoveis.com.br',
  address: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP',
  business_hours: 'Seg a Sex 9h às 18h · Sáb 9h às 13h',
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  tiktok: '',
  youtube: '',
  linkedin: '',
  about: 'Somos uma imobiliária especializada em locação residencial e comercial. Nosso compromisso é conectar pessoas a lares com transparência, agilidade e atendimento humano do início ao fim.',
  rental_requirements: 'Renda mínima comprovada de 3x o valor do aluguel (somando aluguel + condomínio + IPTU).\nDocumentos: RG, CPF, comprovante de residência e comprovante de renda dos últimos 3 meses.\nGarantias aceitas: fiador, seguro-fiança, caução (até 3 meses) ou título de capitalização.\nContrato mínimo de 12 meses (salvo indicação no anúncio).',
  footer_text: 'CRECI 00000-J · Todos os direitos reservados.',
};

// ---------- Helpers ----------

function nowIso() {
  return new Date().toISOString();
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function saveSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.exec('BEGIN');
  try {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in obj) stmt.run(key, String(obj[key] ?? '').trim());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function nextPropertyCode() {
  const row = db.prepare('SELECT MAX(id) AS m FROM properties').get();
  const n = (row?.m || 0) + 1;
  return 'IM-' + String(n).padStart(4, '0');
}

function generateProtocol() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  let protocol;
  do {
    const rnd = Math.floor(Math.random() * 900000 + 100000);
    protocol = `${y}${m}-${rnd}`;
  } while (db.prepare('SELECT 1 FROM leads WHERE protocol = ?').get(protocol));
  return protocol;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ---------- Seed ----------

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const ins = db.prepare('INSERT INTO users(name, username, password_hash, role, email, phone, whatsapp, creci) VALUES (?,?,?,?,?,?,?,?)');
    ins.run('Paulo', 'Paulo', bcrypt.hashSync('Abcd1234', 10), 'admin', 'paulo@primeimoveis.com.br', '(11) 99999-0001', '5511999990001', '');
    ins.run('Mariele', 'Mariele', bcrypt.hashSync('Abcd1234', 10), 'corretor', 'mariele@primeimoveis.com.br', '(11) 99999-0002', '5511999990002', 'CRECI 123456-F');
  }

  const propCount = db.prepare('SELECT COUNT(*) AS c FROM properties').get().c;
  if (propCount === 0) {
    const mariele = db.prepare("SELECT id FROM users WHERE username = 'Mariele'").get();
    const brokerId = mariele ? mariele.id : null;
    const samples = [
      {
        title: 'Apartamento moderno com varanda gourmet no Brooklin', type: 'apartamento', price: 4200, condo_fee: 850, iptu: 210,
        area: 78, bedrooms: 2, suites: 1, bathrooms: 2, parking: 1, furnished: 0, pets_allowed: 1,
        address: 'Rua Barão de Jaceguai, 120', neighborhood: 'Brooklin', city: 'São Paulo', state: 'SP', zip: '04606-000',
        description: 'Apartamento com planta inteligente, varanda gourmet integrada à sala, cozinha americana com bancada em quartzo e ampla iluminação natural. Condomínio completo com piscina, academia e salão de festas. Localização privilegiada, a 5 minutos da estação Brooklin.',
        features: ['Piscina', 'Academia', 'Portaria 24h', 'Elevador', 'Varanda / Sacada', 'Salão de festas', 'Próximo ao metrô'],
        featured: 1, palette: ['#0b2545', '#13315c'],
      },
      {
        title: 'Casa térrea com quintal amplo e churrasqueira', type: 'casa', price: 3500, condo_fee: 0, iptu: 180,
        area: 140, bedrooms: 3, suites: 1, bathrooms: 2, parking: 2, furnished: 0, pets_allowed: 1,
        address: 'Rua das Acácias, 45', neighborhood: 'Jardim Bonfiglioli', city: 'São Paulo', state: 'SP', zip: '05594-000',
        description: 'Casa térrea em rua tranquila, com 3 dormitórios, quintal gramado, área gourmet com churrasqueira e garagem coberta para 2 carros. Ideal para famílias que buscam espaço e conforto.',
        features: ['Churrasqueira', 'Quintal', 'Jardim', 'Área de serviço', 'Armários embutidos', 'Próximo a escolas'],
        featured: 1, palette: ['#134e4a', '#0f766e'],
      },
      {
        title: 'Studio mobiliado próximo à Av. Paulista', type: 'kitnet', price: 2600, condo_fee: 520, iptu: 95,
        area: 32, bedrooms: 1, suites: 0, bathrooms: 1, parking: 0, furnished: 1, pets_allowed: 0,
        address: 'Rua Augusta, 2000', neighborhood: 'Consolação', city: 'São Paulo', state: 'SP', zip: '01412-000',
        description: 'Studio totalmente mobiliado e decorado, pronto para morar. Prédio com lavanderia compartilhada, coworking e bicicletário. A poucos passos do metrô Consolação.',
        features: ['Portaria 24h', 'Elevador', 'Lavanderia', 'Bicicletário', 'Ar-condicionado', 'Próximo ao metrô'],
        featured: 1, palette: ['#7c2d12', '#c2410c'],
      },
      {
        title: 'Sobrado em condomínio fechado com lazer completo', type: 'sobrado', price: 6800, condo_fee: 1200, iptu: 320,
        area: 210, bedrooms: 4, suites: 2, bathrooms: 4, parking: 3, furnished: 0, pets_allowed: 1,
        address: 'Alameda dos Ipês, 300', neighborhood: 'Alphaville', city: 'Barueri', state: 'SP', zip: '06454-000',
        description: 'Sobrado de alto padrão em condomínio fechado com segurança 24h. Living com pé-direito duplo, cozinha planejada, 4 dormitórios sendo 2 suítes, e área de lazer privativa com piscina.',
        features: ['Piscina', 'Churrasqueira', 'Portaria 24h', 'Playground', 'Academia', 'Câmeras de segurança', 'Espaço gourmet'],
        featured: 0, palette: ['#1e1b4b', '#4338ca'],
      },
      {
        title: 'Sala comercial com recepção em edifício corporativo', type: 'comercial', price: 3900, condo_fee: 900, iptu: 260,
        area: 55, bedrooms: 0, suites: 0, bathrooms: 1, parking: 1, furnished: 0, pets_allowed: 0,
        address: 'Av. Brigadeiro Faria Lima, 1500', neighborhood: 'Pinheiros', city: 'São Paulo', state: 'SP', zip: '01452-000',
        description: 'Sala comercial com piso elevado, ar-condicionado central e recepção pronta. Edifício com heliponto, auditório e estacionamento rotativo para visitantes.',
        features: ['Portaria 24h', 'Elevador', 'Ar-condicionado', 'Acessibilidade', 'Câmeras de segurança'],
        featured: 0, palette: ['#111827', '#374151'],
      },
      {
        title: 'Cobertura duplex com vista panorâmica', type: 'cobertura', price: 9500, condo_fee: 1800, iptu: 540,
        area: 180, bedrooms: 3, suites: 3, bathrooms: 4, parking: 2, furnished: 1, pets_allowed: 1,
        address: 'Rua Oscar Freire, 800', neighborhood: 'Jardins', city: 'São Paulo', state: 'SP', zip: '01426-000',
        description: 'Cobertura duplex mobiliada com terraço, piscina privativa e vista panorâmica da cidade. Acabamento de alto padrão e 3 suítes com closet.',
        features: ['Piscina', 'Churrasqueira', 'Elevador', 'Portaria 24h', 'Ar-condicionado', 'Espaço gourmet', 'Varanda / Sacada'],
        featured: 1, palette: ['#3f1d2e', '#9d174d'],
      },
    ];

    const insProp = db.prepare(`INSERT INTO properties(code, title, type, status, price, condo_fee, iptu, area, bedrooms, suites, bathrooms, parking,
      furnished, pets_allowed, address, neighborhood, city, state, zip, description, features, featured, broker_id, min_contract_months, deposit_months)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insImg = db.prepare('INSERT INTO property_images(property_id, filename, sort_order, is_cover) VALUES (?,?,?,?)');

    samples.forEach((s, idx) => {
      const code = 'IM-' + String(idx + 1).padStart(4, '0');
      const r = insProp.run(code, s.title, s.type, 'disponivel', s.price, s.condo_fee, s.iptu, s.area, s.bedrooms, s.suites, s.bathrooms,
        s.parking, s.furnished, s.pets_allowed, s.address, s.neighborhood, s.city, s.state, s.zip, s.description,
        JSON.stringify(s.features), s.featured, brokerId, 12, s.type === 'comercial' ? 3 : 0);
      const pid = Number(r.lastInsertRowid);
      for (let i = 0; i < 3; i++) {
        const fname = `demo-${code.toLowerCase()}-${i + 1}.svg`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fname), placeholderSvg(s.palette, s.title, i));
        insImg.run(pid, fname, i, i === 0 ? 1 : 0);
      }
    });
  }
}

function placeholderSvg([c1, c2], title, i) {
  const labels = ['Fachada', 'Sala de estar', 'Dormitório'];
  const safe = title.replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <g opacity="0.15" fill="#fff">
    <rect x="${120 + i * 40}" y="380" width="360" height="300" rx="8"/>
    <polygon points="${100 + i * 40},390 ${300 + i * 40},220 ${500 + i * 40},390"/>
    <rect x="${640 - i * 30}" y="300" width="420" height="380" rx="8"/>
    <rect x="${690 - i * 30}" y="350" width="80" height="80"/><rect x="${810 - i * 30}" y="350" width="80" height="80"/><rect x="${930 - i * 30}" y="350" width="80" height="80"/>
    <rect x="${690 - i * 30}" y="470" width="80" height="80"/><rect x="${810 - i * 30}" y="470" width="80" height="80"/><rect x="${930 - i * 30}" y="470" width="80" height="80"/>
  </g>
  <text x="60" y="720" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#fff" opacity="0.9">${labels[i] || 'Foto'} · ${safe}</text>
  <text x="60" y="760" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#fff" opacity="0.6">Imagem ilustrativa — substitua pelas fotos reais no painel do corretor</text>
</svg>`;
}

seed();

module.exports = {
  db,
  UPLOADS_DIR,
  PROPERTY_TYPES,
  PROPERTY_STATUS,
  LEAD_STATUS,
  FEATURE_OPTIONS,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  nextPropertyCode,
  generateProtocol,
  normalizePhone,
  nowIso,
};
