import { SpritesClient } from "@fly/sprites";
import { randomBytes } from "node:crypto";

const SPRITES_TOKEN = process.env.SPRITES_TOKEN;
const AGENT_REPO_URL = process.env.AGENT_REPO_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL;

/** Default agent server URL when no per-chat sprite is used */
export const DEFAULT_AGENT_SERVER_URL =
  process.env.AGENT_SERVER_URL ?? "https://my-sprite-i4t.sprites.app";

export interface CreateSpriteResult {
  spriteUrl: string;
  spriteName: string;
}

/**
 * Create a new Fly Sprite with OPENAI env vars, clone repo, npm i, start server.
 * Returns the sprite URL for API calls.
 */
const log = (msg: string, ...args: unknown[]) =>
  console.log("[sprite-setup]", msg, ...args);

export async function createAndSetupSprite(
  threadId?: string
): Promise<CreateSpriteResult> {
  log("createAndSetupSprite called", { threadId });

  if (!SPRITES_TOKEN) {
    throw new Error("SPRITES_TOKEN is not configured");
  }
  if (!AGENT_REPO_URL?.trim()) {
    throw new Error("AGENT_REPO_URL is not configured");
  }

  const client = new SpritesClient(SPRITES_TOKEN);
  // use provided threadId when available, otherwise generate a random suffix
  const spriteName =
    typeof threadId === "string" && threadId
      ? `agent-${threadId}`
      : `agent-${Date.now()}-${randomBytes(4).toString("hex")}`;

  log("creating PUBLIC sprite via HTTP API", { spriteName });
  log("SPRITES_TOKEN", { SPRITES_TOKEN });
  const createRes = await fetch("https://api.sprites.dev/v1/sprites", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SPRITES_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: spriteName,
      url_settings: {
        auth: "public",
      },
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    log("sprite create failed", { status: createRes.status, text });
    throw new Error(
      `Failed to create sprite (status ${createRes.status}): ${text}`
    );
  }
  log("sprite created, waiting for URL...");

  let spriteUrl: string | undefined;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    // need to make the URL public
    const info = await client.getSprite(spriteName);
    const sprite = info as { url?: string; status?: string };
    if (sprite.url) {
      spriteUrl = sprite.url;
      log("sprite URL available", { spriteUrl, attempt: i + 1 });
      break;
    }
    log("polling for sprite URL", { attempt: i + 1, status: sprite.status });
  }
  if (!spriteUrl) {
    throw new Error("Sprite was created but URL was not available in time");
  }

  const sprite = client.sprite(spriteName);
  const env: Record<string, string> = {};
  if (OPENAI_API_KEY) env.OPENAI_API_KEY = OPENAI_API_KEY;
  if (OPENAI_MODEL) env.OPENAI_MODEL = OPENAI_MODEL;

  log("cloning repo", { url: AGENT_REPO_URL });
  await sprite.exec(`git clone ${AGENT_REPO_URL}`, { env });
  log("clone done");

  const { stdout: ls } = await sprite.exec("ls", { env });
  log("ls", { ls });

  const runInAgent = async (cmd: string) => {
    log("running in ./agent", { cmd });
    try {
      const result = await sprite.exec(cmd, { env });
      log("command completed", {
        cmd,
        exitCode: result.exitCode,
        stdout: String(result.stdout).slice(0, 500),
        stderr: String(result.stderr).slice(0, 500),
      });
      return result;
    } catch (e: any) {
      const exitCode = e?.result?.exitCode ?? e?.exitCode;
      const stderr = e?.result?.stderr ?? e?.stderr;
      const stdout = e?.result?.stdout ?? e?.stdout;
      log("command FAILED", {
        cmd,
        exitCode,
        stdout: String(stdout ?? "").slice(0, 500),
        stderr: String(stderr ?? "").slice(0, 500),
      });
      throw e;
    }
  };

  log("installing deps in ./agent");
  await runInAgent("npm i --prefix ./agent");

  // Start dev server as long-running background process so we can return immediately.
  const envWithYes = { ...env, npm_config_yes: "true" };
  log("starting dev server in ./agent (background)");
  sprite.spawn("npm", ["run", "dev", "--prefix", "./agent"], {
    env: envWithYes,
    tty: false,
    detachable: true,
  });
  log("server start command sent, returning to caller");
  return { spriteUrl, spriteName };
}
