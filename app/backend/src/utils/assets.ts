import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const assetBaseUrl = "https://cdn.cloudflare.steamstatic.com";

function getLocalRoot() {
  const base = resolve(process.cwd(), "app", "backend", ".data", "assets");
  mkdirSync(base, { recursive: true });
  return base;
}

export function buildAssetProxyUrl(path: string | null | undefined) {
  if (!path) return null;
  return `/api/assets/opendota?path=${encodeURIComponent(path)}`;
}

export function defaultHeroIconPath(internalName: string | null | undefined) {
  if (!internalName) return null;
  const slug = internalName.replace(/^npc_dota_hero_/, "");
  return `/apps/dota2/images/dota_react/heroes/icons/${slug}.png`;
}

export function defaultHeroPortraitPath(internalName: string | null | undefined) {
  if (!internalName) return null;
  const slug = internalName.replace(/^npc_dota_hero_/, "");
  return `/apps/dota2/images/dota_react/heroes/${slug}.png`;
}

export function defaultItemImagePath(internalName: string | null | undefined) {
  if (!internalName) return null;
  const slug = internalName.replace(/^item_/, "");
  return `/apps/dota2/images/dota_react/items/${slug}.png`;
}

export async function getCachedAssetBuffer(path: string) {
  const assetRoot = getLocalRoot();
  const hash = createHash("sha1").update(path).digest("hex");
  const normalizedPath = path.split("?")[0] ?? path;
  const extension = normalizedPath.split(".").pop() ?? "bin";
  const filePath = join(assetRoot, `${hash}.${extension}`);

  if (existsSync(filePath)) {
    return readFileSync(filePath);
  }

  const response = await fetch(`${assetBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset ${path}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  writeFileSync(filePath, buffer);
  return buffer;
}

export function getMimeType(path: string) {
  const normalizedPath = path.split("?")[0] ?? path;
  if (normalizedPath.endsWith(".png")) return "image/png";
  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) return "image/jpeg";
  if (normalizedPath.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
