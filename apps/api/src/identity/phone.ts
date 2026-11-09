const COLOMBIA_E164 = /^\+57\d{10}$/;

export function parseColombianPhone(value: string): string {
  const trimmed = value.trim();
  if (!COLOMBIA_E164.test(trimmed)) {
    throw new Error("El teléfono debe estar en E.164 de Colombia (+57 y 10 dígitos)");
  }
  return trimmed;
}
