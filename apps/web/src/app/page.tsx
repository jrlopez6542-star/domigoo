import Link from "next/link";
import { DomigooShell } from "@/components/domigoo-shell";
import { getWebServerConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const { appName, adminAppUrl } = getWebServerConfig();

  return (
    <DomigooShell appName={appName} adminAppUrl={adminAppUrl} activeRoute="home">
      <section className="dg-hero" aria-labelledby="home-hero-title">
        <span className="dg-hero-eyebrow">Tocancipá, Cundinamarca</span>
        <h1 id="home-hero-title">{appName}: tus domicilios en un solo lugar</h1>
        <p>
          Elige cómo quieres ingresar hoy. Conectamos restaurantes locales, domiciliarios de la zona
          y clientes en todo el municipio de Tocancipá.
        </p>
      </section>

      <section aria-labelledby="role-selector-title">
        <h2
          id="role-selector-title"
          style={{ margin: "0 0 14px", fontSize: "1.2rem", fontWeight: 800 }}
        >
          ¿Cómo deseas entrar?
        </h2>

        <div className="dg-role-grid">
          <Link href="/cliente" className="dg-role-card" data-testid="role-card-cliente">
            <div>
              <span className="dg-role-icon dg-role-icon--cliente" aria-hidden="true">
                C
              </span>
              <h3 className="dg-role-title">Soy cliente</h3>
              <p className="dg-role-desc">
                Consulta el estado de tu pedido en vivo, calcula tarifas de envío y gestiona tu
                cuenta.
              </p>
            </div>
            <span className="dg-role-cta">Entrar como cliente</span>
          </Link>

          <Link href="/restaurante" className="dg-role-card" data-testid="role-card-restaurante">
            <div>
              <span className="dg-role-icon dg-role-icon--restaurante" aria-hidden="true">
                R
              </span>
              <h3 className="dg-role-title">Soy restaurante</h3>
              <p className="dg-role-desc">
                Administra tu sucursal, cotiza domicilios, publica entregas y comparte el
                seguimiento.
              </p>
            </div>
            <span className="dg-role-cta dg-role-cta--restaurante">Entrar como restaurante</span>
          </Link>

          <Link href="/domiciliario" className="dg-role-card" data-testid="role-card-domiciliario">
            <div>
              <span className="dg-role-icon dg-role-icon--domiciliario" aria-hidden="true">
                D
              </span>
              <h3 className="dg-role-title">Soy domiciliario</h3>
              <p className="dg-role-desc">
                Registra tu perfil, activa tu disponibilidad en Tocancipá y gestiona tus entregas.
              </p>
            </div>
            <span className="dg-role-cta dg-role-cta--domiciliario">Entrar como domiciliario</span>
          </Link>
        </div>
      </section>
    </DomigooShell>
  );
}
