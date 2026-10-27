import { describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

describe("health routes", () => {
  it("returns plain ok", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.body.trim()).toBe("ok");
    await app.close();
  });

  it("returns service metadata", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/v1/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "coredrive",
      version: "0.1.0",
    });
    await app.close();
  });

  it("reports degraded when no database is configured", async () => {
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "degraded", db: "unavailable" });
    await app.close();
  });
});
