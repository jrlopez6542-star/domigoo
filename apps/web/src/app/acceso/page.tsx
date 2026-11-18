import { DomigooShell } from "@/components/domigoo-shell";
import { RoleSelector } from "@/components/role-selector";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AccesoPage() {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="home">
      <RoleSelector />
    </DomigooShell>
  );
}
