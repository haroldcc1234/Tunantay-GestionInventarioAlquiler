import { randomUUID } from "node:crypto";
import {
  asyncRoute,
  loginRequired,
  roles,
  internalOnly,
  rows,
  first,
  inTx,
  assert,
  nonEmpty,
  numberId,
  money,
  httpError,
  audit,
  call,
} from "./core.js";

const stateValues = ["AVAILABLE", "HELD", "RENTED", "MAINTENANCE", "INACTIVE"];
const conservationValues = ["EXCELENTE", "BUENO", "REGULAR", "DAÑADO"];

export function register(app) {
  app.get(
    "/public/catalog",
    asyncRoute(async (_req, res) => {
      const dances =
        await rows(`SELECT id,name,region,department,description,image_credit,image_source,image_license
      FROM dances WHERE active=1 ORDER BY (name='Tunantada') DESC,(image_data IS NOT NULL) DESC,(department='Junín') DESC,name`);
      const sets =
        await rows(`SELECT s.id,s.name,s.dance_id,s.size,s.fixed_price,
      COALESCE(MIN(CASE WHEN g.active=0 THEN 0 ELSE FLOOR(COALESCE(u.available,0)/si.quantity) END),0) AS available,
      SUM(g.rental_price * si.quantity) AS item_price
      FROM garment_sets s JOIN dances d ON d.id=s.dance_id AND d.active=1
      JOIN set_items si ON si.set_id=s.id JOIN garments g ON g.id=si.garment_id
      LEFT JOIN (SELECT garment_id,COUNT(*) AS available FROM units WHERE active=1 AND state='AVAILABLE' GROUP BY garment_id) u
      ON u.garment_id=g.id WHERE s.active=1 GROUP BY s.id`);
      const config = await call("admin", "/internal/settings");
      res.json(
        dances.map((d) => ({
          ...d,
          sets: sets
            .filter((s) => s.dance_id === d.id)
            .map((s) => ({
              ...s,
              price:
                config.PRICE_MODE === "ITEMS" ? s.item_price : s.fixed_price,
            })),
        })),
      );
    }),
  );

  app.get(
    "/dances",
    loginRequired,
    asyncRoute(async (req, res) => {
      const search = String(req.query.search || "").trim();
      const region = String(req.query.region || "").trim();
      let sql =
        "SELECT id,name,region,department,description,active,image_credit,image_source,image_license FROM dances WHERE active = 1";
      const args = [];
      if (region) {
        sql += " AND region = ?";
        args.push(region);
      }
      if (search) {
        sql += " AND (name LIKE ? OR department LIKE ?)";
        args.push(`%${search}%`, `%${search}%`);
      }
      res.json(
        await rows(
          `${sql} ORDER BY FIELD(department,'Junín','Puno','Cusco'),name`,
          args,
        ),
      );
    }),
  );

  app.get(
    "/dances/:id/image",
    asyncRoute(async (req, res) => {
      const item = await first(
        "SELECT image_svg,image_data FROM dances WHERE id=? AND active=1",
        [numberId(req.params.id)],
      );
      if (!item) throw httpError(404, "Imagen no encontrada");
      if (item.image_data) {
        const match = item.image_data.match(
          /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s,
        );
        if (match) {
          res.set("Content-Type", match[1]);
          res.set("Cache-Control", "public, max-age=3600");
          return res.send(Buffer.from(match[2], "base64"));
        }
      }
      res.set("Content-Type", "image/svg+xml; charset=utf-8");
      res.set("Cache-Control", "public, max-age=3600");
      res.send(item.image_svg);
    }),
  );

  app.get(
    "/garments",
    loginRequired,
    asyncRoute(async (req, res) => {
      const args = [];
      let sql = `SELECT g.*,d.name AS dance_name,
      (SELECT COUNT(*) FROM units u WHERE u.garment_id=g.id AND u.active=1) AS total_units,
      (SELECT COUNT(*) FROM units u WHERE u.garment_id=g.id AND u.active=1 AND u.state='AVAILABLE') AS available_units
      FROM garments g JOIN dances d ON d.id=g.dance_id WHERE g.active=1`;
      if (req.query.danceId) {
        sql += " AND g.dance_id=?";
        args.push(numberId(req.query.danceId));
      }
      if (req.query.search) {
        sql += " AND (g.name LIKE ? OR g.sku LIKE ?)";
        args.push(`%${req.query.search}%`, `%${req.query.search}%`);
      }
      res.json(await rows(`${sql} ORDER BY g.id LIMIT 400`, args));
    }),
  );

  app.post(
    "/garments",
    loginRequired,
    roles("ADMIN", "EMPLEADO"),
    asyncRoute(async (req, res) => {
      const name = nonEmpty(req.body.name, "Nombre");
      const sku = nonEmpty(req.body.sku, "SKU", 36);
      const type = req.body.type;
      assert(["PRENDA", "ACCESORIO"].includes(type), "Tipo inválido");
      const danceId = numberId(req.body.danceId, "Danza");
      const size = nonEmpty(req.body.size || "Única", "Talla", 32);
      const price = money(req.body.rentalPrice);
      const result = await rows(
        "INSERT INTO garments (sku,name,type,dance_id,size,rental_price) VALUES (?,?,?,?,?,?)",
        [sku, name, type, danceId, size, price],
      );
      await audit(
        "GARMENT_CREATED",
        "garments",
        result.insertId,
        Number(req.user.sub),
      );
      res.status(201).json({ id: result.insertId });
    }),
  );

  app.patch(
    "/garments/:id",
    loginRequired,
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      const old = await first("SELECT * FROM garments WHERE id=?", [id]);
      if (!old) throw httpError(404, "Prenda no encontrada");
      const type = req.body.type ?? old.type;
      assert(["PRENDA", "ACCESORIO"].includes(type), "Tipo inválido");
      await rows(
        "UPDATE garments SET name=?,type=?,size=?,rental_price=?,active=? WHERE id=?",
        [
          req.body.name === undefined
            ? old.name
            : nonEmpty(req.body.name, "Nombre"),
          type,
          req.body.size ?? old.size,
          req.body.rentalPrice === undefined
            ? old.rental_price
            : money(req.body.rentalPrice),
          req.body.active === undefined ? old.active : !!req.body.active,
          id,
        ],
      );
      await audit("GARMENT_UPDATED", "garments", id, Number(req.user.sub));
      res.json({ ok: true });
    }),
  );

  app.get(
    "/units",
    loginRequired,
    asyncRoute(async (req, res) => {
      let sql = `SELECT u.*,g.name AS garment_name,g.sku,d.name AS dance_name FROM units u
      JOIN garments g ON g.id=u.garment_id JOIN dances d ON d.id=g.dance_id WHERE 1=1`;
      const params = [];
      if (req.query.garmentId) {
        sql += " AND u.garment_id=?";
        params.push(numberId(req.query.garmentId));
      }
      if (req.query.state) {
        assert(stateValues.includes(req.query.state), "Estado inválido");
        sql += " AND u.state=?";
        params.push(req.query.state);
      }
      res.json(await rows(`${sql} ORDER BY u.id LIMIT 5000`, params));
    }),
  );

  app.post(
    "/units",
    loginRequired,
    asyncRoute(async (req, res) => {
      const id = numberId(req.body.garmentId, "Prenda");
      const code = nonEmpty(req.body.code, "Código", 48);
      const conservation = req.body.conservation || "BUENO";
      assert(
        conservationValues.includes(conservation),
        "Conservación inválida",
      );
      const result = await rows(
        "INSERT INTO units (garment_id,code,conservation) VALUES (?,?,?)",
        [id, code, conservation],
      );
      await audit(
        "UNIT_CREATED",
        "units",
        result.insertId,
        Number(req.user.sub),
        { code },
      );
      res.status(201).json({ id: result.insertId });
    }),
  );

  app.patch(
    "/units/:id",
    loginRequired,
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      const old = await first("SELECT * FROM units WHERE id=?", [id]);
      if (!old) throw httpError(404, "Unidad no encontrada");
      const state = req.body.state ?? old.state;
      const conservation = req.body.conservation ?? old.conservation;
      assert(
        stateValues.includes(state) &&
          conservationValues.includes(conservation),
        "Estado inválido",
      );
      assert(
        old.state !== "RENTED" && old.state !== "HELD",
        "No se puede editar una unidad asignada",
      );
      assert(
        !["HELD", "RENTED"].includes(state),
        "El alquiler controla los estados de asignación",
      );
      await rows(
        "UPDATE units SET state=?,conservation=?,notes=?,active=? WHERE id=?",
        [
          state,
          conservation,
          req.body.notes ?? old.notes,
          req.body.active === undefined ? old.active : !!req.body.active,
          id,
        ],
      );
      await audit("UNIT_UPDATED", "units", id, Number(req.user.sub), {
        state,
        conservation,
      });
      res.json({ ok: true });
    }),
  );

  app.get(
    "/sets",
    loginRequired,
    asyncRoute(async (req, res) => {
      const args = [];
      let sql = `SELECT s.*,d.name AS dance_name FROM garment_sets s JOIN dances d ON d.id=s.dance_id WHERE s.active=1`;
      if (req.query.danceId) {
        sql += " AND s.dance_id=?";
        args.push(numberId(req.query.danceId));
      }
      const sets = await rows(`${sql} ORDER BY s.id`, args);
      const details = await rows(
        "SELECT si.set_id,si.garment_id,si.quantity,g.name,g.rental_price FROM set_items si JOIN garments g ON g.id=si.garment_id",
      );
      res.json(
        sets.map((s) => ({
          ...s,
          items: details.filter((d) => d.set_id === s.id),
        })),
      );
    }),
  );

  app.post(
    "/sets",
    loginRequired,
    asyncRoute(async (req, res) => {
      const name = nonEmpty(req.body.name, "Conjunto");
      const items = req.body.items;
      assert(
        Array.isArray(items) && items.length > 0,
        "El conjunto necesita prendas",
      );
      const id = await inTx(async (conn) => {
        const [result] = await conn.execute(
          "INSERT INTO garment_sets (name,dance_id,size,fixed_price) VALUES (?,?,?,?)",
          [
            name,
            numberId(req.body.danceId),
            req.body.size || "Única",
            money(req.body.fixedPrice),
          ],
        );
        for (const item of items) {
          await conn.execute(
            "INSERT INTO set_items (set_id,garment_id,quantity) VALUES (?,?,?)",
            [
              result.insertId,
              numberId(item.garmentId),
              numberId(item.quantity),
            ],
          );
        }
        return result.insertId;
      });
      await audit("SET_CREATED", "sets", id, Number(req.user.sub));
      res.status(201).json({ id });
    }),
  );

  app.patch(
    "/sets/:id",
    loginRequired,
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      const current = await first("SELECT * FROM garment_sets WHERE id=?", [
        id,
      ]);
      if (!current) throw httpError(404, "Conjunto no encontrado");
      await inTx(async (conn) => {
        await conn.execute(
          "UPDATE garment_sets SET name=?,fixed_price=?,active=? WHERE id=?",
          [
            req.body.name === undefined
              ? current.name
              : nonEmpty(req.body.name, "Nombre"),
            req.body.fixedPrice === undefined
              ? current.fixed_price
              : money(req.body.fixedPrice),
            req.body.active === undefined ? current.active : !!req.body.active,
            id,
          ],
        );
        if (Array.isArray(req.body.items)) {
          assert(
            req.body.items.length > 0,
            "El conjunto no puede quedar vacío",
          );
          await conn.execute("DELETE FROM set_items WHERE set_id=?", [id]);
          for (const item of req.body.items)
            await conn.execute(
              "INSERT INTO set_items (set_id,garment_id,quantity) VALUES (?,?,?)",
              [id, numberId(item.garmentId), numberId(item.quantity)],
            );
        }
      });
      await audit("SET_UPDATED", "sets", id, Number(req.user.sub));
      res.json({ ok: true });
    }),
  );

  app.get(
    "/internal/sets/:id",
    internalOnly,
    asyncRoute(async (req, res) => {
      res.json(await getSetDetails(numberId(req.params.id)));
    }),
  );

  // Expira bloqueos antes de consultar; operación idempotente para evitar dobles asignaciones.
  app.post(
    "/internal/hold",
    internalOnly,
    asyncRoute(async (req, res) => {
      const requests = req.body.garments;
      assert(
        Array.isArray(requests) && requests.length > 0 && requests.length <= 40,
        "Prendas inválidas",
      );
      const idList = [];
      for (const item of requests)
        for (let j = 0; j < numberId(item.quantity); j++) {
          assert(idList.length < 40, "Máximo 40 unidades por alquiler");
          idList.push(numberId(item.garmentId));
        }
      const token = randomUUID();
      const allocated = await inTx(async (conn) => {
        // Liberar bloqueos vencidos con la misma transacción.
        await conn.execute(
          "UPDATE units SET state='AVAILABLE',hold_token=NULL,hold_expires=NULL WHERE state='HELD' AND hold_expires<UTC_TIMESTAMP()",
        );
        const selected = [];
        for (const garmentId of idList) {
          const [list] = await conn.execute(
            `SELECT u.id,u.code,g.name,g.rental_price FROM units u
          JOIN garments g ON g.id=u.garment_id WHERE u.garment_id=? AND u.state='AVAILABLE' AND u.active=1 AND g.active=1 ORDER BY u.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [garmentId],
          );
          if (!list.length)
            throw httpError(
              409,
              `Sin disponibilidad de una prenda solicitada (ID ${garmentId})`,
              "OUT_OF_STOCK",
            );
          const unit = list[0];
          await conn.execute(
            "UPDATE units SET state='HELD',hold_token=?,hold_expires=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE) WHERE id=?",
            [token, unit.id],
          );
          selected.push({
            unitId: unit.id,
            code: unit.code,
            garmentName: unit.name,
            price: unit.rental_price,
          });
        }
        return selected;
      });
      res.json({ token, units: allocated });
    }),
  );

  app.post(
    "/internal/commit",
    internalOnly,
    asyncRoute(async (req, res) => {
      const token = nonEmpty(req.body.token, "Bloqueo", 80);
      const rentalId = numberId(req.body.rentalId);
      const count = await inTx(async (conn) => {
        const [already] = await conn.execute(
          "SELECT COUNT(*) AS n FROM units WHERE rental_id=? AND state=?",
          [rentalId, "RENTED"],
        );
        if (already[0].n > 0) return already[0].n;
        const [units] = await conn.execute(
          "SELECT id FROM units WHERE state='HELD' AND hold_token=? AND hold_expires>=UTC_TIMESTAMP() FOR UPDATE",
          [token],
        );
        assert(
          units.length > 0,
          "El bloqueo de prendas expiró",
          409,
          "HOLD_EXPIRED",
        );
        await conn.execute(
          "UPDATE units SET state='RENTED',rental_id=?,hold_token=NULL,hold_expires=NULL WHERE hold_token=? AND state='HELD'",
          [rentalId, token],
        );
        return units.length;
      });
      res.json({ ok: true, units: count });
    }),
  );

  app.post(
    "/internal/release-hold",
    internalOnly,
    asyncRoute(async (req, res) => {
      await rows(
        "UPDATE units SET state='AVAILABLE',hold_token=NULL,hold_expires=NULL WHERE hold_token=? AND state='HELD'",
        [req.body.token || ""],
      );
      res.json({ ok: true });
    }),
  );

  app.post(
    "/internal/release-unit",
    internalOnly,
    asyncRoute(async (req, res) => {
      const state =
        req.body.condition === "DAÑADO" ? "MAINTENANCE" : "AVAILABLE";
      const old = await first("SELECT * FROM units WHERE id=?", [
        numberId(req.body.unitId),
      ]);
      if (
        old?.last_rental_id === Number(req.body.rentalId) &&
        old.rental_id === null
      ) {
        res.json({ ok: true, state: old.state, already: true });
        return;
      }
      const result = await rows(
        "UPDATE units SET state=?,conservation=?,last_rental_id=rental_id,rental_id=NULL WHERE id=? AND state='RENTED' AND rental_id=?",
        [
          state,
          req.body.condition,
          numberId(req.body.unitId),
          numberId(req.body.rentalId),
        ],
      );
      assert(
        result.affectedRows === 1,
        "Unidad no corresponde al alquiler o ya fue devuelta",
        409,
        "UNIT_CONFLICT",
      );
      res.json({ ok: true, state });
    }),
  );
}
// Consultas internas para cotización sin exponer inventario al cliente.
export async function getSetDetails(setId) {
  const set = await first(
    "SELECT * FROM garment_sets WHERE id=? AND active=1",
    [setId],
  );
  if (!set) throw httpError(404, "Conjunto no encontrado");
  const items = await rows(
    "SELECT si.garment_id AS garmentId,si.quantity,g.rental_price AS price FROM set_items si JOIN garments g ON g.id=si.garment_id WHERE si.set_id=? AND g.active=1",
    [setId],
  );
  const total = await first(
    "SELECT COUNT(*) AS n FROM set_items WHERE set_id=?",
    [setId],
  );
  assert(
    items.length > 0 && items.length === total.n,
    "El conjunto tiene prendas desactivadas o no contiene piezas",
    409,
  );
  return { ...set, items };
}
