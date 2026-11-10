'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const DURACION_SESION_MS = 2 * 60 * 60 * 1000; // 2 horas

// Hash de mentira para gastar el mismo tiempo cuando el correo no existe
// (evita descubrir qué correos están registrados midiendo la respuesta).
const HASH_FALSO = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

// Contraseña -> "scrypt$<sal>$<hash>". Cada usuario tiene su propia sal aleatoria.
async function hashearPassword(password) {
  const sal = crypto.randomBytes(16);
  const derivada = await scrypt(password, sal, 64);
  return `scrypt$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

async function verificarPassword(password, almacenado) {
  const [algoritmo, salHex, hashHex] = String(almacenado).split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const derivada = await scrypt(password, Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(derivada, esperado);
}

function hashSha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

// Token de sesión (va en la cookie) y token CSRF (va en los formularios).
function generarSesion() {
  return {
    token: crypto.randomBytes(32).toString('hex'),
    csrf: crypto.randomBytes(24).toString('hex'),
    expiraEn: Date.now() + DURACION_SESION_MS,
  };
}

function csrfValido(esperado, recibido) {
  if (typeof esperado !== 'string' || typeof recibido !== 'string') return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(recibido);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Limitador de intentos fallidos de login (en memoria).
function crearLimitador({ maximo = 5, ventanaMs = 15 * 60 * 1000 } = {}) {
  const registros = new Map();

  function vigente(clave, ahora) {
    const r = registros.get(clave);
    if (r && ahora - r.desde > ventanaMs) {
      registros.delete(clave);
      return undefined;
    }
    return r;
  }

  return {
    bloqueado(clave) {
      const r = vigente(clave, Date.now());
      return Boolean(r) && r.fallos >= maximo;
    },
    registrarFallo(clave) {
      const ahora = Date.now();
      const r = vigente(clave, ahora);
      if (r) r.fallos += 1;
      else registros.set(clave, { fallos: 1, desde: ahora });
      if (registros.size > 10000) {
        for (const k of registros.keys()) vigente(k, ahora);
      }
    },
    reiniciar(clave) {
      registros.delete(clave);
    },
  };
}

module.exports = {
  DURACION_SESION_MS,
  HASH_FALSO,
  hashearPassword,
  verificarPassword,
  hashSha256,
  generarSesion,
  csrfValido,
  crearLimitador,
};
