export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  SEEKING_COURIER: "Buscando domiciliario",
  OFFERED: "Oferta enviada",
  ACCEPTED: "Domiciliario asignado",
  ARRIVING_PICKUP: "En camino al restaurante",
  AT_PICKUP: "En el restaurante",
  PICKED_UP: "Pedido recogido (en camino)",
  AT_DROPOFF: "En el punto de entrega",
  DELIVERED: "Entregado",
  CANCELLED_RESTAURANT: "Cancelado por el restaurante",
  CANCELLED_COURIER: "Cancelado por el domiciliario",
  CANCELLED_ADMIN: "Cancelado por operaciones",
  EXPIRED: "Expirado",
  FAILED: "Fallido",
};

export function orderStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
