import { BRAND_COLORS, BRAND_IDENTITY, BRAND_RADII } from "@domigoo/brand";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  Button,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { CourierApiClient } from "./api/client.js";
import {
  initialCourierState,
  nextScreenAfterLogin,
  sanitizeOfferForDisplay,
  sanitizeOrderForDisplay,
  screenForOrderStatus,
  type CourierMachineState,
} from "./state/courier-machine.js";

const envApiUrl = (process.env as Record<string, string | undefined>)["EXPO_PUBLIC_API_URL"];
const API_URL =
  typeof envApiUrl === "string" && envApiUrl.length > 0 ? envApiUrl : "http://127.0.0.1:3001";

export default function App() {
  const [client] = useState(() => new CourierApiClient(API_URL));
  const [state, setState] = useState<CourierMachineState>(initialCourierState);
  const [showHome, setShowHome] = useState(true);
  const [homeNotice, setHomeNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pinDigits, setPinDigits] = useState("");
  const [geoConsentBox, setGeoConsentBox] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function onLogin() {
    setFeedback("");
    try {
      await client.login(phone, password);
      setState((prev) => ({
        ...prev,
        screen: prev.hasGeolocationConsent
          ? nextScreenAfterLogin(prev.hasProfile)
          : "GEOLOCATION_CONSENT",
      }));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    }
  }

  async function onAllowGeolocation() {
    setFeedback("");
    if (!geoConsentBox) {
      setFeedback("Debes marcar la autorización de ubicación antes de permitirla.");
      return;
    }
    try {
      const { consentId } = await client.grantGeolocationConsent();
      setState((prev) => ({
        ...prev,
        hasGeolocationConsent: true,
        geolocationConsentId: consentId,
        screen: nextScreenAfterLogin(prev.hasProfile),
      }));
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "No se pudo registrar el consentimiento de ubicación",
      );
    }
  }

  function onDeclineGeolocation() {
    setGeoConsentBox(false);
    setState((prev) => ({
      ...prev,
      hasGeolocationConsent: false,
      available: false,
      screen: "AVAILABILITY",
    }));
    setFeedback(
      "Permiso de ubicación omitido. Puedes usar tu cuenta, pero sin activar turnos ni recibir entregas.",
    );
  }

  async function onRevokeGeolocation() {
    setFeedback("");
    try {
      if (state.geolocationConsentId) {
        await client.revokeGeolocationConsent(state.geolocationConsentId);
      }
      if (state.available) {
        await client.setAvailability("OFFLINE").catch(() => undefined);
      }
      setGeoConsentBox(false);
      setState((prev) => ({
        ...prev,
        hasGeolocationConsent: false,
        geolocationConsentId: null,
        available: false,
      }));
      setFeedback(
        "Ubicación desactivada. DOMIGOO dejó de recibir la ubicación de este dispositivo. Los datos ya recogidos se conservarán solo durante los plazos de la Política de Tratamiento de Datos.",
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "No se pudo revocar la ubicación");
    }
  }

  async function onToggleAvailable(next: boolean) {
    setFeedback("");
    if (next && !state.hasGeolocationConsent) {
      setState((prev) => ({ ...prev, screen: "GEOLOCATION_CONSENT" }));
      return;
    }
    try {
      await client.setAvailability(next ? "AVAILABLE" : "OFFLINE");
      setState((prev) => ({ ...prev, available: next }));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "No se pudo cambiar la disponibilidad");
    }
  }

  async function onSubmitPin(kind: "pickup" | "delivery") {
    if (!state.order) return;
    const submitted = pinDigits;
    setPinDigits("");
    setFeedback("");
    try {
      const res =
        kind === "pickup"
          ? await client.submitPickupPin(state.order.id, submitted)
          : await client.submitDeliveryPin(state.order.id, submitted);
      const nextStatus = res.status as NonNullable<CourierMachineState["order"]>["status"];
      setState((prev) => ({
        ...prev,
        order: prev.order ? { ...prev.order, status: nextStatus } : null,
        screen: screenForOrderStatus(nextStatus),
      }));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "PIN inválido");
    }
  }

  const displayOffer = state.offer ? sanitizeOfferForDisplay(state.offer) : null;
  const displayOrder = state.order ? sanitizeOrderForDisplay(state.order) : null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor={BRAND_COLORS.indigo} />
      <View style={styles.header}>
        <Text style={styles.wordmark}>
          <Text style={styles.wordmarkDomi}>DOMI</Text>
          <Text style={styles.wordmarkGoo}>GOO</Text>
        </Text>
        <Text style={styles.slogan}>{BRAND_IDENTITY.slogan}</Text>
        <Text style={styles.cityBadge}>{BRAND_IDENTITY.city}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {state.available && state.hasGeolocationConsent ? (
          <Text style={styles.locationBadge}>Compartiendo ubicación en vivo</Text>
        ) : null}
        {feedback ? <Text style={styles.error}>{feedback}</Text> : null}

        {state.screen === "LOGIN" && showHome ? (
          <View style={styles.homeWrapper}>
            <View style={styles.homeCardsRow}>
              <Pressable
                style={styles.homeCard}
                accessibilityRole="button"
                accessibilityLabel="Pedir comida"
                onPress={() => {
                  setHomeNotice(
                    "El catálogo de restaurantes está en preparación. Consulta tarifas y tu cuenta desde domigoo-web.vercel.app.",
                  );
                }}
              >
                <Text style={styles.homeCardBadge}>🍽</Text>
                <Text style={styles.homeCardTitle}>Pedir comida</Text>
              </Pressable>

              <Pressable
                style={styles.homeCard}
                accessibilityRole="button"
                accessibilityLabel="Seguir pedido"
                onPress={() => {
                  setHomeNotice(
                    "Para seguir un pedido con tu enlace o token público, abre domigoo-web.vercel.app/tracking/tu-codigo.",
                  );
                }}
              >
                <Text style={styles.homeCardBadge}>📍</Text>
                <Text style={styles.homeCardTitle}>Seguir pedido</Text>
              </Pressable>

              <Pressable
                style={styles.homeCard}
                accessibilityRole="button"
                accessibilityLabel="Soy domiciliario"
                onPress={() => {
                  setHomeNotice("");
                  setShowHome(false);
                }}
              >
                <Text style={styles.homeCardBadge}>🛵</Text>
                <Text style={styles.homeCardTitle}>Soy domiciliario</Text>
              </Pressable>
            </View>

            {homeNotice ? <Text style={styles.noticeBox}>{homeNotice}</Text> : null}

            <Pressable
              style={styles.pillButton}
              accessibilityRole="button"
              accessibilityLabel="Iniciar sesión"
              onPress={() => {
                setHomeNotice("");
                setShowHome(false);
              }}
            >
              <Text style={styles.pillButtonText}>Iniciar sesión</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryLink}
              accessibilityRole="button"
              accessibilityLabel="Crear cuenta"
              onPress={() => {
                setHomeNotice(
                  "Regístrate como cliente, restaurante o domiciliario en domigoo-web.vercel.app y luego ingresa aquí.",
                );
              }}
            >
              <Text style={styles.secondaryLinkText}>Crear cuenta</Text>
            </Pressable>
          </View>
        ) : null}

        {state.screen === "LOGIN" && !showHome ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ingreso de domiciliarios</Text>
            <TextInput
              placeholder="Correo o teléfono (+57...)"
              placeholderTextColor={BRAND_COLORS.textMuted}
              value={phone}
              onChangeText={setPhone}
              style={styles.input}
            />
            <TextInput
              placeholder="Contraseña"
              placeholderTextColor={BRAND_COLORS.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={styles.input}
            />
            <Pressable style={styles.primaryButton} onPress={() => void onLogin()}>
              <Text style={styles.primaryButtonText}>Entrar</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryLink}
              onPress={() => {
                setShowHome(true);
              }}
            >
              <Text style={styles.secondaryLinkText}>Volver al inicio</Text>
            </Pressable>
          </View>
        ) : null}

        {state.screen === "GEOLOCATION_CONSENT" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Compartir tu ubicación con DOMIGOO</Text>
            <Text style={styles.bodyText}>
              Para recibir y realizar entregas necesitamos conocer tu ubicación en tiempo real solo
              mientras tengas el turno activado o una entrega en curso. Cuando terminas el turno,
              dejamos de recibir tu ubicación.
            </Text>
            <Text style={styles.bodyText}>
              Este permiso es voluntario y puedes retirarlo cuando quieras en Configuración →
              Privacidad → Ubicación o en los ajustes de tu teléfono.
            </Text>
            <View style={styles.switchRow}>
              <Switch
                value={geoConsentBox}
                onValueChange={setGeoConsentBox}
                trackColor={{ false: BRAND_COLORS.silver, true: BRAND_COLORS.turquoise }}
                thumbColor={BRAND_COLORS.indigo}
              />
              <Text style={styles.switchLabel}>
                Autorizo de forma expresa a DOMIGOO a recolectar y tratar mi ubicación en tiempo
                real en los términos anteriores.
              </Text>
            </View>
            <View style={styles.buttonRow}>
              <Button
                title="Permitir"
                color={BRAND_COLORS.indigo}
                onPress={() => void onAllowGeolocation()}
              />
              <Button
                title="Ahora no"
                color={BRAND_COLORS.textMuted}
                onPress={onDeclineGeolocation}
              />
            </View>
          </View>
        ) : null}

        {state.screen === "AVAILABILITY" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              Estado: {state.available ? "Disponible" : "Desconectado"}
            </Text>
            <Button
              title={state.available ? "Pasar a desconectado" : "Pasar a disponible"}
              color={BRAND_COLORS.indigo}
              onPress={() => void onToggleAvailable(!state.available)}
            />
            <View style={styles.privacySection}>
              <Text style={styles.sectionTitle}>Configuración → Privacidad → Ubicación</Text>
              {state.hasGeolocationConsent ? (
                <Button
                  title="Revocar ubicación"
                  color={BRAND_COLORS.errorText}
                  onPress={() => void onRevokeGeolocation()}
                />
              ) : (
                <Button
                  title="Activar consentimiento de ubicación"
                  color={BRAND_COLORS.indigo}
                  onPress={() => {
                    setState((prev) => ({ ...prev, screen: "GEOLOCATION_CONSENT" }));
                  }}
                />
              )}
            </View>
          </View>
        ) : null}

        {state.screen === "OFFER" && displayOffer ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Nueva oferta de domicilio</Text>
            <Text style={styles.bodyText}>Recoger en: {displayOffer.pickupAddress}</Text>
            <Text style={styles.bodyText}>Entregar en: {displayOffer.dropoffAddress}</Text>
            <Text style={styles.bodyText}>Domicilio: ${displayOffer.deliveryFeeCop} COP</Text>
            {displayOffer.customerPhone ? (
              <Text style={styles.bodyText}>Teléfono cliente: {displayOffer.customerPhone}</Text>
            ) : null}
          </View>
        ) : null}

        {state.screen === "JOURNEY" && displayOrder ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Pedido en curso</Text>
            <Text style={styles.bodyText}>Estado: {displayOrder.status}</Text>
          </View>
        ) : null}

        {state.screen === "PIN_PICKUP" || state.screen === "PIN_DELIVERY" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {state.screen === "PIN_PICKUP"
                ? "Ingresa el PIN de recogida"
                : "Ingresa el PIN de entrega"}
            </Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={6}
              value={pinDigits}
              onChangeText={setPinDigits}
              placeholder="0000"
              placeholderTextColor={BRAND_COLORS.textMuted}
              style={styles.input}
            />
            <Button
              title="Validar PIN"
              color={BRAND_COLORS.indigo}
              onPress={() =>
                void onSubmitPin(state.screen === "PIN_PICKUP" ? "pickup" : "delivery")
              }
            />
          </View>
        ) : null}

        {state.screen === "DONE" ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Entrega completada</Text>
            <Text style={styles.bodyText}>Pedido entregado correctamente.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND_COLORS.white,
  },
  header: {
    backgroundColor: BRAND_COLORS.indigo,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: BRAND_COLORS.turquoise,
  },
  wordmark: {
    fontSize: 26,
    fontWeight: "800",
    fontStyle: "italic",
    letterSpacing: -0.5,
  },
  wordmarkDomi: {
    color: BRAND_COLORS.white,
  },
  wordmarkGoo: {
    color: BRAND_COLORS.turquoise,
  },
  slogan: {
    color: BRAND_COLORS.silver,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.4,
    marginTop: 2,
  },
  cityBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: BRAND_RADII.pill,
    borderWidth: 1,
    borderColor: BRAND_COLORS.turquoise,
    color: BRAND_COLORS.turquoise,
    fontSize: 11,
    fontWeight: "700",
  },
  content: {
    padding: 20,
    gap: 14,
  },
  homeWrapper: {
    gap: 16,
    alignItems: "center",
  },
  homeCardsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  homeCard: {
    flex: 1,
    backgroundColor: BRAND_COLORS.surface,
    borderRadius: BRAND_RADII.md,
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
    paddingVertical: 16,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 108,
  },
  homeCardBadge: {
    fontSize: 22,
  },
  homeCardTitle: {
    color: BRAND_COLORS.indigo,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  noticeBox: {
    width: "100%",
    backgroundColor: "#E9F8F7",
    borderColor: BRAND_COLORS.turquoise,
    borderWidth: 1,
    borderRadius: BRAND_RADII.sm,
    padding: 12,
    color: BRAND_COLORS.indigo,
    fontSize: 13,
  },
  pillButton: {
    width: "100%",
    minHeight: 52,
    borderRadius: BRAND_RADII.pill,
    backgroundColor: BRAND_COLORS.indigo,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pillButtonText: {
    color: BRAND_COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: BRAND_RADII.sm,
    backgroundColor: BRAND_COLORS.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: BRAND_COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryLink: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryLinkText: {
    color: BRAND_COLORS.indigo,
    fontSize: 15,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: BRAND_COLORS.indigo,
  },
  bodyText: {
    color: BRAND_COLORS.textPrimary,
    fontSize: 14,
  },
  locationBadge: {
    backgroundColor: BRAND_COLORS.successBg,
    color: BRAND_COLORS.successText,
    padding: 10,
    borderRadius: BRAND_RADII.sm,
    fontWeight: "600",
  },
  card: {
    backgroundColor: BRAND_COLORS.surface,
    borderWidth: 1,
    borderColor: BRAND_COLORS.border,
    padding: 16,
    borderRadius: BRAND_RADII.md,
    gap: 12,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: BRAND_COLORS.borderStrong,
    borderRadius: BRAND_RADII.sm,
    paddingHorizontal: 12,
    color: BRAND_COLORS.indigo,
    backgroundColor: BRAND_COLORS.surface,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  switchLabel: {
    flex: 1,
    color: BRAND_COLORS.textPrimary,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  privacySection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BRAND_COLORS.border,
    gap: 8,
  },
  error: {
    backgroundColor: BRAND_COLORS.errorBg,
    color: BRAND_COLORS.errorText,
    padding: 10,
    borderRadius: BRAND_RADII.sm,
    fontWeight: "600",
  },
});
