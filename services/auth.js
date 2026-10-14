import jwt from "jsonwebtoken";
import {
  asyncRoute,
  loginRequired,
  internalOnly,
  roles,
  rows,
  first,
  assert,
  nonEmpty,
  numberId,
  httpError,
  SECRET,
  hashPassword,
  verifyPassword,
  audit,
} from "./core.js";

export function register(app) {
  app.get(
    "/internal/users/:id",
    internalOnly,
    asyncRoute(async (req, res) => {
      const user = await first("SELECT active,role FROM users WHERE id=?", [
        numberId(req.params.id),
      ]);
      res.json(user || { active: false });
    }),
  );
  app.post(
    "/login",
    asyncRoute(async (req, res) => {
      const email = nonEmpty(req.body.email, "Correo", 180).toLowerCase();
      const password = req.body.password || "";
      const user = await first("SELECT * FROM users WHERE email = ?", [email]);
      if (
        !user ||
        !user.active ||
        !verifyPassword(password, user.password_hash)
      ) {
        throw httpError(
          401,
          "Credenciales incorrectas o cuenta desactivada",
          "LOGIN_FAILED",
        );
      }
      const publicUser = {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      };
      const token = jwt.sign(
        { sub: String(user.id), role: user.role, name: user.full_name },
        SECRET,
        {
          issuer: "tunantay",
          audience: "tunantay-web",
          expiresIn: "8h",
        },
      );
      res.json({ token, user: publicUser, expiresIn: 28800 });
    }),
  );

  app.get(
    "/me",
    loginRequired,
    asyncRoute(async (req, res) => {
      const user = await first(
        "SELECT id, full_name AS fullName, email, role, active FROM users WHERE id = ?",
        [req.user.sub],
      );
      if (!user?.active)
        throw httpError(401, "Cuenta desactivada", "ACCOUNT_DISABLED");
      res.json(user);
    }),
  );

  app.get(
    "/users",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (_req, res) => {
      res.json(
        await rows(
          "SELECT id,full_name AS fullName,email,role,active,created_at AS createdAt FROM users ORDER BY id DESC",
        ),
      );
    }),
  );

  app.post(
    "/users",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (req, res) => {
      const fullName = nonEmpty(req.body.fullName, "Nombre");
      const email = nonEmpty(req.body.email, "Correo").toLowerCase();
      assert(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "Correo inválido");
      const pass = hashPassword(req.body.password);
      const role = req.body.role === "ADMIN" ? "ADMIN" : "EMPLEADO";
      const result = await rows(
        "INSERT INTO users (full_name,email,password_hash,role) VALUES (?,?,?,?)",
        [fullName, email, pass, role],
      );
      await audit(
        "USER_CREATED",
        "users",
        result.insertId,
        Number(req.user.sub),
        { email, role },
      );
      res.status(201).json({ id: result.insertId, fullName, email, role });
    }),
  );

  app.patch(
    "/users/:id",
    loginRequired,
    roles("ADMIN"),
    asyncRoute(async (req, res) => {
      const id = numberId(req.params.id);
      const current = await first("SELECT * FROM users WHERE id=?", [id]);
      if (!current) throw httpError(404, "Empleado no encontrado");
      const fullName =
        req.body.fullName === undefined
          ? current.full_name
          : nonEmpty(req.body.fullName, "Nombre");
      const role = req.body.role === undefined ? current.role : req.body.role;
      assert(["ADMIN", "EMPLEADO"].includes(role), "Rol inválido");
      const active =
        req.body.active === undefined
          ? !!current.active
          : Boolean(req.body.active);
      assert(
        !(id === Number(req.user.sub) && (!active || role !== "ADMIN")),
        "No puedes quitarte permisos ni desactivar tu propia cuenta",
      );
      const passwordHash = req.body.password
        ? hashPassword(req.body.password)
        : current.password_hash;
      await rows(
        "UPDATE users SET full_name=?,role=?,active=?,password_hash=? WHERE id=?",
        [fullName, role, active, passwordHash, id],
      );
      await audit("USER_UPDATED", "users", id, Number(req.user.sub), {
        role,
        active,
      });
      res.json({ id, fullName, role, active });
    }),
  );
}
