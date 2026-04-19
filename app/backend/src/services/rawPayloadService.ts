import { db } from "../db/client.js";
import { rawApiPayloads } from "../db/schema.js";

export class RawPayloadService {
  async store(input: {
    provider: string;
    entityType: string;
    entityId: string;
    fetchedAt: number;
    rawJson: unknown;
    requestContext?: Record<string, unknown>;
    parseVersion?: string;
  }) {
    await db.insert(rawApiPayloads).values({
      provider: input.provider,
      entityType: input.entityType,
      entityId: input.entityId,
      fetchedAt: new Date(input.fetchedAt),
      rawJson: JSON.stringify(input.rawJson),
      requestContext: input.requestContext ? JSON.stringify(input.requestContext) : null,
      parseVersion: input.parseVersion ?? "v1"
    });
  }
}
