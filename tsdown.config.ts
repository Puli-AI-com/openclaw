import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

function buildInputOptions(options: { onLog?: unknown; [key: string]: unknown }) {
  if (process.env.OPENCLAW_BUILD_VERBOSE === "1") {
    return undefined;
  }

  const previousOnLog = typeof options.onLog === "function" ? options.onLog : undefined;

  return {
    ...options,
    onLog(
      level: string,
      log: { code?: string },
      defaultHandler: (level: string, log: { code?: string }) => void,
    ) {
      if (log.code === "PLUGIN_TIMINGS") {
        return;
      }
      if (typeof previousOnLog === "function") {
        previousOnLog(level, log, defaultHandler);
        return;
      }
      defaultHandler(level, log);
    },
  };
}

function nodeBuildConfig(config: Record<string, unknown>) {
  return {
    ...config,
    env,
    fixedExtension: false,
    platform: "node",
    inputOptions: buildInputOptions,
  };
}

const pluginSdkEntrypoints = [
  "index",
  "core",
  "compat",
  "telegram",
  "discord",
  "slack",
  "signal",
  "imessage",
  "whatsapp",
  "line",
  "msteams",
  "acpx",
  "bluebubbles",
  "copilot-proxy",
  "device-pair",
  "diagnostics-otel",
  "diffs",
  "feishu",
  "google-gemini-cli-auth",
  "googlechat",
  "irc",
  "llm-task",
  "lobster",
  "matrix",
  "mattermost",
  "memory-core",
  "memory-lancedb",
  "minimax-portal-auth",
  "nextcloud-talk",
  "nostr",
  "open-prose",
  "phone-control",
  "qwen-portal-auth",
  "synology-chat",
  "talk-voice",
  "test-utils",
  "thread-ownership",
  "tlon",
  "twitch",
  "voice-call",
  "zalo",
  "zalouser",
  "account-id",
  "keyed-async-queue",
] as const;

const allBuildConfigs = [
  nodeBuildConfig({
    entry: "src/index.ts",
  }),
  nodeBuildConfig({
    entry: "src/entry.ts",
  }),
  nodeBuildConfig({
    // Ensure this module is bundled as an entry so legacy CLI shims can resolve its exports.
    entry: "src/cli/daemon-cli.ts",
  }),
  nodeBuildConfig({
    entry: "src/infra/warning-filter.ts",
  }),
  nodeBuildConfig({
    // Keep sync lazy-runtime channel modules as concrete dist files.
    entry: {
      "channels/plugins/agent-tools/whatsapp-login":
        "src/channels/plugins/agent-tools/whatsapp-login.ts",
      "channels/plugins/actions/discord": "src/channels/plugins/actions/discord.ts",
      "channels/plugins/actions/signal": "src/channels/plugins/actions/signal.ts",
      "channels/plugins/actions/telegram": "src/channels/plugins/actions/telegram.ts",
      "telegram/audit": "src/telegram/audit.ts",
      "telegram/token": "src/telegram/token.ts",
      "line/accounts": "src/line/accounts.ts",
      "line/send": "src/line/send.ts",
      "line/template-messages": "src/line/template-messages.ts",
    },
  }),
  ...pluginSdkEntrypoints.map((entry) =>
    nodeBuildConfig({
      entry: `src/plugin-sdk/${entry}.ts`,
      outDir: "dist/plugin-sdk",
    }),
  ),
  nodeBuildConfig({
    entry: "src/extensionAPI.ts",
  }),
  nodeBuildConfig({
    entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"],
  }),
];

// Memory-bounded chunked bundling for constrained builders (e.g. QEMU
// amd64-on-arm64, where the whole-array bundle exceeds the VM memory ceiling).
// Set TSDOWN_BUILD_CHUNK="i/n" to bundle only the i-th of n contiguous slices.
// Each invocation is a fresh process, so peak memory is reclaimed between
// passes. Chunked runs disable `clean` so a later chunk does not wipe the
// dist output produced by earlier chunks (Docker builds start from an empty
// dist, so nothing stale remains). When the env var is unset the full,
// unchanged config array is built (preserving CI/local behavior exactly).
function selectBuildChunk<T>(items: T[], spec: string | undefined): T[] | null {
  if (!spec) return null;
  const match = /^(\d+)\/(\d+)$/.exec(spec.trim());
  if (!match) {
    throw new Error(`Invalid TSDOWN_BUILD_CHUNK="${spec}" — expected "i/n" (e.g. "1/4")`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || total < 1 || index > total) {
    throw new Error(`Invalid TSDOWN_BUILD_CHUNK="${spec}" — require 1 <= i <= n`);
  }
  const size = Math.ceil(items.length / total);
  const start = (index - 1) * size;
  return items.slice(start, start + size);
}

const chunk = selectBuildChunk(allBuildConfigs, process.env.TSDOWN_BUILD_CHUNK);

export default defineConfig(
  chunk === null ? allBuildConfigs : chunk.map((config) => ({ ...config, clean: false })),
);
