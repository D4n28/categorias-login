# Categorías + Login

CRUD de categorías con registro y autenticación de usuarios. Node.js 22 + SQLite (`node:sqlite`), sin dependencias externas.

## Ejecutar

Requiere Node.js 22.13 o superior.

```bash
npm start      # http://localhost:3000
npm test       # pruebas automatizadas
```

Variables de entorno opcionales: `PORT`, `DB_PATH` (por defecto `data/app.db`), `NODE_ENV=production`, `TRUST_PROXY=1`.

## Rutas

| Método | Ruta | Acceso | Acción |
|---|---|---|---|
| GET | `/registro` | Pública | Formulario de registro |
| POST | `/registro` | Pública | Crear usuario |
| GET | `/login` | Pública | Formulario de inicio de sesión |
| POST | `/login` | Pública | Autenticar y crear la sesión |
| POST | `/logout` | Sesión + CSRF | Cerrar sesión |
| GET | `/categorias` | Sesión | Listar categorías |
| GET | `/categorias/nueva` | Sesión | Formulario de creación |
| POST | `/categorias` | Sesión + CSRF | Crear categoría |
| GET | `/categorias/:id/editar` | Sesión | Formulario de edición |
| POST | `/categorias/:id` | Sesión + CSRF | Actualizar categoría |
| POST | `/categorias/:id/eliminar` | Sesión + CSRF | Eliminar categoría |
| GET | `/salud` | Pública | Comprobación de estado |

## Estructura

- `server.js` — arranque del servidor.
- `src/app.js` — enrutador y controladores.
- `src/db.js` — tablas `usuarios`, `sesiones`, `categorias` y consultas preparadas.
- `src/seguridad.js` — scrypt, tokens de sesión, CSRF y limitador de intentos.
- `src/validaciones.js` — reglas de validación.
- `src/http.js` — formularios, cookies, redirecciones y cabeceras de seguridad.
- `src/vistas.js` — pantallas HTML con escape de texto.
- `public/` — estilos y confirmación al eliminar.
- `tests/flujo.test.js` — pruebas del flujo completo.

## Despliegue en Render

El archivo `render.yaml` ya trae la configuración. En Render: **New → Blueprint**, elegir este repositorio y confirmar.
En el plan gratuito el disco es temporal: los datos se pierden al reiniciar o redesplegar.
