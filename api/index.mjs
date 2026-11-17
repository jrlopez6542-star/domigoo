import { createVercelHandler } from "../apps/api/dist/vercel.js";
import { vercelBuildMeta } from "../apps/api/dist/vercel-build-meta.js";

const pending = createVercelHandler();

export default async function handler(request, response) {
  const commitSha = process.env["VERCEL_GIT_COMMIT_SHA"] || vercelBuildMeta.commitSha || "";
  const deploymentId = process.env["VERCEL_DEPLOYMENT_ID"] || vercelBuildMeta.deploymentId || "";
  if (commitSha !== "") {
    response.setHeader("x-domigoo-commit-sha", commitSha);
  }
  if (deploymentId !== "") {
    response.setHeader("x-domigoo-deployment-id", deploymentId);
  }
  response.setHeader(
    "x-domigoo-vercel-build",
    `migrate=${vercelBuildMeta.migrateDeploy};seed=${vercelBuildMeta.seedStaging}`,
  );
  const server = await pending;
  server(request, response);
}
