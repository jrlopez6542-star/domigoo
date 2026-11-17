const SECRET =
  /(?:authorization\s*:\s*bearer\s+\S+|cookie\s*[:=]\s*\S+|set-cookie\s*:\s*\S+|password(?:Hash)?\s*[:=]\s*\S+|pin\s*[:=]\s*\S+|(?:push)?token(?:Hash|Ciphertext)?\s*[:=]\s*\S+|(?:pickupPin|deliveryPin)?ciphertext\s*[:=]\s*\S+|documentNumber\s*[:=]\s*\S+)/gi;

export function redact(value: string): string {
  return value.replace(SECRET, (match) => {
    const index = match.search(/[:=]/);
    return `${match.slice(0, index + 1)} [redactado]`;
  });
}
