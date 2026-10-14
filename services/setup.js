import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(root, ".env"));
const connection = await mysql.createConnection({
  host: "127.0.0.1",
  port: Number(process.env.LOCAL_DB_PORT || 3306),
  user: process.env.LOCAL_DB_USER || "root",
  password: process.env.LOCAL_DB_PASSWORD,
  multipleStatements: true,
  charset: "utf8mb4",
});
try {
  const [existing] =
    await connection.query(`SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema IN ('auth_db','inventory_db','rental_db','returns_db','admin_db')`);
  if (existing[0].n) {
    throw new Error(
      "Ya hay tablas del proyecto. La inicialización se detuvo para conservar los datos.",
    );
  }
  await connection.query(
    await readFile(path.join(root, "database/01_schema.sql"), "utf8"),
  );
  await connection.beginTransaction();
  try {
    await connection.query(
      await readFile(path.join(root, "database/02_seed.sql"), "utf8"),
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  const [summary] = await connection.query(`SELECT
    (SELECT COUNT(*) FROM inventory_db.dances) AS dances,
    (SELECT COUNT(*) FROM inventory_db.garments) AS garments,
    (SELECT COUNT(*) FROM inventory_db.units) AS units,
    (SELECT COUNT(*) FROM inventory_db.garment_sets) AS sets`);
  console.log("Base local inicializada:", summary[0]);
} finally {
  await connection.end();
}
