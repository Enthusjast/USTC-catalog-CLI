import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "../src/domain/errors.js";
import { CatalogApiClient } from "../src/infrastructure/http/catalog-api-client.js";
import { loadConfig } from "../src/infrastructure/config/paths.js";

const servers: http.Server[] = [];

const clientFor = async (
  handler: http.RequestListener,
): Promise<{ client: CatalogApiClient; server: http.Server }> => {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    client: new CatalogApiClient(loadConfig({
      baseUrl: `http://127.0.0.1:${address.port}`,
      timeoutMs: 500,
    })),
    server,
  };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("CatalogApiClient", () => {
  it("returns validated JSON and leaves static document text untouched", async () => {
    const { client } = await clientFor((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/teach/semester/list") {
        response.end(JSON.stringify([{
          id: 461,
          nameZh: "2026年秋季学期",
          code: "2026A",
          start: "2026-09-01",
          end: "2027-01-31",
          isLast: true,
        }]));
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end("<h1>培养方案</h1>");
    });

    await expect(client.get("/api/teach/semester/list")).resolves.toMatchObject({ status: 200 });
    await expect(client.getText("/data/program/cn/001001.html")).resolves.toMatchObject({
      data: "<h1>培养方案</h1>",
      status: 200,
    });
  });

  it("maps HTTP errors without retrying semantic failures", async () => {
    let requests = 0;
    const { client } = await clientFor((_request, response) => {
      requests += 1;
      response.statusCode = 404;
      response.setHeader("content-type", "text/plain");
      response.end("missing");
    });

    await expect(client.get("/missing")).rejects.toMatchObject({
      code: "REMOTE_NOT_FOUND",
      cause: undefined,
    });
    expect(requests).toBe(1);
  });

  it("reports invalid JSON and invalid endpoint data separately", async () => {
    const { client } = await clientFor((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/bad-json") {
        response.end("not-json");
        return;
      }
      response.end(JSON.stringify({ nope: true }));
    });

    await expect(client.get("/bad-json")).rejects.toMatchObject({ code: "REMOTE_INVALID_JSON" });
    try {
      await client.get("/api/restricted");
      throw new Error("expected invalid endpoint data");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(error).toMatchObject({ code: "REMOTE_INVALID_DATA" });
    }
  });
});
