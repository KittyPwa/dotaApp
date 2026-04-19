export type ProviderName = "opendota" | "stratz";

export interface ProviderFetchResult<T> {
  payload: T;
  fetchedAt: number;
}
