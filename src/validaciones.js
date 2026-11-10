'use strict';

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REGEX_NOMBRE = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

const texto = (v) => (typeof v === 'string' ? v : '');
const compactar = (v) => texto(v).trim().replace(/\s+/g, ' ');

function resultado(valores, errores) {
  return { valores, errores, valido: Object.keys(errores).length === 0 };
}

// Registro de usuario: nombre, correo, contraseña y confirmación.
function validarRegistro(entrada) {
  const nombre = compactar(entrada.nombre);
  const email = texto(entrada.email).trim().toLowerCase();
  const password = texto(entrada.password);
  const confirmar = texto(entrada.confirmar);
  const errores = {};

  if (!nombre) errores.nombre = 'El nombre es obligatorio.';
  else if (nombre.length < 2 || nombre.length > 60) errores.nombre = 'El nombre debe tener entre 2 y 60 caracteres.';
  else if (!REGEX_NOMBRE.test(nombre)) errores.nombre = 'El nombre solo puede tener letras, espacios, puntos, apóstrofes y guiones.';

  if (!email) errores.email = 'El correo es obligatorio.';
  else if (email.length > 150 || !REGEX_EMAIL.test(email)) errores.email = 'Escribe un correo válido, por ejemplo nombre@dominio.com.';

  if (!password) {
    errores.password = 'La contraseña es obligatoria.';
  } else if (password.length > 128) {
    errores.password = 'La contraseña no puede superar los 128 caracteres.';
  } else {
    const faltan = [];
    if (password.length < 8) faltan.push('mínimo 8 caracteres');
    if (!/[a-z]/.test(password)) faltan.push('una minúscula');
    if (!/[A-Z]/.test(password)) faltan.push('una mayúscula');
    if (!/\d/.test(password)) faltan.push('un número');
    if (faltan.length) errores.password = `La contraseña debe tener ${faltan.join(', ')}.`;
    else if (password.toLowerCase() === email) errores.password = 'La contraseña no puede ser igual al correo.';
  }

  if (!errores.password && confirmar !== password) errores.confirmar = 'Las contraseñas no coinciden.';

  return resultado({ nombre, email, password }, errores);
}

// Login: solo exige que lleguen los dos datos (la complejidad se exige al registrarse).
function validarLogin(entrada) {
  const email = texto(entrada.email).trim().toLowerCase();
  const password = texto(entrada.password);
  const errores = {};
  if (!email) errores.email = 'El correo es obligatorio.';
  if (!password) errores.password = 'La contraseña es obligatoria.';
  return resultado({ email, password }, errores);
}

// Categoría: nombre obligatorio (2-50) y descripción opcional (hasta 200).
function validarCategoria(entrada) {
  const nombre = compactar(entrada.nombre);
  const descripcion = texto(entrada.descripcion).trim();
  const errores = {};

  if (!nombre) errores.nombre = 'El nombre de la categoría es obligatorio.';
  else if (nombre.length < 2 || nombre.length > 50) errores.nombre = 'El nombre debe tener entre 2 y 50 caracteres.';

  if (descripcion.length > 200) errores.descripcion = 'La descripción no puede superar los 200 caracteres.';

  return resultado({ nombre, descripcion }, errores);
}

module.exports = { validarRegistro, validarLogin, validarCategoria };
