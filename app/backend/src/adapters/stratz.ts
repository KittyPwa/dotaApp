import { fetchJsonWithRetry } from "../utils/http.js";
import type { ProviderFetchResult } from "../domain/provider.js";

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class StratzAdapter {
  private readonly endpoint = "https://api.stratz.com/graphql";

  constructor(private readonly apiKey: string | null) {}

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error("STRATZ API key is not configured.");
    }
  }

  async execute<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<ProviderFetchResult<GraphQLResponse<T>>> {
    this.assertConfigured();
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<GraphQLResponse<T>>(
      this.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ query, variables })
      },
      { provider: "stratz" }
    );
    return { payload, fetchedAt };
  }

  async getPlayerBasic(playerId: number) {
    return this.execute<{ player: { steamAccountId: number; name?: string | null } }>(
      `
        query PlayerBasic($playerId: Long!) {
          player(steamAccountId: $playerId) {
            steamAccountId
            name
          }
        }
      `,
      { playerId }
    );
  }
}
