#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const repo = (process.env["GITHUB_REPOSITORY"] ?? "").trim();
const prNumber = (process.env["PR_NUMBER"] ?? "").trim();
const headSha = (process.env["HEAD_SHA"] ?? "").trim();
const headRef = (process.env["HEAD_REF"] ?? "").trim();
const githubToken = (process.env["GITHUB_TOKEN"] ?? "").trim();
const bypassSecret = (process.env["VERCEL_AUTOMATION_BYPASS_SECRET"] ?? "").trim();
const githubOutput = (process.env["GITHUB_OUTPUT"] ?? "").trim();
const timeoutSeconds = Number(process.env["WAIT_TIMEOUT_SECONDS"] ?? "240");

if (headSha === "" || headRef === "") {
  process.stderr.write("Abortado: HEAD_SHA y HEAD_REF son obligatorias\n");
  process.exit(1);
}

if (bypassSecret === "") {
  process.stderr.write(
    "Abortado: VERCEL_AUTOMATION_BYPASS_SECRET no está definido en el entorno\n",
  );
  process.exit(1);
}

const branchSlug = headRef
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "");
const fallbackHost = `domigoo-git-${branchSlug}-jrlopez6542-1905.vercel.app`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateBody(raw) {
  const clean = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
}

async function readVercelBotComment() {
  if (repo === "" || prNumber === "" || githubToken === "") {
    return null;
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=50`,
      {
        headers: {
          authorization: `Bearer ${githubToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "domigoo-ci-preview-wait",
        },
      },
    );
    if (!res.ok) {
      return null;
    }
    const comments = await res.json();
    if (!Array.isArray(comments)) {
      return null;
    }
    const vcComment = comments.find(
      (c) =>
        c?.user?.login === "vercel[bot]" &&
        typeof c?.body === "string" &&
        c.body.startsWith("[vc]: #"),
    );
    if (!vcComment) {
      return null;
    }
    const firstLine = vcComment.body.split("\n")[0] ?? "";
    const colonIdx = firstLine.lastIndexOf(":");
    if (colonIdx === -1) {
      return null;
    }
    const encoded = firstLine.slice(colonIdx + 1).trim();
    const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const project = Array.isArray(decoded?.projects)
      ? decoded.projects.find((p) => p?.name === "domigoo")
      : undefined;
    if (!project) {
      return null;
    }
    const rawPreviewUrl = String(project.previewUrl ?? "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    const inspectorUrl = String(project.inspectorUrl ?? "").trim();
    const nextCommitStatus = String(project.nextCommitStatus ?? "").trim();
    let inspectorDeploymentId = "";
    if (inspectorUrl !== "") {
      const parts = inspectorUrl.replace(/\/+$/, "").split("/");
      const suffix = parts[parts.length - 1] ?? "";
      if (suffix !== "") {
        inspectorDeploymentId = suffix.startsWith("dpl_") ? suffix : `dpl_${suffix}`;
      }
    }
    return {
      previewHost: rawPreviewUrl,
      inspectorUrl,
      inspectorDeploymentId,
      nextCommitStatus,
      updatedAt: String(vcComment.updated_at ?? ""),
    };
  } catch {
    return null;
  }
}

async function probeEndpoint(host, path) {
  try {
    const res = await fetch(`https://${host}${path}`, {
      headers: {
        "x-vercel-protection-bypass": bypassSecret,
        "cache-control": "no-cache",
      },
      redirect: "manual",
    });
    const text = await res.text();
    return {
      status: res.status,
      commitSha: (res.headers.get("x-domigoo-commit-sha") ?? "").trim(),
      deploymentId: (res.headers.get("x-domigoo-deployment-id") ?? "").trim(),
      vercelBuild: (res.headers.get("x-domigoo-vercel-build") ?? "").trim(),
      text,
    };
  } catch (error) {
    return {
      status: 0,
      commitSha: "",
      deploymentId: "",
      vercelBuild: "",
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let attempt = 0;
  let lastSummary = "sin respuesta inicial";

  while (Date.now() < deadline) {
    attempt += 1;
    const commentInfo = await readVercelBotComment();
    const candidateHost =
      commentInfo?.previewHost && commentInfo.previewHost !== ""
        ? commentInfo.previewHost
        : fallbackHost;
    const commentStatus = commentInfo?.nextCommitStatus ?? "SIN_COMENTARIO";

    const health = await probeEndpoint(candidateHost, "/health");
    const shaMatches = health.commitSha === headSha;
    const deployedWithoutShaHeader =
      health.commitSha === "" && commentStatus === "DEPLOYED" && health.status === 200;

    const bodyDiag =
      health.status !== 200 ? ` body=${JSON.stringify(truncateBody(health.text))}` : "";
    lastSummary = `intento=${attempt} host=${candidateHost} commentStatus=${commentStatus} health=${health.status} previewSha=${health.commitSha ? health.commitSha.slice(0, 7) : "n/a"} targetSha=${headSha.slice(0, 7)} buildHeader=${health.vercelBuild || "n/a"}${bodyDiag}`;
    process.stdout.write(`[vercel-preview] ${lastSummary}\n`);

    if (health.status === 200 && (shaMatches || deployedWithoutShaHeader)) {
      const ready = await probeEndpoint(candidateHost, "/ready");
      if (ready.status === 200) {
        let finalComment = commentInfo;
        for (let i = 0; i < 3; i += 1) {
          if (finalComment?.nextCommitStatus === "DEPLOYED" && finalComment.inspectorDeploymentId) {
            break;
          }
          await sleep(2000);
          finalComment = (await readVercelBotComment()) ?? finalComment;
        }

        const rawDeploymentId =
          health.deploymentId || finalComment?.inspectorDeploymentId || "no-expuesto";
        const deploymentId =
          rawDeploymentId !== "no-expuesto" && !rawDeploymentId.startsWith("dpl_")
            ? `dpl_${rawDeploymentId}`
            : rawDeploymentId;
        const inspectorUrl = finalComment?.inspectorUrl || "no-expuesto";
        const verifiedSha = health.commitSha || headSha;
        const buildMeta = health.vercelBuild || "no-expuesto";

        process.stdout.write(`[vercel-preview] Preview URL: https://${candidateHost}\n`);
        process.stdout.write(`[vercel-preview] Preview Host: ${candidateHost}\n`);
        process.stdout.write(`[vercel-preview] Deployment ID: ${deploymentId}\n`);
        process.stdout.write(`[vercel-preview] Inspector URL: ${inspectorUrl}\n`);
        process.stdout.write(`[vercel-preview] Commit SHA verificado: ${verifiedSha}\n`);
        process.stdout.write(`[vercel-preview] x-domigoo-vercel-build: ${buildMeta}\n`);

        if (buildMeta !== "migrate=ok;seed=ejecutado") {
          process.stderr.write(
            `Abortado: La cabecera x-domigoo-vercel-build del Preview fue '${buildMeta}', pero se requiere 'migrate=ok;seed=ejecutado'\n`,
          );
          process.exit(1);
        }

        if (githubOutput !== "") {
          appendFileSync(
            githubOutput,
            `preview_url=https://${candidateHost}\npreview_host=${candidateHost}\ndeployment_id=${deploymentId}\nvercel_build=${buildMeta}\n`,
            "utf8",
          );
        }
        return;
      }
      process.stdout.write(
        `[vercel-preview] /ready respondió ${ready.status} body=${JSON.stringify(truncateBody(ready.text))}, reintentando...\n`,
      );
    }

    await sleep(5000);
  }

  process.stderr.write(
    `Abortado: Tiempo de espera agotado (${timeoutSeconds}s) esperando Vercel Preview para ${headSha}. Último estado: ${lastSummary}\n`,
  );
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
