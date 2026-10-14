import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import net from "node:net";

const directory = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(directory, "../.env"));
const domains = ["auth", "inventory", "rental", "returns", "admin"];
const ports = Object.fromEntries(domains.map((name, i) => [name, 3101 + i]));
const urls = Object.fromEntries(
  domains.map((name) => [
    `${name.toUpperCase()}_URL`,
    `http://127.0.0.1:${ports[name]}`,
  ]),
);
const children = [];
function startServices() {
  return domains.map((name) =>
    spawn(process.execPath, ["server.js"], {
      cwd: directory,
      env: {
        ...process.env,
        ...urls,
        SERVICE_NAME: name,
        HOST: "127.0.0.1",
        PORT: String(ports[name]),
        DB_HOST: "127.0.0.1",
        DB_USER: process.env.LOCAL_DB_USER || "root",
        DB_PASSWORD: process.env.LOCAL_DB_PASSWORD,
        DB_NAME: `${name}_db`,
      },
      stdio: "inherit",
      windowsHide: true,
    }),
  );
}
const app = express();
app.disable("x-powered-by");
app.use(
  "/api/:service",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req, res) => {
    const port = ports[req.params.service];
    if (!port)
      return res.status(404).json({ message: "Servicio no encontrado" });
    try {
      const headers = {};
      for (const key of ["authorization", "content-type"]) {
        if (req.headers[key]) headers[key] = req.headers[key];
      }
      const result = await fetch(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
        signal: AbortSignal.timeout(15000),
      });
      for (const key of ["content-type", "cache-control"]) {
        if (result.headers.has(key)) res.set(key, result.headers.get(key));
      }
      res.status(result.status).send(Buffer.from(await result.arrayBuffer()));
    } catch {
      res
        .status(503)
        .json({ message: "El servicio está iniciando o no está disponible" });
    }
  },
);
const dist = path.join(directory, "../frontend/dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
const webPort = Number(process.env.WEB_PORT || 8080);
const server = app.listen(webPort, "127.0.0.1");
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  children.forEach((child) => child.kill());
  server.close();
  server.closeAllConnections();
  setTimeout(() => process.exit(code), 2000).unref();
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

server.once("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `El puerto ${webPort} ya está ocupado. Si Tunantay ya está abierto, utiliza http://localhost:${webPort}/.`,
    );
    console.error(
      "Para reiniciarlo, pulsa Ctrl+C en la terminal donde está ejecutándose y vuelve a usar npm run local.",
    );
  } else {
    console.error(`No se pudo iniciar Tunantay: ${error.message}`);
  }
  stop(1);
});

server.once("listening", async () => {
  try {
    for (const [name, port] of Object.entries(ports)) {
      try {
        await checkPort(port);
      } catch (error) {
        throw new Error(
          `El puerto ${port} de ${name} no está disponible (${error.code}). Cierra la instancia anterior antes de reiniciar.`,
        );
      }
    }
    if (stopping) return;
    children.push(...startServices());
    children.forEach((child, index) => {
      child.once("error", (error) => {
        console.error(`No se pudo iniciar ${domains[index]}: ${error.message}`);
        stop(1);
      });
      child.once("exit", (code) => {
        if (!stopping) {
          console.error(
            `El servicio ${domains[index]} se detuvo (código ${code}). Cerrando la instancia.`,
          );
          stop(1);
        }
      });
    });
    console.log(`Tunantay: http://localhost:${webPort}`);
    console.log(
      "Para detener todos los servicios, pulsa Ctrl+C en esta terminal.",
    );
  } catch (error) {
    console.error(error.message);
    stop(1);
  }
});

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
