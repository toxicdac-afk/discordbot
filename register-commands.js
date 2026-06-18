const fs = require("fs");
const https = require("https");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error("Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID first.");
  process.exit(1);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const commands = [
  {
    name: "genkey",
    description: "Generate an ELIJAH key. HWID binds on first activation.",
    options: [
      {
        name: "discord_id",
        description: "Customer Discord user ID.",
        type: 3,
        required: true,
      },
      {
        name: "customer",
        description: "Discord name or customer label.",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "keyinfo",
    description: "Look up license owner, status, and bound HWID.",
    options: [
      {
        name: "key",
        description: "License key to inspect.",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "customer",
    description: "Find a license by Discord ID, customer name, or key text.",
    options: [
      {
        name: "query",
        description: "Discord ID, customer name, or key fragment.",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "listkeys",
    description: "Show recent license keys and status.",
    options: [
      {
        name: "count",
        description: "Number of keys to show, max 10.",
        type: 4,
        required: false,
      },
    ],
  },
  {
    name: "reset-hwid",
    description: "Reset a key's HWID binding for a customer PC change.",
    options: [
      {
        name: "key",
        description: "License key to reset.",
        type: 3,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for audit logs.",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "revoke",
    description: "Revoke or un-revoke a license key.",
    options: [
      {
        name: "key",
        description: "License key to update.",
        type: 3,
        required: true,
      },
      {
        name: "revoked",
        description: "True to revoke, false to restore.",
        type: 5,
        required: true,
      },
      {
        name: "reason",
        description: "Reason for audit logs.",
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: "stats",
    description: "Show license and activation dashboard stats.",
  },
  {
    name: "logs",
    description: "Show recent activation logs.",
    options: [
      {
        name: "count",
        description: "Number of logs to show, max 10.",
        type: 4,
        required: false,
      },
    ],
  },
];

const body = JSON.stringify(commands);
const req = https.request(
  {
    method: "PUT",
    hostname: "discord.com",
    path: `/api/v10/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
    headers: {
      authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => {
      data += chunk;
    });
    res.on("end", () => {
      console.log(`Discord command registration: ${res.statusCode}`);
      if (data) console.log(data);
    });
  }
);

req.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

req.end(body);
