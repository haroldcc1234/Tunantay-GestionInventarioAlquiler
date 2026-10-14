import { randomUUID } from "node:crypto";
import {
  asyncRoute,
  loginRequired,
  roles,
  internalOnly,
  rows,
  first,
  assert,
  nonEmpty,
  numberId,
  money,
  httpError,
} from "./core.js";

const permitted = {
  PRICE_MODE: ["FIXED", "ITEMS"],
  DEBT_POLICY: ["ALLOW", "BLOCK", "REQUIRE_APPROVAL"],
};

export function register(app) {
  app.get(
    "/internal/settings",
    internalOnly,
    asyncRoute(async (_req, res) => res.json(await getSettings())),
  );
  app.post(
    "/internal/audit",
    internalOnly,
    asyncRoute(async (req, res) => {
      const { action, entity, entityId, userId, payload, eventId } = req.body;
      await rows(
        `INSERT INTO audit_logs (event_id,user_id,action,entity,entity_id,payload)
      VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event_id=event_id`,
        [
          eventId || randomUUID(),
          Number(userId || 0),
          nonEmpty(action, "Acción", 80),
          nonEmpty(entity, "Entidad", 80),
          String(entityId),
          JSON.stringify(payload || {}),
        ],
      );
      res.json({ ok: true });
    }),
  );
  app.get(
    "/settings",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (_req, res) => res.json(await getSettings())),
  );
  app.patch(
    "/settings",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (req, res) => {
      const updates = req.body;
      assert(
        updates && typeof updates === "object" && Object.keys(updates).length,
        "No hay cambios",
      );
      const valid = ["PRICE_MODE", "CUTOFF_HOUR", "DEBT_POLICY", "DAMAGE_BASE"];
      for (const [key, value] of Object.entries(updates)) {
        assert(valid.includes(key), `Configuración no admitida: ${key}`);
        if (permitted[key])
          assert(permitted[key].includes(value), `Valor inválido para ${key}`);
        if (key === "CUTOFF_HOUR")
          assert(
            Number.isInteger(Number(value)) &&
              Number(value) >= 0 &&
              Number(value) <= 23,
            "Hora de corte de 0 a 23",
          );
        if (key === "DAMAGE_BASE") money(value);
        await rows(
          `INSERT INTO settings (key_name,value_text,updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE
        value_text=VALUES(value_text),updated_by=VALUES(updated_by)`,
          [key, String(value), Number(req.user.sub)],
        );
      }
      await rows(
        "INSERT INTO audit_logs (event_id,user_id,action,entity,entity_id,payload) VALUES (?,?,?,?,?,?)",
        [
          randomUUID(),
          Number(req.user.sub),
          "SETTINGS_UPDATED",
          "settings",
          "global",
          JSON.stringify(updates),
        ],
      );
      res.json(await getSettings());
    }),
  );

  app.get(
    "/reports/overview",
    loginRequired,
    asyncRoute(async (_req, res) => {
      const [[stock], [rental], [money], [clients], [dances], [pending]] =
        await Promise.all([
          rows(`SELECT COUNT(*) AS total,
        SUM(state='AVAILABLE') AS available,SUM(state='RENTED') AS rented,
        SUM(state='MAINTENANCE') AS maintenance FROM inventory_db.units`),
          rows(`SELECT COUNT(*) AS total,SUM(status IN ('ACTIVE','PARTIAL')) AS active,
        COALESCE(SUM(base_amount),0) AS total_amount FROM rental_db.rentals WHERE status<>'CANCELLED'`),
          rows(
            "SELECT COALESCE(SUM(amount),0) AS received FROM returns_db.payments",
          ),
          rows("SELECT COUNT(*) AS total FROM rental_db.clients"),
          rows(
            "SELECT COUNT(*) AS total FROM inventory_db.dances WHERE active=1",
          ),
          rows(
            "SELECT COUNT(*) AS total FROM returns_db.damages WHERE status='PENDING'",
          ),
        ]);
      const recent =
        await rows(`SELECT r.id,r.folio,c.full_name AS client_name,r.status,r.base_amount,r.created_at
      FROM rental_db.rentals r JOIN rental_db.clients c ON c.id=r.client_id ORDER BY r.id DESC LIMIT 8`);
      const byDance =
        await rows(`SELECT d.name,COUNT(u.id) AS units FROM inventory_db.dances d
      JOIN inventory_db.garments g ON g.dance_id=d.id JOIN inventory_db.units u ON u.garment_id=g.id
      GROUP BY d.id ORDER BY units DESC LIMIT 8`);
      const cashflow =
        await rows(`SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,SUM(amount) AS amount
      FROM returns_db.payments WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)
      GROUP BY DATE_FORMAT(created_at,'%Y-%m-%d') ORDER BY day`);
      res.json({
        stock: stock || {},
        rentals: rental || {},
        payments: money || {},
        clients: clients?.total || 0,
        dances: dances?.total || 0,
        pendingDamages: pending?.total || 0,
        recent,
        byDance,
        cashflow,
      });
    }),
  );

  app.get(
    "/reports/audit",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (_req, res) => {
      res.json(
        await rows(`SELECT a.*,u.full_name AS actor FROM audit_logs a
      LEFT JOIN auth_db.users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`),
      );
    }),
  );
  app.get(
    "/reports/inventory",
    loginRequired,
    asyncRoute(async (_req, res) => {
      res.json(
        await rows(`SELECT d.name AS dance,g.name AS garment,g.sku,
      COUNT(u.id) AS total,SUM(u.state='AVAILABLE') AS available,
      SUM(u.state='RENTED') AS rented,SUM(u.state='MAINTENANCE') AS maintenance
      FROM inventory_db.garments g JOIN inventory_db.dances d ON d.id=g.dance_id
      LEFT JOIN inventory_db.units u ON u.garment_id=g.id
      GROUP BY g.id ORDER BY d.name,g.name`),
      );
    }),
  );
}

async function getSettings() {
  const data = await rows("SELECT key_name,value_text FROM settings");
  return Object.fromEntries(
    data.map((item) => [item.key_name, item.value_text]),
  );
}
