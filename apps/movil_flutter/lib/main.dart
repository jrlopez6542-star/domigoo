import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';

import 'api/courier_api_client.dart';
import 'state/courier_machine.dart';
import 'theme/futuro_urbano_theme.dart';

const String kDefaultApiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://domigoo.vercel.app',
);

abstract class SessionStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> deleteAll();
}

class SecureSessionStorage implements SessionStorage {
  SecureSessionStorage([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> deleteAll() => _storage.deleteAll();
}

typedef PositionFetcher = Future<({double latitude, double longitude, double? accuracyM})?> Function();

Future<({double latitude, double longitude, double? accuracyM})?> defaultPositionFetcher() async {
  try {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return null;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return null;
    }
    final pos = await Geolocator.getCurrentPosition();
    return (
      latitude: pos.latitude,
      longitude: pos.longitude,
      accuracyM: pos.accuracy,
    );
  } catch (_) {
    return null;
  }
}

void main() {
  runApp(const DomigooApp());
}

class DomigooApp extends StatelessWidget {
  const DomigooApp({
    super.key,
    this.apiClient,
    this.sessionStorage,
    this.positionFetcher,
    this.initialState,
    this.initialShowHome = true,
  });

  final CourierApiClient? apiClient;
  final SessionStorage? sessionStorage;
  final PositionFetcher? positionFetcher;
  final CourierMachineState? initialState;
  final bool initialShowHome;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: BrandIdentity.name,
      debugShowCheckedModeBanner: false,
      theme: buildFuturoUrbanoTheme(),
      home: CourierHomePage(
        apiClient: apiClient ?? CourierApiClient(kDefaultApiUrl),
        sessionStorage: sessionStorage ?? SecureSessionStorage(),
        positionFetcher: positionFetcher ?? defaultPositionFetcher,
        initialState: initialState ?? CourierMachineState.initial(),
        initialShowHome: initialShowHome,
      ),
    );
  }
}

class CourierHomePage extends StatefulWidget {
  const CourierHomePage({
    super.key,
    required this.apiClient,
    required this.sessionStorage,
    required this.positionFetcher,
    required this.initialState,
    required this.initialShowHome,
  });

  final CourierApiClient apiClient;
  final SessionStorage sessionStorage;
  final PositionFetcher positionFetcher;
  final CourierMachineState initialState;
  final bool initialShowHome;

  @override
  State<CourierHomePage> createState() => _CourierHomePageState();
}

class _CourierHomePageState extends State<CourierHomePage> {
  static const String _kTokenKey = 'domigoo_token';
  static const String _kHasProfileKey = 'domigoo_has_profile';
  static const String _kGeoConsentKey = 'domigoo_geo_consent';
  static const String _kGeoConsentIdKey = 'domigoo_geo_consent_id';

  late CourierMachineState _state;
  late bool _showHome;
  bool _showRegister = false;
  String _homeNotice = '';
  String _feedback = '';
  bool _busy = false;
  bool _geoConsentBox = false;
  bool _termsAccepted = false;
  bool _privacyAccepted = false;
  bool _sensitiveAccepted = false;

  final _identifierController = TextEditingController();
  final _passwordController = TextEditingController();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _docTypeController = TextEditingController(text: 'CC');
  final _docNumberController = TextEditingController();
  final _pinController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _state = widget.initialState;
    _showHome = widget.initialShowHome;
    _restoreSession();
  }

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _docTypeController.dispose();
    _docNumberController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _restoreSession() async {
    try {
      final token = await widget.sessionStorage.read(_kTokenKey);
      if (token == null || token.isEmpty) return;
      final hasProfile = (await widget.sessionStorage.read(_kHasProfileKey)) == 'true';
      final hasGeo = (await widget.sessionStorage.read(_kGeoConsentKey)) == 'true';
      final geoId = await widget.sessionStorage.read(_kGeoConsentIdKey);
      widget.apiClient.setToken(token);
      if (!mounted) return;
      setState(() {
        _showHome = false;
        _state = _state.copyWith(
          hasProfile: hasProfile,
          hasGeolocationConsent: hasGeo,
          geolocationConsentId: geoId,
          screen: hasGeo
              ? nextScreenAfterLogin(hasProfile)
              : ScreenName.geolocationConsent,
        );
      });
    } catch (_) {
      // Ignorar errores de lectura de almacenamiento en arranque
    }
  }

  Future<void> _persistSession({String? token}) async {
    try {
      if (token != null) {
        await widget.sessionStorage.write(_kTokenKey, token);
      }
      await widget.sessionStorage.write(_kHasProfileKey, _state.hasProfile.toString());
      await widget.sessionStorage.write(
        _kGeoConsentKey,
        _state.hasGeolocationConsent.toString(),
      );
      if (_state.geolocationConsentId != null) {
        await widget.sessionStorage.write(
          _kGeoConsentIdKey,
          _state.geolocationConsentId!,
        );
      }
    } catch (_) {
      // No bloquear el flujo si el almacenamiento seguro falla en entorno de prueba
    }
  }

  Future<void> _onLogin() async {
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      final token = await widget.apiClient.login(
        _identifierController.text,
        _passwordController.text,
      );
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          screen: _state.hasGeolocationConsent
              ? nextScreenAfterLogin(_state.hasProfile)
              : ScreenName.geolocationConsent,
        );
      });
      await _persistSession(token: token);
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _feedback = err.toString();
      });
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _onRegister() async {
    if (!_termsAccepted || !_privacyAccepted || !_sensitiveAccepted) {
      setState(() {
        _feedback = 'Debes aceptar términos, privacidad y datos sensibles para registrarte.';
      });
      return;
    }
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      final token = await widget.apiClient.registerCourier(
        identifier: _identifierController.text,
        password: _passwordController.text,
        consents: RegisterConsentsInput(
          termsAccepted: _termsAccepted,
          privacyAccepted: _privacyAccepted,
          sensitiveDataAccepted: _sensitiveAccepted,
        ),
      );
      if (!mounted) return;
      setState(() {
        _showRegister = false;
        _state = _state.copyWith(screen: ScreenName.geolocationConsent);
      });
      await _persistSession(token: token);
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onCreateProfile() async {
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      await widget.apiClient.createProfile(
        firstName: _firstNameController.text.trim(),
        lastName: _lastNameController.text.trim(),
        documentType: _docTypeController.text.trim(),
        documentNumber: _docNumberController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          hasProfile: true,
          screen: ScreenName.availability,
        );
      });
      await _persistSession();
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onAllowGeolocation() async {
    setState(() => _feedback = '');
    if (!_geoConsentBox) {
      setState(() {
        _feedback = 'Debes marcar la autorización de ubicación antes de permitirla.';
      });
      return;
    }
    setState(() => _busy = true);
    try {
      final consentId = await widget.apiClient.grantGeolocationConsent();
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          hasGeolocationConsent: true,
          geolocationConsentId: consentId,
          screen: nextScreenAfterLogin(_state.hasProfile),
        );
      });
      await _persistSession();
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _onDeclineGeolocation() {
    setState(() {
      _geoConsentBox = false;
      _state = _state.copyWith(
        hasGeolocationConsent: false,
        available: false,
        screen: ScreenName.availability,
      );
      _feedback =
          'Permiso de ubicación omitido. Puedes usar tu cuenta, pero sin activar turnos ni recibir entregas.';
    });
  }

  Future<void> _onRevokeGeolocation() async {
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      if (_state.geolocationConsentId != null) {
        await widget.apiClient.revokeGeolocationConsent(_state.geolocationConsentId!);
      }
      if (_state.available) {
        await widget.apiClient.setAvailability('OFFLINE').catchError((_) => 'OFFLINE');
      }
      if (!mounted) return;
      setState(() {
        _geoConsentBox = false;
        _state = _state.copyWith(
          hasGeolocationConsent: false,
          clearGeolocationConsentId: true,
          available: false,
        );
        _feedback =
            'Ubicación desactivada. DOMIGOO dejó de recibir la ubicación de este dispositivo. Los datos ya recogidos se conservarán solo durante los plazos de la Política de Tratamiento de Datos.';
      });
      await _persistSession();
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onToggleAvailable(bool next) async {
    setState(() => _feedback = '');
    if (next && !_state.hasGeolocationConsent) {
      setState(() {
        _state = _state.copyWith(screen: ScreenName.geolocationConsent);
      });
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.apiClient.setAvailability(next ? 'AVAILABLE' : 'OFFLINE');
      if (next && _state.hasGeolocationConsent) {
        final pos = await widget.positionFetcher();
        if (pos != null) {
          await widget.apiClient.sendLocation(
            hasGeolocationConsent: _state.hasGeolocationConsent,
            longitude: pos.longitude,
            latitude: pos.latitude,
            accuracyM: pos.accuracyM,
          );
        }
      }
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(available: next);
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onAcceptOffer(CourierOfferView offer) async {
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      final idemKey = 'accept-${offer.id}-${DateTime.now().millisecondsSinceEpoch}';
      final nextStatus = await widget.apiClient.acceptOffer(offer.id, idemKey);
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          clearOffer: true,
          order: CourierOrderState(
            id: offer.orderId,
            status: nextStatus,
            customerPhone: offer.customerPhone,
            pickupAddress: offer.pickupAddress,
            dropoffAddress: offer.dropoffAddress,
          ),
          screen: screenForOrderStatus(nextStatus),
        );
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onDeclineOffer(CourierOfferView offer) async {
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      await widget.apiClient.declineOffer(offer.id);
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          clearOffer: true,
          screen: ScreenName.availability,
        );
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onAdvanceOrderStep(String action) async {
    final order = _state.order;
    if (order == null) return;
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      final nextStatus = await widget.apiClient.advanceStep(order.id, action);
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          order: order.copyWith(status: nextStatus),
          screen: screenForOrderStatus(nextStatus),
        );
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onSubmitPin({required bool isPickup}) async {
    final order = _state.order;
    if (order == null) return;
    final submitted = _pinController.text.trim();
    _pinController.clear();
    setState(() {
      _feedback = '';
      _busy = true;
    });
    try {
      final nextStatus = isPickup
          ? await widget.apiClient.submitPickupPin(order.id, submitted)
          : await widget.apiClient.submitDeliveryPin(order.id, submitted);
      if (!mounted) return;
      setState(() {
        _state = _state.copyWith(
          order: order.copyWith(status: nextStatus),
          screen: screenForOrderStatus(nextStatus),
        );
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _feedback = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _onLogout() async {
    widget.apiClient.setToken(null);
    await widget.sessionStorage.deleteAll().catchError((_) {});
    if (!mounted) return;
    setState(() {
      _showHome = true;
      _feedback = '';
      _geoConsentBox = false;
      _state = CourierMachineState.initial();
    });
  }

  @override
  Widget build(BuildContext context) {
    final displayOffer =
        _state.offer != null ? sanitizeOfferForDisplay(_state.offer!) : null;
    final displayOrder =
        _state.order != null ? sanitizeOrderForDisplay(_state.order!) : null;

    return Scaffold(
      backgroundColor: BrandColors.white,
      body: Column(
        children: [
          _buildHeader(context),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_state.available && _state.hasGeolocationConsent) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: BrandColors.successBg,
                        borderRadius: BorderRadius.circular(BrandRadii.sm),
                        border: Border.all(color: BrandColors.successBorder),
                      ),
                      child: const Text(
                        'Compartiendo ubicación en vivo',
                        style: TextStyle(
                          color: BrandColors.successText,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_feedback.isNotEmpty) ...[
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: BrandColors.errorBg,
                        borderRadius: BorderRadius.circular(BrandRadii.sm),
                        border: Border.all(color: BrandColors.errorBorder),
                      ),
                      child: Text(
                        _feedback,
                        style: const TextStyle(
                          color: BrandColors.errorText,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_state.screen == ScreenName.login && _showHome)
                    _buildHomeView(),
                  if (_state.screen == ScreenName.login && !_showHome)
                    _buildLoginOrRegisterCard(),
                  if (_state.screen == ScreenName.profile)
                    _buildProfileCard(),
                  if (_state.screen == ScreenName.geolocationConsent)
                    _buildGeolocationConsentCard(),
                  if (_state.screen == ScreenName.availability)
                    _buildAvailabilityCard(),
                  if (_state.screen == ScreenName.offer && displayOffer != null)
                    _buildOfferCard(displayOffer, _state.offer!),
                  if (_state.screen == ScreenName.journey && displayOrder != null)
                    _buildJourneyCard(displayOrder),
                  if (_state.screen == ScreenName.pinPickup ||
                      _state.screen == ScreenName.pinDelivery)
                    _buildPinCard(_state.screen == ScreenName.pinPickup),
                  if (_state.screen == ScreenName.done) _buildDoneCard(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: BrandColors.indigo,
        border: Border(
          bottom: BorderSide(color: BrandColors.turquoise, width: 2),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
          child: Column(
            children: [
              RichText(
                text: const TextSpan(
                  style: TextStyle(
                    fontFamily: 'Montserrat',
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    fontStyle: FontStyle.italic,
                    letterSpacing: -0.5,
                  ),
                  children: [
                    TextSpan(
                      text: 'DOMI',
                      style: TextStyle(color: BrandColors.white),
                    ),
                    TextSpan(
                      text: 'GOO',
                      style: TextStyle(color: BrandColors.turquoise),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                BrandIdentity.slogan,
                style: TextStyle(
                  fontFamily: 'Montserrat',
                  color: BrandColors.silver,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2.4,
                ),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(BrandRadii.pill),
                  border: Border.all(color: BrandColors.turquoise),
                ),
                child: const Text(
                  BrandIdentity.city,
                  style: TextStyle(
                    color: BrandColors.turquoise,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHomeView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _HomeRoleCard(
                icon: Icons.restaurant_menu_rounded,
                title: 'Pedir comida',
                onTap: () {
                  setState(() {
                    _homeNotice =
                        'Próximamente en app móvil. Consulta el catálogo en domigoo-web.vercel.app.';
                  });
                },
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _HomeRoleCard(
                icon: Icons.location_on_outlined,
                title: 'Seguir pedido',
                onTap: () {
                  setState(() {
                    _homeNotice =
                        'Próximamente en app móvil. Abre domigoo-web.vercel.app/tracking/tu-codigo.';
                  });
                },
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _HomeRoleCard(
                icon: Icons.two_wheeler_rounded,
                title: 'Soy domiciliario',
                onTap: () {
                  setState(() {
                    _homeNotice = '';
                    _showHome = false;
                    _showRegister = false;
                  });
                },
              ),
            ),
          ],
        ),
        if (_homeNotice.isNotEmpty) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: BrandColors.noticeBg,
              borderRadius: BorderRadius.circular(BrandRadii.sm),
              border: Border.all(color: BrandColors.turquoise),
            ),
            child: Text(
              _homeNotice,
              style: const TextStyle(
                color: BrandColors.indigo,
                fontSize: 13,
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        SizedBox(
          height: 52,
          child: ElevatedButton(
            style: ElevatedButton.styleFrom(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(BrandRadii.pill),
              ),
            ),
            onPressed: () {
              setState(() {
                _homeNotice = '';
                _showHome = false;
                _showRegister = false;
              });
            },
            child: const Text(
              'Iniciar sesión',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () {
            setState(() {
              _homeNotice = '';
              _showHome = false;
              _showRegister = true;
            });
          },
          child: const Text(
            'Crear cuenta',
            style: TextStyle(
              color: BrandColors.indigo,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildLoginOrRegisterCard() {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _showRegister
                ? 'Registro de domiciliarios'
                : 'Ingreso de domiciliarios',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _identifierController,
            decoration: const InputDecoration(
              hintText: 'Correo o teléfono (+57...)',
            ),
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _passwordController,
            obscureText: true,
            decoration: const InputDecoration(
              hintText: 'Contraseña',
            ),
          ),
          if (_showRegister) ...[
            const SizedBox(height: 12),
            CheckboxListTile(
              value: _termsAccepted,
              onChanged: (v) => setState(() => _termsAccepted = v ?? false),
              title: const Text('Acepto términos y condiciones',
                  style: TextStyle(fontSize: 13)),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
            ),
            CheckboxListTile(
              value: _privacyAccepted,
              onChanged: (v) => setState(() => _privacyAccepted = v ?? false),
              title: const Text('Acepto la política de privacidad',
                  style: TextStyle(fontSize: 13)),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
            ),
            CheckboxListTile(
              value: _sensitiveAccepted,
              onChanged: (v) => setState(() => _sensitiveAccepted = v ?? false),
              title: const Text('Autorizo tratamiento de datos sensibles',
                  style: TextStyle(fontSize: 13)),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
            ),
          ],
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: _busy ? null : (_showRegister ? _onRegister : _onLogin),
            child: Text(_showRegister ? 'Registrarme' : 'Entrar'),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: () {
              setState(() {
                _feedback = '';
                _showRegister = !_showRegister;
              });
            },
            child: Text(
              _showRegister ? 'Ya tengo cuenta' : 'Crear cuenta de domiciliario',
              style: const TextStyle(color: BrandColors.turquoiseText),
            ),
          ),
          TextButton(
            onPressed: () {
              setState(() {
                _feedback = '';
                _showHome = true;
              });
            },
            child: const Text(
              'Volver al inicio',
              style: TextStyle(color: BrandColors.indigo),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProfileCard() {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Completa tu perfil de domiciliario',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _firstNameController,
            decoration: const InputDecoration(hintText: 'Nombres'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _lastNameController,
            decoration: const InputDecoration(hintText: 'Apellidos'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _docTypeController,
            decoration: const InputDecoration(hintText: 'Tipo documento (CC/CE)'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _docNumberController,
            decoration: const InputDecoration(hintText: 'Número de documento'),
          ),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: _busy ? null : _onCreateProfile,
            child: const Text('Guardar perfil'),
          ),
        ],
      ),
    );
  }

  Widget _buildGeolocationConsentCard() {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Compartir tu ubicación con DOMIGOO',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          const Text(
            'Para recibir y realizar entregas necesitamos conocer tu ubicación en tiempo real solo mientras tengas el turno activado o una entrega en curso. Cuando terminas el turno, dejamos de recibir tu ubicación.',
          ),
          const SizedBox(height: 8),
          const Text(
            'Este permiso es voluntario y puedes retirarlo cuando quieras en Configuración → Privacidad → Ubicación o en los ajustes de tu teléfono.',
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Switch(
                value: _geoConsentBox,
                activeColor: BrandColors.indigo,
                activeTrackColor: BrandColors.turquoise,
                onChanged: (value) => setState(() => _geoConsentBox = value),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Autorizo de forma expresa a DOMIGOO a recolectar y tratar mi ubicación en tiempo real en los términos anteriores.',
                  style: TextStyle(fontSize: 13),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: _busy ? null : _onAllowGeolocation,
                  child: const Text('Permitir'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    side: const BorderSide(color: BrandColors.borderStrong),
                  ),
                  onPressed: _busy ? null : _onDeclineGeolocation,
                  child: const Text(
                    'Ahora no',
                    style: TextStyle(color: BrandColors.textMuted),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildAvailabilityCard() {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Estado: ${_state.available ? 'Disponible' : 'Desconectado'}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed:
                _busy ? null : () => _onToggleAvailable(!_state.available),
            child: Text(
              _state.available
                  ? 'Pasar a desconectado'
                  : 'Pasar a disponible',
            ),
          ),
          const SizedBox(height: 16),
          const Divider(color: BrandColors.border),
          const SizedBox(height: 10),
          Text(
            'Configuración → Privacidad → Ubicación',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          if (_state.hasGeolocationConsent)
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: BrandColors.errorText,
              ),
              onPressed: _busy ? null : _onRevokeGeolocation,
              child: const Text('Revocar ubicación'),
            )
          else
            ElevatedButton(
              onPressed: _busy
                  ? null
                  : () {
                      setState(() {
                        _state = _state.copyWith(
                          screen: ScreenName.geolocationConsent,
                        );
                      });
                    },
              child: const Text('Activar consentimiento de ubicación'),
            ),
          const SizedBox(height: 16),
          const Divider(color: BrandColors.border),
          const SizedBox(height: 8),
          const ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.history, color: BrandColors.turquoiseText),
            title: Text('Historial de entregas'),
            trailing: Text(
              'Próximamente',
              style: TextStyle(
                color: BrandColors.turquoiseText,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.local_offer_outlined,
                color: BrandColors.turquoiseText),
            title: Text('Promociones y bonos'),
            trailing: Text(
              'Próximamente',
              style: TextStyle(
                color: BrandColors.turquoiseText,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _onLogout,
            child: const Text(
              'Cerrar sesión',
              style: TextStyle(color: BrandColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOfferCard(
    SanitizedOfferView displayOffer,
    CourierOfferView rawOffer,
  ) {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Nueva oferta de domicilio',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          Text('Recoger en: ${displayOffer.pickupAddress}'),
          const SizedBox(height: 4),
          Text('Entregar en: ${displayOffer.dropoffAddress}'),
          const SizedBox(height: 4),
          Text('Domicilio: \$${displayOffer.deliveryFeeCop} COP'),
          if (displayOffer.customerPhone != null) ...[
            const SizedBox(height: 4),
            Text('Teléfono cliente: ${displayOffer.customerPhone}'),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: _busy ? null : () => _onAcceptOffer(rawOffer),
                  child: const Text('Aceptar'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
                  onPressed: _busy ? null : () => _onDeclineOffer(rawOffer),
                  child: const Text('Rechazar'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildJourneyCard(SanitizedOrderView displayOrder) {
    String? nextAction;
    String nextLabel = '';
    if (displayOrder.status == 'ACCEPTED') {
      nextAction = 'arrive-pickup';
      nextLabel = 'Voy hacia el restaurante';
    } else if (displayOrder.status == 'ARRIVING_PICKUP') {
      nextAction = 'at-pickup';
      nextLabel = 'Llegué al restaurante';
    } else if (displayOrder.status == 'PICKED_UP') {
      nextAction = 'at-dropoff';
      nextLabel = 'Llegué donde el cliente';
    }

    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Pedido en curso', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 10),
          Text('Estado: ${displayOrder.status}'),
          if (displayOrder.pickupAddress != null) ...[
            const SizedBox(height: 4),
            Text('Recoger en: ${displayOrder.pickupAddress}'),
          ],
          if (displayOrder.dropoffAddress != null) ...[
            const SizedBox(height: 4),
            Text('Entregar en: ${displayOrder.dropoffAddress}'),
          ],
          if (displayOrder.customerPhone != null) ...[
            const SizedBox(height: 4),
            Text('Teléfono cliente: ${displayOrder.customerPhone}'),
          ],
          if (nextAction != null) ...[
            const SizedBox(height: 14),
            ElevatedButton(
              onPressed: _busy ? null : () => _onAdvanceOrderStep(nextAction!),
              child: Text(nextLabel),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPinCard(bool isPickup) {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            isPickup ? 'Ingresa el PIN de recogida' : 'Ingresa el PIN de entrega',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _pinController,
            keyboardType: TextInputType.number,
            maxLength: 6,
            decoration: const InputDecoration(
              hintText: '0000',
              counterText: '',
            ),
          ),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: _busy ? null : () => _onSubmitPin(isPickup: isPickup),
            child: const Text('Validar PIN'),
          ),
        ],
      ),
    );
  }

  Widget _buildDoneCard() {
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Entrega completada',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          const Text('Pedido entregado correctamente.'),
          const SizedBox(height: 14),
          ElevatedButton(
            onPressed: () {
              setState(() {
                _state = _state.copyWith(
                  clearOrder: true,
                  screen: ScreenName.availability,
                );
              });
            },
            child: const Text('Volver a disponibilidad'),
          ),
        ],
      ),
    );
  }
}

class _HomeRoleCard extends StatelessWidget {
  const _HomeRoleCard({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(BrandRadii.md),
      child: Container(
        constraints: const BoxConstraints(minHeight: 108),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 6),
        decoration: BoxDecoration(
          color: BrandColors.surface,
          borderRadius: BorderRadius.circular(BrandRadii.md),
          border: Border.all(color: BrandColors.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 28, color: BrandColors.turquoiseText),
            const SizedBox(height: 8),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: BrandColors.indigo,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: BrandColors.surface,
        borderRadius: BorderRadius.circular(BrandRadii.md),
        border: Border.all(color: BrandColors.border),
      ),
      child: child,
    );
  }
}
