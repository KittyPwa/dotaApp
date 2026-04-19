import { desc, eq, isNull } from "drizzle-orm";
import { OpenDotaAdapter } from "../adapters/openDota.js";
import { db } from "../db/client.js";
import { heroes, items, rawApiPayloads } from "../db/schema.js";
import { defaultHeroIconPath, defaultHeroPortraitPath, defaultItemImagePath } from "../utils/assets.js";
import { config } from "../utils/config.js";
import { RawPayloadService } from "./rawPayloadService.js";

export class ReferenceDataService {
  constructor(
    private readonly openDota: OpenDotaAdapter,
    private readonly rawPayloadService: RawPayloadService
  ) {}

  async syncIfStale() {
    const [heroWithoutIcons] = await db.select().from(heroes).where(isNull(heroes.iconPath)).limit(1);
    const [itemWithoutImage] = await db.select().from(items).where(isNull(items.imagePath)).limit(1);
    const [latestHeroFetch] = await db
      .select()
      .from(rawApiPayloads)
      .where(eq(rawApiPayloads.entityType, "hero_stats"))
      .orderBy(desc(rawApiPayloads.fetchedAt))
      .limit(1);

    if (
      !heroWithoutIcons &&
      !itemWithoutImage &&
      latestHeroFetch?.fetchedAt &&
      Date.now() - latestHeroFetch.fetchedAt.getTime() < config.staleWindows.referenceDataMs
    ) {
      return;
    }

    const [heroStats, itemDictionary] = await Promise.all([
      this.openDota.getHeroStats(),
      this.openDota.getItems()
    ]);

    await this.rawPayloadService.store({
      provider: "opendota",
      entityType: "hero_stats",
      entityId: "all",
      fetchedAt: heroStats.fetchedAt,
      rawJson: heroStats.payload
    });

    await this.rawPayloadService.store({
      provider: "opendota",
      entityType: "items",
      entityId: "all",
      fetchedAt: itemDictionary.fetchedAt,
      rawJson: itemDictionary.payload
    });

    const now = new Date();

    for (const hero of heroStats.payload) {
      await db
        .insert(heroes)
        .values({
          id: hero.id,
          name: hero.name,
          localizedName: hero.localized_name,
          iconPath: hero.icon ?? defaultHeroIconPath(hero.name),
          portraitPath: hero.img ?? defaultHeroPortraitPath(hero.name),
          primaryAttr: hero.primary_attr ?? null,
          attackType: hero.attack_type ?? null,
          rolesJson: JSON.stringify(hero.roles ?? []),
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: heroes.id,
          set: {
            name: hero.name,
            localizedName: hero.localized_name,
            iconPath: hero.icon ?? defaultHeroIconPath(hero.name),
            portraitPath: hero.img ?? defaultHeroPortraitPath(hero.name),
            primaryAttr: hero.primary_attr ?? null,
            attackType: hero.attack_type ?? null,
            rolesJson: JSON.stringify(hero.roles ?? []),
            updatedAt: now
          }
        });
    }

    for (const [name, item] of Object.entries(itemDictionary.payload)) {
      await db
        .insert(items)
        .values({
          id: item.id,
          name,
          localizedName: item.dname ?? name,
          imagePath: item.img ?? defaultItemImagePath(name),
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: items.id,
          set: {
            name,
            localizedName: item.dname ?? name,
            imagePath: item.img ?? defaultItemImagePath(name),
            updatedAt: now
          }
        });
    }
  }
}
