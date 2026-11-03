
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || "";
const MAX_PLAYERS = 30;
const TICK_MS = 50;
const PLAYER_SPEED = 11;
const MATCH_LENGTH = 30 * 60 * 1000;

const rooms = new Map();

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function makeGameCode() {
  let code;
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while ([...rooms.values()].some(room => room.code === code));
  return code;
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws, message) {
  send(ws, { type: "error", message });
}

function cleanName(value) {
  return String(value || "Player")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 18) || "Player";
}

function broadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function leaveRoom(ws) {
  if (!ws.roomCode) return;

  const room = rooms.get(ws.roomCode);
  if (!room) {
    ws.roomCode = null;
    return;
  }

  room.players.delete(ws.playerId);
  ws.roomCode = null;
  ws.playerId = null;

  broadcast(room, {
    type: "players",
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      team: p.team
    }))
  });

  if (room.players.size === 0) {
    rooms.delete(room.code);
  }
}

function createRoom(ws, msg) {
  if (!ADMIN_CODE) {
    return sendError(ws, "השרת עדיין לא הוגדר עם ADMIN_CODE.");
  }

  if (!safeEqual(String(msg.adminCode || ""), ADMIN_CODE)) {
    return sendError(ws, "קוד מנהל שגוי.");
  }

  const maxPlayers = Math.min(
    MAX_PLAYERS,
    Math.max(2, Number(msg.maxPlayers) || MAX_PLAYERS)
  );

  const mode = msg.mode === "teams" ? "teams" : "solo";
  const code = makeGameCode();

  const room = {
    code,
    mode,
    maxPlayers,
    players: new Map(),
    startedAt: null,
    ended: false,
    zoneRadius: 100
  };

  rooms.set(code, room);

  send(ws, {
    type: "roomCreated",
    code,
    mode,
    maxPlayers
  });
}

function joinRoom(ws, msg) {
  leaveRoom(ws);

  const code = String(msg.gameCode || "").trim();
  const room = rooms.get(code);

  if (!/^\d{6}$/.test(code) || !room) {
    return sendError(ws, "קוד המשחק לא נמצא.");
  }

  if (room.ended) {
    return sendError(ws, "המשחק הזה הסתיים.");
  }

  if (room.players.size >= room.maxPlayers) {
    return sendError(ws, "החדר מלא.");
  }

  const id = crypto.randomUUID();

  const team = room.mode === "teams"
    ? (room.players.size % 2) + 1
    : null;

  const player = {
    id,
    ws,
    name: cleanName(msg.name),
    team,
    x: 0,
    y: 0,
    z: 0,
    input: {
      forward: false,
      backward: false,
      left: false,
      right: false
    }
  };

  room.players.set(id, player);

  ws.roomCode = code;
  ws.playerId = id;

  send(ws, {
    type: "joined",
    gameCode: code,
    playerId: id,
    team,
    mode: room.mode,
    started: Boolean(room.startedAt)
  });

  broadcast(room, {
    type: "players",
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      team: p.team
    }))
  });
}

function startRoom(ws, msg) {
  if (!ADMIN_CODE || !safeEqual(String(msg.adminCode || ""), ADMIN_CODE)) {
    return sendError(ws, "אין הרשאת מנהל.");
  }

  const code = String(msg.gameCode || "");
  const room = rooms.get(code);

  if (!room) return sendError(ws, "החדר לא נמצא.");
  if (room.startedAt) return sendError(ws, "המשחק כבר התחיל.");

  room.startedAt = Date.now();

  broadcast(room, {
    type: "gameStarted",
    startedAt: room.startedAt,
    duration: MATCH_LENGTH
  });
}

function handleMessage(ws, raw) {
  let msg;

  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return sendError(ws, "הודעה לא תקינה.");
  }

  if (!msg || typeof msg.type !== "string") {
    return sendError(ws, "סוג הודעה חסר.");
  }

  switch (msg.type) {
    case "createRoom":
      createRoom(ws, msg);
      break;

    case "joinRoom":
      joinRoom(ws, msg);
      break;

    case "leaveRoom":
      leaveRoom(ws);
      send(ws, { type: "left" });
      break;

    case "startRoom":
      startRoom(ws, msg);
      break;

    case "input": {
      const room = rooms.get(ws.roomCode);
      if (!room || !room.startedAt || room.ended) return;

      const player = room.players.get(ws.playerId);
      if (!player) return;

      const input = msg.input || {};

      player.input = {
        forward: input.forward === true,
        backward: input.backward === true,
        left: input.left === true,
        right: input.right === true
      };
      break;
    }

    default:
      sendError(ws, "פעולה לא מוכרת.");
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      status: "ok",
      rooms: rooms.size
    }));
  }

  const root = path.resolve(__dirname);
  const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.resolve(root, "." + requested);

  if (!filePath.startsWith(root + path.sep) || filePath === root) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream"
    });
    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 4096
});

wss.on("connection", ws => {
  ws.roomCode = null;
  ws.playerId = null;

  ws.on("message", raw => handleMessage(ws, raw));
  ws.on("close", () => leaveRoom(ws));
  ws.on("error", () => leaveRoom(ws));
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (!room.startedAt || room.ended) continue;

    const elapsed = now - room.startedAt;

    if (elapsed >= MATCH_LENGTH) {
      room.ended = true;
      broadcast(room, { type: "gameEnded" });
      continue;
    }

    room.zoneRadius = Math.max(
      12,
      100 * (1 - elapsed / MATCH_LENGTH)
    );

    for (const player of room.players.values()) {
      const input = player.input;
      let dx = 0;
      let dz = 0;

      if (input.forward) dz -= 1;
      if (input.backward) dz += 1;
      if (input.left) dx -= 1;
      if (input.right) dx += 1;

      const length = Math.hypot(dx, dz) || 1;

      player.x += (dx / length) * PLAYER_SPEED * (TICK_MS / 1000);
      player.z += (dz / length) * PLAYER_SPEED * (TICK_MS / 1000);

      player.x = Math.max(-100, Math.min(100, player.x));
      player.z = Math.max(-100, Math.min(100, player.z));
    }

    broadcast(room, {
      type: "snapshot",
      elapsed,
      zoneRadius: room.zoneRadius,
      players: [...room.players.values()].map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        x: p.x,
        y: p.y,
        z: p.z
      }))
    });
  }
}, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BATTLESHOT server running on port ${PORT}`);
});
