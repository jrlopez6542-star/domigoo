export const BRAND_IDENTITY = {
  name: "DOMIGOO",
  slogan: "TU CIUDAD A TU PUERTA",
  direction: "Futuro Urbano",
  city: "Tocancipá, Cundinamarca",
} as const;

export const BRAND_COLORS = {
  indigo: "#29243E",
  indigoDeep: "#1B172A",
  indigoSoft: "#363052",
  turquoise: "#79D5D0",
  turquoiseBright: "#9EF2ED",
  /**
   * Turquesa accesible sobre fondos claros (#F5F7FA / #FFFFFF) para texto e iconos WCAG AA.
   */
  turquoiseText: "#0E7C77",
  silver: "#C0C6D4",
  silverLight: "#E2E6EF",
  white: "#F5F7FA",
  surface: "#FFFFFF",
  textPrimary: "#29243E",
  textMuted: "#544E6B",
  border: "#D9DEE8",
  borderStrong: "#C0C6D4",
  successBg: "#ECFDF5",
  successBorder: "#A7F3D0",
  successText: "#065F46",
  warnBg: "#FFFBEB",
  warnBorder: "#FDE68A",
  warnText: "#92400E",
  errorBg: "#FEF2F2",
  errorBorder: "#FECACA",
  errorText: "#991B1B",
} as const;

export const BRAND_TYPOGRAPHY = {
  brandFont: "Montserrat, Arial, sans-serif",
  uiFont: "Inter, system-ui, -apple-system, sans-serif",
} as const;

export const BRAND_RADII = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export const BRAND_SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
