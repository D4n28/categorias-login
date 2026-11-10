'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { abrirBaseDeDatos, crearRepositorio, esErrorDeDuplicado } = require('./db');
const { validarRegistro, validarLogin, validarCategoria } = require('./validaciones');
const {
  DURACION_SESION_MS, HASH_FALSO, hashearPassword, verificarPassword,
  hashSha256, generarSesion, csrfValido, crearLimitador,
} = require('./seguridad');
const { leerFormulario, leerCookies, cookieSesion, enviarHtml, redirigir, enviarArchivo } = require('./http');
const { vistaRegistro, vistaLogin, vistaCategorias, vistaFormularioCategoria, vistaError } = require('./vistas');

const DIRECTORIO_PUBLICO = path.join(__dirname, '..', 'public');
const ARCHIVOS_ESTATICOS = {
  '/styles.css': ['text/css; charset=utf-8', fs.readFileSync(path.join(DIRECTORIO_PUBLICO, 'styles.css'))],
  '/app.js': ['text/javascript; charset=utf-8', fs.readFileSync(path.join(DIRECTORIO_PUBLICO, 'app.js'))],
};

function crearApp({ rutaDb = ':memory:', produccion = false, confiarEnProxy = false } = {}) {
  const db = abrirBaseDeDatos(rutaDb);
  const repo = crearRepositorio(db);
  const limitador = crearLimitador();

  // ---- Utilidades de sesión -------------------------------------------------
  function sesionActual(req) {
    const token = leerCookies(req).sid;
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const fila = repo.buscarSesion(hashSha256(token));
    if (!fila) return null;
    if (fila.expira_en < Date.now()) {
      repo.borrarSesion(hashSha256(token));
      return null;
    }
    return { token, csrf: fila.csrf, usuario: { id: fila.usuario_id, nombre: fila.nombre, email: fila.email } };
  }

  const esSeguro = (req) => produccion || req.headers['x-forwarded-proto'] === 'https';
  const ipDe = (req) =>
    (confiarEnProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
    req.socket.remoteAddress;

  // ---- Autenticación --------------------------------------------------------
  async function registrar(req, res) {
    const { valores, errores, valido } = validarRegistro(await leerFormulario(req));
    if (!valido) return enviarHtml(res, 400, vistaRegistro({ valores, errores }));

    const duplicado = () => {
      errores.email = 'Ya existe una cuenta con este correo.';
      return enviarHtml(res, 409, vistaRegistro({ valores, errores }));
    };
    if (repo.buscarUsuarioPorEmail(valores.email)) return duplicado();

    const passwordHash = await hashearPassword(valores.password);
    try {
      repo.crearUsuario(valores.nombre, valores.email, passwordHash);
    } catch (error) {
      if (esErrorDeDuplicado(error)) return duplicado();
      throw error;
    }
    return redirigir(res, '/login?aviso=registrado');
  }

  async function iniciarSesion(req, res, sesionPrevia) {
    const { valores, errores, valido } = validarLogin(await leerFormulario(req));
    if (!valido) return enviarHtml(res, 400, vistaLogin({ valores: { email: valores.email }, errores }));

    const clave = `${ipDe(req)}|${valores.email}`;
    if (limitador.bloqueado(clave)) {
      return enviarHtml(res, 429, vistaLogin({
        valores: { email: valores.email },
        errorGeneral: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.',
      }));
    }

    const usuario = repo.buscarUsuarioPorEmail(valores.email);
    const correcta = await verificarPassword(valores.password, usuario ? usuario.password_hash : HASH_FALSO);
    if (!usuario || !correcta) {
      limitador.registrarFallo(clave);
      // Mismo mensaje si el correo no existe o la contraseña es incorrecta.
      return enviarHtml(res, 401, vistaLogin({
        valores: { email: valores.email },
        errorGeneral: 'Correo o contraseña incorrectos.',
      }));
    }

    limitador.reiniciar(clave);
    if (sesionPrevia) repo.borrarSesion(hashSha256(sesionPrevia.token));
    repo.borrarSesionesVencidas(Date.now());

    const { token, csrf, expiraEn } = generarSesion();
    repo.crearSesion(hashSha256(token), usuario.id, csrf, expiraEn);
    return redirigir(res, '/categorias', {
      'Set-Cookie': cookieSesion(token, DURACION_SESION_MS / 1000, esSeguro(req)),
    });
  }

  function cerrarSesion(res, req, sesion) {
    repo.borrarSesion(hashSha256(sesion.token));
    return redirigir(res, '/login?aviso=salida', { 'Set-Cookie': cookieSesion('', 0, esSeguro(req)) });
  }

  // ---- CRUD de categorías (solo con sesión) -------------------------------
  async function guardarCategoria(req, res, sesion, id) {
    const cuerpo = await leerFormulario(req);
    if (!csrfValido(sesion.csrf, cuerpo._csrf)) return respuestaCsrf(res, sesion);

    const { valores, errores, valido } = validarCategoria(cuerpo);
    const mostrarErrores = (estado) =>
      enviarHtml(res, estado, vistaFormularioCategoria({ id, valores, errores, usuario: sesion.usuario, csrf: sesion.csrf }));
    if (!valido) return mostrarErrores(400);

    try {
      if (id === null) {
        repo.crearCategoria(valores.nombre, valores.descripcion, sesion.usuario.id);
        return redirigir(res, '/categorias?aviso=creada');
      }
      const cambios = repo.actualizarCategoria(id, valores.nombre, valores.descripcion);
      return redirigir(res, `/categorias?aviso=${cambios ? 'actualizada' : 'noexiste'}`);
    } catch (error) {
      if (!esErrorDeDuplicado(error)) throw error;
      errores.nombre = 'Ya existe una categoría con ese nombre.';
      return mostrarErrores(409);
    }
  }

  async function eliminarCategoria(req, res, sesion, id) {
    const cuerpo = await leerFormulario(req);
    if (!csrfValido(sesion.csrf, cuerpo._csrf)) return respuestaCsrf(res, sesion);
    const cambios = repo.eliminarCategoria(id);
    return redirigir(res, `/categorias?aviso=${cambios ? 'eliminada' : 'noexiste'}`);
  }

  const respuestaCsrf = (res, sesion) =>
    enviarHtml(res, 403, vistaError({
      titulo: 'Solicitud no válida',
      mensaje: 'El formulario expiró o no es válido. Vuelve atrás, recarga la página e inténtalo otra vez.',
      usuario: sesion.usuario,
      csrf: sesion.csrf,
    }));

  // ---- Enrutador ------------------------------------------------------------
  async function manejar(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname: ruta } = url;
    const metodo = req.method;
    const sesion = sesionActual(req);
    const aviso = url.searchParams.get('aviso') || '';

    if (metodo === 'GET' && Object.hasOwn(ARCHIVOS_ESTATICOS, ruta)) {
      return enviarArchivo(res, ...ARCHIVOS_ESTATICOS[ruta]);
    }
    if (metodo === 'GET' && ruta === '/salud') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"estado":"ok"}');
    }
    if (metodo === 'GET' && ruta === '/') {
      return redirigir(res, sesion ? '/categorias' : '/login');
    }

    // Rutas públicas
    if (ruta === '/registro') {
      if (sesion) return redirigir(res, '/categorias');
      if (metodo === 'GET') return enviarHtml(res, 200, vistaRegistro());
      if (metodo === 'POST') return registrar(req, res);
    }
    if (ruta === '/login') {
      if (metodo === 'GET') {
        if (sesion) return redirigir(res, '/categorias');
        return enviarHtml(res, 200, vistaLogin({ aviso }));
      }
      if (metodo === 'POST') return iniciarSesion(req, res, sesion);
    }

    // Todo lo que sigue exige sesión iniciada
    const protegida = ruta === '/logout' || ruta === '/categorias' || ruta.startsWith('/categorias/');
    if (protegida && !sesion) return redirigir(res, '/login?aviso=sesion');

    if (ruta === '/logout' && metodo === 'POST') {
      const cuerpo = await leerFormulario(req);
      if (!csrfValido(sesion.csrf, cuerpo._csrf)) return respuestaCsrf(res, sesion);
      return cerrarSesion(res, req, sesion);
    }

    const contexto = sesion && { usuario: sesion.usuario, csrf: sesion.csrf };

    if (ruta === '/categorias') {
      if (metodo === 'GET') {
        return enviarHtml(res, 200, vistaCategorias({ categorias: repo.listarCategorias(), aviso, ...contexto }));
      }
      if (metodo === 'POST') return guardarCategoria(req, res, sesion, null);
    }
    if (ruta === '/categorias/nueva' && metodo === 'GET') {
      return enviarHtml(res, 200, vistaFormularioCategoria(contexto));
    }

    const coincidencia = ruta.match(/^\/categorias\/(\d{1,9})(?:\/(editar|eliminar))?$/);
    if (coincidencia) {
      const id = Number(coincidencia[1]);
      const accion = coincidencia[2];
      if (metodo === 'GET' && accion === 'editar') {
        const categoria = repo.obtenerCategoria(id);
        if (!categoria) return redirigir(res, '/categorias?aviso=noexiste');
        return enviarHtml(res, 200, vistaFormularioCategoria({ id, valores: categoria, ...contexto }));
      }
      if (metodo === 'POST' && !accion) return guardarCategoria(req, res, sesion, id);
      if (metodo === 'POST' && accion === 'eliminar') return eliminarCategoria(req, res, sesion, id);
    }

    return enviarHtml(res, 404, vistaError({
      titulo: 'Página no encontrada',
      mensaje: 'La dirección que buscas no existe.',
      ...contexto,
    }));
  }

  const servidor = http.createServer((req, res) => {
    manejar(req, res).catch((error) => {
      if (res.headersSent) return res.end();
      if (error.estado === 413) {
        return enviarHtml(res, 413, vistaError({ titulo: 'Solicitud demasiado grande', mensaje: 'Los datos enviados superan el tamaño permitido.' }));
      }
      console.error(error);
      enviarHtml(res, 500, vistaError({ titulo: 'Error del servidor', mensaje: 'Ocurrió un problema inesperado. Inténtalo más tarde.' }));
    });
  });

  return { servidor, db };
}

module.exports = { crearApp };
