// Supabase auth — login, logout, session management

class SeedAuth {
  constructor() {
    this.client = null;
    this.user = null;
    this._onAuthChange = null;
  }

  // Called once config.js is loaded
  init() {
    if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
      console.warn('Supabase not configured — running in local-only mode');
      return false;
    }
    try {
      this.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      this.client.auth.onAuthStateChange((event, session) => {
        this.user = session?.user ?? null;
        this._updateUI();
        if (this._onAuthChange) this._onAuthChange(event, this.user);
      });
      return true;
    } catch (e) {
      console.warn('Supabase init failed:', e);
      return false;
    }
  }

  async getSession() {
    if (!this.client) return null;
    const { data } = await this.client.auth.getSession();
    this.user = data?.session?.user ?? null;
    return data?.session;
  }

  async signIn(email, password) {
    if (!this.client) throw new Error('Supabase not configured');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    return data;
  }

  async signUp(email, password) {
    if (!this.client) throw new Error('Supabase not configured');
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async signOut() {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.user = null;
    this._updateUI();
  }

  isConfigured() { return !!this.client; }
  isAuthenticated() { return !!this.user; }
  onAuthChange(cb) { this._onAuthChange = cb; }

  _updateUI() {
    const badge = document.getElementById('user-badge');
    const signOutBtn = document.getElementById('btn-sign-out');
    const syncStatus = document.getElementById('sync-status');
    if (!badge) return;

    if (this.user) {
      badge.textContent = this.user.email.split('@')[0];
      badge.title = this.user.email;
      badge.classList.remove('hidden');
      if (signOutBtn) signOutBtn.classList.remove('hidden');
      if (syncStatus) syncStatus.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      if (signOutBtn) signOutBtn.classList.add('hidden');
      if (syncStatus) syncStatus.classList.add('hidden');
    }
  }
}

window.seedAuth = new SeedAuth();
