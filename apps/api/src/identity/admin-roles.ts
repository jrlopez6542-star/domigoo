import { ForbiddenException } from "@nestjs/common";

export function denyReviewer(adminRole: string | undefined): void {
  if (adminRole === "REVIEWER") {
    throw new ForbiddenException();
  }
}
