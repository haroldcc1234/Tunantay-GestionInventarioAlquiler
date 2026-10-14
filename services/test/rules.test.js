import test from "node:test";
import assert from "node:assert/strict";
import { durationByCutoff } from "../rules.js";

const time = (iso) => new Date(iso).getTime();

test("un alquiler dentro del mismo día comercial cuesta un día", () => {
  assert.equal(
    durationByCutoff(
      time("2026-10-13T18:00:00Z"),
      time("2026-10-14T16:00:00Z"),
      12,
    ),
    1,
  );
});

test("cruzar el corte de mediodía de Lima cuenta dos períodos", () => {
  assert.equal(
    durationByCutoff(
      time("2026-10-13T16:00:00Z"),
      time("2026-10-13T18:00:00Z"),
      12,
    ),
    2,
  );
});

test("mínimo un día aun para diez minutos", () => {
  assert.equal(
    durationByCutoff(
      time("2026-10-13T19:00:00Z"),
      time("2026-10-13T19:10:00Z"),
      12,
    ),
    1,
  );
});

test("rechaza devoluciones anteriores a la entrega", () => {
  assert.throws(() =>
    durationByCutoff(
      time("2026-10-13T20:00:00Z"),
      time("2026-10-13T19:00:00Z"),
      12,
    ),
  );
});

test("rechaza corte fuera de rango", () => {
  assert.throws(() =>
    durationByCutoff(
      time("2026-10-13T19:00:00Z"),
      time("2026-10-13T20:00:00Z"),
      25,
    ),
  );
});
