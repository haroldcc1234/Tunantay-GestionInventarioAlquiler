import { app, name, flushAudits } from "./core.js";

const modules = {
  auth: "./auth.js",
  inventory: "./inventory.js",
  rental: "./rental.js",
  returns: "./returns.js",
  admin: "./admin.js",
};
if (!modules[name]) throw new Error(`Servicio desconocido: ${name}`);
const { register } = await import(modules[name]);
register(app);
if (name !== "admin") {
  const timer = setInterval(flushAudits, 15000);
  timer.unref();
}
// Manejador final: va después de registrar rutas.
app.use((err, _req, res, _next) => {
  if (err.status >= 500 || !err.status) console.error(`[${name}]`, err);
  const status = err.status || (err.code === "ER_DUP_ENTRY" ? 409 : 500);
  res
    .status(status)
    .json({
      code:
        err.code === "ER_DUP_ENTRY"
          ? "CONFLICT"
          : status === 500
            ? "SERVER_ERROR"
            : err.code || "ERROR",
      message:
        status === 500 ? "No se pudo completar la operación" : err.message,
    });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`[${name}] escuchando :${port}`),
);
