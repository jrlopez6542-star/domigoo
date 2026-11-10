export type QuoteInput = {
  baseFeeCop: number;
  perKmCop: number;
  minimumFeeCop: number;
  distanceMeters: number;
  nightMultiplierBps: number;
  isNight: boolean;
};

export function quoteCop(input: QuoteInput): number {
  const variable = Math.floor((input.perKmCop * input.distanceMeters) / 1000);
  let fee = input.baseFeeCop + variable;
  if (input.isNight) {
    fee = Math.floor((fee * input.nightMultiplierBps) / 10000);
  }
  if (fee < input.minimumFeeCop) {
    fee = input.minimumFeeCop;
  }
  return fee;
}
