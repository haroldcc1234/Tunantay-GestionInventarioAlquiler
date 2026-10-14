import { registerStorefront } from "./storefront.js";
import { durationByCutoff } from "./rules.js";
import { randomUUID } from "node:crypto";
import {
  asyncRoute,
  loginRequired,
  internalOnly,
  rows,
  first,
  inTx,
  assert,
  nonEmpty,
  numberId,
  httpError,
  audit,
  call,
  roundMoney,
  isDate,
} from "./core.js";

const cache = {
  settings: {
    PRICE_MODE: "FIXED",
    CUTOFF_HOUR: "12",
    DEBT_POLICY: "REQUIRE_APPROVAL",
  },
  expires: 0,
};
async function settings() {
  if (Date.now() < cache.expires) return cache.settings;
  try {
    cache.settings = await call("admin", "/internal/settings");
    cache.expires = Date.now() + 30000;
  } catch {
    cache.expires = Date.now() + 5000;
  }
  return cache.settings;
}

export function register(app) {
  registerStorefront(app);
  // Un alquiler no se activa hasta que Inventario confirme la asignación.
  // Si se interrumpe el proceso tras crear el registro, se reconcilia al volver.
  const reconciliation = setInterval(async () => {
    try {
      const pending = await rows(
        "SELECT id,hold_token FROM rentals WHERE status='PENDING' ORDER BY id LIMIT 25",
      );
      for (const rental of pending) {
        try {
          await call("inventory", "/internal/commit", {
            method: "POST",
            body: { token: rental.hold_token, rentalId: rental.id },
          });
          await rows(
            "UPDATE rentals SET status='ACTIVE' WHERE id=? AND status='PENDING'",
            [rental.id],
          );
        } catch (error) {
          if (error.code === "HOLD_EXPIRED") {
            await rows(
              "UPDATE rentals SET status='CANCELLED' WHERE id=? AND status='PENDING'",
              [rental.id],
            );
          }
        }
      }
    } catch {
      /* Se reintentará si la base de datos se recupera. */
    }
  }, 30000);
  reconciliation.unref();
  app.get(
    "/clients",
    loginRequired,
    asyncRoute(async (req, res) => {
      const term = String(req.query.search || "");
      res.json(
        await rows(
          "SELECT * FROM clients WHERE full_name LIKE ? OR doc_number LIKE ? ORDER BY id DESC LIMIT 100",
          [`%${term}%`, `%${term}%`],
        ),
      );
    }),
  );
  app.post(
    "/clients",
    loginRequired,
    asyncRoute(async (req, res) => {
      const fullName = nonEmpty(req.body.fullName, "Nombre");
      const docNumber = nonEmpty(req.body.docNumber, "Documento", 25);
      const result = await rows(
        "INSERT INTO clients (full_name,doc_number,phone,email,address) VALUES (?,?,?,?,?)",
        [
          fullName,
          docNumber,
          req.body.phone || null,
          req.body.email || null,
          req.body.address || null,
        ],
      );
      await audit(
        "CLIENT_CREATED",
        "clients",
        result.insertId,
        Number(req.user.sub),
      );
      res.status(201).json({ id: result.insertId });
    }),
  );
  app.patch(
    "/clients/:id",
    loginRequired,
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      const old = await first("SELECT * FROM clients WHERE id=?", [id]);
      if (!old) throw httpError(404, "Cliente no encontrado");
      await rows(
        "UPDATE clients SET full_name=?,doc_number=?,phone=?,email=?,address=? WHERE id=?",
        [
          req.body.fullName === undefined
            ? old.full_name
            : nonEmpty(req.body.fullName, "Nombre"),
          req.body.docNumber ?? old.doc_number,
          req.body.phone ?? old.phone,
          req.body.email ?? old.email,
          req.body.address ?? old.address,
          id,
        ],
      );
      await audit("CLIENT_UPDATED", "clients", id, Number(req.user.sub));
      res.json({ ok: true });
    }),
  );

  app.get(
    "/rentals",
    loginRequired,
    asyncRoute(async (req, res) => {
      const args = [];
      let sql = `SELECT r.*,c.full_name AS client_name,c.doc_number FROM rentals r
      JOIN clients c ON c.id=r.client_id WHERE 1=1`;
      if (req.query.status) {
        sql += " AND r.status=?";
        args.push(req.query.status);
      }
      if (req.query.clientId) {
        sql += " AND r.client_id=?";
        args.push(numberId(req.query.clientId));
      }
      res.json(await rows(`${sql} ORDER BY r.id DESC LIMIT 200`, args));
    }),
  );

  app.get(
    "/rentals/:id",
    loginRequired,
    asyncRoute(async (req, res) => {
      const rental = await getRental(numberId(req.params.id));
      if (!rental) throw httpError(404, "Alquiler no encontrado");
      try {
        rental.balance = await call(
          "returns",
          `/internal/rentals/${rental.id}/balance`,
          {},
        );
      } catch {
        rental.balance = null;
      }
      res.json(rental);
    }),
  );

  app.post(
    "/rentals",
    loginRequired,
    asyncRoute(async (req, res) => {
      const requestId = req.body.requestId
        ? nonEmpty(req.body.requestId, "Identificador de solicitud", 80)
        : randomUUID();
      const previous = await first(
        "SELECT id,folio,base_amount AS amount,duration_days AS days,status FROM rentals WHERE request_id=?",
        [requestId],
      );
      if (previous) {
        if (previous.status === "PENDING")
          throw httpError(
            409,
            "El alquiler todavía se está confirmando. Vuelve a consultar.",
            "PENDING_RENTAL",
          );
        if (previous.status === "CANCELLED")
          throw httpError(
            409,
            "La operación anterior no se completó. Inicia una nueva solicitud.",
            "CANCELLED_RENTAL",
          );
        res.json(previous);
        return;
      }
      if (requestId.startsWith("WEB-")) {
        const request = await first(
          "SELECT * FROM web_requests WHERE id=? AND status=?",
          [numberId(requestId.slice(4)), "PENDING"],
        );
        assert(request, "Solicitud no disponible", 409);
        assert(
          Number(req.body.setId) === request.set_id,
          "El conjunto debe coincidir con la solicitud",
        );
        const client = await first(
          "SELECT doc_number FROM clients WHERE id=?",
          [numberId(req.body.clientId)],
        );
        assert(
          client?.doc_number === request.doc_number,
          "El cliente debe coincidir con la solicitud",
        );
      }
      const clientId = numberId(req.body.clientId, "Cliente");
      assert(
        await first("SELECT id FROM clients WHERE id=?", [clientId]),
        "Cliente no encontrado",
        404,
      );
      assert(isDate(req.body.dueAt), "Fecha de devolución inválida");
      const now = new Date();
      const due = new Date(req.body.dueAt);
      assert(
        due.getTime() > now.getTime(),
        "La devolución debe ser posterior a la entrega",
      );
      assert(
        due.getTime() - now.getTime() <= 45 * 86400000,
        "El plazo máximo de demostración es 45 días",
      );
      const cfg = await settings();
      const cutoff = Number(cfg.CUTOFF_HOUR);
      assert(
        Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 23,
        "Horario de corte inválido",
      );
      const days = durationByCutoff(now.getTime(), due.getTime(), cutoff);
      const debt = await call("returns", `/internal/clients/${clientId}/debt`);
      if (debt.balance > 0.009) {
        if (cfg.DEBT_POLICY === "BLOCK")
          throw httpError(
            409,
            "Este cliente tiene saldo pendiente; no puede alquilar",
            "DEBT_BLOCKED",
          );
        if (cfg.DEBT_POLICY === "REQUIRE_APPROVAL") {
          const approval = await call(
            "returns",
            `/internal/clients/${clientId}/approval`,
          );
          if (!approval.approved)
            throw httpError(
              409,
              "El cliente tiene saldo pendiente. Solicita autorización del administrador.",
              "APPROVAL_REQUIRED",
            );
        }
      }
      const setId = req.body.setId ? numberId(req.body.setId) : null;
      let requests = [];
      let fixedPrice = 0;
      if (setId) {
        const set = await call("inventory", `/internal/sets/${setId}`);
        requests = set.items.map((item) => ({
          garmentId: item.garmentId,
          quantity: item.quantity,
        }));
        fixedPrice = Number(set.fixed_price);
      } else {
        requests = req.body.items;
        assert(
          Array.isArray(requests) && requests.length > 0,
          "Debes elegir prendas o un conjunto",
        );
        requests = requests.map((i) => ({
          garmentId: numberId(i.garmentId),
          quantity: numberId(i.quantity),
        }));
      }
      const held = await call("inventory", "/internal/hold", {
        method: "POST",
        body: { garments: requests },
      });
      let id = null;
      try {
        const unitSum = held.units.reduce(
          (sum, item) => sum + Number(item.price),
          0,
        );
        const unitPrice =
          setId && cfg.PRICE_MODE === "FIXED" ? fixedPrice : unitSum;
        const amount = roundMoney(unitPrice * days);
        const folio = `ALQ-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
        id = await inTx(async (conn) => {
          if (requestId.startsWith("WEB-")) {
            const [source] = await conn.execute(
              "SELECT status FROM web_requests WHERE id=? FOR UPDATE",
              [numberId(requestId.slice(4))],
            );
            assert(
              source[0]?.status === "PENDING",
              "La solicitud fue cerrada",
              409,
            );
          }
          const [r] = await conn.execute(
            `INSERT INTO rentals
          (folio,request_id,hold_token,client_id,created_by,start_at,due_at,cutoff_hour,duration_days,base_amount,status)
          VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING')`,
            [
              folio,
              requestId,
              held.token,
              clientId,
              Number(req.user.sub),
              now,
              due,
              cutoff,
              days,
              amount,
            ],
          );
          for (const item of held.units) {
            await conn.execute(
              `INSERT INTO rental_items (rental_id,unit_id,garment_name,unit_code,price) VALUES (?,?,?,?,?)`,
              [
                r.insertId,
                item.unitId,
                item.garmentName,
                item.code,
                item.price,
              ],
            );
          }
          return r.insertId;
        });
        await call("inventory", "/internal/commit", {
          method: "POST",
          body: { token: held.token, rentalId: id },
        });
        await rows(
          "UPDATE rentals SET status='ACTIVE' WHERE id=? AND status='PENDING'",
          [id],
        );
        if (debt.balance > 0.009 && cfg.DEBT_POLICY === "REQUIRE_APPROVAL") {
          await call(
            "returns",
            `/internal/clients/${clientId}/consume-approval`,
            { method: "POST" },
          );
        }
        await audit("RENTAL_CREATED", "rentals", id, Number(req.user.sub), {
          folio,
          amount,
          days,
        });
        res.status(201).json({ id, folio, amount, days, status: "ACTIVE" });
      } catch (error) {
        if (!id)
          await call("inventory", "/internal/release-hold", {
            method: "POST",
            body: { token: held.token },
          }).catch(() => {});
        // Si el alquiler llegó a PENDING, se conserva para recuperación sin duplicar asignaciones.
        throw error;
      }
    }),
  );

  app.get(
    "/internal/rentals/:id",
    internalOnly,
    asyncRoute(async (req, res) => {
      const rental = await getRental(numberId(req.params.id));
      if (!rental) throw httpError(404, "Alquiler no encontrado");
      res.json(rental);
    }),
  );
  app.get(
    "/internal/clients/:id/rentals",
    internalOnly,
    asyncRoute(async (req, res) => {
      res.json(
        await rows(
          "SELECT id,base_amount,status FROM rentals WHERE client_id=? AND status IN ('ACTIVE','PARTIAL','RETURNED')",
          [numberId(req.params.id)],
        ),
      );
    }),
  );
  app.post(
    "/internal/items/:id/returned",
    internalOnly,
    asyncRoute(async (req, res) => {
      const itemId = numberId(req.params.id);
      const rentalId = numberId(req.body.rentalId);
      await inTx(async (conn) => {
        const [result] = await conn.execute(
          "UPDATE rental_items SET status='RETURNED' WHERE id=? AND rental_id=? AND status='OUT'",
          [itemId, rentalId],
        );
        if (result.affectedRows === 0) {
          const [existing] = await conn.execute(
            "SELECT status FROM rental_items WHERE id=? AND rental_id=?",
            [itemId, rentalId],
          );
          assert(
            existing[0]?.status === "RETURNED",
            "Prenda no pertenece al alquiler",
            409,
            "ITEM_CONFLICT",
          );
        }
        const [left] = await conn.execute(
          "SELECT COUNT(*) AS n FROM rental_items WHERE rental_id=? AND status='OUT'",
          [rentalId],
        );
        await conn.execute("UPDATE rentals SET status=? WHERE id=?", [
          left[0].n === 0 ? "RETURNED" : "PARTIAL",
          rentalId,
        ]);
      });
      res.json({ ok: true });
    }),
  );
}

async function getRental(id) {
  const r = await first(
    "SELECT r.*,c.full_name AS client_name,c.doc_number FROM rentals r JOIN clients c ON c.id=r.client_id WHERE r.id=?",
    [id],
  );
  if (!r) return null;
  return {
    ...r,
    items: await rows(
      "SELECT * FROM rental_items WHERE rental_id=? ORDER BY id",
      [id],
    ),
  };
}
