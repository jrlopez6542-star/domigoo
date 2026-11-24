import { randomUUID } from "node:crypto";
import { createVercelHandler } from "../apps/api/dist/vercel.js";
import { vercelBuildMeta } from "../apps/api/dist/vercel-build-meta.js";

let pending;

export default async function handler(request, response) {
  const commitSha = process.env["VERCEL_GIT_COMMIT_SHA"] || vercelBuildMeta.commitSha || "";
  const deploymentId = process.env["VERCEL_DEPLOYMENT_ID"] || vercelBuildMeta.deploymentId || "";
  if (commitSha !== "") {
    response.setHeader("x-domigoo-commit-sha", commitSha);
  }
  if (deploymentId !== "") {
    response.setHeader("x-domigoo-deployment-id", deploymentId);
  }
  const buildHeader =
    vercelBuildMeta.vercelEnv === "production"
      ? `migrate=${vercelBuildMeta.migrateDeploy};seedAdmin=${vercelBuildMeta.seedAdmin ?? "omitido"}`
      : `migrate=${vercelBuildMeta.migrateDeploy};seed=${vercelBuildMeta.seedStaging}`;
  response.setHeader("x-domigoo-vercel-build", buildHeader);
  try {
    if (pending === undefined) {
      pending = createVercelHandler();
    }
    const server = await pending;
    server(request, response);
  } catch (error) {
    pending = undefined;
    const rawVercelId = request?.headers?.["x-vercel-id"];
    const headerVercelId = Array.isArray(rawVercelId) ? rawVercelId[0] : rawVercelId;
    const requestId =
      typeof headerVercelId === "string" && /^[A-Za-z0-9:._-]{1,128}$/.test(headerVercelId)
        ? headerVercelId
        : randomUUID();
    console.error(`[api/index] requestId=${requestId}`, error);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("x-request-id", requestId);
    response.end(
      JSON.stringify({
        status: "error",
        message: "Error interno del servidor",
        requestId,
      }),
    );
  }
}
