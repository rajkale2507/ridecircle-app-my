/* ================= RIDECIRCLE — SERVER-SIDE DATABASE =================
   A small, dependency-free JSON-file "database". Not meant to scale to
   production traffic, but it's a real persistent store: data survives
   server restarts, writes are atomic-ish (whole file rewritten), and
   every table is just an array of plain objects keyed by id.

   Tables:
     users         - riders + admins
     bikes         - rentor-listed bikes (pending / approved / rejected)
     rides         - community group rides (seeded, admin can add more)
     joinRequests  - "Join Ride" requests -> admin approves/rejects
     rentRequests  - "Rent Now" requests -> admin approves/rejects
     reviews       - ride reviews, keyed by rideId
     sessions      - session token -> user email
======================================================================= */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- password hashing (scrypt, salted, no external deps) ---------- */

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(String(password), salt, 64).toString("hex");
  // timing-safe compare
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(check, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

/* ---------------------------- seed data ---------------------------- */

function seedRides() {
  return [
    {
      id: "spiti-valley",
      title: "Spiti Valley Expedition",
      club: "Mountain Riders Club",
      route: "Manali → Kaza → Spiti Valley",
      distanceKm: 412,
      difficulty: "Hard",
      date: "Aug 15, 2026",
      duration: "4 days",
      capacity: 50,
      joined: 42,
      cover: "linear-gradient(160deg,#6b5a3a,#241d10)",
      about: "A high-altitude crossing through cold desert valleys, monasteries and switchback passes. Riders should be comfortable with rough tarmac, water crossings and thin air above 4,000m.",
      highlights: ["Rohtang Pass crossing", "Key Monastery stop", "Chandratal night camp", "Support van + mechanic on route"],
      status: "approved"
    },
    {
      id: "coastal-cruise",
      title: "Coastal Highway Cruise",
      club: "Coastal Riders Network",
      route: "Mumbai → Goa via NH66",
      distanceKm: 590,
      difficulty: "Easy",
      date: "Aug 22, 2026",
      duration: "3 days",
      capacity: 200,
      joined: 128,
      cover: "linear-gradient(160deg,#4a4a4a,#141414)",
      about: "An easy-paced coastal run down NH66 with beach-town stopovers, seafood breaks and wide, well-surfaced roads. Great for first-time group riders.",
      highlights: ["Ganpatipule beach stop", "Sunset ride into Goa", "Beginner-friendly pace", "Hotel stays pre-booked"],
      status: "approved"
    },
    {
      id: "ladakh-challenge",
      title: "Ladakh Grand Challenge",
      club: "Himalayan Riders Guild",
      route: "Leh → Khardung La → Nubra Valley",
      distanceKm: 220,
      difficulty: "Hard",
      date: "Sep 5, 2026",
      duration: "5 days",
      capacity: 75,
      joined: 67,
      cover: "linear-gradient(160deg,#333,#0f0f0f)",
      about: "The classic high-pass challenge ride to one of the highest motorable roads on earth, followed by the cold desert dunes of Nubra Valley.",
      highlights: ["Khardung La summit", "Nubra sand dunes", "Oxygen support kits provided", "Acclimatisation day in Leh"],
      status: "approved"
    },
    {
      id: "ncr-warriors",
      title: "Weekend Warriors NCR",
      club: "NCR Bikers Brotherhood",
      route: "Delhi → Alwar → Sariska",
      distanceKm: 210,
      difficulty: "Medium",
      date: "Aug 17, 2026",
      duration: "2 days",
      capacity: 40,
      joined: 35,
      cover: "linear-gradient(160deg,#4b4b60,#17171f)",
      about: "A short weekend escape from the city — forest roads, a wildlife sanctuary detour and an easy return on Sunday afternoon.",
      highlights: ["Sariska forest detour", "Overnight stay at Alwar", "Easy Sunday return", "Beginner + intermediate friendly"],
      status: "approved"
    }
  ];
}

function seedBikes() {
  const list = [
    { name: "Royal Enfield Himalayan", brand: "Royal Enfield", cc: "411cc Engine", category: "Adventure", price: 1800, city: "Manali, Himachal Pradesh", specs: ["411cc Engine", "Long Travel Suspension", "Off-Road Tyres"], thumb: "linear-gradient(160deg,#5a4632,#2b2116)" },
    { name: "KTM 390 Adventure", brand: "KTM", cc: "373cc Engine", category: "Adventure", price: 2200, city: "Manali, Himachal Pradesh", specs: ["373cc Engine", "Ride-by-Wire", "Cornering ABS"], thumb: "linear-gradient(160deg,#3a3a3a,#111)" },
    { name: "Kawasaki Ninja 300", brand: "Kawasaki", cc: "296cc Engine", category: "Sport", price: 2600, city: "Manali, Himachal Pradesh", specs: ["296cc Engine", "Twin Cylinder", "Sport ABS"], thumb: "linear-gradient(160deg,#333,#1a1a1a)", available: false },
    { name: "Bajaj Dominar 400", brand: "Bajaj", cc: "373cc DOHC 4V", category: "Touring", price: 1400, city: "Manali, Himachal Pradesh", specs: ["373cc DOHC 4V", "Slipper Clutch", "Dual-Channel ABS", "Cruise Control"], thumb: "linear-gradient(160deg,#4a5a35,#1c2416)" },
    { name: "Honda CB350 H'ness", brand: "Honda", cc: "348cc Engine", category: "Classic", price: 1600, city: "Manali, Himachal Pradesh", specs: ["348cc Engine", "Classic Heritage Design", "Smartphone Connect", "Dual ABS"], thumb: "linear-gradient(160deg,#2e2e2e,#0f0f0f)" }
  ];
  return list.map((b, i) => ({
    id: newId("bike"),
    ownerEmail: "system@ridecircle.com",
    ownerName: "RideCircle Fleet",
    name: b.name,
    brand: b.brand,
    cc: b.cc,
    category: b.category,
    price: b.price,
    city: b.city,
    specs: b.specs,
    thumb: b.thumb,
    rating: 4.5,
    reviewCount: 200 + i * 37,
    available: b.available !== false,
    status: "approved" // seeded fleet bikes don't need approval
  }));
}

function seedDb() {
  const adminPass = hashPassword("Ridecircle@2026");
  const demoPass = hashPassword("demo1234");
  return {
    users: [
      { id: newId("user"), name: "RideCircle Admin", email: "admin@ridecircle.com", password: adminPass, role: "admin", initials: "RA", joinedRides: [], createdAt: Date.now() },
      { id: newId("user"), name: "Demo Rider", email: "demo@ridecircle.com", password: demoPass, role: "user", initials: "DR", joinedRides: [], createdAt: Date.now() }
    ],
    bikes: seedBikes(),
    rides: seedRides(),
    joinRequests: [],
    rentRequests: [],
    reviews: {
      "spiti-valley": [
        { name: "Dev Malhotra", stars: 5, text: "Best organised group ride I've done — the support van saved us twice." },
        { name: "Zara Ahmed", stars: 5, text: "Chandratal at night was worth every switchback. Ride lead kept the pace sane." },
        { name: "Rohit Verma", stars: 4, text: "Tough on the bike, but the route planning was spot on." }
      ],
      "coastal-cruise": [
        { name: "Kavya Reddy", stars: 5, text: "So relaxed compared to the mountain rides. Perfect for my first group ride." },
        { name: "Aditya Kumar", stars: 4, text: "Roads were great, wish we had one more beach stop." }
      ],
      "ladakh-challenge": [
        { name: "Sneha Iyer", stars: 5, text: "Bucket list ride, done right. The acclimatisation day mattered a lot." },
        { name: "Priya Kaur", stars: 5, text: "Guides knew every water crossing on the route. Felt safe the whole way." }
      ],
      "ncr-warriors": [
        { name: "Arjun Singh", stars: 4, text: "Perfect quick weekend ride, didn't eat into Monday at all." }
      ]
    },
    sessions: {}
  };
}

/* ---------------------------- load / save ---------------------------- */

let cache = null;

function load() {
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      return cache;
    } catch (e) {
      console.error("db.json was corrupt, reseeding:", e.message);
    }
  }
  cache = seedDb();
  save();
  return cache;
}

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), "utf8");
}

/* ------------------------------ API ------------------------------ */

module.exports = {
  hashPassword,
  verifyPassword,
  newId,

  get data() {
    return load();
  },

  save,

  createSession(email) {
    const db = load();
    const token = crypto.randomBytes(24).toString("hex");
    db.sessions[token] = { email, createdAt: Date.now() };
    save();
    return token;
  },

  destroySession(token) {
    const db = load();
    delete db.sessions[token];
    save();
  },

  userForSession(token) {
    const db = load();
    const s = db.sessions[token];
    if (!s) return null;
    return db.users.find((u) => u.email === s.email) || null;
  }
};
