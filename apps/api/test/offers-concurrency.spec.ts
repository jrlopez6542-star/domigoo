import pg, { type QueryResult, type QueryResultRow } from "pg";
import { Database } from "../src/database.js";
import { OffersRepository } from "../src/orders/offers.repository.js";

const { Pool, Client } = pg;

describe("OffersRepository.accept - Concurrencia Determinista en PostgreSQL (M23-S7)", () => {
  const databaseUrl =
    process.env["DATABASE_URL"] ?? "postgresql://postgres@127.0.0.1:5433/domigoo_test";

  let pool: pg.Pool | undefined;
  let monitorClient: pg.Client | undefined;
  let setupClient: pg.PoolClient | undefined;
  let canConnect = false;

  beforeAll(async () => {
    try {
      pool = new Pool({ connectionString: databaseUrl, max: 10 });
      setupClient = await pool.connect();
      monitorClient = new Client({ connectionString: databaseUrl });
      await monitorClient.connect();
      canConnect = true;

      // Si no se ejecutó prisma migrate deploy previo (entorno local sin PostGIS), crear tablas mínimas
      const schemaCheck = await setupClient.query<{ exists: boolean }>(
        `SELECT to_regclass('public.restaurants') IS NOT NULL AS exists`,
      );
      const hasFullSchema = schemaCheck.rows[0]?.exists === true;

      if (!hasFullSchema) {
        await setupClient.query(`
          CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

          CREATE TABLE IF NOT EXISTS users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email text NOT NULL UNIQUE,
            "updatedAt" timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS couriers (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "userId" uuid NOT NULL REFERENCES users(id),
            "documentType" text NOT NULL DEFAULT 'CC',
            "documentNumber" text NOT NULL DEFAULT '10000000',
            "firstName" text NOT NULL DEFAULT 'Courier',
            "lastName" text NOT NULL DEFAULT 'Race',
            "registrationSource" text NOT NULL DEFAULT 'OPEN',
            "updatedAt" timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS courier_availabilities (
            "courierId" uuid PRIMARY KEY REFERENCES couriers(id),
            state text NOT NULL,
            "updatedAt" timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS orders (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            status text NOT NULL,
            "assignedCourierId" uuid REFERENCES couriers(id),
            "acceptedAt" timestamptz,
            "updatedAt" timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS dispatch_offers (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "orderId" uuid NOT NULL REFERENCES orders(id),
            "courierId" uuid NOT NULL REFERENCES couriers(id),
            status text NOT NULL,
            "expiresAt" timestamptz NOT NULL,
            "respondedAt" timestamptz
          );

          CREATE TABLE IF NOT EXISTS idempotency_keys (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "userId" uuid NOT NULL REFERENCES users(id),
            key text NOT NULL,
            "requestHash" text NOT NULL,
            "responseStatus" int NOT NULL,
            "createdAt" timestamptz NOT NULL DEFAULT now(),
            "expiresAt" timestamptz NOT NULL
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_user_key_uidx ON idempotency_keys("userId", key);

          CREATE TABLE IF NOT EXISTS order_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "orderId" uuid NOT NULL REFERENCES orders(id),
            "fromStatus" text NOT NULL,
            "toStatus" text NOT NULL,
            "actorKind" text NOT NULL,
            "actorId" uuid NOT NULL,
            "createdAt" timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS audit_logs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            "actorId" uuid NOT NULL,
            "actorKind" text NOT NULL,
            action text NOT NULL,
            "entityType" text NOT NULL,
            "entityId" uuid NOT NULL,
            diff jsonb,
            "createdAt" timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS "orders_one_active_per_courier" ON orders("assignedCourierId")
          WHERE status IN ('ACCEPTED', 'ARRIVING_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'AT_DROPOFF');
        `);
      }
    } catch {
      canConnect = false;
    }
  });

  afterAll(async () => {
    if (setupClient !== undefined) {
      setupClient.release();
    }
    if (monitorClient !== undefined) {
      await monitorClient.end().catch(() => {});
    }
    if (pool !== undefined) {
      await pool.end().catch(() => {});
    }
  });

  it("detiene la Transacción A antes de COMMIT, observa el bloqueo real de B en PostgreSQL y resuelve por idempotencia", async () => {
    if (
      !canConnect ||
      setupClient === undefined ||
      monitorClient === undefined ||
      pool === undefined
    ) {
      console.warn(
        "PostgreSQL no disponible en DATABASE_URL; omitiendo prueba determinista local.",
      );
      return;
    }

    const schemaCheck = await setupClient.query<{ exists: boolean }>(
      `SELECT to_regclass('public.restaurants') IS NOT NULL AS exists`,
    );
    const hasFullSchema = schemaCheck.rows[0]?.exists === true;

    // 1. Limpieza de datos previa
    if (hasFullSchema) {
      await setupClient.query(
        "TRUNCATE audit_logs, order_events, idempotency_keys, dispatch_offers, orders, courier_availabilities, couriers, branches, establishments, restaurants, users CASCADE",
      );
    } else {
      await setupClient.query(
        "TRUNCATE audit_logs, order_events, idempotency_keys, dispatch_offers, orders, courier_availabilities, couriers, users CASCADE",
      );
    }

    // 2. Sembrar usuario y courier en estado AVAILABLE
    const userResult = await setupClient.query<{ id: string }>(
      `INSERT INTO users (id, email, "updatedAt") VALUES (gen_random_uuid(), 'courier-race@test.local', now()) RETURNING id`,
    );
    const user = userResult.rows[0];
    if (user === undefined) throw new Error("Fallo al insertar usuario de prueba");

    const courierResult = await setupClient.query<{ id: string }>(
      `INSERT INTO couriers (id, "userId", "documentType", "documentNumber", "firstName", "lastName", "registrationSource", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'CC', '80099901', 'Courier', 'Race', 'OPEN', now())
       RETURNING id`,
      [user.id],
    );
    const courier = courierResult.rows[0];
    if (courier === undefined) throw new Error("Fallo al insertar courier de prueba");

    await setupClient.query(
      `INSERT INTO courier_availabilities ("courierId", state, "updatedAt") VALUES ($1, $2, now())`,
      [courier.id, "AVAILABLE"],
    );

    // 3. Sembrar orden en SEEKING_COURIER y oferta PENDING
    let order: { id: string } | undefined;
    if (hasFullSchema) {
      const restResult = await setupClient.query<{ id: string }>(
        `INSERT INTO restaurants (id, "legalName", "tradeName", nit, email, "phoneE164", "updatedAt")
         VALUES (gen_random_uuid(), 'Race SAS', 'Race Food', '900999001', 'race-rest@test.local', '+573009990001', now())
         RETURNING id`,
      );
      const restaurantId = restResult.rows[0]?.id;
      const estResult = await setupClient.query<{ id: string }>(
        `INSERT INTO establishments (id, "restaurantId", name, "updatedAt")
         VALUES (gen_random_uuid(), $1, 'Establecimiento Race', now())
         RETURNING id`,
        [restaurantId],
      );
      const estId = estResult.rows[0]?.id;
      const branchResult = await setupClient.query<{ id: string }>(
        `INSERT INTO branches (id, "establishmentId", name, "addressLine", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'Sede Race', 'Calle Race 1', now())
         RETURNING id`,
        [estId],
      );
      const branchId = branchResult.rows[0]?.id;
      const orderResult = await setupClient.query<{ id: string }>(
        `INSERT INTO orders (id, "referenceCode", "restaurantId", "branchId", "createdById", status, "updatedAt")
         VALUES (gen_random_uuid(), 'RACE0001', $1, $2, $3, 'SEEKING_COURIER', now())
         RETURNING id`,
        [restaurantId, branchId, user.id],
      );
      order = orderResult.rows[0];
    } else {
      const orderResult = await setupClient.query<{ id: string }>(
        `INSERT INTO orders (id, status, "updatedAt") VALUES (gen_random_uuid(), 'SEEKING_COURIER', now()) RETURNING id`,
      );
      order = orderResult.rows[0];
    }
    if (order === undefined) throw new Error("Fallo al insertar orden de prueba");

    const offerResult = await setupClient.query<{ id: string }>(
      `INSERT INTO dispatch_offers (id, "orderId", "courierId", status, "expiresAt")
       VALUES (gen_random_uuid(), $1, $2, 'PENDING', now() + interval '10 minutes')
       RETURNING id`,
      [order.id, courier.id],
    );
    const offer = offerResult.rows[0];
    if (offer === undefined) throw new Error("Fallo al insertar oferta de prueba");

    // 4. Mecanismo de Barrera para el Entorno de Test
    let firstCommitReached = false;
    let winnerPid: number | undefined;
    let blockedPid: number | undefined;

    let resolveBarrierArrived!: (pid: number) => void;
    const barrierArrived = new Promise<number>((resolve) => {
      resolveBarrierArrived = resolve;
    });

    let resolveBarrierRelease!: () => void;
    const barrierRelease = new Promise<void>((resolve) => {
      resolveBarrierRelease = () => {
        resolve();
      };
    });

    const connectedClients: number[] = [];
    const clientQueries = new Map<number, string[]>();

    // Envolver pool.connect para instrumentar la barrera sin modificar el código de OffersRepository
    const targetPool = pool;
    const instrumentedPool = {
      connect: async () => {
        const realClient = await targetPool.connect();
        const pidRow = await realClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        const clientPid = Number(pidRow.rows[0]?.pid);
        connectedClients.push(clientPid);
        clientQueries.set(clientPid, []);

        const origQuery = realClient.query.bind(realClient);

        // Interceptar query para pausar a la primera transacción en COMMIT
        const interceptedQuery = async (
          queryTextOrConfig: string | { text: string },
          values?: unknown[],
        ): Promise<QueryResult<QueryResultRow>> => {
          const sqlStr =
            typeof queryTextOrConfig === "string" ? queryTextOrConfig : queryTextOrConfig.text;
          clientQueries.get(clientPid)?.push(sqlStr);

          if (sqlStr === "COMMIT" && !firstCommitReached) {
            firstCommitReached = true;
            winnerPid = clientPid;
            resolveBarrierArrived(clientPid);
            // Pausar hasta que el monitor certifique que la otra transacción está bloqueada en PG
            await barrierRelease;
          }

          if (values !== undefined) {
            return origQuery(queryTextOrConfig as string, values);
          }
          return origQuery(queryTextOrConfig as string);
        };

        realClient.query = interceptedQuery as typeof realClient.query;

        return realClient;
      },
    };

    const mockDatabase = { pool: instrumentedPool } as unknown as Database;
    const repo = new OffersRepository(mockDatabase);

    const idempotencyKey = `race-idem-${String(Date.now())}`;
    const payload = { ack: true };

    try {
      // 5. Ejecutar simultáneamente dos llamadas al método real offersRepository.accept()
      const callA = repo.accept(offer.id, user.id, idempotencyKey, payload);
      const callB = repo.accept(offer.id, user.id, idempotencyKey, payload);

      // 6. Esperar a que la Transacción Ganadora alcance el estado pre-COMMIT con limpieza de temporizador
      let commitTimer: NodeJS.Timeout | undefined;
      const commitTimeout = new Promise<never>((_, reject) => {
        commitTimer = setTimeout(() => {
          reject(new Error("Timeout esperando que Transacción A alcance pre-COMMIT"));
        }, 5000);
      });

      let pidWinner: number | undefined;
      try {
        pidWinner = await Promise.race([barrierArrived, commitTimeout]);
      } finally {
        clearTimeout(commitTimer);
      }
      expect(pidWinner).toBeDefined();

      // Sincronización robusta: Esperar acotadamente a que ambas conexiones queden registradas
      const startConnectWait = Date.now();
      while (connectedClients.length < 2 && Date.now() - startConnectWait < 5000) {
        await new Promise((r) => {
          setTimeout(r, 10);
        });
      }

      // Aserción explícita de recepción de exactamente dos conexiones con PIDs válidos y distintos
      expect(connectedClients.length).toBe(2);
      expect(connectedClients[0]).toBeDefined();
      expect(connectedClients[1]).toBeDefined();
      expect(connectedClients[0]).not.toBe(connectedClients[1]);

      // Identificar el PID de la otra transacción (Transacción B)
      blockedPid = connectedClients.find((p) => p !== pidWinner);
      expect(blockedPid).toBeDefined();
      expect(blockedPid).not.toBe(pidWinner);
      if (blockedPid === undefined) throw new Error("Transacción B no encontrada");

      // 7. Inspección de Catálogo: La tercera conexión (Monitor) verifica el bloqueo en PostgreSQL
      let lockObserved = false;
      let observedEvent = "";
      const startPoll = Date.now();

      while (Date.now() - startPoll < 5000) {
        const res = await monitorClient.query<{
          pid: number;
          blockers: number[];
          wait_event_type: string;
          wait_event: string;
        }>(
          `SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type, wait_event
           FROM pg_stat_activity
           WHERE pid = $1`,
          [blockedPid],
        );
        const row = res.rows[0];
        if (
          row !== undefined &&
          Array.isArray(row.blockers) &&
          row.blockers.includes(Number(winnerPid))
        ) {
          lockObserved = true;
          observedEvent = `${row.wait_event_type}:${row.wait_event}`;
          expect(row.wait_event_type).toBe("Lock");
          break;
        }
        await new Promise((r) => {
          setTimeout(r, 50);
        });
      }

      // Demostración indiscutible de que B estuvo físicamente bloqueada en PostgreSQL
      expect(lockObserved).toBe(true);
      expect(observedEvent).toMatch(/^Lock:/);

      // 8. Liberar la barrera para que la Transacción A ejecute su COMMIT
      resolveBarrierRelease();

      // 9. Esperar la resolución de ambas llamadas
      const [resultA, resultB] = await Promise.all([callA, callB]);

      // Comprobación 1: Ambas llamadas retornan el mismo resultado original
      expect(resultA).toEqual({
        offerId: offer.id,
        orderId: order.id,
        offerStatus: "ACCEPTED",
        orderStatus: "ACCEPTED",
      });
      expect(resultB).toEqual(resultA);

      // Comprobación 2: Existe exactamente una clave de idempotencia
      const keyCountResult = await setupClient.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM idempotency_keys WHERE "userId" = $1 AND key = $2',
        [user.id, idempotencyKey],
      );
      const keyCount = keyCountResult.rows[0];
      if (keyCount === undefined) throw new Error("Fallo en conteo de idempotencia");
      expect(Number(keyCount.count)).toBe(1);

      // Comprobación 3: Existe exactamente un evento de aceptación
      const eventCountResult = await setupClient.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM order_events WHERE "orderId" = $1 AND "toStatus" = \'ACCEPTED\'',
        [order.id],
      );
      const eventCount = eventCountResult.rows[0];
      if (eventCount === undefined) throw new Error("Fallo en conteo de eventos");
      expect(Number(eventCount.count)).toBe(1);

      // Comprobación 4: Existe exactamente un registro de auditoría de aceptación
      const auditCountResult = await setupClient.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_logs WHERE \"entityId\" = $1 AND action = 'offer.accepted'",
        [offer.id],
      );
      const auditCount = auditCountResult.rows[0];
      if (auditCount === undefined) throw new Error("Fallo en conteo de auditoría");
      expect(Number(auditCount.count)).toBe(1);

      // Comprobación 5: El courier termina en "ON_SERVICE"
      const availResult = await setupClient.query<{ state: string }>(
        'SELECT state FROM courier_availabilities WHERE "courierId" = $1',
        [courier.id],
      );
      const availState = availResult.rows[0];
      if (availState === undefined) throw new Error("Fallo en estado de disponibilidad");
      expect(availState.state).toBe("ON_SERVICE");

      // Comprobación 6: La orden queda asignada una sola vez
      const orderStateResult = await setupClient.query<{
        status: string;
        assignedCourierId: string;
      }>('SELECT status, "assignedCourierId" FROM orders WHERE id = $1', [order.id]);
      const orderState = orderStateResult.rows[0];
      if (orderState === undefined) throw new Error("Fallo en estado de orden");
      expect(orderState.status).toBe("ACCEPTED");
      expect(orderState.assignedCourierId).toBe(courier.id);

      // Comprobación 7: La segunda llamada realmente ejecutó la reconsulta de M23-S4
      const blockedQueries = clientQueries.get(blockedPid) ?? [];
      const idemQueries = blockedQueries.filter((q) => q.includes("FROM idempotency_keys"));
      expect(idemQueries.length).toBeGreaterThanOrEqual(2);
    } finally {
      // Liberación garantizada de la barrera para evitar cuelgues ante cualquier fallo
      resolveBarrierRelease();
    }
  });
});
