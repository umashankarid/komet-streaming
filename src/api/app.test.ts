import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { MatchOrchestrator } from "../domain/MatchOrchestrator.js";
import { createApp } from "./app.js";
import { hashPassword } from "./auth.js";

const teams = {
  home: { players: [{ name: "A" }] },
  away: { players: [{ name: "B" }] },
};

function makeApp() {
  return createApp(new MatchOrchestrator(), {
    auth: { username: "admin", passwordHash: hashPassword("pw") },
    sessionSecret: "test-secret",
  });
}

/** Log in and return the session cookie for authenticated requests. */
async function login(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await request(app)
    .post("/login")
    .type("form")
    .send({ username: "admin", password: "pw" });
  return res.headers["set-cookie"];
}

describe("app auth gating", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("serves /healthz without auth", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("redirects unauthenticated dashboard access to /login", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("redirects unauthenticated /control and /score to /login", async () => {
    expect((await request(app).get("/control")).headers.location).toBe("/login");
    expect((await request(app).get("/score/1")).headers.location).toBe("/login");
  });

  it("blocks direct access to protected html files", async () => {
    const res = await request(app).get("/control.html");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("serves the overlay and ticker publicly (OBS cannot log in)", async () => {
    expect((await request(app).get("/overlay/court/1")).status).toBe(200);
    expect((await request(app).get("/overlay/court/1/ticker")).status).toBe(200);
  });

  it("serves the login page", async () => {
    const res = await request(app).get("/login");
    expect(res.status).toBe(200);
  });

  it("rejects bad credentials back to login with error", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ username: "admin", password: "wrong" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=1");
  });

  it("allows the dashboard after a successful login", async () => {
    const cookie = await login(app);
    const res = await request(app).get("/").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("allows GET API reads without auth but blocks writes", async () => {
    expect((await request(app).get("/api/courts")).status).toBe(200);
    const write = await request(app).post("/api/courts/1/match").send(teams);
    expect(write.status).toBe(401);
  });

  it("allows API writes once authenticated", async () => {
    const cookie = await login(app);
    const res = await request(app)
      .post("/api/courts/1/match")
      .set("Cookie", cookie)
      .send(teams);
    expect(res.status).toBe(201);
  });

  it("logs out and clears the session", async () => {
    const cookie = await login(app);
    const out = await request(app).post("/logout").set("Cookie", cookie);
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe("/login");
  });
});
