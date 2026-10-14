import { randomUUID } from "node:crypto";
import {
  asyncRoute,
  loginRequired,
  rows,
  first,
  assert,
  nonEmpty,
  numberId,
  httpError,
  call,
  audit,
  inTx,
} from "./core.js";

export function registerStorefront(app) {
  app.patch(
    "/requests/:id/status",
    loginRequired,
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      const status = req.body.status;
      assert(["PENDING", "CANCELLED"].includes(status), "Estado inválido");
      await inTx(async (conn) => {
        const [requests] = await conn.execute(
          "SELECT id FROM web_requests WHERE id=? FOR UPDATE",
          [id],
        );
        assert(requests.length, "Solicitud no encontrada", 404);
        const [rentals] = await conn.execute(
          "SELECT id FROM rentals WHERE request_id=?",
          [`WEB-${id}`],
        );
        assert(
          !rentals.length,
          "La solicitud ya está vinculada con un alquiler",
          409,
        );
        await conn.execute("UPDATE web_requests SET status=? WHERE id=?", [
          status,
          id,
        ]);
      });
      await audit(
        "WEB_REQUEST_STATUS",
        "web_requests",
        id,
        Number(req.user.sub),
        { status },
      );
      res.json({ ok: true });
    }),
  );
  const attempts = new Map();
  const cleanup = setInterval(() => {
    for (const [key, value] of attempts) {
      if (value.until < Date.now()) attempts.delete(key);
    }
  }, 60000);
  cleanup.unref();

  app.post(
    "/public/requests",
    asyncRoute(async (req, res) => {
      const key = req.ip;
      const entry = attempts.get(key) || {
        count: 0,
        until: Date.now() + 600000,
      };
      assert(
        entry.count < 15,
        "Has enviado varias solicitudes. Inténtalo en unos minutos.",
        429,
      );
      entry.count += 1;
      attempts.set(key, entry);
      const requestKey = nonEmpty(req.body.requestKey, "Identificador", 36);
      assert(/^[a-f0-9-]{36}$/i.test(requestKey), "Identificador inválido");
      assert(
        req.body.consent === true,
        "Debes aceptar el uso de tus datos para atender la solicitud",
      );
      const fullName = nonEmpty(req.body.fullName, "Nombre", 160);
      const docNumber = nonEmpty(req.body.docNumber, "Documento", 25);
      const phone = nonEmpty(req.body.phone, "Teléfono", 30);
      assert(/^[0-9A-Za-z-]{8,20}$/.test(docNumber), "Documento inválido");
      assert(/^[+\d\s()-]{7,25}$/.test(phone), "Teléfono inválido");
      const email = String(req.body.email || "").trim();
      assert(
        !email ||
          (email.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
        "Correo inválido",
      );
      const pickup = String(req.body.pickupDate || "");
      const due = String(req.body.returnDate || "");
      const today = new Date(Date.now() - 5 * 3600000)
        .toISOString()
        .slice(0, 10);
      assert(
        /^\d{4}-\d{2}-\d{2}$/.test(pickup) && /^\d{4}-\d{2}-\d{2}$/.test(due),
        "Fechas inválidas",
      );
      const from = new Date(`${pickup}T12:00:00-05:00`);
      const to = new Date(`${due}T12:00:00-05:00`);
      assert(
        Number.isFinite(+from) && Number.isFinite(+to),
        "Fechas inválidas",
      );
      assert(
        from.toISOString().slice(0, 10) === pickup &&
          to.toISOString().slice(0, 10) === due,
        "La fecha no existe",
      );
      assert(
        pickup >= today &&
          due >= pickup &&
          +to - +from <= 45 * 86400000 &&
          +from - Date.now() < 366 * 86400000,
        "Revisa las fechas; el alquiler admite hasta 45 días",
      );
      const setId = numberId(req.body.setId, "Conjunto");
      const set = await call("inventory", `/internal/sets/${setId}`);
      assert(set.items.length > 0, "Este conjunto no está disponible", 409);
      const note = String(req.body.notes || "").trim();
      assert(note.length <= 500, "La nota admite hasta 500 caracteres");
      const reference = `SOL-${randomUUID().slice(0, 8).toUpperCase()}`;
      await rows(
        `INSERT INTO web_requests
      (request_key,reference,full_name,doc_number,phone,email,set_id,set_name,pickup_date,return_date,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key`,
        [
          requestKey,
          reference,
          fullName,
          docNumber,
          phone,
          email || null,
          setId,
          set.name,
          pickup,
          due,
          note,
        ],
      );
      const saved = await first(
        "SELECT reference FROM web_requests WHERE request_key=?",
        [requestKey],
      );
      res.status(201).json({ reference: saved.reference });
    }),
  );

  app.get(
    "/requests",
    loginRequired,
    asyncRoute(async (_req, res) => {
      res.json(
        await rows(`SELECT w.*,r.id AS rental_id,r.folio,r.status AS rental_status
      FROM web_requests w LEFT JOIN rentals r ON r.request_id=CONCAT('WEB-',w.id)
      ORDER BY w.created_at DESC LIMIT 300`),
      );
    }),
  );

  app.post(
    "/requests/:id/prepare",
    loginRequired,
    asyncRoute(async (req, res) => {
      const request = await first("SELECT * FROM web_requests WHERE id=?", [
        numberId(req.params.id),
      ]);
      assert(
        request && request.status === "PENDING",
        "Solicitud no disponible",
        409,
      );
      await rows(
        `INSERT INTO clients (full_name,doc_number,phone,email)
      VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [request.full_name, request.doc_number, request.phone, request.email],
      );
      const client = await first("SELECT id FROM clients WHERE doc_number=?", [
        request.doc_number,
      ]);
      await audit(
        "WEB_REQUEST_PREPARED",
        "web_requests",
        request.id,
        Number(req.user.sub),
      );
      res.json({
        clientId: client.id,
        setId: request.set_id,
        requestId: `WEB-${request.id}`,
        dueAt: `${String(request.return_date).slice(0, 10)}T17:00`,
        reference: request.reference,
      });
    }),
  );
}
