import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RestaurantRepository, type PublicRestaurantItem } from "./restaurant.repository.js";

@ApiTags("publico")
@Controller("v1/public/restaurants")
export class PublicRestaurantsController {
  constructor(private readonly restaurants: RestaurantRepository) {}

  @Get()
  @ApiOperation({
    summary: "Lista restaurantes activos en Tocancipá sin PII (sin NIT, correo ni razón social)",
  })
  async list(@Query("q") q?: string): Promise<{ restaurants: PublicRestaurantItem[] }> {
    const restaurants = await this.restaurants.listPublicRestaurants(q);
    return { restaurants };
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalle público de un restaurante activo sin PII" })
  async getOne(@Param("id") id: string): Promise<PublicRestaurantItem> {
    const item = await this.restaurants.getPublicRestaurant(id);
    if (item === null) {
      throw new NotFoundException();
    }
    return item;
  }
}
