# ELIJAH License Server

This project is a lightweight Node.js license backend for validating app activations and managing Discord-based license operations.

> Keep secrets, webhook URLs, and bot tokens out of the compiled app files.

## Overview

The server handles:

- `POST /activate` for app license validation
- Discord slash commands for admin operations
- logging activation activity to local JSON files
- webhook notifications for key and activation events

## Required Environment Variables

Create a `.env` file from `.env.example` and set the following values:

- `PORT` — server port (default: `8787`)
- `LICENSE_SECRET` — secret used to generate/verify license keys
- `DISCORD_PUBLIC_KEY` — Discord application public key
- `DISCORD_WEBHOOK_URL` — webhook used for notifications
- `DISCORD_BOT_TOKEN` — bot token for slash commands
- `DISCORD_CLIENT_ID` — Discord application client ID
- `DISCORD_GUILD_ID` — Discord server ID for local command registration
- `ADMIN_DISCORD_IDS` — comma-separated admin Discord IDs

## Setup

1. Copy `.env.example` to `.env`.
2. Update all required values in `.env`.
3. Install dependencies if needed:

```powershell
npm install
```

4. Start the server:

```powershell
node server.js
```

5. Set the Discord interactions endpoint to:

```text
https://your-domain.example/discord/interactions
```

## Register Discord Commands

Run this once after setting the Discord env values:

```powershell
node register-commands.js
```

## Discord Commands

- `/genkey discord_id customer`
  Generates a key for the given Discord ID.
  The first successful activation binds the key to the detected PC hardware ID.

- `/keyinfo key`
  Shows customer details, Discord ID, bound hardware ID, creator, and date.

- `/customer query`
  Searches by Discord ID, customer name, or key fragment.

- `/listkeys count`
  Shows recent keys with status.

- `/reset-hwid key reason`
  Clears a key's hardware binding so it can bind again on the customer's next activation.

- `/revoke key revoked reason`
  Revokes or restores a license key.

- `/stats`
  Shows total keys, activated keys, ready keys, revoked keys, and today's activation stats.

- `/logs count`
  Displays recent activation logs.

Only users listed in `ADMIN_DISCORD_IDS` can use these commands.
If `ADMIN_DISCORD_IDS` is empty, admin commands are blocked by default for safety.

## API Endpoint

### `POST /activate`

Request body:

```json
{
  "hardwareId": "AUTO_DETECTED_USER_HARDWARE_ID",
  "discordId": "USER_DISCORD_ID",
  "key": "ELIJAH-XXXXX-XXXXX-XXXXX-XXXXX",
  "user": "optional Windows username"
}
```

## Data Stored

The server stores:

- activation records in `data/activations.json`
- generated keys in `data/keys.json`
- admin audit logs in `data/audit.json`
- automatic JSON backups in `data/backups`

Activation logs may include:

- activation result
- Windows username
- customer label
- Discord ID
- key creator name
- hardware ID hash
- IP address
- user agent
- location metadata (when available)
- timestamp

> Only collect the fields you actually need. Be transparent with users about IP/location logging.

## License Flow

### Recommended online flow

1. Admin runs `/genkey discord_id customer`
2. User opens the app and enters their Discord ID + key
3. The app detects the hardware ID automatically
4. The server validates the key and binds it to that hardware ID on first success
5. Future activations require the same Discord ID, key, and hardware ID

### Offline fallback

```powershell
LicenseKeyGenerator.exe <discord-id> <hardware-id>
```

## App Configuration

Before release, update the app constants in [ManokCleaner.cs](ManokCleaner.cs) so they match the server values:

```csharp
private const string LicenseSecret = "YOUR_PRIVATE_SECRET";
private const string LicenseApiUrl = "https://your-server.example.com/activate";
```

Use the same secret in:

- [ManokCleaner.cs](ManokCleaner.cs)
- [LicenseKeyGenerator.cs](LicenseKeyGenerator.cs)
- [license-server/.env](.env)

If `LicenseApiUrl` is blank, offline key validation still works, but activation logs will not be sent.

## Notes

- Activation logs from the app are only sent after `LicenseApiUrl` is set and the app is rebuilt.
- Slash command responses use private Discord embeds by default.
- Webhook activation alerts use green/red embeds and mask long hardware IDs.
- If `ADMIN_DISCORD_IDS` is empty, admin commands are blocked. Add your Discord ID before production use.
