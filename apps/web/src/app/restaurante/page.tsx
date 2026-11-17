import { DomigooShell } from "@/components/domigoo-shell";
import { RestaurantPortal } from "@/components/restaurant-portal";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function RestaurantePage() {
  const { appName, adminAppUrl } = getWebServerConfig();
  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="restaurante">
      <RestaurantPortal appName={appName} />
    </DomigooShell>
  );
}
