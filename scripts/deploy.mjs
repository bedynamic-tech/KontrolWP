// Deploys the built Worker and creates SITE_SECRETS_KEY on the first deploy.
// The key encrypts every site's secret in D1, so it is never replaced: a new
// key would make every stored Connection Key unreadable.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export const KEY_NAME = "SITE_SECRETS_KEY";

function runWrangler(args, { inherit = false } = {}) {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  if (result.error) throw result.error;
  return result;
}

/** Inspect secret names only; the existing key never leaves Cloudflare. */
export async function deployWithSecretsKey({ config, run = runWrangler, log = console.log }) {
  if (!config.name || !config.configPath) throw new Error("A named Worker and a Wrangler config are required.");
  const configArgs = ["--config", config.configPath];
  const listed = run(["secret", "list", ...configArgs, "--format", "json"]);
  // Wrangler 4.124.0 emits this specific diagnostic for a missing Worker.
  // Any other failure must stop the deploy rather than risk a second key.
  const missingWorker = `Worker "${config.name}" not found. If this is a new Worker, run \`wrangler deploy\` first to create it.`;
  const diagnostic = stripVTControlCharacters(listed.stderr ?? "").replace(/\s+/g, " ");
  const newWorker = listed.status !== 0 && diagnostic.includes(missingWorker);
  let secrets = [];
  if (!newWorker) {
    if (listed.status !== 0) {
      throw new Error(`Listing Worker secrets failed. ${listed.stderr?.trim() || "Check Cloudflare credentials."}`);
    }
    try {
      secrets = JSON.parse(listed.stdout);
    } catch {
      throw new Error(`Listing Worker secrets returned invalid JSON; refusing to change ${KEY_NAME}.`);
    }
    if (!Array.isArray(secrets) || !secrets.every((secret) => typeof secret?.name === "string")) {
      throw new Error(`Unexpected secret list; refusing to change ${KEY_NAME}.`);
    }
  }
  const hasKey = secrets.some((secret) => secret.name === KEY_NAME) || KEY_NAME in (config.vars ?? {});

  let temporaryDirectory;
  try {
    const args = ["deploy", ...configArgs];
    if (!hasKey) {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "presser-secrets-"));
      const secretsPath = join(temporaryDirectory, "secrets.json");
      await writeFile(secretsPath, JSON.stringify({ [KEY_NAME]: randomBytes(32).toString("base64url") }), { mode: 0o600 });
      args.push("--secrets-file", secretsPath);
    }
    log(hasKey ? `Preserving the existing ${KEY_NAME}.` : `Creating ${KEY_NAME} with this deployment.`);
    const deployed = run(args, { inherit: true });
    if (deployed.status !== 0) throw new Error("Worker deployment failed.");
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error("This deployment script does not accept extra arguments.");
    const { unstable_readConfig } = await import("wrangler");
    // Use the generated Vite config for both inspection and deployment.
    const config = unstable_readConfig({}, { useRedirectIfAvailable: true });
    await deployWithSecretsKey({ config });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployment failed.");
    process.exitCode = 1;
  }
}
