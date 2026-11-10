'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../src/app');

const PASSWORD = 'Segura123';

// Levanta una instancia nueva (base en memoria) y devuelve un "navegador" con cookies.
async function levantar(t) {
  const { servidor, db } = crearApp({ rutaDb: ':memory:' });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  t.after(() => new Promise((resolve) => servidor.close(() => { db.close(); resolve(); })));

  const nuevoNavegador = () => {
    const cookies = new Map();
    async function pedir(ruta, { metodo = 'GET', datos } = {}) {
      const headers = {};
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      let body;
      if (datos) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(datos).toString();
      }
      const res = await fetch(base + ruta, { method: metodo, headers, body, redirect: 'manual' });
      for (const c of res.headers.getSetCookie()) {
        const [par] = c.split(';');
        const i = par.indexOf('=');
        const nombre = par.slice(0, i);
        const valor = par.slice(i + 1);
        if (valor) cookies.set(nombre, valor);
        else cookies.delete(nombre);
      }
      const html = await res.text();
      return { estado: res.status, ubicacion: res.headers.get('location'), html, headers: res.headers };
    }
    return { pedir, cookies };
  };

  return { db, base, nuevoNavegador };
}

const csrfDe = (html) => html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];

async function registrar(nav, datos = {}) {
  return nav.pedir('/registro', {
    metodo: 'POST',
    datos: { nombre: 'Elena Torres', email: 'elena@correo.com', password: PASSWORD, confirmar: PASSWORD, ...datos },
  });
}

async function entrar(nav, email = 'elena@correo.com', password = PASSWORD) {
  return nav.pedir('/login', { metodo: 'POST', datos: { email, password } });
}

async function registrarYEntrar(nav) {
  await registrar(nav);
  await entrar(nav);
  const lista = await nav.pedir('/categorias');
  return csrfDe(lista.html);
}

test('registro: rechaza datos inválidos con mensajes por campo', async (t) => {
  const { nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();

  let r = await nav.pedir('/registro', { metodo: 'POST', datos: {} });
  assert.equal(r.estado, 400);
  assert.match(r.html, /El nombre es obligatorio/);
  assert.match(r.html, /El correo es obligatorio/);
  assert.match(r.html, /La contraseña es obligatoria/);

  r = await registrar(nav, { nombre: 'A', email: 'correo-invalido', password: 'abc', confirmar: 'abc' });
  assert.equal(r.estado, 400);
  assert.match(r.html, /entre 2 y 60 caracteres/);
  assert.match(r.html, /Escribe un correo válido/);
  assert.match(r.html, /mínimo 8 caracteres, una mayúscula, un número/);

  r = await registrar(nav, { confirmar: 'Otra12345' });
  assert.equal(r.estado, 400);
  assert.match(r.html, /Las contraseñas no coinciden/);
});

test('registro: crea el usuario, guarda la contraseña con hash y rechaza correos repetidos', async (t) => {
  const { db, nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();

  const r = await registrar(nav, { email: '  Elena@Correo.COM ' });
  assert.equal(r.estado, 303);
  assert.equal(r.ubicacion, '/login?aviso=registrado');

  const fila = db.prepare('SELECT email, password_hash FROM usuarios').get();
  assert.equal(fila.email, 'elena@correo.com');
  assert.match(fila.password_hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.ok(!fila.password_hash.includes(PASSWORD));

  const repetido = await registrar(nav, { email: 'ELENA@correo.com' });
  assert.equal(repetido.estado, 409);
  assert.match(repetido.html, /Ya existe una cuenta con este correo/);
});

test('login: mensaje genérico si el correo no existe o la contraseña falla', async (t) => {
  const { db, nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  await registrar(nav);

  const noExiste = await entrar(nav, 'nadie@correo.com');
  const malaClave = await entrar(nav, 'elena@correo.com', 'Incorrecta1');
  for (const r of [noExiste, malaClave]) {
    assert.equal(r.estado, 401);
    assert.match(r.html, /Correo o contraseña incorrectos\./);
  }
  assert.equal(nav.cookies.has('sid'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sesiones').get().n, 0);
});

test('categorías: sin sesión se redirige al login', async (t) => {
  const { db, nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();

  for (const ruta of ['/categorias', '/categorias/nueva', '/categorias/1/editar']) {
    const r = await nav.pedir(ruta);
    assert.equal(r.estado, 303, ruta);
    assert.equal(r.ubicacion, '/login?aviso=sesion');
  }
  const post = await nav.pedir('/categorias', { metodo: 'POST', datos: { nombre: 'Intrusa' } });
  assert.equal(post.estado, 303);
  assert.equal(post.ubicacion, '/login?aviso=sesion');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categorias').get().n, 0);
});

test('login correcto: cookie HttpOnly y acceso al CRUD completo', async (t) => {
  const { nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  await registrar(nav);

  const login = await nav.pedir('/login', { metodo: 'POST', datos: { email: 'elena@correo.com', password: PASSWORD } });
  assert.equal(login.estado, 303);
  assert.equal(login.ubicacion, '/categorias');
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  let lista = await nav.pedir('/categorias');
  assert.equal(lista.estado, 200);
  assert.match(lista.html, /Hola, <strong>Elena Torres<\/strong>/);
  const csrf = csrfDe(lista.html);
  assert.ok(csrf);

  // Create
  let r = await nav.pedir('/categorias', { metodo: 'POST', datos: { _csrf: csrf, nombre: 'Tecnología', descripcion: 'Software' } });
  assert.equal(r.ubicacion, '/categorias?aviso=creada');

  // Read
  lista = await nav.pedir('/categorias?aviso=creada');
  assert.match(lista.html, /Tecnología/);
  assert.match(lista.html, /Categoría creada correctamente/);
  const id = lista.html.match(/\/categorias\/(\d+)\/editar/)[1];

  // Duplicado y validaciones
  r = await nav.pedir('/categorias', { metodo: 'POST', datos: { _csrf: csrf, nombre: 'tecnología' } });
  assert.equal(r.estado, 409);
  assert.match(r.html, /Ya existe una categoría con ese nombre/);
  r = await nav.pedir('/categorias', { metodo: 'POST', datos: { _csrf: csrf, nombre: 'a' } });
  assert.equal(r.estado, 400);
  assert.match(r.html, /entre 2 y 50 caracteres/);

  // Update
  r = await nav.pedir(`/categorias/${id}/editar`);
  assert.equal(r.estado, 200);
  assert.match(r.html, /value="Tecnología"/);
  r = await nav.pedir(`/categorias/${id}`, { metodo: 'POST', datos: { _csrf: csrf, nombre: 'Tecnología y ciencia', descripcion: '' } });
  assert.equal(r.ubicacion, '/categorias?aviso=actualizada');
  lista = await nav.pedir('/categorias');
  assert.match(lista.html, /Tecnología y ciencia/);

  // Delete
  r = await nav.pedir(`/categorias/${id}/eliminar`, { metodo: 'POST', datos: { _csrf: csrf } });
  assert.equal(r.ubicacion, '/categorias?aviso=eliminada');
  lista = await nav.pedir('/categorias');
  assert.match(lista.html, /Todavía no hay categorías/);

  // Id inexistente
  r = await nav.pedir('/categorias/999/editar');
  assert.equal(r.ubicacion, '/categorias?aviso=noexiste');
  r = await nav.pedir('/categorias/999/eliminar', { metodo: 'POST', datos: { _csrf: csrf } });
  assert.equal(r.ubicacion, '/categorias?aviso=noexiste');
});

test('seguridad: sin token CSRF no se puede modificar nada', async (t) => {
  const { db, nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  const csrf = await registrarYEntrar(nav);
  await nav.pedir('/categorias', { metodo: 'POST', datos: { _csrf: csrf, nombre: 'Original' } });
  const { id } = db.prepare('SELECT id FROM categorias').get();

  const intentos = [
    ['/categorias', { nombre: 'Nueva' }],
    ['/categorias', { _csrf: 'falso', nombre: 'Nueva' }],
    [`/categorias/${id}`, { _csrf: 'a'.repeat(48), nombre: 'Cambiada' }],
    [`/categorias/${id}/eliminar`, {}],
    ['/logout', {}],
  ];
  for (const [ruta, datos] of intentos) {
    const r = await nav.pedir(ruta, { metodo: 'POST', datos });
    assert.equal(r.estado, 403, ruta);
  }
  const filas = db.prepare('SELECT nombre FROM categorias').all();
  assert.deepEqual(filas.map((f) => f.nombre), ['Original']);
  assert.equal((await nav.pedir('/categorias')).estado, 200);
});

test('seguridad: el texto del usuario se escapa (XSS) y las consultas no son inyectables', async (t) => {
  const { nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  const csrf = await registrarYEntrar(nav);

  await nav.pedir('/categorias', { metodo: 'POST', datos: { _csrf: csrf, nombre: '<script>alert(1)</script>' } });
  const lista = await nav.pedir('/categorias');
  assert.ok(!lista.html.includes('<script>alert(1)</script>'));
  assert.match(lista.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const otro = nuevoNavegador();
  const r = await entrar(otro, "' OR '1'='1", "' OR '1'='1");
  assert.equal(r.estado, 401);
  assert.equal(otro.cookies.has('sid'), false);
});

test('logout: invalida la sesión en el servidor', async (t) => {
  const { nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  const csrf = await registrarYEntrar(nav);
  const sidAnterior = nav.cookies.get('sid');

  const r = await nav.pedir('/logout', { metodo: 'POST', datos: { _csrf: csrf } });
  assert.equal(r.estado, 303);
  assert.equal(r.ubicacion, '/login?aviso=salida');

  // Alguien reutiliza la cookie anterior
  const atacante = nuevoNavegador();
  atacante.cookies.set('sid', sidAnterior);
  const intento = await atacante.pedir('/categorias');
  assert.equal(intento.estado, 303);
  assert.equal(intento.ubicacion, '/login?aviso=sesion');
});

test('sesión vencida: se rechaza y se elimina', async (t) => {
  const { db, nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  await registrarYEntrar(nav);

  db.prepare('UPDATE sesiones SET expira_en = ?').run(Date.now() - 1000);
  const r = await nav.pedir('/categorias');
  assert.equal(r.estado, 303);
  assert.equal(r.ubicacion, '/login?aviso=sesion');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sesiones').get().n, 0);
});

test('login: tras 5 intentos fallidos se bloquea temporalmente', async (t) => {
  const { nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();
  await registrar(nav);

  for (let i = 0; i < 5; i++) {
    assert.equal((await entrar(nav, 'elena@correo.com', 'Incorrecta1')).estado, 401);
  }
  const sexto = await entrar(nav); // incluso con la contraseña correcta
  assert.equal(sexto.estado, 429);
  assert.match(sexto.html, /Demasiados intentos fallidos/);
});

test('cabeceras de seguridad y página 404', async (t) => {
  const { nuevoNavegador } = await levantar(t);
  const nav = nuevoNavegador();

  const login = await nav.pedir('/login');
  assert.match(login.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(login.headers.get('x-content-type-options'), 'nosniff');

  const noExiste = await nav.pedir('/no-existe');
  assert.equal(noExiste.estado, 404);
  assert.match(noExiste.html, /Página no encontrada/);

  const salud = await nav.pedir('/salud');
  assert.equal(salud.estado, 200);
  assert.deepEqual(JSON.parse(salud.html), { estado: 'ok' });
});
