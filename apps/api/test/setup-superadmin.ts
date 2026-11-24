import { Pool } from "pg";
import request from "supertest";

type HttpServer = Parameters<typeof request>[0];

// ORDEN 018 (decision C): REVIEWER recibe 403 en POST /v1/legal-documents y en
// POST /v1/admin/restaurants/:id/activate. Las pruebas que usaban al REVIEWER para esa preparacion
// usan este SUPERADMIN dedicado; el REVIEWER de cada prueba sigue decidiendo los casos de
// verificacion como antes.
export async function registerSetupSuperadmin(
  httpServer: HttpServer,
  databaseUrl: string,
  email: string,
): Promise<string> {
  const res = await request(httpServer)
    .post("/v1/auth/register")
    .send({
      email,
      password: "clave-de-prueba-12",
      client: "MOBILE",
      consents: { termsAccepted: true, privacyAccepted: true },
    })
    .expect(201);
  const body = res.body as Record<string, unknown>;
  const token = body["token"];
  if (typeof token !== "string" || token === "") {
    throw new Error("El registro del superadmin de preparacion no devolvio token");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `INSERT INTO admin_profiles ("userId", "displayName", role, "createdAt", "updatedAt")
       SELECT id, 'Superadmin de preparacion', 'SUPERADMIN', now(), now()
       FROM users WHERE email = $1`,
      [email],
    );
  } finally {
    await pool.end();
  }
  return token;
}
