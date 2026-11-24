"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Gift, MapPin, ShoppingBag, Store, Users, UtensilsCrossed } from "lucide-react";
import { extractTrackingToken } from "@/lib/api-client";

function MotoIcon({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Ruedas gruesas de motocicleta */}
      <circle cx="5.5" cy="17" r="3" />
      <circle cx="18.5" cy="17" r="3" />
      {/* Caja de domicilio trasera */}
      <rect x="2.5" y="7" width="5.5" height="4.5" rx="1" />
      {/* Tanque, asiento y chasis de moto */}
      <path d="M5.5 14 L8 11.5 L12.5 11.5 C14.2 10 15.6 10.2 16.4 11.8 L18.5 17" />
      <path d="M8.5 14.5 H14.5 L16 11.5" />
      {/* Horquilla y manubrio */}
      <path d="M14.5 7.5 H17 L18.5 14" />
    </svg>
  );
}

export function HomeLanding({ appName }: { appName: string }) {
  const router = useRouter();
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackingInput, setTrackingInput] = useState("");
  const [trackingError, setTrackingError] = useState("");

  function handleTrackingSubmit(e: FormEvent) {
    e.preventDefault();
    setTrackingError("");
    const token = extractTrackingToken(trackingInput);
    if (!token) {
      setTrackingError("Ingresa el código o enlace de seguimiento de tu pedido.");
      return;
    }
    router.push(`/tracking/${encodeURIComponent(token)}`);
  }

  return (
    <div className="dg-home-shell">
      <section className="dg-home-top" aria-labelledby="home-hero-title">
        <div className="dg-home-top-inner">
          <span className="dg-home-city-pill">Tocancipá, Cundinamarca</span>
          <img
            src="/brand/domigoo-horizontal-dark.svg"
            alt={`${appName} — Tu ciudad a tu puerta`}
            className="dg-home-logo-hero"
            width={320}
            height={95}
          />
          <h1
            id="home-hero-title"
            style={{
              margin: "4px 0 0",
              fontSize: "clamp(1.15rem, 3.2vw, 1.45rem)",
              fontWeight: 700,
              color: "#F5F7FA",
            }}
          >
            Domicilios locales en un solo lugar
          </h1>
        </div>

        <svg
          className="dg-home-waves"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,26 C320,76 620,2 980,46 C1210,72 1350,36 1440,20 L1440,80 L0,80 Z"
            fill="#C0C6D4"
            fillOpacity="0.45"
          />
          <path
            d="M0,42 C360,84 740,12 1120,50 C1280,66 1380,44 1440,32 L1440,80 L0,80 Z"
            fill="#79D5D0"
          />
          <path d="M0,56 C420,90 860,26 1440,56 L1440,80 L0,80 Z" fill="#F5F7FA" />
        </svg>
      </section>

      <section className="dg-home-body" aria-label="Accesos principales">
        <div className="dg-home-cards">
          <Link
            href="/cliente"
            className="dg-home-card"
            data-testid="home-card-pedir"
            aria-label="Pedir comida"
          >
            <span className="dg-home-card-icon" aria-hidden="true">
              <UtensilsCrossed size={24} strokeWidth={2} />
            </span>
            <span className="dg-home-card-label">Pedir comida</span>
          </Link>

          <button
            type="button"
            className="dg-home-card"
            data-testid="home-card-seguir"
            aria-label="Seguir pedido"
            aria-expanded={trackingOpen}
            onClick={() => {
              setTrackingOpen((prev) => !prev);
              setTrackingError("");
            }}
          >
            <span className="dg-home-card-icon" aria-hidden="true">
              <MapPin size={24} strokeWidth={2} />
            </span>
            <span className="dg-home-card-label">Seguir pedido</span>
          </button>

          <Link
            href="/domiciliario"
            className="dg-home-card"
            data-testid="home-card-domiciliario"
            aria-label="Soy domiciliario"
          >
            <span className="dg-home-card-icon" aria-hidden="true">
              <MotoIcon size={24} strokeWidth={2} />
            </span>
            <span className="dg-home-card-label">Soy domiciliario</span>
          </Link>
        </div>

        {trackingOpen ? (
          <form
            className="dg-home-tracking-drawer dg-stack"
            onSubmit={handleTrackingSubmit}
            data-testid="home-tracking-form"
          >
            <label className="dg-field">
              Código o enlace de seguimiento
              <input
                className="dg-input"
                type="text"
                value={trackingInput}
                onChange={(e) => {
                  setTrackingInput(e.target.value);
                }}
                placeholder="Ej: trk_... o https://.../tracking/..."
                aria-label="Código o enlace de seguimiento"
              />
            </label>
            {trackingError ? (
              <div className="dg-alert dg-alert--error" role="alert" style={{ marginBottom: 0 }}>
                {trackingError}
              </div>
            ) : null}
            <div className="dg-btn-row">
              <button type="submit" className="dg-btn" style={{ flex: 1 }}>
                Consultar estado
              </button>
              <Link href="/cliente/seguir" className="dg-btn dg-btn--secondary">
                Ir al portal cliente
              </Link>
            </div>
          </form>
        ) : null}

        <Link href="/acceso?modo=login" className="dg-home-pill-btn" data-testid="home-btn-login">
          Iniciar sesión
        </Link>

        <Link
          href="/acceso?modo=registro"
          className="dg-home-create-link"
          data-testid="home-link-register"
        >
          Crear cuenta
        </Link>

        <p className="dg-home-restaurant-note">
          ¿Tienes restaurante?{" "}
          <Link href="/restaurante" data-testid="home-link-restaurante">
            Regístralo aquí
          </Link>
        </p>

        <div className="dg-ecosystem-strip" aria-label="Ecosistema DOMIGOO">
          <div className="dg-ecosystem-grid">
            <Link href="/restaurante" className="dg-ecosystem-item">
              <Store size={20} strokeWidth={1.9} aria-hidden="true" />
              <span>Restaurantes</span>
            </Link>
            <Link href="/cliente" className="dg-ecosystem-item">
              <Users size={20} strokeWidth={1.9} aria-hidden="true" />
              <span>Clientes</span>
            </Link>
            <Link href="/domiciliario" className="dg-ecosystem-item">
              <MotoIcon size={20} strokeWidth={1.9} />
              <span>Domiciliarios</span>
            </Link>
            <Link href="/cliente" className="dg-ecosystem-item">
              <ShoppingBag size={20} strokeWidth={1.9} aria-hidden="true" />
              <span>Pedidos</span>
            </Link>
            <Link href="/cliente/seguir" className="dg-ecosystem-item">
              <MapPin size={20} strokeWidth={1.9} aria-hidden="true" />
              <span>Seguimiento</span>
            </Link>
            <div className="dg-ecosystem-item" aria-label="Promociones próximamente">
              <Gift size={20} strokeWidth={1.9} aria-hidden="true" />
              <span>Promociones</span>
              <span className="dg-ecosystem-soon">Próximamente</span>
            </div>
          </div>
        </div>
      </section>

      <div className="dg-home-skyline" aria-hidden="true">
        <svg viewBox="0 0 1200 160" preserveAspectRatio="none">
          <defs>
            <linearGradient id="tocancipa-hills" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#79D5D0" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#79D5D0" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#C0C6D4" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          <path
            d="M0,120 Q180,68 380,104 T760,88 T1200,110 L1200,160 L0,160 Z"
            fill="url(#tocancipa-hills)"
          />
          <path
            d="M0,136 L75,136 L75,108 L120,108 L120,136 L150,136 L150,96 L195,96 L195,136 L250,136 L250,116 L295,116 L295,136 L520,136 L520,104 L558,104 L558,74 L578,42 L598,74 L598,104 L634,104 L634,136 L710,136 L710,112 L755,112 L755,136 L830,136 L830,98 L875,98 L875,136 L960,136 L960,114 L1010,114 L1010,136 L1200,136 L1200,160 L0,160 Z"
            fill="#29243E"
          />
          <rect x="572" y="84" width="12" height="18" rx="6" fill="#79D5D0" />
          <rect x="164" y="106" width="10" height="10" rx="2" fill="#79D5D0" fillOpacity="0.7" />
          <rect x="844" y="108" width="10" height="10" rx="2" fill="#79D5D0" fillOpacity="0.7" />
        </svg>
      </div>
    </div>
  );
}
