// Lista de candidatos a partir de la fila de disponibilidad vigente.
export const CANDIDATE_SQL = `
SELECT c.id
FROM courier_availabilities a
JOIN couriers c ON c.id = a."courierId"
JOIN branches b ON b.id = $1
JOIN consent_records consent ON consent.id = a."consentId"
JOIN vehicles v ON v."courierId" = c.id
WHERE c.status = 'APPROVED'
  AND a.state = 'AVAILABLE'
  AND v.status = 'ACTIVE'
  AND v.type = 'MOTORCYCLE'
  AND v."soatExpiresOn" > CURRENT_DATE
  AND v."techExpiresOn" > CURRENT_DATE
  AND consent."revokedAt" IS NULL
  AND consent.purpose = 'GEOLOCATION'
  AND a.location IS NOT NULL
  AND a."recordedAt" > now() - ($2::int * interval '1 second')
  AND ST_DWithin(a.location, b.location, $3)
  AND NOT EXISTS (
    SELECT 1 FROM orders o
    WHERE o."assignedCourierId" = c.id
      AND o.status NOT IN (
        'DELIVERED', 'EXPIRED', 'CANCELLED_RESTAURANT', 'CANCELLED_COURIER', 'CANCELLED_ADMIN', 'FAILED'
      )
  )
`;
