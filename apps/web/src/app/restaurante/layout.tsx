import type { ReactNode } from "react";
import { DomigooShell } from "@/components/domigoo-shell";
import { RestaurantPortalShell } from "@/components/restaurant-portal";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function RestauranteLayout({ children }: { children: ReactNode }) {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="restaurante">
      <RestaurantPortalShell appName={appName}>{children}</RestaurantPortalShell>
    </DomigooShell>
  );
}
