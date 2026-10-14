/**
 * Duración comercial por horario de corte configurable, zona America/Lima (UTC-5).
 * Cada segmento comercial empezado se factura como un día; mínimo un día.
 */
export function durationByCutoff(start, end, cutoffHour) {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new RangeError("El horario de corte debe estar entre 0 y 23");
  }
  if (!(end > start))
    throw new RangeError("La devolución debe ser posterior a la entrega");
  const offset = (5 + cutoffHour) * 3600000;
  return Math.max(
    1,
    Math.floor((end - offset) / 86400000) -
      Math.floor((start - offset) / 86400000) +
      1,
  );
}
