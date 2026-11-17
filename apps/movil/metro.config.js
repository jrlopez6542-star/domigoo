const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const monorepoRoot = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules/.pnpm/node_modules"),
];
config.resolver.unstable_enableSymlinks = true;
if (config.server) {
  config.server.unstable_serverRoot = __dirname;
}

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return originalResolveRequest
      ? originalResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  } catch (err) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      const stripped = moduleName.slice(0, -3);
      return originalResolveRequest
        ? originalResolveRequest(context, stripped, platform)
        : context.resolveRequest(context, stripped, platform);
    }
    throw err;
  }
};

module.exports = config;
