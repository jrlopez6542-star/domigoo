import { Controller, Get, NotFoundException, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RestaurantMemberGuard, type RestaurantRequest } from "./restaurant.guard.js";

@ApiTags("restaurantes")
@Controller("v1/restaurants")
export class RestaurantsController {
  @Get(":id")
  @UseGuards(RestaurantMemberGuard)
  @ApiOperation({ summary: "Lee un restaurante si la sesión tiene una membresía activa" })
  getOne(@Req() request: RestaurantRequest): { id: string; tradeName: string } {
    const restaurant = request.restaurant;
    if (restaurant === undefined) {
      throw new NotFoundException();
    }
    return restaurant;
  }
}
