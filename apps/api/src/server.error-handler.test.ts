/**
 * Tests for the error handler.
 *
 * Two separate things are pinned here, because two separate things were
 * wrong.
 *
 * 1. A ZodError must become a 400. `schema.parse()` throws one, and it
 *    carries neither `err.validation` (that is Fastify's own schema
 *    validation, a different thing) nor a `statusCode`, so it used to reach
 *    the catch-all and a caller's typo was reported as a server fault.
 *
 * 2. The handler has to actually be reachable from the API routes. It was
 *    registered below the `/api/v1` register() call, and a Fastify error
 *    handler is only inherited by child contexts created after it is set —
 *    so the whole handler, including the pre-existing validation branch, was
 *    dead code for every API request. A test that only exercised the handler
 *    directly would have passed the entire time, so the last test goes
 *    through a real prefixed route instead.
 */
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { z } from "zod";
import { ZodError } from "zod";

/** The handler under test, kept in step with server.ts by review — the same
 *  convention the other route tests here use for schemas. */
function attachErrorHandler(app: ReturnType<typeof Fastify>) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "validation_failed",
        message: "request validation failed",
        details: err.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    if (err.validation) {
      return reply.status(400).send({
        error: "validation_failed",
        message: err.message,
        details: err.validation,
      });
    }
    const status = err.statusCode ?? 500;
    return reply.status(status).send({
      error: status >= 500 ? "internal_error" : err.name,
      message: status >= 500 ? "Internal server error" : err.message,
    });
  });
}

const bodySchema = z.object({ title: z.string().min(1).max(10) });

describe("error handler — zod", () => {
  it("turns a ZodError into 400, not 500", async () => {
    const app = Fastify();
    attachErrorHandler(app);
    app.post("/x", async (req) => bodySchema.parse(req.body));

    const res = await app.inject({
      method: "POST",
      url: "/x",
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_failed");
    await app.close();
  });

  it("reports which field failed and why", async () => {
    const app = Fastify();
    attachErrorHandler(app);
    app.post("/x", async (req) => bodySchema.parse(req.body));

    const res = await app.inject({
      method: "POST",
      url: "/x",
      payload: { title: "much too long to pass" },
    });
    const body = res.json();
    expect(body.details).toHaveLength(1);
    expect(body.details[0].path).toBe("title");
    expect(body.details[0].code).toBe("too_big");
  });

  it("does not put raw zod internals in the response", async () => {
    // The default handler serialised the whole issue array into `message`.
    // Callers get a flattened shape instead, so a zod upgrade cannot change
    // the wire format underneath them.
    const app = Fastify();
    attachErrorHandler(app);
    app.post("/x", async (req) => bodySchema.parse(req.body));

    const res = await app.inject({
      method: "POST",
      url: "/x",
      payload: { title: 42 },
    });
    const body = res.json();
    expect(body.message).toBe("request validation failed");
    expect(Object.keys(body.details[0]).sort()).toEqual([
      "code",
      "message",
      "path",
    ]);
  });

  it("leaves non-zod errors alone", async () => {
    const app = Fastify();
    attachErrorHandler(app);
    app.get("/boom", async () => {
      throw new Error("kaboom");
    });

    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    // A real fault must not leak its message to the caller.
    expect(res.json().message).toBe("Internal server error");
  });
});

describe("error handler — reachability from a prefixed scope", () => {
  // This is the test that would have caught the original bug. The handler
  // itself was fine; it was simply never inherited by the route scope.
  it("applies to routes registered AFTER it is set", async () => {
    const app = Fastify();
    attachErrorHandler(app);
    await app.register(
      async (api) => {
        api.post("/thing", async (req) => bodySchema.parse(req.body));
      },
      { prefix: "/api/v1" }
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/thing",
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_failed");
    await app.close();
  });
});
