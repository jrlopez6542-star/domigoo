import { ForbiddenException } from "@nestjs/common";
import type { AuditRecorder } from "../audit/audit.service.js";
import type { Database } from "../database.js";
import { PrivacyController } from "../privacy/privacy.controller.js";
import type { PrivacyRepository } from "../privacy/privacy.repository.js";
import type { RestaurantRepository } from "../restaurants/restaurant.repository.js";
import type { SubscriptionRepository } from "../subscriptions/subscription.repository.js";
import { SubscriptionAdminController } from "../subscriptions/subscriptions.controller.js";
import type { TariffRepository } from "../tariffs/tariff.repository.js";
import { TariffsController } from "../tariffs/tariffs.controller.js";
import { AdminController } from "./admin.controller.js";
import { denyReviewer } from "./admin-roles.js";
import type { AdminRequest } from "./admin.guard.js";

describe("denyReviewer y bloqueo temprano de REVIEWER en controladores admin (ORDEN 018)", () => {
  it("lanza ForbiddenException (403) cuando adminRole es REVIEWER", () => {
    expect(() => {
      denyReviewer("REVIEWER");
    }).toThrow(ForbiddenException);
  });

  it.each(["SUPERADMIN", "OPERATIONS", "SECURITY", undefined])(
    "permite continuar cuando adminRole es %s",
    (role) => {
      expect(() => {
        denyReviewer(role);
      }).not.toThrow();
    },
  );

  it("bloquea REVIEWER con 403 antes de leer body o tocar BD en los 10 endpoints restringidos", async () => {
    let dbCalls = 0;
    const countCall = () => {
      dbCalls += 1;
      throw new Error("No debe consultar ni mutar BD para REVIEWER");
    };

    const reviewerReq = {
      adminRole: "REVIEWER",
      auth: { userId: "reviewer-user-1", sessionId: "sess-1" },
    } as AdminRequest;

    const tariffsCtrl = new TariffsController({
      createVersion: countCall,
      addZone: countCall,
      addRule: countCall,
      publish: countCall,
      quote: countCall,
    } as unknown as TariffRepository);

    const subsCtrl = new SubscriptionAdminController(
      {
        createPlan: countCall,
        open: countCall,
        acknowledge: () => Promise.resolve(true),
        advance: countCall,
      } as unknown as SubscriptionRepository,
      {
        record: () => Promise.resolve(),
      } as unknown as AuditRecorder,
    );

    const adminCtrl = new AdminController(
      {} as Database,
      { record: countCall } as unknown as AuditRecorder,
      { activateRestaurant: countCall } as unknown as RestaurantRepository,
    );

    const privacyCtrl = new PrivacyController({
      insertDocument: countCall,
    } as unknown as PrivacyRepository);

    // Incluso con body inválido (null), debe devolver 403 antes de validar body o tocar BD
    await expect(tariffsCtrl.createVersion(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(tariffsCtrl.addZone(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(tariffsCtrl.addRule(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(tariffsCtrl.publish(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(tariffsCtrl.quote(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(subsCtrl.createPlan(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(subsCtrl.open(null, reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(subsCtrl.advance(reviewerReq)).rejects.toThrow(ForbiddenException);
    await expect(adminCtrl.activateRestaurant("rest-1", reviewerReq)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(privacyCtrl.publish(null, reviewerReq)).rejects.toThrow(ForbiddenException);

    expect(dbCalls).toBe(0);

    // REVIEWER conserva acceso a acknowledge
    const ack = await subsCtrl.acknowledge("decl-1", reviewerReq, { note: "Revisado" });
    expect(ack).toEqual({ acknowledged: true });
  });
});
