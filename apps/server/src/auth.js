import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, tokenHash } from './database.js';
import { now, id, password, fail, publicUser, audit } from './domain.js';
export function registerAuth(app, { db, config, cancelRequests }) {
  const sessionAlive = session => (session.refresh_expires_at || session.expires_at) > now();
  function issue(state, user, previous) {
    const token = randomBytes(32).toString('base64url'), refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + config.accessTokenMinutes * 60000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + config.refreshTokenDays * 86400000).toISOString();
    state.tokens.push({ id: previous?.id || id(), token_hash: tokenHash(token), refresh_hash: tokenHash(refreshToken), user_id: user.id,
      expires_at: expiresAt, refresh_expires_at: refreshExpiresAt, created_at: previous?.created_at || now(), last_used_at: now(), device: previous?.device || '' });
    return { token, refreshToken, expiresAt, refreshExpiresAt, user: publicUser(state, user, config.timezone) };
  }
  const auth = (req, _res, next) => {
    const token = (req.get('authorization') || '').match(/^Bearer (\S+)$/i)?.[1];
    const state = db.read(), session = token && state.tokens.find(t => t.token_hash === tokenHash(token) && t.expires_at > now());
    const user = session && state.users.find(u => u.id === session.user_id);
    if (!user) fail(401, 'INVALID_TOKEN', '登录已过期，请重新登录');
    if (!user.is_active) fail(403, 'USER_DISABLED', '账号已被禁用，请联系管理员');
    req.user = user; req.session = session; next();
  };
  app.post('/auth/login', (req, res) => {
    const address = req.ip, current = Date.now();
    const { username, password: supplied, device } = req.body || {};
    const state = db.read();
    if (state.loginFailures.filter(f => f.address === address && f.until > current).length >= config.loginFailureLimit) fail(429, 'LOGIN_RATE_LIMIT', '登录失败过多，请 15 分钟后重试');
    const user = state.users.find(u => typeof username === 'string' && u.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(supplied, user.password_hash)) {
      db.transaction(next => {
        next.loginFailures = next.loginFailures.filter(f => f.until > current).slice(-10000);
        next.loginFailures.push({ id: id(), address, until: current + 900000 });
      });
      fail(401, 'LOGIN_FAILED', '用户名或密码错误');
    }
    if (!user.is_active) fail(403, 'USER_DISABLED', '账号已被禁用');
    const result = db.transaction(next => {
      next.tokens = next.tokens.filter(sessionAlive);
      if (next.tokens.filter(t => t.user_id === user.id).length >= user.session_limit) fail(409, 'SESSION_LIMIT', '登录设备数量已达上限，请退出其他设备或联系管理员撤销登录');
      const saved = next.users.find(u => u.id === user.id); saved.last_login_at = now();
      audit(next, saved, 'login', saved.id);
      return issue(next, saved, { device: typeof device === 'string' ? device.slice(0,100) : '' });
    });
    res.json(result);
  });
  app.post('/auth/refresh', (req, res) => {
    const bearer = (req.get('authorization') || '').match(/^Bearer (\S+)$/i)?.[1];
    const refresh = req.body?.refreshToken;
    if (refresh !== undefined && (typeof refresh !== 'string' || refresh.length > 256)) fail(400, 'INVALID_REFRESH', '无效的续期凭据');
    const state = db.read();
    const session = refresh ? state.tokens.find(s => s.refresh_hash === tokenHash(refresh) && s.refresh_expires_at > now())
      : bearer && state.tokens.find(s => s.token_hash === tokenHash(bearer) && s.expires_at > now());
    const user = session && state.users.find(u => u.id === session.user_id);
    if (!user) fail(401, 'INVALID_TOKEN', '会话已过期或已被撤销');
    if (!user.is_active) fail(403, 'USER_DISABLED', '账号已被禁用');
    res.json(db.transaction(next => {
      next.tokens = next.tokens.filter(s => s.token_hash !== session.token_hash);
      return issue(next, user, session);
    }));
  });
  app.get('/auth/me', auth, (req, res) => res.json(publicUser(db.read(), req.user, config.timezone)));
  app.get('/auth/sessions', auth, (req, res) => res.json(db.read().tokens.filter(s => s.user_id === req.user.id && sessionAlive(s)).map(s => ({
    id: s.id || s.token_hash.slice(0,12), device: s.device, created_at: s.created_at, expires_at: s.refresh_expires_at || s.expires_at, current: s.token_hash === req.session.token_hash,
  }))));
  app.post('/auth/logout', auth, (req, res) => {
    db.transaction(state => { state.tokens = state.tokens.filter(s => s.token_hash !== req.session.token_hash); audit(state, req.user, 'logout', req.user.id); });
    cancelRequests(req.user.id, 'SESSION_REVOKED', req.session.id);
    res.json({ ok: true });
  });
  app.post('/auth/password', auth, (req, res) => {
    if (!verifyPassword(req.body?.currentPassword, req.user.password_hash)) fail(401, 'LOGIN_FAILED', '当前密码不正确');
    const hashed = hashPassword(password(req.body?.password));
    db.transaction(state => {
      state.users.find(u => u.id === req.user.id).password_hash = hashed;
      state.tokens = state.tokens.filter(s => s.user_id !== req.user.id); audit(state, req.user, 'password.change', req.user.id);
    });
    cancelRequests(req.user.id, 'SESSION_REVOKED'); res.json({ ok: true, loginRequired: true });
  });
  return auth;
}
