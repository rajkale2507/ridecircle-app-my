/* ================= RIDECIRCLE — CLIENT-SIDE AUTH =================
   Talks to the real backend (RC_API) instead of localStorage. Session
   lives in an HttpOnly cookie set by the server; here we just cache
   the logged-in user in memory once per page load so synchronous
   currentUser() calls (used all over the front-end) keep working.
=================================================================== */

const RC_AUTH = {
  _user: null,
  _loaded: false,
  ready: null,

  init() {
    this.ready = (async () => {
      try {
        const res = await RC_API.me();
        this._user = (res && res.ok && res.user) ? res.user : null;
      } catch (e) {
        this._user = null;
      }

      this._loaded = true;
      rcApplyHeaderAuth();
      return this._user;
    })();

    return this.ready;
  },

  currentUser() {
    return this._user;
  },

  isAdmin() {
    return !!(this._user && this._user.role === "admin");
  },

  async signup(name, email, password) {
    const res = await RC_API.signup(name, email, password);
    if (res.ok) this._user = res.user;
    return res;
  },

  async login(email, password) {
    const res = await RC_API.login(email, password);
    if (res.ok) this._user = res.user;
    return res;
  },

  async googleLogin(name, email) {
    const res = await RC_API.googleLogin(name, email);
    if (res.ok) this._user = res.user;
    return res;
  },

  async logout() {
    try { await RC_API.logout(); } catch (e) { /* ignore network errors on logout */ }
    this._user = null;
  },

  initials(name) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0].toUpperCase())
      .join("");
  }
};

/* ================= HEADER STATE ================= */
/* Every page includes a header .buttons block with Login/Sign Up
   links plus (on inner pages) a profile.html avatar-chip link.
   Once the session check resolves, if a user is logged in, swap
   those for the real user's initials and a logout affordance. */

function rcApplyHeaderAuth() {
  const buttons = document.querySelector("header .buttons");
  if (!buttons) return;

  const user = RC_AUTH.currentUser();
  if (!user) return; // leave default Login / Sign Up markup as-is

  const loginLink = buttons.querySelector(".login");
  const signupLink = buttons.querySelector(".signup");
  if (loginLink) loginLink.remove();
  if (signupLink) {
    signupLink.textContent = "Log Out";
    signupLink.href = "#";
    signupLink.addEventListener("click", async (e) => {
      e.preventDefault();
      await RC_AUTH.logout();
      window.location.href = "index.html";
    });
  }

  let chip = buttons.querySelector(".avatar-chip");
  if (!chip) {
    chip = document.createElement("a");
    chip.href = "profile-combined.html";
    chip.className = "avatar-chip";
    buttons.appendChild(chip);
  }
  chip.textContent = user.initials;
  chip.title = user.name;

  // if this user is an admin, add a quick link to the dashboard
  if (user.role === "admin" && !buttons.querySelector(".admin-chip")) {
    const adminLink = document.createElement("a");
    adminLink.href = "admin-dashboard.html";
    adminLink.className = "admin-chip";
    adminLink.textContent = "Admin";
    adminLink.style.cssText =
      "padding:8px 16px;border-radius:8px;background:#2a2a2a;color:#facc15;font-size:13px;font-weight:600;text-decoration:none;margin-right:8px;";
    buttons.insertBefore(adminLink, chip);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  RC_AUTH.init();
});
