import { ClientPortal } from "@/components/client-portal";
import { DomigooShell } from "@/components/domigoo-shell";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function ClientePage() {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="cliente">
      <ClientPortal />
    </DomigooShell>
  );
}
