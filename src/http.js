'use strict';

const LIMITE_CUERPO = 16 * 1024; // 16 KB es más que suficiente para estos formularios

const CABECERAS_SEGURIDAD = {
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

// Lee el cuerpo de un <form> (application/x-www-form-urlencoded) y lo devuelve como objeto.
function leerFormulario(req) {
  return new Promise((resolve, reject) => {
    const demasiado = () => Object.assign(new Error('Cuerpo demasiado grande'), { estado: 413 });
    if (Number(req.headers['content-length']) > LIMITE_CUERPO) return reject(demasiado());

    const partes = [];
    let total = 0;
    req.on('data', (trozo) => {
      total += trozo.length;
      if (total > LIMITE_CUERPO) {
        reject(demasiado());
        req.destroy();
        return;
      }
      partes.push(trozo);
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(partes).toString('utf8')))));
    req.on('error', reject);
  });
}

function leerCookies(req) {
  const cookies = {};
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i < 0) continue;
    try {
      cookies[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
    } catch {
      /* cookie mal formada: se ignora */
    }
  }
  return cookies;
}

function cookieSesion(token, maxAgeSegundos, seguro) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSegundos}${seguro ? '; Secure' : ''}`;
}

function enviarHtml(res, estado, html, cabeceras = {}) {
  res.writeHead(estado, { 'Content-Type': 'text/html; charset=utf-8', ...CABECERAS_SEGURIDAD, ...cabeceras });
  res.end(html);
}

// 303 "See Other": después de un POST el navegador hace un GET a la nueva dirección.
function redirigir(res, destino, cabeceras = {}) {
  res.writeHead(303, { Location: destino, ...CABECERAS_SEGURIDAD, ...cabeceras });
  res.end();
}

function enviarArchivo(res, tipo, contenido) {
  res.writeHead(200, { 'Content-Type': tipo, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300' });
  res.end(contenido);
}

module.exports = { leerFormulario, leerCookies, cookieSesion, enviarHtml, redirigir, enviarArchivo };
