import { DotaDataService } from "./dotaDataService.js";
import { SettingsService } from "./settingsService.js";
import { logger } from "../utils/logger.js";

type ProviderEnrichmentWorkerStatus = {
  enabled: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastFinishedAt: number | null;
  nextRunAt: number | null;
  lastQueued: {
    scannedMatches: number;
    stratzQueued: number;
    openDotaParseQueued: number;
  } | null;
  lastProcessedCount: number;
  lastError: string | null;
};

const MINUTE_MS = 60 * 1000;

export class ProviderEnrichmentWorker {
  private readonly settingsService = new SettingsService();
  private readonly dataService = new DotaDataService();
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private status: ProviderEnrichmentWorkerStatus = {
    enabled: false,
    running: false,
    lastRunAt: null,
    lastFinishedAt: null,
    nextRunAt: null,
    lastQueued: null,
    lastProcessedCount: 0,
    lastError: null
  };

  getStatus() {
    return { ...this.status };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(5_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.status = { ...this.status, running: false, nextRunAt: null };
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const boundedDelay = Math.max(1_000, delayMs);
    this.status = { ...this.status, nextRunAt: Date.now() + boundedDelay };
    this.timer = setTimeout(() => {
      void this.runOnce();
    }, boundedDelay);
  }

  private async runOnce() {
    if (this.stopped) return;
    if (this.status.running) {
      this.schedule(60_000);
      return;
    }

    let nextDelayMs = 30 * MINUTE_MS;
    try {
      const settings = await this.settingsService.getSettings({ includeProtected: true });
      nextDelayMs = settings.providerEnrichmentWorkerIntervalMinutes * MINUTE_MS;
      this.status = {
        ...this.status,
        enabled: settings.providerEnrichmentWorkerEnabled,
        nextRunAt: null
      };

      if (!settings.providerEnrichmentWorkerEnabled) {
        this.schedule(nextDelayMs);
        return;
      }

      this.status = {
        ...this.status,
        running: true,
        lastRunAt: Date.now(),
        lastError: null
      };

      const queued = await this.dataService.enqueueProviderEnrichmentCandidates({
        limit: settings.providerEnrichmentWorkerScanLimit
      });
      const processed = await this.dataService.processProviderEnrichmentQueue({
        limit: settings.providerEnrichmentWorkerJobsPerRun
      });

      this.status = {
        ...this.status,
        running: false,
        enabled: true,
        lastFinishedAt: Date.now(),
        lastQueued: {
          scannedMatches: queued.scannedMatches,
          stratzQueued: queued.stratzQueued,
          openDotaParseQueued: queued.openDotaParseQueued
        },
        lastProcessedCount: processed.processed.length,
        lastError: null
      };

      if (processed.processed.length > 0 || queued.stratzQueued > 0 || queued.openDotaParseQueued > 0) {
        logger.info("Provider enrichment worker completed", {
          scannedMatches: queued.scannedMatches,
          stratzQueued: queued.stratzQueued,
          openDotaParseQueued: queued.openDotaParseQueued,
          processed: processed.processed.length
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider enrichment worker failed.";
      this.status = {
        ...this.status,
        running: false,
        lastFinishedAt: Date.now(),
        lastError: message
      };
      logger.warn("Provider enrichment worker failed", { error: message });
    } finally {
      this.schedule(nextDelayMs);
    }
  }
}

export const providerEnrichmentWorker = new ProviderEnrichmentWorker();
