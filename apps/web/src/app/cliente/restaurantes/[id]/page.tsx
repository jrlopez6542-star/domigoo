import { ClientRestaurantProfileView } from "@/components/client-portal";

export default async function ClienteRestauranteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientRestaurantProfileView branchId={id} />;
}
