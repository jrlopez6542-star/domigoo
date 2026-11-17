import { CourierPortal } from "@/components/courier-portal";
import { DomigooShell } from "@/components/domigoo-shell";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function DomiciliarioPage() {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="domiciliario">
      <CourierPortal />
    </DomigooShell>
  );
}
