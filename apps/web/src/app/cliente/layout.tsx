import type { ReactNode } from "react";
import { DomigooShell } from "@/components/domigoo-shell";
import { ClientPortalShell } from "@/components/client-portal";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function ClienteLayout({ children }: { children: ReactNode }) {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="cliente">
      <ClientPortalShell>{children}</ClientPortalShell>
    </DomigooShell>
  );
}
