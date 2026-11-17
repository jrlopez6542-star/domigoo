import 'dart:convert';
import 'package:http/http.dart' as http;

typedef HttpRequestFn = Future<HttpJsonResponse> Function(
  Uri uri, {
  required String method,
  required Map<String, String> headers,
  String? body,
});

class HttpJsonResponse {
  const HttpJsonResponse({
    required this.statusCode,
    required this.body,
  });

  final int statusCode;
  final String body;

  bool get isOk => statusCode >= 200 && statusCode < 300;
}

class CourierOfferView {
  const CourierOfferView({
    required this.id,
    required this.orderId,
    required this.status,
    required this.deliveryFeeCop,
    required this.pickupAddress,
    required this.dropoffAddress,
    this.customerPhone,
  });

  final String id;
  final String orderId;
  final String status; // PENDING | ACCEPTED | DECLINED | EXPIRED
  final int deliveryFeeCop;
  final String pickupAddress;
  final String dropoffAddress;
  final String? customerPhone;
}

class CourierOrderState {
  const CourierOrderState({
    required this.id,
    required this.status,
    this.customerPhone,
    this.pickupAddress,
    this.dropoffAddress,
  });

  final String id;
  final String status; // ACCEPTED | ARRIVING_PICKUP | AT_PICKUP | PICKED_UP | AT_DROPOFF | DELIVERED
  final String? customerPhone;
  final String? pickupAddress;
  final String? dropoffAddress;

  CourierOrderState copyWith({
    String? status,
    String? customerPhone,
    String? pickupAddress,
    String? dropoffAddress,
  }) {
    return CourierOrderState(
      id: id,
      status: status ?? this.status,
      customerPhone: customerPhone ?? this.customerPhone,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      dropoffAddress: dropoffAddress ?? this.dropoffAddress,
    );
  }
}

class RegisterConsentsInput {
  const RegisterConsentsInput({
    required this.termsAccepted,
    required this.privacyAccepted,
    required this.sensitiveDataAccepted,
    this.marketingAccepted,
    this.version,
  });

  final bool termsAccepted;
  final bool privacyAccepted;
  final bool sensitiveDataAccepted;
  final bool? marketingAccepted;
  final String? version;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'termsAccepted': termsAccepted,
      'privacyAccepted': privacyAccepted,
      'sensitiveDataAccepted': sensitiveDataAccepted,
      if (marketingAccepted != null) 'marketingAccepted': marketingAccepted,
      if (version != null) 'version': version,
    };
  }
}

class CourierApiException implements Exception {
  const CourierApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class CourierApiClient {
  CourierApiClient(
    this.baseUrl, {
    HttpRequestFn? requestFn,
  }) : _requestFn = requestFn ?? _defaultHttpRequest;

  final String baseUrl;
  final HttpRequestFn _requestFn;
  String? _token;

  String? get token => _token;

  void setToken(String? token) {
    _token = token;
  }

  static Future<HttpJsonResponse> _defaultHttpRequest(
    Uri uri, {
    required String method,
    required Map<String, String> headers,
    String? body,
  }) async {
    final client = http.Client();
    try {
      final req = http.Request(method, uri);
      req.headers.addAll(headers);
      if (body != null) {
        req.body = body;
      }
      final streamed = await client.send(req);
      final response = await http.Response.fromStream(streamed);
      return HttpJsonResponse(statusCode: response.statusCode, body: response.body);
    } finally {
      client.close();
    }
  }

  Future<Map<String, dynamic>> _request(
    String path,
    String method, {
    Object? body,
    Map<String, String>? extraHeaders,
  }) async {
    final headers = <String, String>{
      'content-type': 'application/json',
      if (extraHeaders != null) ...extraHeaders,
    };
    if (_token != null) {
      headers['authorization'] = 'Bearer $_token';
    }

    final res = await _requestFn(
      Uri.parse('$baseUrl$path'),
      method: method,
      headers: headers,
      body: body != null ? jsonEncode(body) : null,
    );

    Map<String, dynamic> data = <String, dynamic>{};
    if (res.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) {
          data = decoded;
        }
      } catch (_) {
        data = <String, dynamic>{};
      }
    }

    if (!res.isOk) {
      final msg = data['message'] is String
          ? data['message'] as String
          : 'Error ${res.statusCode}';
      throw CourierApiException(msg);
    }
    return data;
  }

  Future<String> login(String identifier, String password) async {
    final trimmed = identifier.trim();
    final payload = trimmed.contains('@')
        ? <String, dynamic>{'email': trimmed, 'password': password, 'client': 'MOBILE'}
        : <String, dynamic>{'phoneE164': trimmed, 'password': password, 'client': 'MOBILE'};
    final res = await _request('/v1/auth/login', 'POST', body: payload);
    final tok = res['token'] as String? ?? '';
    _token = tok;
    return tok;
  }

  Future<String> registerCourier({
    required String identifier,
    required String password,
    required RegisterConsentsInput consents,
  }) async {
    final trimmed = identifier.trim();
    final base = trimmed.contains('@')
        ? <String, dynamic>{'email': trimmed, 'password': password, 'client': 'MOBILE'}
        : <String, dynamic>{'phoneE164': trimmed, 'password': password, 'client': 'MOBILE'};
    final res = await _request(
      '/v1/auth/register',
      'POST',
      body: <String, dynamic>{
        ...base,
        'role': 'COURIER',
        'consents': consents.toJson(),
      },
    );
    final tok = res['token'] as String? ?? '';
    _token = tok;
    return tok;
  }

  Future<String> grantGeolocationConsent() async {
    final docs = await _request('/v1/legal-documents/current', 'GET');
    final list = docs['documents'];
    String? geoDocId;
    if (list is List) {
      for (final item in list) {
        if (item is Map<String, dynamic> && item['kind'] == 'GEOLOCATION_CONSENT') {
          geoDocId = item['id'] as String?;
          break;
        }
      }
    }
    if (geoDocId == null || geoDocId.isEmpty) {
      throw const CourierApiException(
        'No se encontró el documento de consentimiento de geolocalización',
      );
    }
    final consent = await _request(
      '/v1/consents',
      'POST',
      body: <String, dynamic>{
        'legalDocumentId': geoDocId,
        'purpose': 'GEOLOCATION',
        'channel': 'MOBILE',
      },
    );
    return consent['id'] as String;
  }

  Future<bool> revokeGeolocationConsent(String consentId) async {
    final res = await _request(
      '/v1/consents/$consentId/revoke',
      'POST',
      body: <String, dynamic>{},
    );
    return res['revoked'] == true;
  }

  Future<String> createProfile({
    required String firstName,
    required String lastName,
    required String documentType,
    required String documentNumber,
  }) async {
    final res = await _request(
      '/v1/couriers',
      'POST',
      body: <String, dynamic>{
        'firstName': firstName,
        'lastName': lastName,
        'documentType': documentType,
        'documentNumber': documentNumber,
      },
    );
    return res['id'] as String? ?? '';
  }

  Future<String> setAvailability(String state) async {
    final res = await _request(
      '/v1/couriers/me/availability',
      'POST',
      body: <String, dynamic>{'state': state},
    );
    return res['state'] as String? ?? state;
  }

  Future<bool> sendLocation({
    required bool hasGeolocationConsent,
    required double longitude,
    required double latitude,
    double? accuracyM,
  }) async {
    if (!hasGeolocationConsent) {
      throw const CourierApiException(
        'Se requiere consentimiento de geolocalización antes de enviar la posición.',
      );
    }
    await _request(
      '/v1/couriers/me/location',
      'POST',
      body: <String, dynamic>{
        'longitude': longitude,
        'latitude': latitude,
        if (accuracyM != null) 'accuracyM': accuracyM.round(),
      },
    );
    return true;
  }

  Future<String> acceptOffer(String offerId, String idempotencyKey) async {
    final res = await _request(
      '/v1/offers/$offerId/accept',
      'POST',
      body: <String, dynamic>{},
      extraHeaders: <String, String>{'idempotency-key': idempotencyKey},
    );
    return res['status'] as String? ?? 'ACCEPTED';
  }

  Future<String> declineOffer(String offerId) async {
    final res = await _request(
      '/v1/offers/$offerId/decline',
      'POST',
      body: <String, dynamic>{},
    );
    return res['status'] as String? ?? 'DECLINED';
  }

  Future<String> advanceStep(String orderId, String action) async {
    final res = await _request(
      '/v1/orders/$orderId/$action',
      'POST',
      body: <String, dynamic>{},
    );
    return res['status'] as String? ?? '';
  }

  Future<String> submitPickupPin(String orderId, String pin) async {
    final res = await _request(
      '/v1/orders/$orderId/pickup-pin',
      'POST',
      body: <String, dynamic>{'pin': pin},
    );
    return res['status'] as String? ?? '';
  }

  Future<String> submitDeliveryPin(String orderId, String pin) async {
    final res = await _request(
      '/v1/orders/$orderId/delivery-pin',
      'POST',
      body: <String, dynamic>{'pin': pin},
    );
    return res['status'] as String? ?? '';
  }
}
