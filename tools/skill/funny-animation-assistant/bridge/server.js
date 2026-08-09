/* eslint-disable no-console */
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = Number(process.env.FAA_BRIDGE_PORT || 17321);
const BRIDGE_TOKEN = process.env.FAA_BRIDGE_TOKEN || "";
const BRIDGE_VERSION = "0.2.0";
const PROTOCOL_VERSION = "faa-agent-v1";
const REQUEST_BASE_URL = `http://${HOST}:${PORT}`;
const MAX_FRAME_BYTES = Number(process.env.FAA_BRIDGE_MAX_FRAME_BYTES || 25 * 1024 * 1024);
const ALLOWED_COMMAND_METHODS = new Set([
  "scan_stage",
  "scan_stage_at_frame",
  "get_timeline_summary",
  "set_current_frame",
  "get_symbol_structure",
  "get_group_structure",
  "open_document",
  "close_document_without_save",
  "cancel_job",
  "get_job_status",
  "export_character",
  "export_batch",
]);

let plugin = null;
const agents = new Map();
const pending = new Map();

function encodeFrame(text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x81;
  return Buffer.concat([header, payload]);
}

function tryDecodeFrames(connection) {
  const messages = [];
  let buffer = connection.buffer;

  while (buffer.length >= 2) {
    const opcode = buffer[0] & 0x0f;
    let offset = 2;
    let length = buffer[1] & 0x7f;
    const masked = (buffer[1] & 0x80) !== 0;

    if (length === 126) {
      if (buffer.length < offset + 2) break;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) break;
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    if (!Number.isSafeInteger(length) || length > MAX_FRAME_BYTES) {
      connection.socket.end();
      connection.buffer = Buffer.alloc(0);
      return messages;
    }

    let mask;
    if (masked) {
      if (buffer.length < offset + 4) break;
      mask = buffer.slice(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + length) break;
    let payload = buffer.slice(offset, offset + length);
    buffer = buffer.slice(offset + length);

    if (opcode === 0x8) {
      connection.socket.end();
      continue;
    }

    if (masked) {
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }
  }

  connection.buffer = buffer;
  return messages;
}

function send(connection, message) {
  if (!connection || connection.socket.destroyed) return;
  connection.socket.write(encodeFrame(JSON.stringify(message)));
}

function sendCommandError(connection, id, code, message) {
  send(connection, {
    type: "command.response",
    id: id || null,
    ok: false,
    error: { code, message },
  });
}

function isTokenAccepted(req, requestUrl) {
  if (!BRIDGE_TOKEN) return true;
  const header = req.headers["x-faa-bridge-token"];
  const query = requestUrl.searchParams.get("token");
  return header === BRIDGE_TOKEN || query === BRIDGE_TOKEN;
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url || "/", REQUEST_BASE_URL);
  } catch {
    return null;
  }
}

function broadcastAgentList() {
  const list = Array.from(agents.values()).map((agent) => ({
    clientId: agent.clientId,
    clientName: agent.clientName,
    pid: agent.pid,
    connectedAt: agent.connectedAt,
    lastRequestAt: agent.lastRequestAt,
  }));
  send(plugin, { type: "agent.list", agents: list });
}

function closeAgent(clientId) {
  const agent = agents.get(clientId);
  if (agent) {
    agent.socket.end();
    agents.delete(clientId);
    for (const [requestId, pendingAgent] of pending) {
      if (pendingAgent === agent) {
        pending.delete(requestId);
      }
    }
    broadcastAgentList();
  }
}

function replaceExistingAgent(connection) {
  if (!connection.clientId) return;
  const existing = agents.get(connection.clientId);
  if (!existing || existing === connection) return;

  for (const [requestId, pendingAgent] of pending) {
    if (pendingAgent === existing) {
      pending.delete(requestId);
    }
  }
  try {
    existing.socket.end();
  } catch (err) {
    existing.socket.destroy();
  }
  agents.delete(connection.clientId);
}

function handlePluginMessage(connection, msg) {
  if (msg.type === "plugin.hello") {
    if (plugin && plugin !== connection && !plugin.socket.destroyed) {
      try {
        plugin.socket.end();
      } catch {
        plugin.socket.destroy();
      }
    }
    plugin = connection;
    connection.pluginInfo = msg;
    console.log("[bridge] plugin connected:", msg.plugin || "unknown");
    broadcastAgentList();
    return;
  }

  if (connection !== plugin) return;

  if (msg.type === "command.response") {
    const agent = pending.get(msg.id);
    if (agent) {
      pending.delete(msg.id);
      send(agent, msg);
    }
    return;
  }

  if (msg.type === "job.event") {
    for (const agent of agents.values()) {
      send(agent, msg);
    }
    return;
  }

  if (msg.type === "agent.disconnect") {
    closeAgent(msg.clientId);
  }
}

function handleAgentMessage(connection, msg) {
  if (msg.type === "agent.bye") {
    if (connection.clientId) {
      closeAgent(connection.clientId);
    }
    return;
  }

  if (msg.type === "agent.hello") {
    connection.clientName = msg.clientName || "agent";
    connection.pid = msg.pid || null;
    connection.clientId = msg.clientId || `${connection.clientName}:${connection.pid || crypto.randomBytes(4).toString("hex")}`;
    connection.connectedAt = new Date().toISOString();
    connection.lastRequestAt = null;
    replaceExistingAgent(connection);
    agents.set(connection.clientId, connection);
    send(connection, {
      type: "agent.hello.ack",
      clientId: connection.clientId,
      pluginOnline: !!plugin,
      bridgeVersion: BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    broadcastAgentList();
    return;
  }

  if (msg.type === "command.request") {
    if (!connection.clientId) {
      sendCommandError(connection, msg.id, "AGENT_NOT_REGISTERED", "Agent must send agent.hello before command.request");
      return;
    }
    if (!msg.id || typeof msg.id !== "string") {
      sendCommandError(connection, msg.id, "INVALID_REQUEST", "command.request requires a string id");
      return;
    }
    if (!ALLOWED_COMMAND_METHODS.has(msg.method)) {
      sendCommandError(connection, msg.id, "METHOD_NOT_ALLOWED", `Method is not allowed: ${msg.method || "unknown"}`);
      return;
    }
    connection.lastRequestAt = new Date().toISOString();
    broadcastAgentList();
    if (!plugin) {
      send(connection, {
        type: "command.response",
        id: msg.id,
        ok: false,
        error: { code: "PLUGIN_OFFLINE", message: "Animate 插件面板未连接" },
      });
      return;
    }
    pending.set(msg.id, connection);
    send(plugin, msg);
  }
}

function attachSocket(socket, role) {
  const connection = { socket, role, buffer: Buffer.alloc(0) };
  function cleanupConnection() {
    if (connection.cleanedUp) return;
    connection.cleanedUp = true;
    if (connection === plugin) {
      plugin = null;
      console.log("[bridge] plugin disconnected");
    }
    if (connection.clientId && agents.get(connection.clientId) === connection) {
      agents.delete(connection.clientId);
      for (const [requestId, pendingAgent] of pending) {
        if (pendingAgent === connection) {
          pending.delete(requestId);
        }
      }
      broadcastAgentList();
    }
  }

  socket.setKeepAlive(true, 5000);
  socket.on("data", (chunk) => {
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    for (const raw of tryDecodeFrames(connection)) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        console.error("[bridge] invalid json:", err.message);
        continue;
      }
      if (role === "plugin") {
        handlePluginMessage(connection, msg);
      } else {
        handleAgentMessage(connection, msg);
      }
    }
  });
  socket.on("end", cleanupConnection);
  socket.on("close", cleanupConnection);
  socket.on("error", () => {
    socket.destroy();
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = parseRequestUrl(req);
  if (!requestUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: "BAD_REQUEST", message: "Invalid request URL" } }));
    return;
  }
  if (requestUrl.pathname === "/status") {
    if (!isTokenAccepted(req, requestUrl)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid bridge token" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      bridgeOnline: true,
      bridgeVersion: BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      pluginOnline: !!plugin,
      plugin: plugin && plugin.pluginInfo ? {
        name: plugin.pluginInfo.plugin || null,
        version: plugin.pluginInfo.version || null,
      } : null,
      agents: agents.size,
    }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.on("upgrade", (req, socket) => {
  const requestUrl = parseRequestUrl(req);
  if (!requestUrl) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!isTokenAccepted(req, requestUrl)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const role = requestUrl.pathname === "/plugin" ? "plugin" : requestUrl.pathname === "/agent" ? "agent" : null;
  if (!role) {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
  );
  attachSocket(socket, role);
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on ws://${HOST}:${PORT}`);
});
