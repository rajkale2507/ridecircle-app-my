/* ================= RIDECIRCLE — CLIENT API HELPER =================
   Thin wrapper around fetch() for talking to the real backend.
   Session is a HttpOnly cookie set by the server, so we just need
   credentials:"include" on every call.
======================================================================= */

const RC_API = {
  // When the site is served by your own local `node server.js` (or any
  // non-Firebase host), call it directly with a relative path — same
  // origin, no CORS involved. When served from Firebase Hosting
  // (production), fall back to the separately-deployed Render API,
  // which is the only origin its CORS policy allows.
  _apiBase: (() => {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
	    return isLocal ? "" : "https://ridecircle-app-my.onrender.com";
  })(),

  async _call(method, path, body) {
    const opts = {
      method,
      headers: {},
      credentials: "include"
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res, data;
    try {
      res = await fetch(this._apiBase + path, opts);
      data = await res.json();
    } catch (e) {
      return { 
ok: false, 
error: "Couldn't reach the server. Is it running?"
 };
    }
        return data;
  },

  get(path) {
    return this._call("GET", path);
  },
  post(path, body) {
    return this._call("POST", path, body || {});
  },
  patch(path, body) {
    return this._call("PATCH", path, body || {});
  },
  del(path) {
    return this._call("DELETE", path);
  },

  // auth
  signup(name, email, password) {
    return this.post("/api/signup", { name, email, password });
  },
  login(email, password) {
    return this.post("/api/login", { email, password });
  },
  googleLogin(name, email) {
    return this.post("/api/google-login", { name, email });
  },
  logout() {
    return this.post("/api/logout");
  },
  me() {
    return this.get("/api/me");
  },

  // rides
  rides() {
    return this.get("/api/rides");
  },
  ride(id) {
    return this.get(`/api/rides/${encodeURIComponent(id)}`);
  },
  joinRide(id) {
    return this.post(`/api/rides/${encodeURIComponent(id)}/join`);
  },
  addReview(id, stars, text) {
    return this.post(`/api/rides/${encodeURIComponent(id)}/reviews`, { stars, text });
  },

  // bikes
  bikes() {
    return this.get("/api/bikes");
  },
  myBikes() {
    return this.get("/api/bikes/mine");
  },
  createBike(payload) {
    return this.post("/api/bikes", payload);
  },
  updateBike(id, payload) {
    return this.patch(`/api/bikes/${encodeURIComponent(id)}`, payload);
  },
  deleteBike(id) {
    return this.del(`/api/bikes/${encodeURIComponent(id)}`);
  },
  rentBike(id, days) {
    return this.post(`/api/bikes/${encodeURIComponent(id)}/rent`, { days });
  },

  // my requests
  myRequests() {
    return this.get("/api/my-requests");
  },

  // admin
  adminOverview() {
    return this.get("/api/admin/overview");
  },
  adminUsers() {
    return this.get("/api/admin/users");
  },
  adminDeleteUser(id) {
    return this.del(`/api/admin/users/${encodeURIComponent(id)}`);
  },
  adminSetUserRole(id, role) {
    return this.patch(`/api/admin/users/${encodeURIComponent(id)}`, { role });
  },
  adminBikes() {
    return this.get("/api/admin/bikes");
  },
  adminApproveBike(id) {
    return this.post(`/api/admin/bikes/${encodeURIComponent(id)}/approve`);
  },
  adminRejectBike(id) {
    return this.post(`/api/admin/bikes/${encodeURIComponent(id)}/reject`);
  },
  adminDeleteBike(id) {
    return this.del(`/api/bikes/${encodeURIComponent(id)}`);
  },
  adminRides() {
    return this.get("/api/admin/rides");
  },
  adminCreateRide(payload) {
    return this.post("/api/admin/rides", payload);
  },
  adminUpdateRide(id, payload) {
    return this.patch(`/api/admin/rides/${encodeURIComponent(id)}`, payload);
  },
  adminDeleteRide(id) {
    return this.del(`/api/admin/rides/${encodeURIComponent(id)}`);
  },
  adminJoinRequests() {
    return this.get("/api/admin/join-requests");
  },
  adminApproveJoin(id) {
    return this.post(`/api/admin/join-requests/${encodeURIComponent(id)}/approve`);
  },
  adminRejectJoin(id) {
    return this.post(`/api/admin/join-requests/${encodeURIComponent(id)}/reject`);
  },
  adminRentRequests() {
    return this.get("/api/admin/rent-requests");
  },
  adminApproveRent(id) {
    return this.post(`/api/admin/rent-requests/${encodeURIComponent(id)}/approve`);
  },
  adminRejectRent(id) {
    return this.post(`/api/admin/rent-requests/${encodeURIComponent(id)}/reject`);
  }
};
