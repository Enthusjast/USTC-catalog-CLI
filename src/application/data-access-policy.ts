import { CliError } from "../domain/errors.js";
import type { ResultMeta, SourceKind } from "../domain/models.js";
import type { ResourceName } from "../domain/query.js";
import { SnapshotRepository, type CachedValue } from "../infrastructure/cache/snapshot-repository.js";

export type AccessOptions = {
  offline: boolean;
  noCache: boolean;
  verbose?: boolean;
  onDiagnostic?: (message: string) => void;
};

export type Loaded<T> = {
  value: T;
  meta: ResultMeta;
};

export type NetworkValue<T> = {
  value: T;
  fetchedAt?: string;
  dataAsOf?: string | null;
  status?: number;
};

const canFallbackToCache = (error: unknown): boolean =>
  error instanceof CliError && error.code === "NETWORK_ERROR";

export class DataAccessPolicy {
  constructor(private readonly repository: SnapshotRepository) {}

  async load<T>(
    resource: ResourceName | string,
    scope: string,
    loader: () => Promise<NetworkValue<T>>,
    options: AccessOptions,
    dataAsOf?: (value: T) => string | null | undefined,
  ): Promise<Loaded<T>> {
    let cached: CachedValue<T> | null = null;
    if (!options.noCache) {
      try {
        cached = this.repository.read<T>(resource, scope);
      } catch (error) {
        if (options.offline) throw error;
        options.onDiagnostic?.(`cache read failed, ignore snapshot: ${resource}/${scope}`);
      }
    }

    if (options.offline) {
      if (!cached) {
        throw new CliError(
          "CACHE_MISS",
          `没有找到 ${resource}/${scope} 的缓存。`,
          "去掉 --offline 后联网获取，或先执行一次普通查询。",
        );
      }
      options.onDiagnostic?.(`cache hit: ${resource}/${scope}`);
      return { value: cached.value, meta: this.meta(resource, scope, cached, "cache", true) };
    }

    let network: NetworkValue<T>;
    try {
      options.onDiagnostic?.(`network request: ${resource}/${scope}`);
      network = await loader();
    } catch (error) {
      if (!cached || !canFallbackToCache(error)) throw error;
      options.onDiagnostic?.(`network failed, fallback cache: ${resource}/${scope}`);
      return {
        value: cached.value,
        meta: this.meta(resource, scope, cached, "cache", true),
      };
    }

    const saved = this.repository.write(
      resource,
      scope,
      `${resource}:${scope}`,
      network.value,
      network.status ?? 200,
      network.dataAsOf ?? dataAsOf?.(network.value) ?? null,
      network.fetchedAt,
    );
    return {
      value: saved.value,
      meta: this.meta(resource, scope, saved, "network", false),
    };
  }

  private meta<T>(
    resource: string,
    scope: string,
    value: CachedValue<T>,
    source: SourceKind,
    stale: boolean,
  ): ResultMeta {
    return {
      resource,
      scope,
      source,
      fetchedAt: value.fetchedAt,
      dataAsOf: value.dataAsOf,
      stale,
    };
  }
}
