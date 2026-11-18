"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bike, Store, UtensilsCrossed } from "lucide-react";

export function RoleSelector() {
  const [modo, setModo] = useState<"login" | "registro">("login");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("modo");
      if (param === "registro") {
        setModo("registro");
      } else {
        setModo("login");
      }
    }
  }, []);

  const isRegister = modo === "registro";

  return (
    <div className="dg-stack">
      <div className="dg-card">
        <span className="dg-badge" style={{ marginBottom: "8px" }}>
          {isRegister ? "Crear cuenta · Tocancipá" : "Iniciar sesión · Tocancipá"}
        </span>
        <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(1.4rem, 3vw, 1.9rem)" }}>
          {isRegister ? "Elige tu rol para crear tu cuenta" : "Elige tu rol para ingresar"}
        </h1>
        <p className="dg-muted" style={{ margin: 0 }}>
          Cada rol tiene su propio panel y herramientas en DOMIGOO. Selecciona cómo deseas entrar.
        </p>
      </div>

      <div className="dg-role-selector-grid">
        <Link
          href={`/cliente?modo=${modo}`}
          className="dg-role-choice-card"
          data-testid="select-role-cliente"
        >
          <span className="dg-role-choice-icon" aria-hidden="true">
            <UtensilsCrossed size={24} />
          </span>
          <h2 className="dg-role-choice-title">Soy Cliente</h2>
          <p className="dg-role-choice-desc">
            Sigue tus pedidos en vivo, calcula tarifas de domicilio y prepara tus próximas órdenes.
          </p>
          <span className="dg-role-choice-cta">
            {isRegister ? "Registrarme como Cliente →" : "Ingresar como Cliente →"}
          </span>
        </Link>

        <Link
          href={`/restaurante?modo=${modo}`}
          className="dg-role-choice-card"
          data-testid="select-role-restaurante"
        >
          <span className="dg-role-choice-icon" aria-hidden="true">
            <Store size={24} />
          </span>
          <h2 className="dg-role-choice-title">Soy Restaurante</h2>
          <p className="dg-role-choice-desc">
            Configura tu sucursal, cotiza envíos, publica domicilios y haz seguimiento en tiempo
            real.
          </p>
          <span className="dg-role-choice-cta">
            {isRegister ? "Registrar restaurante →" : "Ingresar como Restaurante →"}
          </span>
        </Link>

        <Link
          href={`/domiciliario?modo=${modo}`}
          className="dg-role-choice-card"
          data-testid="select-role-domiciliario"
        >
          <span className="dg-role-choice-icon" aria-hidden="true">
            <Bike size={24} />
          </span>
          <h2 className="dg-role-choice-title">Soy Domiciliario</h2>
          <p className="dg-role-choice-desc">
            Completa tu perfil, activa tu disponibilidad, comparte ubicación y gestiona tus
            entregas.
          </p>
          <span className="dg-role-choice-cta">
            {isRegister ? "Registrarme como Domiciliario →" : "Ingresar como Domiciliario →"}
          </span>
        </Link>
      </div>
    </div>
  );
}
