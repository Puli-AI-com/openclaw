import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveHeartbeatIntervalMs } from "../infra/heartbeat-runner.js";
import type { OpenClawConfig } from "./config.js";
import { validateConfigObjectRaw } from "./validation.js";

const defaultConfigPath = fileURLToPath(
  new URL("../../default-config/openclaw.json", import.meta.url),
);

describe("Puli image default config", () => {
  it("is schema-valid and disables periodic LLM heartbeats", () => {
    const config = JSON.parse(readFileSync(defaultConfigPath, "utf8")) as OpenClawConfig;
    const validation = validateConfigObjectRaw(config);

    expect(validation).toMatchObject({ ok: true });
    expect(config.gateway).not.toHaveProperty("heartbeat");
    expect(config.agents?.defaults?.heartbeat).toEqual({ every: "0m" });
    expect(resolveHeartbeatIntervalMs(config)).toBeNull();
  });
});
