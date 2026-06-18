const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8080);
const LICENSE_SECRET = process.env.LICENSE_SECRET || "ELIJAH-CHANGE-THIS-SECRET-BEFORE-RELEASE-2026";
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const ADMIN_DISCORD_IDS = new Set(
  String(process.env.ADMIN_DISCORD_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

const DATA_DIR = path.join(__dirname, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEYS_PATH = path.join(DATA_DIR, "keys.json");
const LOGS_PATH = path.join(DATA_DIR, "activations.json");
const AUDIT_PATH = path.join(DATA_DIR, "audit.json");

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

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(KEYS_PATH)) fs.writeFileSync(KEYS_PATH, "[]");
  if (!fs.existsSync(LOGS_PATH)) fs.writeFileSync(LOGS_PATH, "[]");
  if (!fs.existsSync(AUDIT_PATH)) fs.writeFileSync(AUDIT_PATH, "[]");
}

function readStore(filePath) {
  ensureStore();
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function backupStore(filePath, action) {
  ensureStore();
  if (!fs.existsSync(filePath)) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${stamp}-${action}-${path.basename(filePath)}`;
  fs.copyFileSync(filePath, path.join(BACKUP_DIR, name));
}

function writeStore(filePath, value, action = "write") {
  ensureStore();
  backupStore(filePath, action);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function buildKey(hardwareId) {
  const hex = crypto
    .createHmac("sha256", LICENSE_SECRET)
    .update(String(hardwareId || "").trim().toUpperCase())
    .digest("hex")
    .toUpperCase();

  return `ELIJAH-${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
}

function createRandomKey() {
  const hex = crypto.randomBytes(10).toString("hex").toUpperCase();
  return `ELIJAH-${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
}

function readRaw(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("payload_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRaw(req);
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function postDiscord(content, embeds = []) {
  if (!DISCORD_WEBHOOK_URL) return Promise.resolve();

  const payload = JSON.stringify({ content, embeds });
  const url = new URL(DISCORD_WEBHOOK_URL);
  const request = https.request(
    {
      method: "POST",
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    },
    (response) => response.resume()
  );

  return new Promise((resolve) => {
    request.on("error", resolve);
    request.on("close", resolve);
    request.end(payload);
  });
}

function verifyDiscordRequest(req, rawBody) {
  if (!DISCORD_PUBLIC_KEY) return false;

  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];
  if (!signature || !timestamp) return false;

  try {
    const publicKeyDer = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex"),
    ]);
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      crypto.createPublicKey({
        key: publicKeyDer,
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

function interactionResponse(content, ephemeral = true) {
  return {
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0,
    },
  };
}

function embedResponse(embed, ephemeral = true, content = "") {
  return {
    type: 4,
    data: {
      content,
      embeds: [embed],
      flags: ephemeral ? 64 : 0,
    },
  };
}

function buildEmbed(title, description, color, fields = []) {
  return {
    title,
    description,
    color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "Elijah License Bot | Made by Manok" },
  };
}

function field(name, value, inline = true) {
  return {
    name,
    value: String(value || "n/a").slice(0, 1024),
    inline,
  };
}

function maskHardwareId(hardwareId) {
  const value = String(hardwareId || "").trim().toUpperCase();
  if (!value) return "not bound yet";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function licenseStatus(record) {
  if (!record) return "missing";
  if (record.revoked) return "revoked";
  return record.hardwareId ? "activated" : "ready";
}

function optionValue(interaction, name) {
  const options = interaction.data && interaction.data.options ? interaction.data.options : [];
  const option = options.find((item) => item.name === name);
  return option ? option.value : "";
}

function getDiscordUser(interaction) {
  const memberUser = interaction.member && interaction.member.user;
  const user = memberUser || interaction.user || {};
  return {
    id: String(user.id || ""),
    name: String(user.global_name || user.username || "unknown"),
    username: String(user.username || "unknown"),
  };
}

function requireAdmin(interaction) {
  if (ADMIN_DISCORD_IDS.size === 0) return false;
  const user = getDiscordUser(interaction);
  return ADMIN_DISCORD_IDS.has(user.id);
}

function audit(action, issuer, details) {
  const logs = readStore(AUDIT_PATH);
  logs.unshift({
    at: new Date().toISOString(),
    action,
    issuerId: issuer.id,
    issuerName: issuer.name,
    details,
  });
  writeStore(AUDIT_PATH, logs.slice(0, 500), "audit");
}

function createKeyRecord(discordId, customer, issuer) {
  const normalizedDiscordId = String(discordId || "").trim();
  const records = readStore(KEYS_PATH);
  const existing = records.find((record) => record.discordId === normalizedDiscordId);
  const now = new Date().toISOString();

  const record = {
    discordId: normalizedDiscordId,
    hardwareId: existing && existing.hardwareId ? existing.hardwareId : "",
    key: existing && existing.key ? existing.key : createRandomKey(),
    customer: String(customer || "unknown").slice(0, 80),
    createdById: issuer.id,
    createdByName: issuer.name,
    createdAt: now,
    revoked: existing ? Boolean(existing.revoked) : false,
    revokedReason: existing ? String(existing.revokedReason || "") : "",
  };

  if (existing) {
    Object.assign(existing, record);
  } else {
    records.push(record);
  }

  writeStore(KEYS_PATH, records, "keys");
  return record;
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-real-ip"] ||
    forwarded ||
    (req.socket && req.socket.remoteAddress) ||
    "unknown"
  );
}

function getLocation(req) {
  return {
    country: req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || "unknown",
    region: req.headers["x-vercel-ip-country-region"] || req.headers["fly-region"] || "unknown",
    city: req.headers["x-vercel-ip-city"] || "unknown",
  };
}

function findKeyRecord(hardwareId, key) {
  const records = readStore(KEYS_PATH);
  return records.find((record) => record.key === String(key || "").trim().toUpperCase());
}

function saveKeyRecord(record) {
  const records = readStore(KEYS_PATH);
  const index = records.findIndex((item) => item.key === record.key);
  if (index >= 0) records[index] = record;
  writeStore(KEYS_PATH, records, "keys");
}

function findRecordByKey(key) {
  const normalized = String(key || "").trim().toUpperCase();
  return readStore(KEYS_PATH).find((record) => record.key === normalized);
}

function searchRecords(query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];

  return readStore(KEYS_PATH)
    .filter((record) => {
      return (
        String(record.discordId || "").toLowerCase().includes(needle) ||
        String(record.customer || "").toLowerCase().includes(needle) ||
        String(record.key || "").toLowerCase().includes(needle)
      );
    })
    .slice(0, 10);
}

function updateKeyRecord(key, updater) {
  const normalized = String(key || "").trim().toUpperCase();
  const records = readStore(KEYS_PATH);
  const index = records.findIndex((record) => record.key === normalized);
  if (index < 0) return null;

  updater(records[index]);
  writeStore(KEYS_PATH, records, "keys");
  return records[index];
}

function buildKeyFields(record) {
  return [
    field("Customer", record.customer),
    field("Discord ID", record.discordId),
    field("Status", licenseStatus(record)),
    field("HWID", maskHardwareId(record.hardwareId), false),
    field("Created By", record.createdByName),
    field("Created", record.createdAt),
    field("Bound", record.boundAt || "not yet"),
    field("Revoked Reason", record.revokedReason || "none", false),
  ];
}

function formatKeyLine(record) {
  return `${licenseStatus(record).toUpperCase()} | ${record.customer} | ${record.discordId} | ${record.key}`;
}

function statsSnapshot() {
  const records = readStore(KEYS_PATH);
  const logs = readStore(LOGS_PATH);
  const today = new Date().toISOString().slice(0, 10);
  const total = records.length;
  const activated = records.filter((record) => record.hardwareId && !record.revoked).length;
  const ready = records.filter((record) => !record.hardwareId && !record.revoked).length;
  const revoked = records.filter((record) => record.revoked).length;
  const failedToday = logs.filter((log) => !log.valid && String(log.at || "").startsWith(today)).length;
  const okToday = logs.filter((log) => log.valid && String(log.at || "").startsWith(today)).length;

  return { total, activated, ready, revoked, failedToday, okToday, latest: logs[0] };
}

function logActivation(req, body, valid, keyRecord) {
  const location = getLocation(req);
  const entry = {
    at: new Date().toISOString(),
    valid,
    hardwareId: String(body.hardwareId || "").trim().toUpperCase(),
    discordId: String(body.discordId || "").trim(),
    appUser: String(body.user || "unknown").slice(0, 64),
    discordCustomer: keyRecord ? keyRecord.customer : "unknown",
    keyCreatedBy: keyRecord ? keyRecord.createdByName : "unknown",
    ip: getClientIp(req),
    userAgent: String(req.headers["user-agent"] || "unknown").slice(0, 180),
    location,
  };

  const logs = readStore(LOGS_PATH);
  logs.unshift(entry);
  writeStore(LOGS_PATH, logs.slice(0, 500));
  return entry;
}

async function handleActivate(req, res) {
  try {
    const body = await readJson(req);
    const hardwareId = String(body.hardwareId || "").trim().toUpperCase();
    const discordId = String(body.discordId || "").trim();
    const key = String(body.key || "").trim().toUpperCase();
    const keyRecord = findKeyRecord(hardwareId, key);
    let valid =
      hardwareId.length > 0 &&
      discordId.length > 0 &&
      keyRecord &&
      !keyRecord.revoked &&
      keyRecord.discordId === discordId &&
      (!keyRecord.hardwareId || keyRecord.hardwareId === hardwareId);

    if (valid && !keyRecord.hardwareId) {
      keyRecord.hardwareId = hardwareId;
      keyRecord.boundAt = new Date().toISOString();
      saveKeyRecord(keyRecord);
    }

    const log = logActivation(req, body, valid, keyRecord);

    await postDiscord("", [
      buildEmbed(
        valid ? "Activation Approved" : "Activation Failed",
        valid ? "A customer activated successfully." : "An activation attempt was blocked.",
        valid ? 0x43d588 : 0xff7474,
        [
          field("Windows User", log.appUser),
          field("Discord ID", log.discordId),
          field("Customer", log.discordCustomer),
          field("HWID", maskHardwareId(log.hardwareId), false),
          field("IP", log.ip),
          field("Location", `${log.location.city}/${log.location.region}/${log.location.country}`),
        ]
      ),
    ]);

    sendJson(res, valid ? 200 : 403, { ok: valid });
  } catch {
    sendJson(res, 400, { ok: false, error: "bad_request" });
  }
}

async function handleInteraction(req, res) {
  const rawBody = await readRaw(req);
  if (!verifyDiscordRequest(req, rawBody)) {
    sendJson(res, 401, { error: "bad_signature" });
    return;
  }

  const interaction = rawBody ? JSON.parse(rawBody) : {};
  if (interaction.type === 1) {
    sendJson(res, 200, { type: 1 });
    return;
  }

  if (!requireAdmin(interaction)) {
    sendJson(res, 200, interactionResponse("Admin only command."));
    return;
  }

  const command = interaction.data && interaction.data.name;
  const issuer = getDiscordUser(interaction);

  if (command === "genkey") {
    const discordId = String(optionValue(interaction, "discord_id") || "").trim();
    const customer = String(optionValue(interaction, "customer") || issuer.name);
    if (!discordId) {
      sendJson(res, 200, interactionResponse("Missing discord_id."));
      return;
    }

    const record = createKeyRecord(discordId, customer, issuer);
    audit("genkey", issuer, { key: record.key, discordId: record.discordId, customer: record.customer });
    await postDiscord("", [
      buildEmbed("License Key Created", `${issuer.name} created a key for ${record.customer}.`, 0x7e4aff, [
        field("Customer", record.customer),
        field("Discord ID", record.discordId),
        field("Status", licenseStatus(record)),
      ]),
    ]);
    sendJson(
      res,
      200,
      embedResponse(
        buildEmbed("Key Created", "HWID will bind automatically on first successful activation.", 0x7e4aff, [
          field("Customer", record.customer),
          field("Discord ID", record.discordId),
          field("Key", record.key, false),
          field("Status", licenseStatus(record)),
        ])
      )
    );
    return;
  }

  if (command === "keyinfo") {
    const key = String(optionValue(interaction, "key") || "").trim().toUpperCase();
    const record = findRecordByKey(key);
    sendJson(
      res,
      200,
      record
        ? embedResponse(buildEmbed("License Info", record.key, record.revoked ? 0xff7474 : 0x43d588, buildKeyFields(record)))
        : interactionResponse("Key not found.")
    );
    return;
  }

  if (command === "customer") {
    const query = String(optionValue(interaction, "query") || "").trim();
    const matches = searchRecords(query);
    sendJson(
      res,
      200,
      matches.length
        ? embedResponse(
            buildEmbed(
              "Customer Search",
              `Found ${matches.length} result(s) for "${query}".`,
              0x7e4aff,
              matches.slice(0, 5).map((record) => field(record.customer, formatKeyLine(record), false))
            )
          )
        : interactionResponse("No matching customer or key found.")
    );
    return;
  }

  if (command === "listkeys") {
    const count = Math.max(1, Math.min(Number(optionValue(interaction, "count") || 5), 10));
    const records = readStore(KEYS_PATH).slice(-count).reverse();
    sendJson(
      res,
      200,
      records.length
        ? embedResponse(
            buildEmbed(
              "Recent License Keys",
              `Showing ${records.length} key(s).`,
              0x7e4aff,
              records.map((record) => field(record.customer, formatKeyLine(record), false))
            )
          )
        : interactionResponse("No keys generated yet.")
    );
    return;
  }

  if (command === "reset-hwid") {
    const key = String(optionValue(interaction, "key") || "").trim().toUpperCase();
    const reason = String(optionValue(interaction, "reason") || "customer PC change").slice(0, 160);
    const previous = findRecordByKey(key);
    const record = updateKeyRecord(key, (item) => {
      item.previousHardwareId = item.hardwareId || "";
      item.hardwareId = "";
      item.boundAt = "";
      item.hwidResetAt = new Date().toISOString();
      item.hwidResetBy = issuer.name;
      item.hwidResetReason = reason;
    });

    if (!record) {
      sendJson(res, 200, interactionResponse("Key not found."));
      return;
    }

    audit("reset-hwid", issuer, { key, previousHardwareId: previous.hardwareId || "", reason });
    sendJson(
      res,
      200,
      embedResponse(
        buildEmbed("HWID Reset", "The key can bind again on the next valid activation.", 0xf7c65d, [
          field("Customer", record.customer),
          field("Discord ID", record.discordId),
          field("Previous HWID", maskHardwareId(previous.hardwareId), false),
          field("Reason", reason, false),
        ])
      )
    );
    return;
  }

  if (command === "revoke") {
    const key = String(optionValue(interaction, "key") || "").trim().toUpperCase();
    const revoked = Boolean(optionValue(interaction, "revoked"));
    const reason = String(optionValue(interaction, "reason") || (revoked ? "admin revoked" : "admin restored")).slice(0, 160);
    const record = updateKeyRecord(key, (item) => {
      item.revoked = revoked;
      item.revokedReason = revoked ? reason : "";
      item.revokedAt = revoked ? new Date().toISOString() : "";
      item.revokedBy = revoked ? issuer.name : "";
      item.restoredAt = revoked ? "" : new Date().toISOString();
      item.restoredBy = revoked ? "" : issuer.name;
    });

    if (!record) {
      sendJson(res, 200, interactionResponse("Key not found."));
      return;
    }

    audit(revoked ? "revoke" : "unrevoke", issuer, { key, customer: record.customer, reason });
    sendJson(
      res,
      200,
      embedResponse(
        buildEmbed(revoked ? "License Revoked" : "License Restored", record.key, revoked ? 0xff7474 : 0x43d588, [
          field("Customer", record.customer),
          field("Discord ID", record.discordId),
          field("Status", licenseStatus(record)),
          field("Reason", reason, false),
        ])
      )
    );
    return;
  }

  if (command === "stats") {
    const stats = statsSnapshot();
    sendJson(
      res,
      200,
      embedResponse(
        buildEmbed("License Dashboard", "Live license server summary.", 0x7e4aff, [
          field("Total Keys", stats.total),
          field("Activated", stats.activated),
          field("Ready", stats.ready),
          field("Revoked", stats.revoked),
          field("OK Today", stats.okToday),
          field("Failed Today", stats.failedToday),
          field(
            "Latest Activation",
            stats.latest
              ? `${stats.latest.valid ? "OK" : "FAIL"} | ${stats.latest.discordCustomer} | ${stats.latest.discordId} | ${stats.latest.at}`
              : "none",
            false
          ),
        ])
      )
    );
    return;
  }

  if (command === "logs") {
    const count = Math.max(1, Math.min(Number(optionValue(interaction, "count") || 5), 10));
    const logs = readStore(LOGS_PATH).slice(0, count);
    sendJson(
      res,
      200,
      logs.length === 0
        ? interactionResponse("No activation logs yet.")
        : embedResponse(
            buildEmbed(
              "Activation Logs",
              `Showing ${logs.length} recent log(s).`,
              0x7e4aff,
              logs.map((log) =>
                field(
                  `${log.valid ? "OK" : "FAIL"} | ${log.discordCustomer}`,
                  `${log.appUser} | ${log.discordId} | ${log.ip} | ${log.location.city}/${log.location.region}/${log.location.country} | ${log.at}`,
                  false
                )
              )
            )
          )
    );
    return;
  }

  sendJson(res, 200, interactionResponse("Unknown command."));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/activate") {
      await handleActivate(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/discord/interactions") {
      await handleInteraction(req, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  } catch {
    sendJson(res, 500, { ok: false, error: "server_error" });
  }
});

ensureStore();
server.listen(PORT, () => {
  console.log(`ELIJAH license bot listening on http://localhost:${PORT}`);
});
