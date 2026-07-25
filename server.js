/* ================= RIDECIRCLE — SERVER =================
   Plain Node.js (no npm install needed). Serves the static front-end
   from /public and exposes a JSON REST API under /api/*.
   Run with:  node server.js
   Then open: http://localhost:3000
========================================================= */

const http = require("http");
const ALLOWED_ORIGIN = "https://ridecircle-1315a.web.app";
const fs = require("fs");
const path = require("path");
const url = require("url");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_COOKIE = "rc_session";

/* ---------------------------- helpers ---------------------------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function isLocalRequest(req) {
  const host = (req.headers.host || "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1";
}

function setSessionCookie(res, token, req) {
  // Frontend (Firebase Hosting) and backend (Render) are on different
  // domains in production, so the cookie must be SameSite=None; Secure
  // to be sent on cross-site fetch() calls. Locally (same-origin,
  // plain http) SameSite=Lax without Secure still works and is easier
  // to test with.
  const crossSite = !isLocalRequest(req);
  const attrs = crossSite ? "SameSite=None; Secure" : "SameSite=Lax";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; ${attrs}; Max-Age=${60 * 60 * 24 * 30}`
  );
}

function clearSessionCookie(res, req) {
  const crossSite = !isLocalRequest(req);
  const attrs = crossSite ? "SameSite=None; Secure" : "SameSite=Lax";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; ${attrs}; Max-Age=0`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks += chunk;
    });
    req.on("end", () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return db.userForSession(token);
}

function currentToken(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] || null;
}

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

function isAdmin(u) {
  return !!u && u.role === "admin";
}

/* -------- static file serving (with directory + no-ext fallback) -------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));

  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (pathname === "/") filePath = path.join(PUBLIC_DIR, "index.html");

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      return streamFile(res, filePath);
    }
    // try adding .html
    const withHtml = filePath + ".html";
    fs.stat(withHtml, (err2, stat2) => {
      if (!err2 && stat2.isFile()) {
        return streamFile(res, withHtml);
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
    });
  });
}

function streamFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

/* ------------------------------ API ROUTES ------------------------------ */

const routes = [];
function route(method, pattern, handler) {
  // pattern like /api/bikes/:id -> regex with named groups
  const keys = [];
  const regexStr =
    "^" +
    pattern.replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return "([^/]+)";
    }) +
    "$";
  routes.push({ method, regex: new RegExp(regexStr), keys, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
  }
  return null;
}

/* ---------- auth ---------- */

route("POST", "/api/signup", async (req, res, params, body) => {
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!name || !email || password.length < 4) {
    return sendJson(res, 400, { ok: false, error: "Please fill every field (password: 4+ characters)." });
  }
  const data = db.data;
  if (data.users.some((u) => u.email === email)) {
    return sendJson(res, 409, { ok: false, error: "An account with this email already exists." });
  }
  const user = {
    id: db.newId("user"),
    name,
    email,
    password: db.hashPassword(password),
    role: "user",
    initials: name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join(""),
    joinedRides: [],
    createdAt: Date.now()
  };
  data.users.push(user);
  db.save();
  const token = db.createSession(email);
  setSessionCookie(res, token, req);
  sendJson(res, 200, { ok: true, user: publicUser(user) });
});

route("POST", "/api/login", async (req, res, params, body) => {
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const data = db.data;
  const user = data.users.find((u) => u.email === email);
  if (!user || !db.verifyPassword(password, user.password)) {
    return sendJson(res, 401, { ok: false, error: "No matching account. Check your email and password." });
  }
  const token = db.createSession(email);
  setSessionCookie(res, token, req);
  sendJson(res, 200, { ok: true, user: publicUser(user) });
});

route("POST", "/api/google-login", async (req, res, params, body) => {
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  if (!name || !email) {
    return sendJson(res, 400, { ok: false, error: "Please provide a name and email." });
  }
  const data = db.data;
  let user = data.users.find((u) => u.email === email);
  if (!user) {
    user = {
      id: db.newId("user"),
      name,
      email,
      password: null,
      provider: "google",
      role: "user",
      initials: name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join(""),
      joinedRides: [],
      createdAt: Date.now()
    };
    data.users.push(user);
    db.save();
  }
  const token = db.createSession(email);
  setSessionCookie(res, token, req);
  sendJson(res, 200, { ok: true, user: publicUser(user) });
});

route("POST", "/api/logout", async (req, res) => {
  const token = currentToken(req);
  if (token) db.destroySession(token);
  clearSessionCookie(res, req);
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/me", async (req, res) => {
  const user = currentUser(req);
  sendJson(res, 200, { ok: true, user: publicUser(user) });
});

/* ---------- rides ---------- */

route("GET", "/api/rides", async (req, res) => {
  const data = db.data;
  const rides = data.rides.filter((r) => r.status !== "rejected");
  sendJson(res, 200, { ok: true, rides });
});

route("GET", "/api/rides/:id", async (req, res, params) => {
  const data = db.data;
  const ride = data.rides.find((r) => r.id === params.id);
  if (!ride) return sendJson(res, 404, { ok: false, error: "Ride not found." });
  const reviews = data.reviews[params.id] || [];
  sendJson(res, 200, { ok: true, ride, reviews });
});

route("POST", "/api/rides/:id/join", async (req, res, params) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const data = db.data;
  const ride = data.rides.find((r) => r.id === params.id);
  if (!ride) return sendJson(res, 404, { ok: false, error: "Ride not found." });

  const existing = data.joinRequests.find(
    (r) => r.rideId === params.id && r.userEmail === user.email && r.status === "pending"
  );
  if (existing) return sendJson(res, 200, { ok: true, request: existing, alreadyRequested: true });
  if ((user.joinedRides || []).includes(params.id)) {
    return sendJson(res, 200, { ok: true, alreadyJoined: true });
  }

  const request = {
    id: db.newId("jr"),
    rideId: params.id,
    rideTitle: ride.title,
    userEmail: user.email,
    userName: user.name,
    status: "pending",
    createdAt: Date.now()
  };
  data.joinRequests.push(request);
  db.save();
  sendJson(res, 200, { ok: true, request });
});

route("POST", "/api/rides/:id/reviews", async (req, res, params, body) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const stars = Math.max(1, Math.min(5, parseInt(body.stars, 10) || 5));
  const text = (body.text || "").trim();
  if (!text) return sendJson(res, 400, { ok: false, error: "Review text is required." });

  const data = db.data;
  if (!data.reviews[params.id]) data.reviews[params.id] = [];
  const review = { name: user.name, stars, text, createdAt: Date.now() };
  data.reviews[params.id].unshift(review);
  db.save();
  sendJson(res, 200, { ok: true, review });
});

/* ---------- bikes ---------- */

route("GET", "/api/bikes", async (req, res) => {
  const data = db.data;
  const bikes = data.bikes.filter((b) => b.status === "approved");
  sendJson(res, 200, { ok: true, bikes });
});

route("GET", "/api/bikes/mine", async (req, res) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const data = db.data;
  const bikes = data.bikes.filter((b) => b.ownerEmail === user.email);
  sendJson(res, 200, { ok: true, bikes });
});

const THUMBS = [
  "linear-gradient(160deg,#5a4632,#2b2116)",
  "linear-gradient(160deg,#3a3a3a,#111)",
  "linear-gradient(160deg,#4a5a35,#1c2416)",
  "linear-gradient(160deg,#333,#0f0f0f)",
  "linear-gradient(160deg,#2d5a6b,#0d2830)"
];

route("POST", "/api/bikes", async (req, res, params, body) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });

  const name = (body.name || "").trim();
  const brand = (body.brand || "").trim();
  const cc = (body.cc || "").trim();
  const category = (body.category || "").trim();
  const price = parseInt(body.price, 10);
  const city = (body.city || "").trim();

  if (!name || !brand || !cc || !category || !city || !price || price <= 0) {
    return sendJson(res, 400, { ok: false, error: "Please fill every field with valid values." });
  }

  const data = db.data;
  const bike = {
    id: db.newId("bike"),
    ownerEmail: user.email,
    ownerName: user.name,
    name,
    brand,
    cc,
    category,
    price,
    city,
    specs: [cc],
    thumb: THUMBS[Math.floor(Math.random() * THUMBS.length)],
    rating: null,
    reviewCount: 0,
    available: true,
    status: "pending", // needs admin approval before it's public
    createdAt: Date.now()
  };
  data.bikes.push(bike);
  db.save();
  sendJson(res, 200, { ok: true, bike });
});

route("PATCH", "/api/bikes/:id", async (req, res, params, body) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const data = db.data;
  const bike = data.bikes.find((b) => b.id === params.id);
  if (!bike) return sendJson(res, 404, { ok: false, error: "Bike not found." });
  if (bike.ownerEmail !== user.email) return sendJson(res, 403, { ok: false, error: "Not your listing." });

  if (typeof body.price === "number" || typeof body.price === "string") {
    const p = parseInt(body.price, 10);
    if (p > 0) bike.price = p;
  }
  if (typeof body.available === "boolean") bike.available = body.available;
  db.save();
  sendJson(res, 200, { ok: true, bike });
});

route("DELETE", "/api/bikes/:id", async (req, res, params) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const data = db.data;
  const bike = data.bikes.find((b) => b.id === params.id);
  if (!bike) return sendJson(res, 404, { ok: false, error: "Bike not found." });
  if (bike.ownerEmail !== user.email && !isAdmin(user)) {
    return sendJson(res, 403, { ok: false, error: "Not your listing." });
  }
  data.bikes = data.bikes.filter((b) => b.id !== params.id);
  db.save();
  sendJson(res, 200, { ok: true });
});

route("POST", "/api/bikes/:id/rent", async (req, res, params, body) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const data = db.data;
  const bike = data.bikes.find((b) => b.id === params.id);
  if (!bike) return sendJson(res, 404, { ok: false, error: "Bike not found." });
  if (bike.status !== "approved" || !bike.available) {
    return sendJson(res, 400, { ok: false, error: "This bike isn't available right now." });
  }

  const existing = data.rentRequests.find(
    (r) => r.bikeId === params.id && r.userEmail === user.email && r.status === "pending"
  );
  if (existing) return sendJson(res, 200, { ok: true, request: existing, alreadyRequested: true });

  const request = {
    id: db.newId("rr"),
    bikeId: params.id,
    bikeName: bike.name,
    ownerEmail: bike.ownerEmail,
    userEmail: user.email,
    userName: user.name,
    days: parseInt(body.days, 10) || 1,
    status: "pending",
    createdAt: Date.now()
  };
  data.rentRequests.push(request);
  db.save();
  sendJson(res, 200, { ok: true, request });
});

/* ---------- my requests (for profile page) ---------- */

route("GET", "/api/my-requests", async (req, res) => {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { ok: false, error: "Please log in first." });
  const data = db.data;
  const joinRequests = data.joinRequests.filter((r) => r.userEmail === user.email);
  const rentRequests = data.rentRequests.filter((r) => r.userEmail === user.email);
  sendJson(res, 200, { ok: true, joinRequests, rentRequests });
});

/* ---------- admin ---------- */

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Please log in first." });
    return null;
  }
  if (!isAdmin(user)) {
    sendJson(res, 403, { ok: false, error: "Admin access only." });
    return null;
  }
  return user;
}

route("GET", "/api/admin/overview", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  sendJson(res, 200, {
    ok: true,
    counts: {
      users: data.users.length,
      bikes: data.bikes.length,
      rides: data.rides.length,
      pendingBikes: data.bikes.filter((b) => b.status === "pending").length,
      pendingJoinRequests: data.joinRequests.filter((r) => r.status === "pending").length,
      pendingRentRequests: data.rentRequests.filter((r) => r.status === "pending").length
    }
  });
});

route("GET", "/api/admin/users", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  sendJson(res, 200, { ok: true, users: data.users.map(publicUser) });
});

route("DELETE", "/api/admin/users/:id", async (req, res, params) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const data = db.data;
  const target = data.users.find((u) => u.id === params.id);
  if (!target) return sendJson(res, 404, { ok: false, error: "User not found." });
  if (target.email === admin.email) return sendJson(res, 400, { ok: false, error: "You can't delete your own account." });
  data.users = data.users.filter((u) => u.id !== params.id);
  db.save();
  sendJson(res, 200, { ok: true });
});

route("PATCH", "/api/admin/users/:id", async (req, res, params, body) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const target = data.users.find((u) => u.id === params.id);
  if (!target) return sendJson(res, 404, { ok: false, error: "User not found." });
  if (body.role === "admin" || body.role === "user") target.role = body.role;
  db.save();
  sendJson(res, 200, { ok: true, user: publicUser(target) });
});

route("GET", "/api/admin/bikes", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  sendJson(res, 200, { ok: true, bikes: data.bikes });
});

route("POST", "/api/admin/bikes/:id/approve", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const bike = data.bikes.find((b) => b.id === params.id);
  if (!bike) return sendJson(res, 404, { ok: false, error: "Bike not found." });
  bike.status = "approved";
  db.save();
  sendJson(res, 200, { ok: true, bike });
});

route("POST", "/api/admin/bikes/:id/reject", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const bike = data.bikes.find((b) => b.id === params.id);
  if (!bike) return sendJson(res, 404, { ok: false, error: "Bike not found." });
  bike.status = "rejected";
  db.save();
  sendJson(res, 200, { ok: true, bike });
});

route("GET", "/api/admin/rides", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  sendJson(res, 200, { ok: true, rides: data.rides });
});

route("POST", "/api/admin/rides", async (req, res, params, body) => {
  if (!requireAdmin(req, res)) return;
  const title = (body.title || "").trim();
  if (!title) return sendJson(res, 400, { ok: false, error: "Title is required." });
  const data = db.data;
  const ride = {
    id: db.newId("ride"),
    title,
    club: (body.club || "").trim(),
    route: (body.route || "").trim(),
    distanceKm: parseInt(body.distanceKm, 10) || 0,
    difficulty: body.difficulty || "Medium",
    date: (body.date || "").trim(),
    duration: (body.duration || "").trim(),
    capacity: parseInt(body.capacity, 10) || 0,
    joined: 0,
    cover: "linear-gradient(160deg,#4b4b60,#17171f)",
    about: (body.about || "").trim(),
    highlights: Array.isArray(body.highlights) ? body.highlights : [],
    status: "approved"
  };
  data.rides.push(ride);
  db.save();
  sendJson(res, 200, { ok: true, ride });
});

route("PATCH", "/api/admin/rides/:id", async (req, res, params, body) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const ride = data.rides.find((r) => r.id === params.id);
  if (!ride) return sendJson(res, 404, { ok: false, error: "Ride not found." });
  ["title", "club", "route", "date", "duration", "about", "difficulty"].forEach((k) => {
    if (typeof body[k] === "string") ride[k] = body[k];
  });
  ["distanceKm", "capacity"].forEach((k) => {
    if (body[k] !== undefined) ride[k] = parseInt(body[k], 10) || ride[k];
  });
  db.save();
  sendJson(res, 200, { ok: true, ride });
});

route("DELETE", "/api/admin/rides/:id", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  data.rides = data.rides.filter((r) => r.id !== params.id);
  db.save();
  sendJson(res, 200, { ok: true });
});

route("GET", "/api/admin/join-requests", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  sendJson(res, 200, { ok: true, requests: data.joinRequests });
});

route("POST", "/api/admin/join-requests/:id/approve", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const reqst = data.joinRequests.find((r) => r.id === params.id);
  if (!reqst) return sendJson(res, 404, { ok: false, error: "Request not found." });
  reqst.status = "approved";
  const ride = data.rides.find((r) => r.id === reqst.rideId);
  const user = data.users.find((u) => u.email === reqst.userEmail);
  if (ride) ride.joined = (ride.joined || 0) + 1;
  if (user) {
    user.joinedRides = user.joinedRides || [];
    if (!user.joinedRides.includes(reqst.rideId)) user.joinedRides.push(reqst.rideId);
  }
  db.save();
  sendJson(res, 200, { ok: true, request: reqst });
});

route("POST", "/api/admin/join-requests/:id/reject", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const reqst = data.joinRequests.find((r) => r.id === params.id);
  if (!reqst) return sendJson(res, 404, { ok: false, error: "Request not found." });
  reqst.status = "rejected";
  db.save();
  sendJson(res, 200, { ok: true, request: reqst });
});

route("GET", "/api/admin/rent-requests", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  sendJson(res, 200, { ok: true, requests: data.rentRequests });
});

route("POST", "/api/admin/rent-requests/:id/approve", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const reqst = data.rentRequests.find((r) => r.id === params.id);
  if (!reqst) return sendJson(res, 404, { ok: false, error: "Request not found." });
  reqst.status = "approved";
  const bike = data.bikes.find((b) => b.id === reqst.bikeId);
  if (bike) bike.available = false;
  db.save();
  sendJson(res, 200, { ok: true, request: reqst });
});

route("POST", "/api/admin/rent-requests/:id/reject", async (req, res, params) => {
  if (!requireAdmin(req, res)) return;
  const data = db.data;
  const reqst = data.rentRequests.find((r) => r.id === params.id);
  if (!reqst) return sendJson(res, 404, { ok: false, error: "Request not found." });
  reqst.status = "rejected";
  db.save();
  sendJson(res, 200, { ok: true, request: reqst });
});

/* ------------------------------ HTTP SERVER ------------------------------ */

const server = http.createServer(async (req, res) => {
res.setHeader(
  "Access-Control-Allow-Origin",
  ALLOWED_ORIGIN
);

res.setHeader(
  "Access-Control-Allow-Credentials",
  "true"
);

res.setHeader(
  "Access-Control-Allow-Headers",
  "Content-Type"
);

if(req.method === "OPTIONS"){
  res.writeHead(204);
  return res.end();
}  
const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith("/api/")) {
    const match = matchRoute(req.method, pathname);
    if (!match) {
      return sendJson(res, 404, { ok: false, error: "Unknown API route." });
    }
    try {
      const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : {};
      await match.handler(req, res, match.params, body);
    } catch (e) {
      console.error(e);
      sendJson(res, 400, { ok: false, error: e.message || "Bad request." });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`RideCircle server running at http://localhost:${PORT}`);
  console.log(`Admin login:  admin@ridecircle.com / Ridecircle@2026`);
  console.log(`Demo user:    demo@ridecircle.com / demo1234`);
});
