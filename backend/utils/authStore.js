const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const WORKSPACE_DIR = path.join(DATA_DIR, 'workspaces');

function ensureDataFiles() {
  if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
  if (!fsSync.existsSync(WORKSPACE_DIR)) fsSync.mkdirSync(WORKSPACE_DIR, { recursive: true });
  if (!fsSync.existsSync(USERS_FILE)) fsSync.writeFileSync(USERS_FILE, '[]', 'utf-8');
  if (!fsSync.existsSync(SESSIONS_FILE)) fsSync.writeFileSync(SESSIONS_FILE, '{}', 'utf-8');
}

ensureDataFiles();

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [salt, hash] = String(encoded || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

async function registerUser({ name, email, password }) {
  const users = await readJson(USERS_FILE, []);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password || password.length < 6) {
    throw new Error('Email hoặc mật khẩu không hợp lệ (mật khẩu tối thiểu 6 ký tự)');
  }
  if (users.some((u) => u.email === normalizedEmail)) {
    throw new Error('Email đã tồn tại');
  }

  const user = {
    id: crypto.randomUUID(),
    name: String(name || normalizedEmail.split('@')[0]).trim(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  users.push(user);
  await writeJson(USERS_FILE, users);
  const token = await createSession(user.id);
  return { user: sanitizeUser(user), token };
}

async function loginUser({ email, password }) {
  const users = await readJson(USERS_FILE, []);
  const normalizedEmail = normalizeEmail(email);
  const user = users.find((u) => u.email === normalizedEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error('Email hoặc mật khẩu không đúng');
  }

  const token = await createSession(user.id);
  return { user: sanitizeUser(user), token };
}

async function createSession(userId) {
  const sessions = await readJson(SESSIONS_FILE, {});
  const token = createToken();
  sessions[token] = { userId, createdAt: new Date().toISOString() };
  await writeJson(SESSIONS_FILE, sessions);
  return token;
}

async function getUserById(userId) {
  const users = await readJson(USERS_FILE, []);
  const user = users.find((u) => u.id === userId);
  return user ? sanitizeUser(user) : null;
}

async function getSession(token) {
  if (!token) return null;
  const sessions = await readJson(SESSIONS_FILE, {});
  const session = sessions[token];
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user) return null;
  return { token, user };
}

function getWorkspaceFile(userId) {
  return path.join(WORKSPACE_DIR, `${userId}.json`);
}

async function getWorkspace(userId) {
  const file = getWorkspaceFile(userId);
  return readJson(file, { images: [], lastImage: null, updatedAt: null });
}

async function saveWorkspace(userId, workspace) {
  const file = getWorkspaceFile(userId);
  const payload = {
    images: Array.isArray(workspace.images) ? workspace.images : [],
    lastImage: workspace.lastImage || null,
    updatedAt: new Date().toISOString()
  };
  await writeJson(file, payload);
  return payload;
}

async function appendWorkspaceImage(userId, imageInfo) {
  const workspace = await getWorkspace(userId);
  const images = Array.isArray(workspace.images) ? workspace.images : [];
  const exists = images.some((img) => img.filename === imageInfo.filename);
  if (!exists) {
    images.push(imageInfo);
  }
  workspace.images = images.slice(-50);
  workspace.lastImage = imageInfo.filename;
  return saveWorkspace(userId, workspace);
}

module.exports = {
  registerUser,
  loginUser,
  getSession,
  getWorkspace,
  saveWorkspace,
  appendWorkspaceImage
};
