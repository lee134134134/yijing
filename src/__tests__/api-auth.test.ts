/**
 * API 密钥认证中间件测试
 *
 * 通过 vi.resetModules + doMock 按场景注入不同的 config.apiKeys,
 * 覆盖:开发模式放行 / 无密钥 401 / 错误密钥 401 / X-API-Key 与
 * Authorization: Bearer 两种传递方式 / 非 Bearer 前缀拒绝。
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

/** 认证模块最小接口(用于 buildApp 参数类型) */
type AuthModule = { authenticate: (req: FastifyRequest, reply: FastifyReply) => boolean };

/** 以指定密钥集合加载一份全新的 auth 模块实例 */
async function freshAuth(keys: string[]) {
  vi.resetModules();
  vi.doMock("../config.js", () => ({ config: { apiKeys: keys } }));
  vi.doMock("../logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }));
  const mod = await import("../api/middleware/auth.js");
  mod.initAuth();
  return mod;
}

/** 搭建带认证钩子的最小应用(镜像 server.ts 的注册方式) */
async function buildApp(auth: AuthModule) {
  const app = Fastify();
  app.addHook("onRequest", async (req, reply) => {
    if (!auth.authenticate(req, reply)) {
      return reply; // 401 已由 authenticate 发送
    }
  });
  app.get("/protected", async () => ({ ok: true }));
  return app;
}

describe("认证启用(apiKeys 非空)", () => {
  it("无任何凭据 → 401 且 error.code=INVALID_INPUT", async () => {
    const auth = await freshAuth(["secret-key-1"]);
    expect(auth.isAuthEnabled()).toBe(true);
    const app = await buildApp(auth);

    const res = await app.inject({ method: "GET", url: "/protected" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    await app.close();
  });

  it("错误密钥 → 401", async () => {
    const auth = await freshAuth(["secret-key-1"]);
    const app = await buildApp(auth);

    const res = await app.inject({ method: "GET", url: "/protected", headers: { "x-api-key": "wrong-key" } });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("X-API-Key 正确 → 200", async () => {
    const auth = await freshAuth(["secret-key-1", "secret-key-2"]);
    const app = await buildApp(auth);

    const res = await app.inject({ method: "GET", url: "/protected", headers: { "x-api-key": "secret-key-2" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("Authorization: Bearer 正确 → 200", async () => {
    const auth = await freshAuth(["secret-key-1"]);
    const app = await buildApp(auth);

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer secret-key-1" },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("非 Bearer 前缀的 Authorization → 401(不解析为密钥)", async () => {
    const auth = await freshAuth(["secret-key-1"]);
    const app = await buildApp(auth);

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("开发模式(apiKeys 为空)", () => {
  it("不配置密钥时禁用认证,无凭据也放行", async () => {
    const auth = await freshAuth([]);
    expect(auth.isAuthEnabled()).toBe(false);
    const app = await buildApp(auth);

    const res = await app.inject({ method: "GET", url: "/protected" });

    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
