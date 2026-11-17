import type { ReactNode } from "react";
import { DomigooShell } from "@/components/domigoo-shell";
import { CourierPortalShell } from "@/components/courier-portal";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function DomiciliarioLayout({ children }: { children: ReactNode }) {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="domiciliario">
      <CourierPortalShell>{children}</CourierPortalShell>
    </DomigooShell>
  );
}
