'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// Abre (o crea) la base de datos SQLite y garantiza que existan las tablas.
function abrirBaseDeDatos(ruta) {
  if (ruta !== ':memory:') {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
  }
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre        TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sesiones (
      token_hash TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      csrf       TEXT NOT NULL,
      expira_en  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categorias (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      descripcion TEXT NOT NULL DEFAULT '',
      usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// Capa de acceso a datos: todas las consultas usan parámetros (?) para evitar inyección SQL.
function crearRepositorio(db) {
  const sql = {
    insertarUsuario: db.prepare('INSERT INTO usuarios (nombre, email, password_hash) VALUES (?, ?, ?)'),
    usuarioPorEmail: db.prepare('SELECT id, nombre, email, password_hash FROM usuarios WHERE email = ?'),

    insertarSesion: db.prepare('INSERT INTO sesiones (token_hash, usuario_id, csrf, expira_en) VALUES (?, ?, ?, ?)'),
    sesionPorToken: db.prepare(`
      SELECT s.csrf, s.expira_en, u.id AS usuario_id, u.nombre, u.email
      FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ?`),
    borrarSesion: db.prepare('DELETE FROM sesiones WHERE token_hash = ?'),
    borrarVencidas: db.prepare('DELETE FROM sesiones WHERE expira_en < ?'),

    listarCategorias: db.prepare(`
      SELECT c.id, c.nombre, c.descripcion, c.creado_en, u.nombre AS autor
      FROM categorias c LEFT JOIN usuarios u ON u.id = c.usuario_id
      ORDER BY c.nombre COLLATE NOCASE`),
    categoriaPorId: db.prepare('SELECT id, nombre, descripcion FROM categorias WHERE id = ?'),
    insertarCategoria: db.prepare('INSERT INTO categorias (nombre, descripcion, usuario_id) VALUES (?, ?, ?)'),
    actualizarCategoria: db.prepare('UPDATE categorias SET nombre = ?, descripcion = ? WHERE id = ?'),
    eliminarCategoria: db.prepare('DELETE FROM categorias WHERE id = ?'),
  };

  return {
    crearUsuario: (nombre, email, passwordHash) =>
      Number(sql.insertarUsuario.run(nombre, email, passwordHash).lastInsertRowid),
    buscarUsuarioPorEmail: (email) => sql.usuarioPorEmail.get(email),

    crearSesion: (tokenHash, usuarioId, csrf, expiraEn) =>
      sql.insertarSesion.run(tokenHash, usuarioId, csrf, expiraEn),
    buscarSesion: (tokenHash) => sql.sesionPorToken.get(tokenHash),
    borrarSesion: (tokenHash) => sql.borrarSesion.run(tokenHash),
    borrarSesionesVencidas: (ahora) => sql.borrarVencidas.run(ahora),

    listarCategorias: () => sql.listarCategorias.all(),
    obtenerCategoria: (id) => sql.categoriaPorId.get(id),
    crearCategoria: (nombre, descripcion, usuarioId) =>
      Number(sql.insertarCategoria.run(nombre, descripcion, usuarioId).lastInsertRowid),
    actualizarCategoria: (id, nombre, descripcion) =>
      sql.actualizarCategoria.run(nombre, descripcion, id).changes,
    eliminarCategoria: (id) => sql.eliminarCategoria.run(id).changes,
  };
}

// ¿El error de SQLite es por violar una restricción UNIQUE?
function esErrorDeDuplicado(error) {
  return typeof error?.message === 'string' && error.message.includes('UNIQUE constraint failed');
}

module.exports = { abrirBaseDeDatos, crearRepositorio, esErrorDeDuplicado };
