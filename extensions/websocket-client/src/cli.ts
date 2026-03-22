#!/usr/bin/env node

import { parseArgs } from "node:util";
import { ConfigManager } from "./index.js";

async function main() {
  const { positionals, values } = parseArgs({
    options: {
      url: { type: "string", short: "u", default: "ws://127.0.0.1:18789" },
      token: { type: "string", short: "t" },
      password: { type: "string", short: "p" },
      "device-token": { type: "string" },
      role: { type: "string", default: "operator" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(`
OpenClaw WebSocket Client CLI

Usage: openclaw-websocket-client <command> [options]

Commands:
  list                List all agents
  get <path>          Get configuration file content
  update <path>      Update configuration file content
  history <path>     Show configuration version history
  rollback <path>    Rollback configuration to version

Options:
  -u, --url <url>        Gateway WebSocket URL (default: ws://127.0.0.1:18789)
  -t, --token <token>   Gateway authentication token
  -p, --password <pwd>  Gateway authentication password
  --device-token <token> Device token for authentication
  --role <role>         Client role (default: operator)
  -h, --help            Show this help message

Examples:
  openclaw-websocket-client list --url ws://localhost:18789 --token mytoken
  openclaw-websocket-client get AGENTS.md --token mytoken
  openclaw-websocket-client update AGENTS.md --content "..." --token mytoken
  openclaw-websocket-client history AGENTS.md --token mytoken
  openclaw-websocket-client rollback AGENTS.md --version 5 --token mytoken
`);
    process.exit(0);
  }

  const command = positionals[0];
  const args = positionals.slice(1);

  const clientOptions = {
    url: values.url,
    token: values.token,
    password: values.password,
    deviceToken: values["device-token"],
    role: values.role,
  };

  const manager = new ConfigManager(clientOptions);

  try {
    await manager.connect();
    console.log("Connected to Gateway");

    switch (command) {
      case "list": {
        const agents = await manager.listAgents();
        console.log("\nAgents:");
        for (const agent of agents) {
          console.log(`  - ${agent.agentId}${agent.name ? ` (${agent.name})` : ""}`);
          if (agent.description) {
            console.log(`    ${agent.description}`);
          }
        }
        break;
      }

      case "get": {
        if (args.length === 0) {
          console.error("Error: path is required");
          process.exit(1);
        }
        const path = args[0];
        const content = await manager.getConfig({ path });
        console.log(`\n${path}:`);
        console.log(content);
        break;
      }

      case "update": {
        if (args.length === 0) {
          console.error("Error: path is required");
          process.exit(1);
        }
        const path = args[0];
        const content = values.content || args[1] || "";

        if (!content) {
          console.error("Error: content is required (use --content or provide as second argument)");
          process.exit(1);
        }

        const result = await manager.updateConfig({
          path,
          content,
          atomic: values.atomic || false,
        });

        if (result.success) {
          console.log(`\nConfiguration updated successfully`);
          if (result.version) {
            console.log(`New version: ${result.version}`);
          }
        } else {
          console.error(`\nUpdate failed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case "history": {
        if (args.length === 0) {
          console.error("Error: path is required");
          process.exit(1);
        }
        const path = args[0];
        const history = await manager.getHistory({ path, limit: 10 });

        console.log(`\nVersion history for ${path}:`);
        for (const version of history.versions) {
          const date = new Date(version.timestamp).toISOString();
          console.log(`  v${version.version} | ${date} | ${version.operation}`);
        }
        break;
      }

      case "rollback": {
        if (args.length === 0) {
          console.error("Error: path is required");
          process.exit(1);
        }
        const path = args[0];
        const version = parseInt(args[1] || String(values.version || "1"), 10);

        if (isNaN(version)) {
          console.error("Error: version must be a number");
          process.exit(1);
        }

        const result = await manager.rollback({ path, version });

        if (result.success) {
          console.log(`\nRolled back to version ${version}`);
          if (result.version) {
            console.log(`New version: ${result.version}`);
          }
        } else {
          console.error(`\nRollback failed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Use --help for usage information");
        process.exit(1);
    }

    console.log("\nAudit log:");
    const logs = manager.getAuditLog();
    for (const log of logs.slice(-5)) {
      console.log(`  ${new Date(log.timestamp).toISOString()} | ${log.operation} | ${log.result}`);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    manager.disconnect();
  }
}

main();
