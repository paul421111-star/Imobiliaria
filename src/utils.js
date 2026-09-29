'use strict';

const { LEAD_STATUS, PROPERTY_TYPES, PROPERTY_STATUS } = require('./db');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brlCents = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function money(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? brl.format(n) : brlCents.format(n);
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p || '';
}

function typeLabel(v) {
  return (PROPERTY_TYPES.find((t) => t.value === v) || { label: v }).label;
}

function propStatus(v) {
  return PROPERTY_STATUS[v] || { label: v, color: 'muted' };
}

function leadStatus(v) {
  return LEAD_STATUS[v] || { label: v, desc: '', step: 0 };
}

function whatsappLink(number, text) {
  const n = String(number || '').replace(/\D/g, '');
  if (!n) return '#';
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1).trimEnd() + '…' : str;
}

module.exports = { money, formatDate, formatDateTime, formatPhone, typeLabel, propStatus, leadStatus, whatsappLink, slugify, isValidEmail, escapeHtml, truncate };
