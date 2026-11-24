import { cookies, headers } from "next/headers";
import { AdminPortal } from "@/components/admin-portal";
import { getAdminServerConfig } from "@/lib/env";
import { ADMIN_SESSION_HEADER, SESSION_COOKIE } from "@/middleware";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const { appName } = getAdminServerConfig();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  const hasSessionCookie =
    (typeof sessionCookie === "string" && sessionCookie.trim().length > 0) ||
    headerStore.get(ADMIN_SESSION_HEADER) === "1";
  return <AdminPortal appName={appName} hasSessionCookie={hasSessionCookie} />;
}
