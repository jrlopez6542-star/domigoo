import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { BranchesController } from "./branches.controller.js";
import { PublicRestaurantsController } from "./public-restaurants.controller.js";
import { RestaurantMemberGuard } from "./restaurant.guard.js";
import { RestaurantRepository } from "./restaurant.repository.js";
import { RestaurantsController } from "./restaurants.controller.js";

@Module({
  imports: [IdentityModule],
  controllers: [RestaurantsController, BranchesController, PublicRestaurantsController],
  providers: [RestaurantRepository, RestaurantMemberGuard],
})
export class RestaurantsModule {}
