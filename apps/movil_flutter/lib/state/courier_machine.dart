import '../api/courier_api_client.dart';

enum ScreenName {
  login,
  profile,
  geolocationConsent,
  availability,
  offer,
  journey,
  pinPickup,
  pinDelivery,
  done,
}

class SanitizedOfferView {
  const SanitizedOfferView({
    required this.id,
    required this.orderId,
    required this.deliveryFeeCop,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.customerPhone,
  });

  final String id;
  final String orderId;
  final int deliveryFeeCop;
  final String pickupAddress;
  final String dropoffAddress;
  final String? customerPhone;
}

class SanitizedOrderView {
  const SanitizedOrderView({
    required this.id,
    required this.status,
    required this.customerPhone,
    required this.pickupAddress,
    required this.dropoffAddress,
  });

  final String id;
  final String status;
  final String? customerPhone;
  final String? pickupAddress;
  final String? dropoffAddress;
}

class CourierMachineState {
  const CourierMachineState({
    required this.screen,
    required this.hasProfile,
    required this.hasGeolocationConsent,
    required this.geolocationConsentId,
    required this.available,
    required this.offer,
    required this.order,
  });

  final ScreenName screen;
  final bool hasProfile;
  final bool hasGeolocationConsent;
  final String? geolocationConsentId;
  final bool available;
  final CourierOfferView? offer;
  final CourierOrderState? order;

  factory CourierMachineState.initial() {
    return const CourierMachineState(
      screen: ScreenName.login,
      hasProfile: false,
      hasGeolocationConsent: false,
      geolocationConsentId: null,
      available: false,
      offer: null,
      order: null,
    );
  }

  CourierMachineState copyWith({
    ScreenName? screen,
    bool? hasProfile,
    bool? hasGeolocationConsent,
    String? geolocationConsentId,
    bool clearGeolocationConsentId = false,
    bool? available,
    CourierOfferView? offer,
    bool clearOffer = false,
    CourierOrderState? order,
    bool clearOrder = false,
  }) {
    return CourierMachineState(
      screen: screen ?? this.screen,
      hasProfile: hasProfile ?? this.hasProfile,
      hasGeolocationConsent: hasGeolocationConsent ?? this.hasGeolocationConsent,
      geolocationConsentId: clearGeolocationConsentId
          ? null
          : (geolocationConsentId ?? this.geolocationConsentId),
      available: available ?? this.available,
      offer: clearOffer ? null : (offer ?? this.offer),
      order: clearOrder ? null : (order ?? this.order),
    );
  }
}

SanitizedOfferView sanitizeOfferForDisplay(CourierOfferView offer) {
  return SanitizedOfferView(
    id: offer.id,
    orderId: offer.orderId,
    deliveryFeeCop: offer.deliveryFeeCop,
    pickupAddress: offer.pickupAddress,
    dropoffAddress: offer.dropoffAddress,
    customerPhone: offer.status == 'ACCEPTED' ? offer.customerPhone : null,
  );
}

SanitizedOrderView sanitizeOrderForDisplay(CourierOrderState order) {
  return SanitizedOrderView(
    id: order.id,
    status: order.status,
    customerPhone: order.customerPhone,
    pickupAddress: order.pickupAddress,
    dropoffAddress: order.dropoffAddress,
  );
}

ScreenName nextScreenAfterLogin(bool hasProfile) {
  return hasProfile ? ScreenName.availability : ScreenName.profile;
}

ScreenName screenForOrderStatus(String status) {
  switch (status) {
    case 'AT_PICKUP':
      return ScreenName.pinPickup;
    case 'AT_DROPOFF':
      return ScreenName.pinDelivery;
    case 'DELIVERED':
      return ScreenName.done;
    default:
      return ScreenName.journey;
  }
}
