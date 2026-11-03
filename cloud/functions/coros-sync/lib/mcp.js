// 高驰官方 MCP 调用（Node 18 原生 fetch）—— 移植自 tools/coros_probe.py
//
// 只用标准能力，无第三方依赖。区域端点按 REGION 选。

const PROTOCOL_VERSION = '2025-06-18';

/** 一次 HTTP 请求，返回 { status, headers, text } */
async function httpRequest(url, opts) {
  const resp = await fetch(url, opts || {});
  const text = await resp.text();
  return { status: resp.status, headers: resp.headers, text: text };
}

/** 兼容普通 JSON 与 SSE(text/event-stream) 两种返回 */
function extractJson(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch (e) { /* 继续尝试 SSE */ }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.indexOf('data:') === 0) {
      try { return JSON.parse(line.slice(5).trim()); } catch (e) { /* 下一行 */ }
    }
  }
  return null;
}

/** 发一条 JSON-RPC 请求到 MCP 端点 */
async function mcpRequest(mcpUrl, method, params, token, sessionId, notify) {
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
    'Content-Type': 'application/json'
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const payload = { jsonrpc: '2.0', method: method };
  if (!notify) payload.id = 1;
  if (params !== undefined && params !== null) payload.params = params;
  const r = await httpRequest(mcpUrl, { method: 'POST', headers: headers, body: JSON.stringify(payload) });
  const newSession = r.headers.get('Mcp-Session-Id') || r.headers.get('mcp-session-id') || sessionId;
  return { status: r.status, session: newSession, data: extractJson(r.text), text: r.text };
}

/** initialize + notifications/initialized，返回会话 id */
async function openSession(mcpUrl, token) {
  const init = await mcpRequest(mcpUrl, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'coros-run-cloud', version: '1.0' }
  }, token);
  if (init.status >= 400 || (init.data && init.data.error)) {
    throw new Error('MCP initialize 失败：HTTP ' + init.status + ' ' + String(init.text || '').slice(0, 200));
  }
  await mcpRequest(mcpUrl, 'notifications/initialized', null, token, init.session, true);
  return init.session;
}

/** 调用一个 MCP 工具 */
async function callTool(mcpUrl, name, args, token, session) {
  return mcpRequest(mcpUrl, 'tools/call', { name: name, arguments: args || {} }, token, session);
}

/** 用 refresh_token 换新 token；失败返回 null */
async function refreshToken(tokenUrl, refreshValue, clientId) {
  if (!refreshValue) return null;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshValue,
    client_id: clientId || ''
  });
  const r = await httpRequest(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const data = extractJson(r.text);
  if (r.status >= 400 || !data || !data.access_token) return null;
  return data;
}

module.exports = {
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  httpRequest: httpRequest,
  extractJson: extractJson,
  openSession: openSession,
  callTool: callTool,
  refreshToken: refreshToken
};
