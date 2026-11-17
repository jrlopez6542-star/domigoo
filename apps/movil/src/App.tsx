import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
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
  const [feedback, setFeedback] = useState("");

  async function onLogin() {
    setFeedback("");
    try {
      await client.login(phone, password);
      setState((prev) => ({
        ...prev,
        screen: nextScreenAfterLogin(prev.hasProfile),
      }));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    }
  }

  async function onToggleAvailable(next: boolean) {
    setFeedback("");
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

      {state.screen === "AVAILABILITY" ? (
        <View style={styles.card}>
          <Text>Estado: {state.available ? "Disponible" : "Desconectado"}</Text>
          <Button
            title={state.available ? "Pasar a desconectado" : "Pasar a disponible"}
            onPress={() => void onToggleAvailable(!state.available)}
          />
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
  error: {
    color: "#dc2626",
    marginBottom: 12,
  },
});
