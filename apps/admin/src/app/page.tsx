import { AdminPortal } from "@/components/admin-portal";
import { getAdminServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AdminHomePage() {
  const { appName } = getAdminServerConfig();
  return <AdminPortal appName={appName} />;
}
