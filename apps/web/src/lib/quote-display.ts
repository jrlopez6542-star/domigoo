export const QUOTE_UNAVAILABLE_TEXT = "Valor por confirmar";

export function formatQuote(data: unknown): string {
  if (typeof data !== "object" || data === null) {
    return QUOTE_UNAVAILABLE_TEXT;
  }
  const record = data as Record<string, unknown>;
  const deliveryFeeCop = record["deliveryFeeCop"];
  const distanceMeters = record["distanceMeters"];
  if (
    typeof deliveryFeeCop !== "number" ||
    !Number.isInteger(deliveryFeeCop) ||
    deliveryFeeCop < 0 ||
    typeof distanceMeters !== "number" ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0
  ) {
    return QUOTE_UNAVAILABLE_TEXT;
  }
  const formattedFee = deliveryFeeCop.toLocaleString("es-CO");
  const formattedKm = (distanceMeters / 1000).toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `Domicilio estimado: $${formattedFee} COP · Distancia estimada: ${formattedKm} km`;
}

export function formatQuoteError(err: unknown): { quoteText: string; quoteError: string } {
  if (
    err instanceof Error &&
    "status" in err &&
    (err as { status?: unknown }).status === 422 &&
    err.message.trim() !== ""
  ) {
    return {
      quoteText: QUOTE_UNAVAILABLE_TEXT,
      quoteError: err.message,
    };
  }
  return {
    quoteText: QUOTE_UNAVAILABLE_TEXT,
    quoteError: "",
  };
}
