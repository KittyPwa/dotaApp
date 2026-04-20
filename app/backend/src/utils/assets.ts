import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const assetBaseUrl = "https://cdn.cloudflare.steamstatic.com";
const currentDotaMinimapUrl =
  "https://liquipedia.net/commons/Special:Redirect/file/Gamemap_7.40_minimap_dota2_gameasset.png";

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

export async function getCachedRemoteAssetBuffer(url: string, cacheKey: string) {
  const assetRoot = getLocalRoot();
  const hash = createHash("sha1").update(cacheKey).digest("hex");
  const extension = new URL(url).pathname.split(".").pop() ?? "bin";
  const filePath = join(assetRoot, `${hash}.${extension}`);

  if (existsSync(filePath)) {
    return readFileSync(filePath);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "DotaLocalAnalytics/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch remote asset ${url}: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Remote asset ${url} did not return an image. Content-Type: ${contentType || "unknown"}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  writeFileSync(filePath, buffer);
  return buffer;
}

export async function getCachedCurrentDotaMapBuffer() {
  return getCachedRemoteAssetBuffer(currentDotaMinimapUrl, "dota-minimap-7.40-liquipedia-gameasset");
}

export function getMimeType(path: string) {
  const normalizedPath = path.split("?")[0] ?? path;
  if (normalizedPath.endsWith(".png")) return "image/png";
  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) return "image/jpeg";
  if (normalizedPath.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
