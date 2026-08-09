const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");

const port = 20000 + (process.pid % 10000);
const token = "test-token";
let bridge;

function request(options) {
  return new Promise((resolve, reject) => {
    const req = http.get(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}

function rawRequest(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.end(payload));
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}

before(async () => {
  bridge = spawn(process.execPath, [path.resolve(__dirname, "../server.js")], {
    env: {
      ...process.env,
      FAA_BRIDGE_PORT: String(port),
      FAA_BRIDGE_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Bridge startup timed out")), 5000);
    bridge.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    bridge.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error("Bridge exited during startup with code " + code));
    });
  });
});

after(() => {
  if (bridge && bridge.exitCode === null) bridge.kill();
});

test("status endpoint requires the configured token", async () => {
  const unauthorized = await request({ host: "127.0.0.1", port, path: "/status" });
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await request({
    host: "127.0.0.1",
    port,
    path: "/status",
    headers: { "x-faa-bridge-token": token },
  });
  assert.equal(authorized.statusCode, 200);
  assert.equal(JSON.parse(authorized.body).bridgeOnline, true);
});

test("malformed Host does not crash the bridge", async () => {
  const response = await rawRequest(
    "GET /status HTTP/1.1\r\nHost: [\r\nx-faa-bridge-token: test-token\r\nConnection: close\r\n\r\n"
  );
  assert.match(response, /^HTTP\/1\.1 200/);
  assert.equal(bridge.exitCode, null);
});

test("WebSocket upgrade rejects an invalid token", async () => {
  const response = await rawRequest(
    "GET /agent HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGVzdC1rZXktMTIzNA==\r\nSec-WebSocket-Version: 13\r\nx-faa-bridge-token: wrong\r\n\r\n"
  );
  assert.match(response, /^HTTP\/1\.1 401/);
});