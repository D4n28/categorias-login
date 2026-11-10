// Pide confirmación antes de enviar cualquier formulario marcado con data-confirmar (p. ej. eliminar).
document.addEventListener('submit', (evento) => {
  const mensaje = evento.target.dataset?.confirmar;
  if (mensaje && !window.confirm(mensaje)) {
    evento.preventDefault();
  }
});
