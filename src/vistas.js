'use strict';

// Escapa HTML: todo texto que viene del usuario pasa por aquí antes de mostrarse (evita XSS).
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Mensajes cortos que se muestran tras redirigir (?aviso=clave). Solo se aceptan claves de esta lista.
const AVISOS = {
  registrado: ['ok', '¡Cuenta creada! Ahora inicia sesión con tu correo y contraseña.'],
  salida: ['ok', 'Cerraste sesión correctamente.'],
  sesion: ['aviso', 'Debes iniciar sesión para ver las categorías.'],
  creada: ['ok', 'Categoría creada correctamente.'],
  actualizada: ['ok', 'Categoría actualizada correctamente.'],
  eliminada: ['ok', 'Categoría eliminada correctamente.'],
  noexiste: ['error', 'La categoría que buscas no existe.'],
};

function bloqueAviso(clave) {
  if (!Object.hasOwn(AVISOS, clave)) return '';
  const [tipo, mensaje] = AVISOS[clave];
  return `<div class="aviso aviso--${tipo}" role="status">${esc(mensaje)}</div>`;
}

function bloqueErrorGeneral(mensaje) {
  return mensaje ? `<div class="aviso aviso--error" role="alert">${esc(mensaje)}</div>` : '';
}

function pagina({ titulo, cuerpo, usuario, csrf }) {
  const navegacion = usuario
    ? `<span class="nav__usuario">Hola, <strong>${esc(usuario.nombre)}</strong></span>
       <form method="post" action="/logout" class="nav__form">
         <input type="hidden" name="_csrf" value="${esc(csrf)}">
         <button type="submit" class="boton boton--secundario">Cerrar sesión</button>
       </form>`
    : `<a href="/login">Iniciar sesión</a><a href="/registro">Registrarse</a>`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(titulo)} · Categorías</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="nav">
    <a class="nav__marca" href="/">Categorías</a>
    <nav class="nav__enlaces">${navegacion}</nav>
  </header>
  <main class="contenedor">${cuerpo}</main>
  <script src="/app.js" defer></script>
</body>
</html>`;
}

function campo({ id, etiqueta, tipo = 'text', valor = '', error, atributos = '', ayuda }) {
  const marcaError = error ? ` aria-invalid="true" aria-describedby="${id}-error"` : '';
  const control =
    tipo === 'textarea'
      ? `<textarea id="${id}" name="${id}" rows="3" ${atributos}${marcaError}>${esc(valor)}</textarea>`
      : `<input id="${id}" name="${id}" type="${tipo}" value="${esc(valor)}" ${atributos}${marcaError}>`;
  return `<div class="campo${error ? ' campo--error' : ''}">
    <label for="${id}">${esc(etiqueta)}</label>
    ${control}
    ${ayuda && !error ? `<p class="ayuda">${esc(ayuda)}</p>` : ''}
    ${error ? `<p class="error-campo" id="${id}-error">${esc(error)}</p>` : ''}
  </div>`;
}

function vistaRegistro({ valores = {}, errores = {} } = {}) {
  return pagina({
    titulo: 'Crear cuenta',
    cuerpo: `<section class="tarjeta tarjeta--estrecha">
      <h1>Crear cuenta</h1>
      <p class="subtitulo">Regístrate para acceder a las categorías.</p>
      <form method="post" action="/registro" autocomplete="on">
        ${campo({ id: 'nombre', etiqueta: 'Nombre completo', valor: valores.nombre, error: errores.nombre, atributos: 'required minlength="2" maxlength="60" autocomplete="name"' })}
        ${campo({ id: 'email', etiqueta: 'Correo electrónico', tipo: 'email', valor: valores.email, error: errores.email, atributos: 'required maxlength="150" autocomplete="email"' })}
        ${campo({ id: 'password', etiqueta: 'Contraseña', tipo: 'password', error: errores.password, atributos: 'required minlength="8" maxlength="128" autocomplete="new-password"', ayuda: 'Mínimo 8 caracteres, con mayúscula, minúscula y número.' })}
        ${campo({ id: 'confirmar', etiqueta: 'Confirmar contraseña', tipo: 'password', error: errores.confirmar, atributos: 'required maxlength="128" autocomplete="new-password"' })}
        <button type="submit" class="boton boton--primario boton--ancho">Crear cuenta</button>
      </form>
      <p class="pie-formulario">¿Ya tienes cuenta? <a href="/login">Inicia sesión</a></p>
    </section>`,
  });
}

function vistaLogin({ valores = {}, errores = {}, errorGeneral = '', aviso = '' } = {}) {
  return pagina({
    titulo: 'Iniciar sesión',
    cuerpo: `<section class="tarjeta tarjeta--estrecha">
      <h1>Iniciar sesión</h1>
      <p class="subtitulo">Ingresa con tu cuenta para ver las categorías.</p>
      ${bloqueAviso(aviso)}
      ${bloqueErrorGeneral(errorGeneral)}
      <form method="post" action="/login" autocomplete="on">
        ${campo({ id: 'email', etiqueta: 'Correo electrónico', tipo: 'email', valor: valores.email, error: errores.email, atributos: 'required maxlength="150" autocomplete="email"' })}
        ${campo({ id: 'password', etiqueta: 'Contraseña', tipo: 'password', error: errores.password, atributos: 'required maxlength="128" autocomplete="current-password"' })}
        <button type="submit" class="boton boton--primario boton--ancho">Entrar</button>
      </form>
      <p class="pie-formulario">¿No tienes cuenta? <a href="/registro">Regístrate</a></p>
    </section>`,
  });
}

function vistaCategorias({ categorias, usuario, csrf, aviso = '' }) {
  const filas = categorias
    .map(
      (c) => `<tr>
        <td data-etiqueta="Nombre"><strong>${esc(c.nombre)}</strong></td>
        <td data-etiqueta="Descripción">${c.descripcion ? esc(c.descripcion) : '<span class="tenue">—</span>'}</td>
        <td data-etiqueta="Creada por">${c.autor ? esc(c.autor) : '<span class="tenue">—</span>'}</td>
        <td data-etiqueta="Acciones"><div class="acciones">
          <a class="boton boton--secundario boton--chico" href="/categorias/${c.id}/editar">Editar</a>
          <form method="post" action="/categorias/${c.id}/eliminar" data-confirmar="¿Eliminar la categoría «${esc(c.nombre)}»?">
            <input type="hidden" name="_csrf" value="${esc(csrf)}">
            <button type="submit" class="boton boton--peligro boton--chico">Eliminar</button>
          </form>
        </div></td>
      </tr>`
    )
    .join('');

  const contenido = categorias.length
    ? `<div class="tabla-envoltura"><table>
        <thead><tr><th>Nombre</th><th>Descripción</th><th>Creada por</th><th>Acciones</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>`
    : `<div class="vacio"><p>Todavía no hay categorías.</p><a class="boton boton--primario" href="/categorias/nueva">Crear la primera</a></div>`;

  return pagina({
    titulo: 'Categorías',
    usuario,
    csrf,
    cuerpo: `<section class="tarjeta">
      <div class="encabezado-lista">
        <div>
          <h1>Categorías</h1>
          <p class="subtitulo">${categorias.length} ${categorias.length === 1 ? 'categoría registrada' : 'categorías registradas'}</p>
        </div>
        <a class="boton boton--primario" href="/categorias/nueva">+ Nueva categoría</a>
      </div>
      ${bloqueAviso(aviso)}
      ${contenido}
    </section>`,
  });
}

function vistaFormularioCategoria({ id = null, valores = {}, errores = {}, usuario, csrf }) {
  const editando = id !== null;
  const accion = editando ? `/categorias/${id}` : '/categorias';
  return pagina({
    titulo: editando ? 'Editar categoría' : 'Nueva categoría',
    usuario,
    csrf,
    cuerpo: `<section class="tarjeta tarjeta--estrecha">
      <h1>${editando ? 'Editar categoría' : 'Nueva categoría'}</h1>
      <form method="post" action="${accion}">
        <input type="hidden" name="_csrf" value="${esc(csrf)}">
        ${campo({ id: 'nombre', etiqueta: 'Nombre', valor: valores.nombre, error: errores.nombre, atributos: 'required minlength="2" maxlength="50"' })}
        ${campo({ id: 'descripcion', etiqueta: 'Descripción (opcional)', tipo: 'textarea', valor: valores.descripcion, error: errores.descripcion, atributos: 'maxlength="200"' })}
        <div class="botones">
          <button type="submit" class="boton boton--primario">${editando ? 'Guardar cambios' : 'Crear categoría'}</button>
          <a class="boton boton--secundario" href="/categorias">Cancelar</a>
        </div>
      </form>
    </section>`,
  });
}

function vistaError({ titulo, mensaje, usuario, csrf }) {
  return pagina({
    titulo,
    usuario,
    csrf,
    cuerpo: `<section class="tarjeta tarjeta--estrecha"><h1>${esc(titulo)}</h1><p>${esc(mensaje)}</p><a class="boton boton--secundario" href="/">Volver al inicio</a></section>`,
  });
}

module.exports = { esc, vistaRegistro, vistaLogin, vistaCategorias, vistaFormularioCategoria, vistaError };
