import { randomBytes } from "node:crypto";
import { readEnv, type AppEnv } from "../src/config/env.js";

const pinPepper = randomBytes(32).toString("base64");
const dataEncryptionKey = randomBytes(32).toString("base64");

export function testEnv(env: NodeJS.ProcessEnv): AppEnv {
  return readEnv({
    PIN_PEPPER: pinPepper,
    DATA_ENCRYPTION_KEY: dataEncryptionKey,
    ...env,
  });
}

export const testPinPepper = Buffer.from(pinPepper, "base64");
export const testDataKey = Buffer.from(dataEncryptionKey, "base64");
