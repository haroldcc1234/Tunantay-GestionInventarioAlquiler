import express from "express";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";

export const name = process.env.SERVICE_NAME || "auth";
export const SECRET = process.env.JWT_SECRET || "";
export const INTERNAL_KEY = process.env.INTERNAL_KEY || "";
export const url = {
  auth: process.env.AUTH_URL || "http://auth-service:3000",
  inventory: process.env.INVENTORY_URL || "http://inventory-service:3000",
  rental: process.env.RENTAL_URL || "http://rental-service:3000",
  returns: process.env.RETURNS_URL || "http://returns-service:3000",
  admin: process.env.ADMIN_URL || "http://admin-service:3000",
};

if (SECRET.length < 32 || INTERNAL_KEY.length < 24) {
  throw new Error("JWT_SECRET (>=32) e INTERNAL_KEY (>=24) son obligatorios");
}

export const db = mysql.createPool({
  host: process.env.DB_HOST || "mysql-db",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || `svc_${name}`,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || `${name}_db`,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  timezone: "Z",
  dateStrings: ["DATE"],
});

export const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "1mb" }));
app.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ service: name, status: "ok" });
  } catch {
    res.status(503).json({ service: name, status: "unavailable" });
  }
});

export function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

export function httpError(status, message, code = "ERROR") {
  return Object.assign(new Error(message), { status, code });
}

export function assert(
  condition,
  message,
  status = 400,
  code = "INVALID_INPUT",
) {
  if (!condition) throw httpError(status, message, code);
}

export async function loginRequired(req, _res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) throw Error("Missing token");
    req.user = jwt.verify(token, SECRET, {
      issuer: "tunantay",
      audience: "tunantay-web",
    });
    const current =
      name === "auth"
        ? await first("SELECT active,role FROM users WHERE id=?", [
            req.user.sub,
          ])
        : await call("auth", `/internal/users/${req.user.sub}`);
    if (!current?.active)
      throw httpError(401, "Cuenta desactivada", "ACCOUNT_DISABLED");
    req.user.role = current.role;
    next();
  } catch (error) {
    next(
      error.status === 503
        ? error
        : httpError(
            401,
            "Tu sesión no es válida o ha expirado",
            "UNAUTHORIZED",
          ),
    );
  }
}

export function roles(...allowed) {
  return (req, _res, next) => {
    if (!allowed.includes(req.user?.role))
      return next(
        httpError(403, "No tienes permisos para esta operación", "FORBIDDEN"),
      );
    next();
  };
}

export function internalOnly(req, _res, next) {
  const key = req.get("x-internal-key") || "";
  const a = Buffer.from(key);
  const b = Buffer.from(INTERNAL_KEY);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return next(httpError(403, "Operación interna no autorizada"));
  next();
}

export function numberId(value, field = "ID") {
  const n = Number(value);
  assert(Number.isSafeInteger(n) && n > 0, `${field} inválido`);
  return n;
}

export function nonEmpty(value, label, max = 180) {
  assert(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    `${label} es obligatorio (máximo ${max} caracteres)`,
  );
  return value.trim();
}

export function money(value, label = "Importe") {
  const n = Number(value);
  assert(Number.isFinite(n) && n >= 0 && n <= 1000000, `${label} inválido`);
  return Math.round(n * 100) / 100;
}

export async function rows(sql, args = []) {
  const [result] = await db.execute(sql, args);
  return result;
}
export async function first(sql, args = []) {
  const data = await rows(sql, args);
  return data[0] || null;
}
export async function inTx(handler) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await handler(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function call(service, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`${url[service]}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_KEY,
        ...(options.token ? { Authorization: options.token } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw httpError(
        response.status,
        result.message || `${service} rechazó la operación`,
        result.code || "UPSTREAM_ERROR",
      );
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(
      503,
      `El servicio ${service} no está disponible. Inténtalo después.`,
      "SERVICE_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function audit(action, entity, entityId, userId, payload = {}) {
  try {
    await call("admin", "/internal/audit", {
      method: "POST",
      body: { action, entity, entityId, userId, payload },
    });
  } catch (error) {
    // Cada servicio conserva una bitácora local si Administración no está disponible.
    await rows(
      "INSERT INTO audit_outbox (event_id, action, entity, entity_id, user_id, payload) VALUES (?, ?, ?, ?, ?, ?)",
      [
        randomUUID(),
        action,
        entity,
        String(entityId),
        userId || 0,
        JSON.stringify(payload),
      ],
    );
  }
}

export async function flushAudits() {
  if (name === "admin") return;
  try {
    const pending = await rows(
      "SELECT * FROM audit_outbox ORDER BY id LIMIT 30",
    );
    for (const event of pending) {
      await call("admin", "/internal/audit", {
        method: "POST",
        body: {
          eventId: event.event_id,
          action: event.action,
          entity: event.entity,
          entityId: event.entity_id,
          userId: event.user_id,
          payload:
            typeof event.payload === "string"
              ? JSON.parse(event.payload)
              : event.payload,
        },
      });
      await rows("DELETE FROM audit_outbox WHERE id = ?", [event.id]);
    }
  } catch {
    /* Reintentar cuando Administración se recupere. */
  }
}

export function hashPassword(password) {
  assert(
    typeof password === "string" && password.length >= 10,
    "La contraseña debe tener mínimo 10 caracteres",
  );
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(":");
    const derived = scryptSync(password, salt, 64);
    return timingSafeEqual(Buffer.from(hash, "hex"), derived);
  } catch {
    return false;
  }
}

export const roundMoney = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export const isDate = (value) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
