import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { CourierApiClient } from "./api/client.js";
import {
  initialCourierState,
  nextScreenAfterLogin,
  sanitizeOfferForDisplay,
  sanitizeOrderForDisplay,
  screenForOrderStatus,
  type CourierMachineState,
} from "./state/courier-machine.js";

const API_URL = process.env["EXPO_PUBLIC_API_URL"] ?? "http://127.0.0.1:3001";

export default function App() {
  const [client] = useState(() => new CourierApiClient(API_URL));
  const [state, setState] = useState<CourierMachineState>(initialCourierState);
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
      <StatusBar style="auto" />
      <Text style={styles.title}>DOMIGOO — Domiciliarios</Text>
      {state.available && state.hasGeolocationConsent ? (
        <Text style={styles.locationBadge}>Compartiendo ubicación</Text>
      ) : null}
      {feedback ? <Text style={styles.error}>{feedback}</Text> : null}

      {state.screen === "LOGIN" ? (
        <View style={styles.card}>
          <TextInput
            placeholder="Correo o teléfono (+57...)"
            value={phone}
            onChangeText={setPhone}
            style={styles.input}
          />
          <TextInput
            placeholder="Contraseña"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          <Button title="Entrar" onPress={() => void onLogin()} />
        </View>
      ) : null}

      {state.screen === "GEOLOCATION_CONSENT" ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Compartir tu ubicación con DOMIGOO</Text>
          <Text>
            Para recibir y realizar entregas necesitamos conocer tu ubicación en tiempo real solo
            mientras tengas el turno activado o una entrega en curso. Cuando terminas el turno,
            dejamos de recibir tu ubicación.
          </Text>
          <Text>
            Este permiso es voluntario y puedes retirarlo cuando quieras en Configuración →
            Privacidad → Ubicación o en los ajustes de tu teléfono.
          </Text>
          <View style={styles.switchRow}>
            <Switch value={geoConsentBox} onValueChange={setGeoConsentBox} />
            <Text style={styles.switchLabel}>
              Autorizo de forma expresa a DOMIGOO a recolectar y tratar mi ubicación en tiempo real
              en los términos anteriores.
            </Text>
          </View>
          <View style={styles.buttonRow}>
            <Button title="Permitir" onPress={() => void onAllowGeolocation()} />
            <Button title="Ahora no" onPress={onDeclineGeolocation} />
          </View>
        </View>
      ) : null}

      {state.screen === "AVAILABILITY" ? (
        <View style={styles.card}>
          <Text>Estado: {state.available ? "Disponible" : "Desconectado"}</Text>
          <Button
            title={state.available ? "Pasar a desconectado" : "Pasar a disponible"}
            onPress={() => void onToggleAvailable(!state.available)}
          />
          <View style={styles.privacySection}>
            <Text style={styles.sectionTitle}>Configuración → Privacidad → Ubicación</Text>
            {state.hasGeolocationConsent ? (
              <Button title="Revocar ubicación" onPress={() => void onRevokeGeolocation()} />
            ) : (
              <Button
                title="Activar consentimiento de ubicación"
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
          <Text>Recoger en: {displayOffer.pickupAddress}</Text>
          <Text>Entregar en: {displayOffer.dropoffAddress}</Text>
          <Text>Domicilio: ${displayOffer.deliveryFeeCop} COP</Text>
          {displayOffer.customerPhone ? (
            <Text>Teléfono cliente: {displayOffer.customerPhone}</Text>
          ) : null}
        </View>
      ) : null}

      {state.screen === "JOURNEY" && displayOrder ? (
        <View style={styles.card}>
          <Text>Pedido en curso: {displayOrder.status}</Text>
        </View>
      ) : null}

      {state.screen === "PIN_PICKUP" || state.screen === "PIN_DELIVERY" ? (
        <View style={styles.card}>
          <Text>
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
            style={styles.input}
          />
          <Button
            title="Validar PIN"
            onPress={() => void onSubmitPin(state.screen === "PIN_PICKUP" ? "pickup" : "delivery")}
          />
        </View>
      ) : null}

      {state.screen === "DONE" ? (
        <View style={styles.card}>
          <Text>Pedido entregado correctamente.</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  locationBadge: {
    backgroundColor: "#dcfce7",
    color: "#166534",
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 10,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    padding: 10,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  switchLabel: {
    flex: 1,
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
    borderTopColor: "#e2e8f0",
    gap: 8,
  },
  error: {
    color: "#dc2626",
    marginBottom: 12,
  },
});
