import { Database } from "../database.js";
import { OffersRepository, computeOfferAcceptHash } from "./offers.repository.js";

describe("huella de idempotencia de ofertas", () => {
  const offer1 = "11111111-1111-4111-8111-111111111111";
  const offer2 = "22222222-2222-4222-8222-222222222222";

  it("genera un hash de 64 caracteres hexadecimales (SHA-256)", () => {
    const hash = computeOfferAcceptHash(offer1, { ack: true });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("es determinista para la misma oferta y mismo cuerpo", () => {
    const hashA = computeOfferAcceptHash(offer1, { ack: true });
    const hashB = computeOfferAcceptHash(offer1, { ack: true });
    expect(hashA).toBe(hashB);
  });

  it("produce hashes distintos para ofertas diferentes con el mismo cuerpo (Riesgo B)", () => {
    const hashOffer1 = computeOfferAcceptHash(offer1, { ack: true });
    const hashOffer2 = computeOfferAcceptHash(offer2, { ack: true });
    expect(hashOffer1).not.toBe(hashOffer2);
  });

  it("produce hashes distintos para cuerpos diferentes con la misma oferta", () => {
    const hash1 = computeOfferAcceptHash(offer1, { ack: true });
    const hash2 = computeOfferAcceptHash(offer1, { ack: false });
    expect(hash1).not.toBe(hash2);
  });

  it("maneja cuerpo nulo o indefinido de forma consistente", () => {
    const hashNull = computeOfferAcceptHash(offer1, null);
    const hashUndefined = computeOfferAcceptHash(offer1, undefined);
    const hashEmptyObj = computeOfferAcceptHash(offer1, {});
    expect(hashNull).toBe(hashEmptyObj);
    expect(hashUndefined).toBe(hashEmptyObj);
  });
});

describe("OffersRepository.accept (transaccionalidad e idempotencia concurrente)", () => {
  const offerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const courierId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const orderId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const idempotencyKey = "key-test-123";
  const body = { ack: true };
  const expectedHash = computeOfferAcceptHash(offerId, body);

  function setupRepo(
    queryHandler: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount?: number },
  ) {
    const client = {
      query: (sql: string, params?: unknown[]) => Promise.resolve(queryHandler(sql, params)),
      release: () => {},
    };
    const mockDb = {
      pool: {
        connect: () => Promise.resolve(client),
      },
    } as unknown as Database;

    const repo = new OffersRepository(mockDb);
    return { repo, client };
  }

  it("preserva la respuesta original ACCEPTED cuando el pedido ya avanzó a PICKED_UP", async () => {
    const executedQueries: string[] = [];
    const { repo } = setupRepo((sql) => {
      executedQueries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("FROM idempotency_keys")) {
        return { rows: [{ requestHash: expectedHash }] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      if (sql.includes("FROM dispatch_offers d")) {
        return { rows: [{ orderId, orderStatus: "PICKED_UP", offerStatus: "ACCEPTED" }] };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(result).toEqual({
      offerId,
      orderId,
      offerStatus: "ACCEPTED",
      orderStatus: "ACCEPTED",
    });
    expect(executedQueries.some((q) => q.includes("UPDATE orders"))).toBe(false);
  });

  it("preserva la respuesta original ACCEPTED cuando el pedido ya avanzó a DELIVERED", async () => {
    const { repo } = setupRepo((sql) => {
      if (sql.includes("FROM idempotency_keys")) {
        return { rows: [{ requestHash: expectedHash }] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      if (sql.includes("FROM dispatch_offers d")) {
        return { rows: [{ orderId, orderStatus: "DELIVERED", offerStatus: "ACCEPTED" }] };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(result).toEqual({
      offerId,
      orderId,
      offerStatus: "ACCEPTED",
      orderStatus: "ACCEPTED",
    });
  });

  it("preserva la respuesta original ACCEPTED cuando el pedido fue cancelado posteriormente", async () => {
    const { repo } = setupRepo((sql) => {
      if (sql.includes("FROM idempotency_keys")) {
        return { rows: [{ requestHash: expectedHash }] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      if (sql.includes("FROM dispatch_offers d")) {
        return {
          rows: [{ orderId, orderStatus: "CANCELLED_RESTAURANT", offerStatus: "ACCEPTED" }],
        };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(result).toEqual({
      offerId,
      orderId,
      offerStatus: "ACCEPTED",
      orderStatus: "ACCEPTED",
    });
  });

  it("captura carreras concurrentes mediante re-consulta de idempotency_keys tras adquirir cerrojo de disponibilidad", async () => {
    let idempotencyQueryCount = 0;
    const { repo } = setupRepo((sql) => {
      if (sql.includes("FROM idempotency_keys")) {
        idempotencyQueryCount++;
        // En la primera consulta (antes del cerrojo), no existe la fila aún
        if (idempotencyQueryCount === 1) {
          return { rows: [] };
        }
        // En la re-consulta tras el cerrojo de disponibilidad, la primera transacción ya hizo commit
        return { rows: [{ requestHash: expectedHash }] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      if (sql.includes("FROM dispatch_offers d")) {
        return { rows: [{ orderId, orderStatus: "ACCEPTED", offerStatus: "ACCEPTED" }] };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(idempotencyQueryCount).toBe(2);
    expect(result).toEqual({
      offerId,
      orderId,
      offerStatus: "ACCEPTED",
      orderStatus: "ACCEPTED",
    });
  });

  it("devuelve mismatch si la clave re-consultada tiene un hash diferente", async () => {
    let idempotencyQueryCount = 0;
    const { repo } = setupRepo((sql) => {
      if (sql.includes("FROM idempotency_keys")) {
        idempotencyQueryCount++;
        if (idempotencyQueryCount === 1) {
          return { rows: [] };
        }
        return { rows: [{ requestHash: "hash-distinto-por-otro-body-u-oferta" }] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(result).toBe("mismatch");
  });

  it("devuelve conflict si el domiciliario está ON_SERVICE y no existe clave previa tras la re-consulta", async () => {
    const { repo } = setupRepo((sql) => {
      if (sql.includes("FROM idempotency_keys")) {
        return { rows: [] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(result).toBe("conflict");
  });

  it("devuelve conflict si la clave existe pero la oferta no quedó en estado ACCEPTED", async () => {
    const { repo } = setupRepo((sql) => {
      if (sql.includes("FROM idempotency_keys")) {
        return { rows: [{ requestHash: expectedHash }] };
      }
      if (sql.includes("FROM couriers c")) {
        return {
          rows: [{ courierId, courierStatus: "APPROVED", availabilityState: "ON_SERVICE" }],
        };
      }
      if (sql.includes("FROM dispatch_offers d")) {
        return { rows: [{ orderId, orderStatus: "CANCELLED_RESTAURANT", offerStatus: "EXPIRED" }] };
      }
      return { rows: [] };
    });

    const result = await repo.accept(offerId, userId, idempotencyKey, body);
    expect(result).toBe("conflict");
  });

  it("demuestra la carrera de dos llamadas concurrentes mediante Promise.all donde la clave no existe inicialmente", async () => {
    let committed = false;
    let keyCreated = false;
    let orderMutations = 0;
    let lockQueue: Promise<void> = Promise.resolve();

    const mockDb = {
      pool: {
        connect: () => {
          let releaseThisLock: (() => void) | null = null;

          const client = {
            query: async (sql: string) => {
              if (sql === "BEGIN") {
                return { rows: [] };
              }
              if (sql === "COMMIT") {
                committed = true;
                if (releaseThisLock) {
                  releaseThisLock();
                  releaseThisLock = null;
                }
                return { rows: [] };
              }
              if (sql === "ROLLBACK") {
                if (releaseThisLock) {
                  releaseThisLock();
                  releaseThisLock = null;
                }
                return { rows: [] };
              }
              if (sql.includes("FROM idempotency_keys")) {
                if (keyCreated) {
                  return { rows: [{ requestHash: expectedHash }] };
                }
                return { rows: [] };
              }
              if (sql.includes("FROM couriers c")) {
                // Simula el bloqueo a nivel de fila FOR UPDATE OF a de PostgreSQL
                const prevLock = lockQueue;
                let resolveLock!: () => void;
                lockQueue = new Promise<void>((resolve) => {
                  resolveLock = resolve;
                });
                await prevLock;
                releaseThisLock = resolveLock;

                const availabilityState = committed ? "ON_SERVICE" : "AVAILABLE";
                return { rows: [{ courierId, courierStatus: "APPROVED", availabilityState }] };
              }
              if (sql.includes("FROM dispatch_offers d") && !sql.includes("FOR UPDATE")) {
                return {
                  rows: [{ orderId, orderStatus: "ACCEPTED", offerStatus: "ACCEPTED" }],
                };
              }
              if (sql.includes("FOR UPDATE OF o, d")) {
                return {
                  rows: [
                    {
                      orderId,
                      orderStatus: "SEEKING_COURIER",
                      offerStatus: "PENDING",
                      expiresAt: new Date(Date.now() + 600000),
                    },
                  ],
                };
              }
              if (sql.includes("UPDATE orders")) {
                orderMutations++;
                return { rows: [], rowCount: 1 };
              }
              if (sql.includes("UPDATE courier_availabilities")) {
                return { rows: [], rowCount: 1 };
              }
              if (sql.includes("INSERT INTO idempotency_keys")) {
                keyCreated = true;
                return { rows: [], rowCount: 1 };
              }
              return { rows: [] };
            },
            release: () => {
              if (releaseThisLock) {
                releaseThisLock();
                releaseThisLock = null;
              }
            },
          };
          return Promise.resolve(client);
        },
      },
    } as unknown as Database;

    const repo = new OffersRepository(mockDb);

    const [resultA, resultB] = await Promise.all([
      repo.accept(offerId, userId, idempotencyKey, body),
      repo.accept(offerId, userId, idempotencyKey, body),
    ]);

    expect(resultA).toEqual({
      offerId,
      orderId,
      offerStatus: "ACCEPTED",
      orderStatus: "ACCEPTED",
    });
    expect(resultB).toEqual(resultA);
    expect(orderMutations).toBe(1);
    expect(keyCreated).toBe(true);
  });
});
