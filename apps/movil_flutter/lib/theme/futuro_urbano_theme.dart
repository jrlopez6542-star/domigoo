import 'package:flutter/material.dart';

class BrandIdentity {
  static const String name = 'DOMIGOO';
  static const String slogan = 'TU CIUDAD A TU PUERTA';
  static const String direction = 'Futuro Urbano';
  static const String city = 'Tocancipá, Cundinamarca';
}

class BrandColors {
  static const Color indigo = Color(0xFF29243E);
  static const Color indigoDeep = Color(0xFF1B172A);
  static const Color indigoSoft = Color(0xFF363052);
  static const Color turquoise = Color(0xFF79D5D0);
  static const Color turquoiseBright = Color(0xFF9EF2ED);

  /// Turquesa accesible sobre fondos claros (#F5F7FA / #FFFFFF) para texto e iconos WCAG AA.
  static const Color turquoiseText = Color(0xFF0E7C77);
  static const Color silver = Color(0xFFC0C6D4);
  static const Color silverLight = Color(0xFFE2E6EF);
  static const Color white = Color(0xFFF5F7FA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF29243E);
  static const Color textMuted = Color(0xFF544E6B);
  static const Color border = Color(0xFFD9DEE8);
  static const Color borderStrong = Color(0xFFC0C6D4);
  static const Color noticeBg = Color(0xFFE9F8F7);
  static const Color successBg = Color(0xFFECFDF5);
  static const Color successBorder = Color(0xFFA7F3D0);
  static const Color successText = Color(0xFF065F46);
  static const Color warnBg = Color(0xFFFFFBEB);
  static const Color warnBorder = Color(0xFFFDE68A);
  static const Color warnText = Color(0xFF92400E);
  static const Color errorBg = Color(0xFFFEF2F2);
  static const Color errorBorder = Color(0xFFFECACA);
  static const Color errorText = Color(0xFF991B1B);
}

class BrandRadii {
  static const double sm = 10;
  static const double md = 16;
  static const double lg = 22;
  static const double pill = 999;
}

ThemeData buildFuturoUrbanoTheme() {
  const colorScheme = ColorScheme.light(
    primary: BrandColors.indigo,
    onPrimary: BrandColors.white,
    secondary: BrandColors.turquoise,
    onSecondary: BrandColors.indigo,
    surface: BrandColors.surface,
    onSurface: BrandColors.textPrimary,
    error: BrandColors.errorText,
    onError: BrandColors.surface,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: BrandColors.white,
    fontFamily: 'Inter',
    textTheme: const TextTheme(
      headlineSmall: TextStyle(
        fontFamily: 'Montserrat',
        fontWeight: FontWeight.w700,
        color: BrandColors.indigo,
      ),
      titleMedium: TextStyle(
        fontFamily: 'Montserrat',
        fontWeight: FontWeight.w700,
        fontSize: 16,
        color: BrandColors.indigo,
      ),
      bodyMedium: TextStyle(
        fontFamily: 'Inter',
        fontSize: 14,
        color: BrandColors.textPrimary,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BrandColors.surface,
      hintStyle: const TextStyle(color: BrandColors.textMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BrandRadii.sm),
        borderSide: const BorderSide(color: BrandColors.borderStrong),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BrandRadii.sm),
        borderSide: const BorderSide(color: BrandColors.borderStrong),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BrandRadii.sm),
        borderSide: const BorderSide(color: BrandColors.indigo, width: 1.5),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: BrandColors.indigo,
        foregroundColor: BrandColors.white,
        minimumSize: const Size(double.infinity, 48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BrandRadii.sm),
        ),
        textStyle: const TextStyle(
          fontFamily: 'Inter',
          fontWeight: FontWeight.w700,
          fontSize: 15,
        ),
      ),
    ),
  );
}
