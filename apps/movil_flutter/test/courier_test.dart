import 'dart:convert';
import 'dart:io';

import 'package:domigoo_movil/api/courier_api_client.dart';
import 'package:domigoo_movil/main.dart';
import 'package:domigoo_movil/state/courier_machine.dart';
import 'package:flutter_test/flutter_test.dart';

class _MemorySessionStorage implements SessionStorage {
  final Map<String, String> _data = <String, String>{};

  @override
  Future<void> deleteAll() async => _data.clear();

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> write(String key, String value) async {
    _data[key] = value;
  }
}

void main() {
  group('App del domiciliario DOMIGOO Flutter (M48-FLUTTER)', () {
    test('AndroidManifest y pubspec declaran solo Android, permisos requeridos y sin SDK de pagos', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(
        RegExp(r'stripe|mercadopago|wompi|epayco|paypal', caseSensitive: false)
            .hasMatch(pubspec),
        isFalse,
      );
      expect(pubspec.contains('ios: false'), isTrue);

      final manifest =
          File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
      expect(manifest.contains('android:label="DOMIGOO"'), isTrue);
      expect(manifest.contains('android.permission.INTERNET'), isTrue);
      expect(
          manifest.contains('android.permission.ACCESS_FINE_LOCATION'), isTrue);
      expect(manifest.contains('android.permission.ACCESS_COARSE_LOCATION'),
          isTrue);

      final gradle = File('android/app/build.gradle.kts').readAsStringSync();
      expect(gradle.contains('applicationId = "com.domigoo.movil"'), isTrue);
    });

    test(
        'envía login con phoneE164/email, disponibilidad con state, ubicación con accuracyM y acceptOffer con header idempotency-key',
        () async {
      final calls = <({
        Uri uri,
        String method,
        Map<String, String> headers,
        String? body,
      })>[];

      final client = CourierApiClient(
        'http://127.0.0.1:3001',
        requestFn: (uri, {required method, required headers, body}) async {
          calls.add((uri: uri, method: method, headers: headers, body: body));
          return HttpJsonResponse(
            statusCode: 200,
            body: jsonEncode(<String, dynamic>{
              'token': 'tok-movil',
              'state': 'AVAILABLE',
              'status': 'ACCEPTED',
            }),
          );
        },
      );

      await client.login('+573001112233', 'ClaveSegura123');
      expect(jsonDecode(calls[0].body!), <String, dynamic>{
        'phoneE164': '+573001112233',
        'password': 'ClaveSegura123',
        'client': 'MOBILE',
      });

      await client.login('domi@ejemplo.com', 'ClaveSegura123');
      expect(jsonDecode(calls[1].body!), <String, dynamic>{
        'email': 'domi@ejemplo.com',
        'password': 'ClaveSegura123',
        'client': 'MOBILE',
      });

      await client.setAvailability('AVAILABLE');
      expect(jsonDecode(calls[2].body!), <String, dynamic>{
        'state': 'AVAILABLE',
      });

      await client.sendLocation(
        hasGeolocationConsent: true,
        longitude: -73.9132,
        latitude: 4.9655,
        accuracyM: 12.4,
      );
      expect(jsonDecode(calls[3].body!), <String, dynamic>{
        'longitude': -73.9132,
        'latitude': 4.9655,
        'accuracyM': 12,
      });

      await client.acceptOffer('off-1', 'idem-123');
      expect(calls[4].headers['idempotency-key'], 'idem-123');
      expect(calls[4].headers['authorization'], 'Bearer tok-movil');
    });

    test('propaga errores HTTP 4xx de la API', () async {
      final client = CourierApiClient(
        'http://127.0.0.1:3001',
        requestFn: (uri, {required method, required headers, body}) async {
          return HttpJsonResponse(
            statusCode: 422,
            body: jsonEncode(<String, dynamic>{
              'message': 'Hace falta el consentimiento de geolocalización',
            }),
          );
        },
      );

      expect(
        () => client.sendLocation(
          hasGeolocationConsent: true,
          longitude: -73.91,
          latitude: 4.96,
        ),
        throwsA(
          predicate<Object>(
            (e) => e
                .toString()
                .contains('Hace falta el consentimiento de geolocalización'),
          ),
        ),
      );
    });

    test('una oferta pendiente oculta el teléfono del cliente', () {
      final pending = sanitizeOfferForDisplay(
        const CourierOfferView(
          id: 'off-1',
          orderId: 'ord-1',
          status: 'PENDING',
          deliveryFeeCop: 6500,
          pickupAddress: 'Calle 10 # 20-30',
          dropoffAddress: 'Carrera 15 # 40-50',
          customerPhone: '+573001112233',
        ),
      );
      expect(pending.customerPhone, isNull);

      final accepted = sanitizeOfferForDisplay(
        const CourierOfferView(
          id: 'off-1',
          orderId: 'ord-1',
          status: 'ACCEPTED',
          deliveryFeeCop: 6500,
          pickupAddress: 'Calle 10 # 20-30',
          dropoffAddress: 'Carrera 15 # 40-50',
          customerPhone: '+573001112233',
        ),
      );
      expect(accepted.customerPhone, '+573001112233');
    });

    test('exige consentimiento de geolocalización antes de enviar la posición',
        () async {
      var called = false;
      final client = CourierApiClient(
        'http://127.0.0.1:3001',
        requestFn: (uri, {required method, required headers, body}) async {
          called = true;
          return const HttpJsonResponse(statusCode: 200, body: '{}');
        },
      );

      expect(
        () => client.sendLocation(
          hasGeolocationConsent: false,
          longitude: -74.08,
          latitude: 4.61,
        ),
        throwsA(
          predicate<Object>(
            (e) => e.toString().toLowerCase().contains('consentimiento'),
          ),
        ),
      );
      expect(called, isFalse);
    });

    test(
        'envía el PIN digitado al endpoint y nunca pinta PIN devuelto por el servidor ni lo registra en logs',
        () async {
      final calls = <({Uri uri, String? body})>[];
      final client = CourierApiClient(
        'http://127.0.0.1:3001',
        requestFn: (uri, {required method, required headers, body}) async {
          calls.add((uri: uri, body: body));
          return HttpJsonResponse(
            statusCode: 200,
            body: jsonEncode(<String, dynamic>{
              'status': 'PICKED_UP',
              'pickupPin': '9999',
            }),
          );
        },
      );

      await client.submitPickupPin('ord-1', '4821');
      expect(calls[0].uri.toString(),
          'http://127.0.0.1:3001/v1/orders/ord-1/pickup-pin');
      expect(jsonDecode(calls[0].body!), <String, dynamic>{'pin': '4821'});

      final view = sanitizeOrderForDisplay(
        const CourierOrderState(
          id: 'ord-1',
          status: 'PICKED_UP',
          customerPhone: '+573001112233',
        ),
      );
      expect(view.status, 'PICKED_UP');
      expect(view.customerPhone, '+573001112233');

      expect(nextScreenAfterLogin(false), ScreenName.profile);
      expect(nextScreenAfterLogin(true), ScreenName.availability);
      expect(screenForOrderStatus('AT_PICKUP'), ScreenName.pinPickup);
      expect(screenForOrderStatus('AT_DROPOFF'), ScreenName.pinDelivery);
      expect(screenForOrderStatus('DELIVERED'), ScreenName.done);

      final mainSource = File('lib/main.dart').readAsStringSync();
      expect(
        RegExp(r'(print|debugPrint)\s*\([^)]*pin', caseSensitive: false)
            .hasMatch(mainSource),
        isFalse,
      );
      expect(mainSource.contains('Compartir tu ubicación con DOMIGOO'), isTrue);
      expect(mainSource.contains('Compartiendo ubicación'), isTrue);
    });

    test(
        'registra domiciliario con consentimientos legales y permite otorgar y revocar geolocalización (M45)',
        () async {
      final calls = <({Uri uri, String method, String? body})>[];
      final client = CourierApiClient(
        'http://127.0.0.1:3001',
        requestFn: (uri, {required method, required headers, body}) async {
          calls.add((uri: uri, method: method, body: body));
          if (uri.path.endsWith('/v1/legal-documents/current')) {
            return HttpJsonResponse(
              statusCode: 200,
              body: jsonEncode(<String, dynamic>{
                'documents': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 'doc-geo-1',
                    'kind': 'GEOLOCATION_CONSENT',
                  },
                ],
              }),
            );
          }
          if (uri.path.endsWith('/v1/consents')) {
            return HttpJsonResponse(
              statusCode: 201,
              body: jsonEncode(<String, dynamic>{'id': 'con-geo-1'}),
            );
          }
          if (uri.path.endsWith('/v1/consents/con-geo-1/revoke')) {
            return HttpJsonResponse(
              statusCode: 200,
              body: jsonEncode(<String, dynamic>{'revoked': true}),
            );
          }
          return HttpJsonResponse(
            statusCode: 201,
            body: jsonEncode(<String, dynamic>{'token': 'tok-reg-1'}),
          );
        },
      );

      await client.registerCourier(
        identifier: '+573001112233',
        password: 'ClaveSegura123',
        consents: const RegisterConsentsInput(
          termsAccepted: true,
          privacyAccepted: true,
          sensitiveDataAccepted: true,
        ),
      );
      final regBody = jsonDecode(calls[0].body!) as Map<String, dynamic>;
      expect(regBody['phoneE164'], '+573001112233');
      expect(regBody['role'], 'COURIER');
      expect(regBody['consents'], <String, dynamic>{
        'termsAccepted': true,
        'privacyAccepted': true,
        'sensitiveDataAccepted': true,
      });

      final grantedId = await client.grantGeolocationConsent();
      expect(grantedId, 'con-geo-1');
      expect(jsonDecode(calls[2].body!), <String, dynamic>{
        'legalDocumentId': 'doc-geo-1',
        'purpose': 'GEOLOCATION',
        'channel': 'MOBILE',
      });

      final revoked = await client.revokeGeolocationConsent('con-geo-1');
      expect(revoked, isTrue);
    });

    testWidgets('renderiza pantallas principales y flujo de consentimiento/disponibilidad',
        (tester) async {
      final storage = _MemorySessionStorage();
      final client = CourierApiClient(
        'http://127.0.0.1:3001',
        requestFn: (uri, {required method, required headers, body}) async {
          return const HttpJsonResponse(statusCode: 200, body: '{}');
        },
      );

      await tester.pumpWidget(
        DomigooApp(
          apiClient: client,
          sessionStorage: storage,
          positionFetcher: () async => null,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('TU CIUDAD A TU PUERTA'), findsOneWidget);
      expect(find.text('Soy domiciliario'), findsOneWidget);
      await tester.tap(find.text('Soy domiciliario'));
      await tester.pumpAndSettle();

      expect(find.text('Ingreso de domiciliarios'), findsOneWidget);
      expect(find.text('Entrar'), findsOneWidget);
    });
  });
}
