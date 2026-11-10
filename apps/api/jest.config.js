/** @type {import("jest").Config} */
const config = {
  testEnvironment: "node",
  testTimeout: 60_000,
  testRegex: ".*\\.(spec|e2e-spec)\\.ts$",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
};

export default config;
