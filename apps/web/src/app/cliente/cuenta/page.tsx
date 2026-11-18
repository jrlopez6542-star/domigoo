import { Suspense } from "react";
import { ClientAccountView } from "@/components/client-portal";

export default function ClienteCuentaPage() {
  return (
    <Suspense fallback={<div className="dg-v2-card">Cargando perfil...</div>}>
      <ClientAccountView />
    </Suspense>
  );
}
