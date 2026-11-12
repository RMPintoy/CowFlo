import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { pool } from "./db.js";

// Real-time updates.
//
// Every successful write (POST/PUT/PATCH/DELETE) broadcasts a small "something changed" signal to
// every screen of the same business. The signal only names topics (e.g. "inventory", "sales"); it
// never carries data, so each screen re-fetches through the normal API and its permission checks.

let io = null;

const adminRoom = (businessId) => `business:${businessId}`;
const posRoom = (businessId) => `pos:${businessId}`;

// Which topics a write to a given API path affects. First match wins.
const topicRules = [
  [/^\/api\/pos\/(checkout|refunds)/, ["sales", "inventory"]],
  [/^\/api\/inventory/, ["inventory"]],
  [/^\/api\/skus/, ["skus", "inventory"]],
  [/^\/api\/branches/, ["branches", "inventory", "session"]],
  [/^\/api\/accounts/, ["accounts"]],
  [/^\/api\/auth\/signup/, ["accounts"]],
  [/^\/api\/me\/business/, ["business", "session"]],
  [/^\/api\/me\/(account|profile-image|banner-image)/, ["accounts"]],
];

function topicsForPath(path) {
  const rule = topicRules.find(([pattern]) => pattern.test(path));
  return rule ? rule[1] : [];
}

export function broadcastChange(businessId, topics) {
  if (!io || !businessId || topics.length === 0) {
    return;
  }

  const event = { topics, at: Date.now() };

  io.to(adminRoom(businessId)).to(posRoom(businessId)).emit("change", event);
}

// Express middleware: after a write succeeds, tell the business's other screens.
export function liveUpdates(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  res.on("finish", () => {
    if (res.statusCode >= 400) {
      return;
    }

    const topics = topicsForPath(req.originalUrl.split("?")[0]);
    // Routes set these while handling the request: requireAccess -> req.access,
    // authenticatePos -> req.pos, and signup sets res.locals.liveBusinessId.
    const businessId = res.locals.liveBusinessId ?? req.access?.businessId ?? req.pos?.businessId;

    broadcastChange(businessId, topics);
  });

  return next();
}

async function joinRooms(socket, jwtSecret) {
  const token = socket.handshake.auth?.token;
  const payload = jwt.verify(String(token || ""), jwtSecret);

  if (payload.pos) {
    const result = await pool.query(
      `
        SELECT branches.is_disabled
        FROM branches
        JOIN businesses ON businesses.id = branches.business_id
        WHERE branches.id = $1 AND businesses.id = $2 AND businesses.status = 'A'
      `,
      [payload.branchId, payload.businessId],
    );

    if (!result.rows[0] || result.rows[0].is_disabled) {
      throw new Error("POS session ended.");
    }

    socket.join(posRoom(payload.businessId));
    return;
  }

  const result = await pool.query("SELECT business_id FROM users WHERE id = $1", [payload.sub]);
  const businessId = result.rows[0]?.business_id;

  if (!businessId) {
    throw new Error("User not found.");
  }

  socket.join(adminRoom(businessId));
}

export function attachRealtime(httpServer, { jwtSecret, isOriginAllowed }) {
  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        callback(null, !origin || isOriginAllowed(origin));
      },
    },
    // Render's free plan closes idle connections; pings keep them alive.
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      await joinRooms(socket, jwtSecret);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  return io;
}
