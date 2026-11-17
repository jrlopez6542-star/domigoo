import { DomigooShell } from "@/components/domigoo-shell";
import { HomeLanding } from "@/components/home-landing";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const { appName, adminAppUrl } = getWebServerConfig();

  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="home">
      <HomeLanding appName={appName} />
    </DomigooShell>
  );
}
