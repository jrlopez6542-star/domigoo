"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MapPin, UtensilsCrossed } from "lucide-react";
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
      <circle cx="5.5" cy="17" r="3" />
      <circle cx="18.5" cy="17" r="3" />
      <rect x="2.5" y="7" width="5.5" height="4.5" rx="1" />
      <path d="M5.5 14 L8 11.5 L12.5 11.5 C14.2 10 15.6 10.2 16.4 11.8 L18.5 17" />
      <path d="M8.5 14.5 H14.5 L16 11.5" />
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
      setTrackingError("Ingresa el código o enlace de seguimiento de tu solicitud.");
      return;
    }
    router.push(`/tracking/${encodeURIComponent(token)}`);
  }

  return (
    <div className="dg-v2-shell">
      <main className="dg-v2-home-main" aria-labelledby="home-hero-title">
        <div className="dg-v2-logo-stack">
          <span className="dg-home-city-pill" style={{ marginBottom: 12 }}>
            Tocancipá, Cundinamarca
          </span>
          <img
            src="/brand/domigoo-horizontal-dark.svg"
            alt={`${appName} — Tu ciudad a tu puerta`}
            className="dg-v2-logo-img"
            width={260}
            height={78}
          />
          <h1
            id="home-hero-title"
            style={{
              margin: "8px 0 0",
              fontSize: "0.95rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#79D5D0",
            }}
          >
            Tu ciudad a tu puerta
          </h1>
        </div>

        <section className="dg-v2-action-list" aria-label="Accesos principales">
          <Link
            href="/cliente"
            className="dg-v2-action-card"
            data-testid="home-card-pedir"
            aria-label="Pedir comida"
          >
            <span className="dg-v2-action-icon" aria-hidden="true">
              <UtensilsCrossed size={24} strokeWidth={2} />
            </span>
            <span>
              <span className="dg-v2-action-title" style={{ display: "block" }}>
                Pedir comida
              </span>
              <span className="dg-v2-action-sub" style={{ display: "block" }}>
                Conectar con un restaurante
              </span>
            </span>
          </Link>

          <button
            type="button"
            className="dg-v2-action-card"
            data-testid="home-card-seguir"
            aria-label="Seguir solicitud"
            aria-expanded={trackingOpen}
            onClick={() => {
              setTrackingOpen((prev) => !prev);
              setTrackingError("");
            }}
          >
            <span className="dg-v2-action-icon" aria-hidden="true">
              <MapPin size={24} strokeWidth={2} />
            </span>
            <span>
              <span className="dg-v2-action-title" style={{ display: "block" }}>
                Seguir solicitud
              </span>
              <span className="dg-v2-action-sub" style={{ display: "block" }}>
                Consulta el estado
              </span>
            </span>
          </button>

          {trackingOpen ? (
            <form
              className="dg-home-tracking-drawer dg-stack"
              onSubmit={handleTrackingSubmit}
              data-testid="home-tracking-form"
              style={{ marginBottom: 0 }}
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
                  Ir al seguimiento
                </Link>
              </div>
            </form>
          ) : null}

          <Link
            href="/domiciliario"
            className="dg-v2-action-card"
            data-testid="home-card-domiciliario"
            aria-label="Soy domiciliario"
          >
            <span className="dg-v2-action-icon" aria-hidden="true">
              <MotoIcon size={24} strokeWidth={2} />
            </span>
            <span>
              <span className="dg-v2-action-title" style={{ display: "block" }}>
                Soy domiciliario
              </span>
              <span className="dg-v2-action-sub" style={{ display: "block" }}>
                Accede como repartidor
              </span>
            </span>
          </Link>
        </section>

        <div className="dg-v2-auth-links">
          <Link href="/acceso?modo=login" className="dg-v2-auth-link" data-testid="home-btn-login">
            Iniciar sesión
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            href="/acceso?modo=registro"
            className="dg-v2-auth-link"
            data-testid="home-link-register"
          >
            Crear cuenta
          </Link>
        </div>

        <p
          style={{
            marginTop: 14,
            fontSize: "0.86rem",
            color: "#C0C6D4",
            textAlign: "center",
          }}
        >
          ¿Tienes restaurante?{" "}
          <Link href="/restaurante" className="dg-v2-auth-link" data-testid="home-link-restaurante">
            Ingresa o regístralo aquí
          </Link>
        </p>
      </main>

      <div className="dg-v2-skyline" aria-hidden="true">
        <svg
          viewBox="0 0 1200 160"
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <linearGradient id="tocancipa-hills-v2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#79D5D0" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#79D5D0" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#C0C6D4" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <path
            d="M0,120 Q180,68 380,104 T760,88 T1200,110 L1200,160 L0,160 Z"
            fill="url(#tocancipa-hills-v2)"
          />
          <path
            d="M0,136 L75,136 L75,108 L120,108 L120,136 L150,136 L150,96 L195,96 L195,136 L250,136 L250,116 L295,116 L295,136 L520,136 L520,104 L558,104 L558,74 L578,42 L598,74 L598,104 L634,104 L634,136 L710,136 L710,112 L755,112 L755,136 L830,136 L830,98 L875,98 L875,136 L960,136 L960,114 L1010,114 L1010,136 L1200,136 L1200,160 L0,160 Z"
            fill="#1B172A"
          />
          <rect x="572" y="84" width="12" height="18" rx="6" fill="#79D5D0" />
          <rect x="164" y="106" width="10" height="10" rx="2" fill="#79D5D0" fillOpacity="0.7" />
          <rect x="844" y="108" width="10" height="10" rx="2" fill="#79D5D0" fillOpacity="0.7" />
        </svg>
      </div>
    </div>
  );
}
