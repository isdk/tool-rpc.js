import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { HttpServerToolTransport } from './http-server';
import { MailboxServerTransport } from './mailbox-server';
import { RpcServerDispatcher } from './dispatcher';
import { RpcTransportManager } from './server-manager';
import { RpcSessionIdentityPolicy } from './identity-session';
import { RpcBearerPolicy } from './identity-bearer';
import { RPC_HEADERS, type ToolRpcRequest } from './models';
import type { RpcIdentity, RpcIdentityContext, RpcIdentityPolicy } from './identity';

/**
 * P1b 流水线回归：身份判定插在 `toRpcRequest` 与 `validateRpcRequest` 之间（设计文档 §10）。
 *
 * 两条必钉的回归（§14 第 3 条）：
 * - **未装策略时 header 透传与今天逐字节一致**：`clientId` 就是客户端自报值，`ctx.identity` 是 undefined。
 * - **装了策略后 401 的响应形状**：`RpcError('Unauthenticated', 401, 'unauthenticated')`
 *   经顶级防护映射成 `status: 401` + `error.status: 'unauthenticated'`。
 */

const mockRes = () => {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    headersSent: false,
    setHeader(k: string, v: string) { res.headers[k] = String(v); },
    end(data?: string) { res.body = data ?? ''; },
  };
  return res as unknown as http.ServerResponse & { statusCode: number, headers: Record<string, string>, body: string };
};

const mockReq = (headers: Record<string, string>, url = '/api/tool'): http.IncomingMessage => ({
  url,
  method: 'POST',
  headers: { host: 'localhost', ...headers },
  on: (event: string, cb: any) => {
    if (event === 'data') {cb('{}');}
    if (event === 'end') {cb();}
  },
} as unknown as http.IncomingMessage);

const echoDispatcher = (): { dispatch: (req: any) => Promise<any>, seen: ToolRpcRequest[] } => {
  const seen: ToolRpcRequest[] = [];
  return {
    seen,
    dispatch: async (req: any) => {
      seen.push(req);
      return { status: 200, data: { clientId: req.clientId, identity: req.identity } };
    },
  };
};

describe('identity in the server pipeline', () => {
  afterEach(() => {
    (HttpServerToolTransport as any).sharedServers.clear();
  });

  it('未装策略：clientId 透传客户端自报值，identity 不存在（与今天逐字节一致）', async () => {
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({ apiUrl: 'http://localhost/api', dispatcher: disp as any });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(
      mockReq({ [RPC_HEADERS.CLIENT_ID]: 'self-reported-42', authorization: 'Bearer whatever' }),
      res,
    );

    expect(res.statusCode).toBe(200);
    // sendRpcResponse 直接 end(JSON.stringify(rpcRes.data))：响应体就是 data 本体
    const body = JSON.parse(res.body);
    expect(body.clientId).toBe('self-reported-42');
    expect(body.identity).toBeUndefined();
    expect(disp.seen[0].clientId).toBe('self-reported-42');
    expect(disp.seen[0].identity).toBeUndefined();
  });

  it('装了策略：request.clientId === identity.id（契约 3），且 Manager 校验看得到 identity', async () => {
    const disp = echoDispatcher();
    const manager = new RpcTransportManager();
    const validated: ToolRpcRequest[] = [];
    const original = manager.validateRpcRequest.bind(manager);
    manager.validateRpcRequest = (req: ToolRpcRequest) => {
      validated.push(req);
      return original(req);
    };

    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      manager: manager as any,
      identity: new RpcSessionIdentityPolicy(),
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({ [RPC_HEADERS.CLIENT_ID]: 'client-lies' }), res);

    expect(res.statusCode).toBe(200);
    // 客户端自报值不作身份（契约 4）：装策略后由服务端判定值接管
    expect(validated).toHaveLength(1);
    const identity = validated[0].identity as RpcIdentity;
    expect(identity).toBeDefined();
    expect(validated[0].clientId).toBe(identity.id);
    expect(validated[0].clientId).not.toBe('client-lies');
    expect(disp.seen[0].clientId).toBe(identity.id);
  });

  it('装了策略后 401 的响应形状：status 401 + error.status unauthenticated', async () => {
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      identity: new RpcBearerPolicy({ verify: () => undefined, allowAnonymous: false }),
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({}), res);

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe(401);
    expect(body.error.status).toBe('unauthenticated');
    expect(body.error.message).toBe('Unauthenticated');
    // 拒绝发生在业务之前：dispatcher 没被调用
    expect(disp.seen).toHaveLength(0);
  });

  it('bearer 策略：authorization 的 Bearer 前缀被内置 reader 去掉，verify 拿到裸凭证', async () => {
    const verified: string[] = [];
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      identity: new RpcBearerPolicy({
        verify: (credential) => {
          verified.push(credential);
          return { id: `user-${credential}`, attributes: { scopes: ['read'] } };
        },
      }),
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({ authorization: 'Bearer tok-1' }), res);

    expect(verified).toEqual(['tok-1']);
    const identity = disp.seen[0].identity as RpcIdentity;
    expect(identity.id).toBe('user-tok-1');
    expect(identity.attributes?.scopes).toEqual(['read']);
    expect(disp.seen[0].clientId).toBe('user-tok-1');
  });

  it('私有 header 走部署自己的 credentialReader（契约 9）', async () => {
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      identity: new RpcBearerPolicy({ verify: (t) => ({ id: `x-${t}` }) }),
      credentialReader: (req: http.IncomingMessage) => req.headers['x-auth'] as string,
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({ 'x-auth': 'proxy-token' }), res);

    expect(disp.seen[0].clientId).toBe('x-proxy-token');
  });

  it('transport 没装 reader 时内置 bearer reader 就是权威：私有 header 不被采信（契约 9）', async () => {
    // 钉住 `server.ts:322` 那个无条件赋值：transport 没配 `credentialReader` 时，
    // `:318` 的 `?? readBearerCredential` 就是它的 reader，`ctx.credentialRead` 照样为 true。
    // 所以「transport 没装 reader」不是一种可观测状态：内置 reader 已在读标准字段，它说没有就是没有。
    // 私有 header 要配到 transport 上（上一条测试）；策略侧没有可注入的 reader 能把它捡回来。
    //
    // `x-auth` 的值故意选成**能过 verify** 的：这样 401 只能来自「那个来路不是 reader 认的」，
    // 而不是来自 verify 拒了它。
    const verified: string[] = [];
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      identity: new RpcBearerPolicy({
        allowAnonymous: false,
        verify: (credential) => {
          verified.push(credential);
          return { id: `x-${credential}` };
        },
      }),
      // 关键：这里**不**配 transport 的 credentialReader
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({ 'x-auth': 'proxy-token' }), res);

    expect(verified).toHaveLength(0);            // 没有任何凭证来路被采信
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe(401);
    expect(body.error.status).toBe('unauthenticated');
    expect(disp.seen).toHaveLength(0);           // 拒绝发生在业务之前

    // 同一个 transport、同一个策略：标准字段里的凭证能过——证明跑的就是内置 bearer reader
    const res2 = mockRes();
    await (transport as any).processIncomingCall(mockReq({ authorization: 'Bearer std-token' }), res2);

    expect(verified).toEqual(['std-token']);
    expect(disp.seen[0].clientId).toBe('x-std-token');
  });

  it('会话策略端到端：首次连接签发凭证，带回来续用同一个身份', async () => {
    const policy = new RpcSessionIdentityPolicy();
    const issued: RpcIdentity[] = [];
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      identity: policy,
    });
    transport.addRpcHandler('http://localhost/api');

    // 第一趟：没有凭证 → assign 发一张（下发通道归策略，框架侧不写 header）
    const res1 = mockRes();
    await (transport as any).processIncomingCall(mockReq({}), res1);
    const first = disp.seen[0].identity as RpcIdentity;
    issued.push(first);
    expect(first.credential).toBeTypeOf('string');
    // 框架侧不定义凭证 header（契约 11）：响应里没有策略没要求写的东西
    expect((res1 as any).headers['rpc-session-token']).toBeUndefined();

    // 第二趟：客户端把凭证带回来 → 同一个身份
    const res2 = mockRes();
    await (transport as any).processIncomingCall(mockReq({ authorization: `Bearer ${first.credential}` }), res2);
    const second = disp.seen[1].identity as RpcIdentity;
    expect(second.id).toBe(first.id);
    expect(second.credential).toBeUndefined();   // 续用不重发凭证
  });

  it('ctx 备料：headers 已归一化、prefix/apiUrl 命中、res 是交付句柄', async () => {
    let ctx: RpcIdentityContext | undefined;
    const policy: RpcIdentityPolicy = {
      name: 'ctx-probe',
      match: (c) => { ctx = c; return undefined; },
      assign: () => ({ id: 'probe' }),
    };

    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({ apiUrl: 'http://localhost/api', dispatcher: disp as any, identity: policy });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({ 'x-tenant': 'acme' }, '/api/tool'), res);

    expect(ctx).toBeDefined();
    expect(ctx!.headers?.['x-tenant']).toBe('acme');
    expect(ctx!.headers?.[RPC_HEADERS.CLIENT_ID]).toBeUndefined();
    expect(ctx!.prefix).toBe('/api');
    expect(ctx!.apiUrl).toContain('/api');
    expect(ctx!.res).toBe(res);
    expect(ctx!.req).toBeDefined();
  });

  it('业务侧唯一读法是 ctx.identity（dispatcher.prepareContext 透传）', async () => {
    const dispatcher = new RpcServerDispatcher();
    const seen: (RpcIdentity | undefined)[] = [];
    dispatcher.registry = {
      get: () => ({
        name: 'who',
        run: (_params: any, ctx: any) => {
          seen.push(ctx.identity);
          return { id: ctx.identity?.id, scopes: ctx.identity?.attributes?.scopes };
        },
      }),
    };

    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher,
      identity: new RpcBearerPolicy({ verify: () => ({ id: 'u9', attributes: { scopes: ['admin'] } }) }),
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({ authorization: 'Bearer jwt-here' }), res);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBe('u9');
    expect(JSON.parse(res.body)).toMatchObject({ id: 'u9', scopes: ['admin'] });
  });

  it('非 HTTP 协议：Mailbox 的 MailMessage.headers 走同一个默认 reader', async () => {
    const transport = new MailboxServerTransport({
      apiUrl: 'mem://identity-test',
      identity: new RpcBearerPolicy({ verify: (t) => ({ id: `user-${t}` }) }),
    });

    const message = {
      id: 'm1',
      body: {},
      headers: { 'req-id': 'r1', 'rpc-fn': 'tool', authorization: 'Bearer mb-1' },
      from: 'client@isdk.com',
      to: 'mem://identity-test',
    };
    const rpcReq: ToolRpcRequest = {
      apiUrl: 'mem://identity-test',
      toolId: 'tool',
      requestId: 'r1',
      params: {},
      headers: message.headers as Record<string, string>,
    };

    await (transport as any).resolveRequestIdentity(rpcReq, message, message);
    expect(rpcReq.clientId).toBe('user-mb-1');
    expect((rpcReq.identity as RpcIdentity).id).toBe('user-mb-1');
  });

  it('未装策略的 transport 调 resolveRequestIdentity 就是 no-op（不碰 clientId）', async () => {
    const transport = new HttpServerToolTransport({ apiUrl: 'http://localhost/api' });
    const rpcReq: ToolRpcRequest = {
      apiUrl: 'http://localhost/api',
      toolId: 'tool',
      requestId: 'r1',
      clientId: 'self-reported',
      params: {},
      headers: { [RPC_HEADERS.CLIENT_ID]: 'self-reported', authorization: 'Bearer whatever' },
    };

    await (transport as any).resolveRequestIdentity(rpcReq, mockReq({}), mockRes());
    expect(rpcReq.clientId).toBe('self-reported');
    expect(rpcReq.identity).toBeUndefined();
  });

  it('逐 API 判定的备料：路由级声明的 registry 里的实例也进 ctx（prefix / toolId / act / resId / tool）', async () => {
    const seen: RpcIdentityContext[] = [];
    const adminTool = { name: 'admin', authScope: 'admin' };

    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/v1',
      dispatcher: echoDispatcher() as any,
      identity: new RpcBearerPolicy({
        verify: () => ({ id: 'admin-user' }),
        // 逐 API：注册时带 authScope 的那个必须凭证，其余匿名可进
        allowAnonymous: (ctx) => {
          seen.push(ctx);
          return !(ctx.tool as any)?.authScope;
        },
      }),
    });
    transport.addRpcHandler('http://localhost/v1', {
      registry: { get: (id: string) => (id === 'admin' ? adminTool : undefined) },
    });

    const resPublic = mockRes();
    await (transport as any).processIncomingCall(mockReq({}, '/v1/public'), resPublic);
    expect(resPublic.statusCode).toBe(200);

    const resAdmin = mockRes();
    await (transport as any).processIncomingCall(mockReq({ [RPC_HEADERS.ACT]: 'get' }, '/v1/admin/res-7'), resAdmin);
    expect(resAdmin.statusCode).toBe(401);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ prefix: '/v1', toolId: 'public' });
    expect(seen[0].tool).toBeUndefined();         // 解析不到就是 undefined，不在这一步报 404

    expect(seen[1]).toMatchObject({ prefix: '/v1', toolId: 'admin', act: 'get', resId: 'res-7' });
    expect(seen[1].tool).toBe(adminTool);         // 前缀 claim 的 registry，与 dispatcher 同一解析顺序
  });

  // 设计文档 §16：工具上带自定义字段只是**数据**，生效靠策略谓词读它。
  // 这两条钉住边界，免得有人以为注册时写个 `allowAnonymous: true` 框架就会认。
  it('工具上写 `allowAnonymous: true` 本身不生效：框架不读 `tool` 的字段（§16）', async () => {
    const registry = {
      get: (id: string) => (id === 'public' ? { name: 'public', allowAnonymous: true } : { name: 'strict' }),
    };
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/v1',
      dispatcher: echoDispatcher() as any,
      identity: new RpcBearerPolicy({ verify: () => ({ id: 'u' }), allowAnonymous: false }),
    });
    transport.addRpcHandler('http://localhost/v1', { registry });

    const resPublic = mockRes();
    await (transport as any).processIncomingCall(mockReq({}, '/v1/public'), resPublic);
    const resStrict = mockRes();
    await (transport as any).processIncomingCall(mockReq({}, '/v1/strict'), resStrict);

    // 两个都是 401：那个字段对框架而言与 `authScope` / `isApi` 无异，没人读它
    expect(resPublic.statusCode).toBe(401);
    expect(resStrict.statusCode).toBe(401);
  });

  it('谓词读 `ctx.tool` 上的字段才生效：逐工具的 allowAnonymous 是这么写的（§16）', async () => {
    const registry = {
      get: (id: string) => (id === 'public' ? { name: 'public', allowAnonymous: true } : { name: 'strict' }),
    };
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/v1',
      dispatcher: echoDispatcher() as any,
      identity: new RpcBearerPolicy({
        verify: () => ({ id: 'u' }),
        allowAnonymous: (ctx) => (ctx.tool as any)?.allowAnonymous === true,
      }),
    });
    transport.addRpcHandler('http://localhost/v1', { registry });

    const resPublic = mockRes();
    await (transport as any).processIncomingCall(mockReq({}, '/v1/public'), resPublic);
    expect(resPublic.statusCode).toBe(200);

    const resStrict = mockRes();
    await (transport as any).processIncomingCall(mockReq({}, '/v1/strict'), resStrict);
    expect(resStrict.statusCode).toBe(401);
    expect(JSON.parse(resStrict.body).error).toMatchObject({ code: 401, status: 'unauthenticated' });
  });

  it('钩子可 async：框架侧一律 await（契约 10）', async () => {
    const disp = echoDispatcher();
    const transport = new HttpServerToolTransport({
      apiUrl: 'http://localhost/api',
      dispatcher: disp as any,
      identity: {
        name: 'async-policy',
        match: async () => undefined,
        assign: async () => ({ id: 'async-assigned' }),
      } as RpcIdentityPolicy,
    });
    transport.addRpcHandler('http://localhost/api');

    const res = mockRes();
    await (transport as any).processIncomingCall(mockReq({}), res);

    expect(disp.seen[0].clientId).toBe('async-assigned');
    expect(res.statusCode).toBe(200);
  });
});
