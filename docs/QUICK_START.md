# Skald quick start and troubleshooting

## Connect to Audiobookshelf

Enter the address you use to reach Audiobookshelf, including its port when needed—for example `192.168.1.20:13378`. Keep `https://` selected when your server has a trusted certificate; use `http://` only on a network you trust.

Create API keys in the Audiobookshelf WebUI under **Settings → Users → API Keys**. If connection fails, check that Audiobookshelf is running, the address and port are correct, and any reverse proxy forwards Audiobookshelf's root and `/api` routes. Certificate errors must be corrected on the server or proxy; Skald does not silently bypass them.

## Downloads and offline use

Downloaded books remain available from their normal library entries. Skald checks free space before downloading and records important outcomes under **Recent activity**. If a server library cannot refresh, Skald may show its cached copy with an **Offline** indicator; playback progress queues until the server reconnects.

Download and cache locations are under **Settings → Downloads**. Use Skald's relocation actions so its registry remains aligned with the files.

## Local libraries and Staging

Local libraries are managed under **Settings → Libraries → On this PC**:

`Source files → Copy or move setting → Managed library folders → Needs attention (only when identification is uncertain)`

**Copy** leaves source files in place after verification. **Move** deletes each source only after the destination copy verifies successfully. Staging is a watched inbox and moves successfully imported books out of Staging. Uncertain items go to `_Unidentified` on disk and appear as **Needs attention** in Skald.

Removing a local library from Skald leaves its files on disk. Permanently deleting an individual local item is a separate, confirmed action.

## Diagnostics

Friendly messages omit raw server responses and internal transport details. Use **Settings → Logs → Skald** for redacted diagnostic detail.

## Current boundaries

Skald does not currently provide OIDC sign-in, an ebook reader, casting, or batch metadata editing. These are known product boundaries, not hidden setup switches.
