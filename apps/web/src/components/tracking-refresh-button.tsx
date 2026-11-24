"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export function TrackingRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      data-testid="tracking-refresh-btn"
      disabled={isPending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      style={{
        minHeight: "44px",
        minWidth: "44px",
        padding: "10px 16px",
        borderRadius: "8px",
        border: "1px solid #0f766e",
        backgroundColor: "#ffffff",
        color: "#0f766e",
        fontWeight: 700,
        fontSize: "0.9rem",
        fontFamily: "inherit",
        cursor: isPending ? "not-allowed" : "pointer",
        opacity: isPending ? 0.65 : 1,
      }}
    >
      {isPending ? "Actualizando..." : "Actualizar"}
    </button>
  );
}
