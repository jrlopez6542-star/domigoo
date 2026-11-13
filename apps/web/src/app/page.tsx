import { RestaurantPortal } from "@/components/restaurant-portal";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const { appName } = getWebServerConfig();
  return <RestaurantPortal appName={appName} />;
}
