import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { fileURLToPath } from "node:url";
import path from "node:path";

const enabled =
  process.env.TUNANTAY_INTEGRATION === "1" ||
  process.env.npm_lifecycle_event === "test:integration";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8080/api";

test(
  "Integración de clientes, inventario, alquileres, cobros y permisos",
  { skip: !enabled },
  async (t) => {
    process.loadEnvFile(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"),
    );
    const marker = `QA-${randomUUID().slice(0, 8)}`;
    const ids = {
      garments: [],
      units: [],
      sets: [],
      clients: [],
      rentals: [],
      users: [],
      requests: [],
    };
    let admin;
    let employee;
    let garment;
    let set;
    let rental;
    let prepared;
    let reference;
    let imageCount = 0;

    async function request(endpoint, method = "GET", body, token = admin) {
      const response = await fetch(`${base}/${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      return { status: response.status, data: await response.json() };
    }
    function expect(result, status) {
      assert.equal(result.status, status, JSON.stringify(result.data));
      return result.data;
    }

    try {
      await t.test("Autenticación y rutas protegidas", async () => {
        expect(
          await request("inventory/garments", "GET", undefined, null),
          401,
        );
        expect(
          await request("inventory/internal/sets/1", "GET", undefined, null),
          403,
        );
        expect(
          await request(
            "auth/login",
            "POST",
            { email: "admin@tunantay.local", password: "incorrecta" },
            null,
          ),
          401,
        );
        admin = expect(
          await request(
            "auth/login",
            "POST",
            { email: "admin@tunantay.local", password: "Tunantay2026!" },
            null,
          ),
          200,
        ).token;
        employee = expect(
          await request(
            "auth/login",
            "POST",
            { email: "empleado@tunantay.local", password: "Empleado2026!" },
            null,
          ),
          200,
        ).token;
        expect(await request("auth/users", "GET", undefined, employee), 403);
        expect(
          await request(
            "admin/settings",
            "PATCH",
            { CUTOFF_HOUR: 9 },
            employee,
          ),
          403,
        );
      });

      await t.test("Catálogo público e imágenes completas en BD", async () => {
        const catalog = expect(
          await request("inventory/public/catalog", "GET", undefined, null),
          200,
        );
        assert.ok(catalog.length >= 80);
        assert.ok(catalog.every((d) => d.sets.length > 0 && d.description));
        for (const dance of catalog) {
          const response = await fetch(
            `${base}/inventory/dances/${dance.id}/image`,
          );
          assert.equal(response.status, 200, dance.name);
          assert.match(response.headers.get("content-type"), /^image\//);
          assert.ok((await response.arrayBuffer()).byteLength > 100);
          imageCount += 1;
        }
        expect(
          await request(
            "inventory/dances/999999/image",
            "GET",
            undefined,
            null,
          ),
          404,
        );
      });

      await t.test(
        "Alta y edición de inventario físico y conjuntos",
        async () => {
          garment = expect(
            await request("inventory/garments", "POST", {
              name: marker,
              sku: marker,
              type: "PRENDA",
              danceId: 1,
              size: "M",
              rentalPrice: 12,
            }),
            201,
          ).id;
          ids.garments.push(garment);
          expect(
            await request(`inventory/garments/${garment}`, "PATCH", {
              rentalPrice: 15,
            }),
            200,
          );
          const unit = expect(
            await request("inventory/units", "POST", {
              garmentId: garment,
              code: marker,
            }),
            201,
          ).id;
          ids.units.push(unit);
          set = expect(
            await request("inventory/sets", "POST", {
              name: marker,
              danceId: 1,
              size: "M",
              fixedPrice: 20,
              items: [{ garmentId: garment, quantity: 1 }],
            }),
            201,
          ).id;
          ids.sets.push(set);
          const publicSet = expect(
            await request("inventory/public/catalog"),
            200,
          )
            .flatMap((d) => d.sets)
            .find((s) => s.id === set);
          assert.equal(publicSet.available, 1);
          assert.equal(publicSet.price, 20);
          expect(
            await request("admin/settings", "PATCH", { PRICE_MODE: "ITEMS" }),
            200,
          );
          const summed = expect(await request("inventory/public/catalog"), 200)
            .flatMap((d) => d.sets)
            .find((s) => s.id === set);
          assert.equal(summed.price, 15);
          expect(
            await request("admin/settings", "PATCH", { PRICE_MODE: "FIXED" }),
            200,
          );
        },
      );

      await t.test("Solicitud web validada e idempotente", async () => {
        const pickupDate = new Date(Date.now() + 86400000)
          .toISOString()
          .slice(0, 10);
        const returnDate = new Date(Date.now() + 2 * 86400000)
          .toISOString()
          .slice(0, 10);
        const payload = {
          requestKey: randomUUID(),
          consent: true,
          fullName: marker,
          docNumber: marker.replace("-", ""),
          phone: "999000111",
          email: "qa@example.com",
          setId: set,
          pickupDate,
          returnDate,
          notes: "Prueba automatizada; eliminar al terminar.",
        };
        expect(
          await request(
            "rental/public/requests",
            "POST",
            { ...payload, consent: false },
            null,
          ),
          400,
        );
        expect(
          await request(
            "rental/public/requests",
            "POST",
            { ...payload, pickupDate: "2027-02-31" },
            null,
          ),
          400,
        );
        reference = expect(
          await request("rental/public/requests", "POST", payload, null),
          201,
        ).reference;
        assert.equal(
          expect(
            await request("rental/public/requests", "POST", payload, null),
            201,
          ).reference,
          reference,
        );
        const inbox = expect(await request("rental/requests"), 200);
        const item = inbox.find((i) => i.reference === reference);
        assert.ok(item);
        ids.requests.push(item.id);
        expect(await request("rental/requests", "GET", undefined, null), 401);
        expect(
          await request(`rental/requests/${item.id}/status`, "PATCH", {
            status: "CANCELLED",
          }),
          200,
        );
        expect(
          await request(`rental/requests/${item.id}/prepare`, "POST", {}),
          409,
        );
        expect(
          await request(`rental/requests/${item.id}/status`, "PATCH", {
            status: "PENDING",
          }),
          200,
        );
        prepared = expect(
          await request(`rental/requests/${item.id}/prepare`, "POST", {}),
          200,
        );
        ids.clients.push(prepared.clientId);
        assert.equal(prepared.setId, set);
      });

      await t.test(
        "Entrega asociada a solicitud y bloqueo de stock concurrente",
        async () => {
          const payload = {
            ...prepared,
            dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
          };
          const results = await Promise.all([
            request("rental/rentals", "POST", payload),
            request("rental/rentals", "POST", payload),
          ]);
          const success = results.find(
            (r) => r.status === 201 || r.status === 200,
          );
          assert.ok(success, JSON.stringify(results));
          rental = success.data;
          ids.rentals.push(rental.id);
          assert.ok(
            results.every((r) => [200, 201, 409].includes(r.status)),
            JSON.stringify(results),
          );
          assert.equal(
            expect(await request("rental/rentals", "POST", payload), 200).id,
            rental.id,
          );
          const publicSet = expect(
            await request("inventory/public/catalog"),
            200,
          )
            .flatMap((d) => d.sets)
            .find((s) => s.id === set);
          assert.equal(publicSet.available, 0);
          const item = expect(await request("rental/requests"), 200).find(
            (i) => i.reference === reference,
          );
          assert.equal(item.rental_id, rental.id);
          assert.equal(item.rental_status, "ACTIVE");
          expect(
            await request(`rental/requests/${item.id}/status`, "PATCH", {
              status: "CANCELLED",
            }),
            409,
          );
          expect(
            await request(`inventory/units/${ids.units[0]}`, "PATCH", {
              state: "AVAILABLE",
            }),
            400,
          );
        },
      );

      await t.test(
        "Cobros concurrentes sin sobrepago y saldo consistente",
        async () => {
          const result = await Promise.all(
            [1, 2].map(() =>
              request("returns/payments", "POST", {
                rentalId: rental.id,
                amount: rental.amount,
                method: "EFECTIVO",
              }),
            ),
          );
          assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
          assert.equal(
            expect(await request(`returns/rentals/${rental.id}/balance`), 200)
              .balance,
            0,
          );
        },
      );

      await t.test(
        "Devolución, mantenimiento y autorización de daños por rol",
        async () => {
          const detail = expect(
            await request(`rental/rentals/${rental.id}`),
            200,
          );
          const body = {
            rentalId: rental.id,
            rentalItemId: detail.items[0].id,
            condition: "DAÑADO",
            notes: marker,
            suggestedAmount: 5,
          };
          expect(await request("returns/returns", "POST", body, employee), 201);
          expect(await request("returns/returns", "POST", body, employee), 409);
          const damage = expect(await request("returns/damages"), 200).find(
            (d) => d.rental_id === rental.id,
          );
          expect(
            await request(
              `returns/damages/${damage.id}/decision`,
              "PATCH",
              { decision: "APPROVED", amount: 5 },
              employee,
            ),
            403,
          );
          const decisions = await Promise.all(
            [1, 2].map(() =>
              request(`returns/damages/${damage.id}/decision`, "PATCH", {
                decision: "APPROVED",
                amount: 5,
              }),
            ),
          );
          assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
          assert.equal(
            expect(await request(`returns/rentals/${rental.id}/balance`), 200)
              .balance,
            5,
          );
          const unit = expect(
            await request(`inventory/units?garmentId=${garment}`),
            200,
          )[0];
          assert.equal(unit.state, "MAINTENANCE");
          expect(
            await request(`inventory/units/${unit.id}`, "PATCH", {
              state: "AVAILABLE",
              conservation: "BUENO",
            }),
            200,
          );
          assert.equal(
            expect(await request(`rental/rentals/${rental.id}`), 200).status,
            "RETURNED",
          );
        },
      );

      await t.test(
        "Desactivar empleado revoca su acceso inmediatamente",
        async () => {
          const email = `${marker.toLowerCase()}@example.com`;
          const user = expect(
            await request("auth/users", "POST", {
              fullName: marker,
              email,
              password: "PruebaSegura2026!",
            }),
            201,
          );
          ids.users.push(user.id);
          const token = expect(
            await request(
              "auth/login",
              "POST",
              { email, password: "PruebaSegura2026!" },
              null,
            ),
            200,
          ).token;
          expect(
            await request("inventory/garments", "GET", undefined, token),
            200,
          );
          expect(
            await request(`auth/users/${user.id}`, "PATCH", { active: false }),
            200,
          );
          expect(
            await request("inventory/garments", "GET", undefined, token),
            401,
          );
        },
      );

      await t.test("Reportes y auditoría accesibles", async () => {
        const overview = expect(await request("admin/reports/overview"), 200);
        assert.ok(overview.dances >= 80);
        expect(await request("admin/reports/inventory"), 200);
        const audit = expect(await request("admin/reports/audit"), 200);
        assert.ok(audit.some((a) => a.action === "WEB_REQUEST_PREPARED"));
        assert.equal(imageCount, overview.dances);
      });
    } finally {
      const db = await mysql.createConnection({
        host: "127.0.0.1",
        user: process.env.LOCAL_DB_USER || "root",
        password: process.env.LOCAL_DB_PASSWORD,
      });
      try {
        // Sólo IDs creados por esta ejecución; nunca se borran datos preexistentes.
        await db.beginTransaction();
        for (const id of ids.rentals) {
          for (const table of [
            "payments",
            "damages",
            "return_items",
            "payment_locks",
          ]) {
            await db.execute(
              `DELETE FROM returns_db.${table} WHERE rental_id=?`,
              [id],
            );
          }
          await db.execute(
            "DELETE FROM rental_db.rental_items WHERE rental_id=?",
            [id],
          );
          await db.execute("DELETE FROM rental_db.rentals WHERE id=?", [id]);
        }
        for (const id of ids.requests)
          await db.execute("DELETE FROM rental_db.web_requests WHERE id=?", [
            id,
          ]);
        for (const id of ids.clients)
          await db.execute("DELETE FROM rental_db.clients WHERE id=?", [id]);
        for (const id of ids.sets) {
          await db.execute(
            "DELETE FROM inventory_db.set_items WHERE set_id=?",
            [id],
          );
          await db.execute("DELETE FROM inventory_db.garment_sets WHERE id=?", [
            id,
          ]);
        }
        for (const id of ids.units)
          await db.execute("DELETE FROM inventory_db.units WHERE id=?", [id]);
        for (const id of ids.garments)
          await db.execute("DELETE FROM inventory_db.garments WHERE id=?", [
            id,
          ]);
        for (const id of ids.users)
          await db.execute("DELETE FROM auth_db.users WHERE id=?", [id]);
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        await db.end();
      }
    }
  },
);
