'use strict';

const path = require('node:path');
const { crearApp } = require('./src/app');

const PUERTO = Number(process.env.PORT) || 3000;
const RUTA_DB = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

const { servidor, db } = crearApp({
  rutaDb: RUTA_DB,
  produccion: process.env.NODE_ENV === 'production',
  confiarEnProxy: process.env.TRUST_PROXY === '1',
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  console.log(`Servidor escuchando en http://localhost:${PUERTO}`);
  console.log(`Base de datos SQLite: ${RUTA_DB}`);
});

// Cierre ordenado cuando la plataforma de despliegue detiene el proceso.
for (const señal of ['SIGINT', 'SIGTERM']) {
  process.on(señal, () => {
    servidor.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
