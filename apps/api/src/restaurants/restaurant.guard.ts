import {
  Injectable,
  NotFoundException,
  Optional,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IdentityService } from "../identity/identity.service.js";
import { readHeaders, type AuthenticatedRequest } from "../identity/session.guard.js";
import { RestaurantRepository, type VisibleRestaurant } from "./restaurant.repository.js";

export const ALLOW_ONBOARDING_RESTAURANT_KEY = "allowOnboardingRestaurant";
export const AllowOnboardingRestaurant = (): MethodDecorator =>
  SetMetadata(ALLOW_ONBOARDING_RESTAURANT_KEY, true);

export type RestaurantRequest = AuthenticatedRequest & {
  restaurant?: VisibleRestaurant;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class RestaurantMemberGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly restaurants: RestaurantRepository,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RestaurantRequest>();
    const auth = await this.identity.authenticate(readHeaders(request));
    if (auth === null) {
      throw new UnauthorizedException();
    }
    request.auth = auth;
    const restaurantId = request.params["id"];
    if (typeof restaurantId !== "string" || !UUID.test(restaurantId)) {
      throw new NotFoundException();
    }
    const allowOnboarding =
      this.reflector?.getAllAndOverride<boolean>(ALLOW_ONBOARDING_RESTAURANT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const restaurant = await this.restaurants.findForMember(restaurantId, auth.userId, {
      allowOnboarding,
    });
    if (restaurant === null) {
      throw new NotFoundException();
    }
    request.restaurant = restaurant;
    return true;
  }
}
