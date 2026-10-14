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
  roundMoney,
} from "./core.js";

async function balance(id) {
  const rental = await call("rental", `/internal/rentals/${id}`);
  const pay = await first(
    "SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE rental_id=?",
    [id],
  );
  const damage = await first(
    "SELECT COALESCE(SUM(approved_amount),0) AS amount FROM damages WHERE rental_id=? AND status='APPROVED'",
    [id],
  );
  const total = roundMoney(Number(rental.base_amount) + Number(damage.amount));
  return {
    rentalId: id,
    base: Number(rental.base_amount),
    damage: Number(damage.amount),
    total,
    paid: Number(pay.amount),
    balance: roundMoney(Math.max(0, total - Number(pay.amount))),
  };
}
async function customerDebt(id) {
  const rentals = await call("rental", `/internal/clients/${id}/rentals`);
  const vals = await Promise.all(rentals.map((r) => balance(r.id)));
  return {
    clientId: id,
    balance: roundMoney(vals.reduce((s, item) => s + item.balance, 0)),
    rentals: vals,
  };
}

export function register(app) {
  app.get(
    "/rentals/:id/balance",
    loginRequired,
    asyncRoute(async (req, res) =>
      res.json(await balance(numberId(req.params.id))),
    ),
  );
  app.get(
    "/clients/:id/debt",
    loginRequired,
    asyncRoute(async (req, res) =>
      res.json(await customerDebt(numberId(req.params.id))),
    ),
  );
  app.get(
    "/internal/rentals/:id/balance",
    internalOnly,
    asyncRoute(async (req, res) =>
      res.json(await balance(numberId(req.params.id))),
    ),
  );
  app.get(
    "/internal/clients/:id/debt",
    internalOnly,
    asyncRoute(async (req, res) =>
      res.json(await customerDebt(numberId(req.params.id))),
    ),
  );
  app.get(
    "/internal/clients/:id/approval",
    internalOnly,
    asyncRoute(async (req, res) => {
      const auth = await first(
        "SELECT id FROM debt_authorizations WHERE client_id=? AND consumed=0 ORDER BY id DESC LIMIT 1",
        [numberId(req.params.id)],
      );
      res.json({ approved: !!auth });
    }),
  );
  app.post(
    "/internal/clients/:id/consume-approval",
    internalOnly,
    asyncRoute(async (req, res) => {
      const auth = await first(
        "SELECT id FROM debt_authorizations WHERE client_id=? AND consumed=0 ORDER BY id DESC LIMIT 1",
        [numberId(req.params.id)],
      );
      if (auth)
        await rows("UPDATE debt_authorizations SET consumed=1 WHERE id=?", [
          auth.id,
        ]);
      res.json({ ok: !!auth });
    }),
  );
  app.post(
    "/clients/:id/authorize-debt",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (req, res) => {
      const clientId = numberId(req.params.id);
      const debt = await customerDebt(clientId);
      assert(debt.balance > 0, "El cliente no tiene deuda pendiente");
      const r = await rows(
        "INSERT INTO debt_authorizations (client_id,approved_by) VALUES (?,?)",
        [clientId, Number(req.user.sub)],
      );
      await audit(
        "DEBT_AUTHORIZED",
        "clients",
        clientId,
        Number(req.user.sub),
        { amount: debt.balance },
      );
      res.status(201).json({ id: r.insertId });
    }),
  );

  app.get(
    "/returns",
    loginRequired,
    asyncRoute(async (req, res) => {
      res.json(
        await rows("SELECT * FROM return_items ORDER BY id DESC LIMIT 150"),
      );
    }),
  );
  app.post(
    "/returns",
    loginRequired,
    asyncRoute(async (req, res) => {
      const rentalId = numberId(req.body.rentalId);
      const itemId = numberId(req.body.rentalItemId);
      const condition = req.body.condition;
      assert(
        ["EXCELENTE", "BUENO", "REGULAR", "DAÑADO"].includes(condition),
        "Conservación inválida",
      );
      const rental = await call("rental", `/internal/rentals/${rentalId}`);
      const item = rental.items.find((i) => i.id === itemId);
      if (!item) throw httpError(404, "Prenda no pertenece a este alquiler");
      const note =
        typeof req.body.notes === "string"
          ? req.body.notes.slice(0, 300)
          : null;
      let existing = await first(
        "SELECT * FROM return_items WHERE rental_item_id=?",
        [itemId],
      );
      if (existing?.status === "DONE")
        throw httpError(409, "Esta unidad ya fue devuelta", "ALREADY_RETURNED");
      if (!existing) {
        const result = await rows(
          `INSERT INTO return_items (rental_id,rental_item_id,unit_id,condition_state,notes,registered_by)
        VALUES (?,?,?,?,?,?)`,
          [
            rentalId,
            itemId,
            item.unit_id,
            condition,
            note,
            Number(req.user.sub),
          ],
        );
        existing = { id: result.insertId, condition_state: condition };
      }
      // Reanudable: si la comunicación falla, volver a enviar la misma devolución.
      await call("inventory", "/internal/release-unit", {
        method: "POST",
        body: {
          unitId: item.unit_id,
          rentalId,
          condition: existing.condition_state,
        },
      });
      await call("rental", `/internal/items/${itemId}/returned`, {
        method: "POST",
        body: { rentalId },
      });
      if (existing.condition_state === "DAÑADO") {
        const config = await call("admin", "/internal/settings").catch(() => ({
          DAMAGE_BASE: "25",
        }));
        const suggested = money(req.body.suggestedAmount ?? config.DAMAGE_BASE);
        await rows(
          `INSERT INTO damages (rental_id,unit_id,suggested_amount,notes,requested_by)
        VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
          [rentalId, item.unit_id, suggested, note, Number(req.user.sub)],
        );
      }
      await rows("UPDATE return_items SET status='DONE' WHERE id=?", [
        existing.id,
      ]);
      await audit("UNIT_RETURNED", "rentals", rentalId, Number(req.user.sub), {
        itemId,
        condition: existing.condition_state,
      });
      res.status(201).json({ ok: true, condition: existing.condition_state });
    }),
  );

  app.get(
    "/damages",
    loginRequired,
    asyncRoute(async (req, res) => {
      res.json(await rows("SELECT * FROM damages ORDER BY id DESC LIMIT 200"));
    }),
  );
  app.patch(
    "/damages/:id/decision",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      assert(
        ["APPROVED", "REJECTED"].includes(req.body.decision),
        "Decisión inválida",
      );
      const item = await first("SELECT * FROM damages WHERE id=?", [id]);
      if (!item) throw httpError(404, "Evaluación no encontrada");
      assert(item.status === "PENDING", "Esta evaluación ya fue resuelta", 409);
      const amount =
        req.body.decision === "APPROVED"
          ? money(req.body.amount ?? item.suggested_amount)
          : null;
      const decision = await rows(
        "UPDATE damages SET status=?,approved_amount=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP() WHERE id=? AND status='PENDING'",
        [req.body.decision, amount, Number(req.user.sub), id],
      );
      assert(
        decision.affectedRows === 1,
        "Esta evaluación ya fue resuelta",
        409,
      );
      await audit("DAMAGE_DECIDED", "damages", id, Number(req.user.sub), {
        decision: req.body.decision,
        amount,
      });
      res.json({ ok: true });
    }),
  );

  app.get(
    "/payments",
    loginRequired,
    asyncRoute(async (req, res) => {
      let sql = "SELECT * FROM payments";
      const args = [];
      if (req.query.rentalId) {
        sql += " WHERE rental_id=?";
        args.push(numberId(req.query.rentalId));
      }
      res.json(await rows(`${sql} ORDER BY id DESC LIMIT 150`, args));
    }),
  );
  app.post(
    "/payments",
    loginRequired,
    asyncRoute(async (req, res) => {
      const rentalId = numberId(req.body.rentalId);
      const amount = money(req.body.amount);
      assert(amount > 0, "El pago debe ser mayor a cero");
      const method = req.body.method || "EFECTIVO";
      assert(
        ["EFECTIVO", "YAPE", "PLIN", "TRANSFERENCIA"].includes(method),
        "Método de pago inválido",
      );
      const current = await balance(rentalId);
      assert(
        amount <= current.balance + 0.001,
        "El pago excede el saldo pendiente",
        409,
        "OVERPAYMENT",
      );
      const payment = await inTx(async (conn) => {
        // Bloqueo de fila transaccional: evita dos pagos simultáneos superiores al saldo.
        await conn.execute(
          "INSERT IGNORE INTO payment_locks (rental_id) VALUES (?)",
          [rentalId],
        );
        await conn.execute(
          "SELECT rental_id FROM payment_locks WHERE rental_id=? FOR UPDATE",
          [rentalId],
        );
        const [payments] = await conn.execute(
          "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE rental_id=?",
          [rentalId],
        );
        const remaining = roundMoney(current.total - Number(payments[0].total));
        assert(
          amount <= remaining + 0.001,
          "El pago excede el saldo pendiente",
          409,
          "OVERPAYMENT",
        );
        const [created] = await conn.execute(
          "INSERT INTO payments (rental_id,amount,method,registered_by) VALUES (?,?,?,?)",
          [rentalId, amount, method, Number(req.user.sub)],
        );
        return created.insertId;
      });
      await audit(
        "PAYMENT_REGISTERED",
        "rentals",
        rentalId,
        Number(req.user.sub),
        { amount, method, payment },
      );
      res.status(201).json({ id: payment, balance: await balance(rentalId) });
    }),
  );
}
