import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  currency,
  dateFormat,
  getSession,
  saveSession,
  send,
  type Session,
} from "./api";

type Data = Record<string, any>;
type Notify = (message: string, kind?: "success" | "error") => void;
type Page =
  | "inicio"
  | "danzas"
  | "inventario"
  | "alquileres"
  | "devoluciones"
  | "solicitudes"
  | "pagos"
  | "clientes"
  | "reportes"
  | "usuarios"
  | "ajustes"
  | "servicios";

const navigation: {
  group: string;
  items: { page: Page; title: string; admin?: boolean }[];
}[] = [
  {
    group: "GENERAL",
    items: [
      { page: "inicio", title: "Vista general" },
      { page: "danzas", title: "Catálogo cultural" },
      { page: "inventario", title: "Inventario" },
    ],
  },
  {
    group: "OPERACIONES",
    items: [
      { page: "solicitudes", title: "Solicitudes web" },
      { page: "alquileres", title: "Alquileres" },
      { page: "devoluciones", title: "Devoluciones" },
      { page: "pagos", title: "Pagos y cobros" },
      { page: "clientes", title: "Clientes" },
    ],
  },
  {
    group: "GESTIÓN",
    items: [
      { page: "reportes", title: "Reportes" },
      { page: "usuarios", title: "Empleados", admin: true },
      { page: "ajustes", title: "Configuración", admin: true },
      { page: "servicios", title: "Estado de servicios", admin: true },
    ],
  },
];

function useRemote<T = Data[]>(
  endpoint: string | null,
  dependencies: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!endpoint) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");

    api<T>(endpoint)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // Dependencies are deliberately caller-controlled refresh keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, version, ...dependencies]);

  return { data, loading, error, refresh: () => setVersion((v) => v + 1) };
}

function useToast() {
  const [toast, setToast] = useState<{
    text: string;
    kind: "success" | "error";
  } | null>(null);
  const notify: Notify = (text, kind = "success") => setToast({ text, kind });
  return { toast, notify, dismiss: () => setToast(null) };
}

function Button({
  children,
  onClick,
  secondary = false,
  small = false,
  disabled = false,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  small?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`button ${secondary ? "button-secondary" : "button-primary"} ${small ? "button-small" : ""}`}
      onClick={onClick}
      type={type}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) =>
      event.key === "Escape" && onClose();
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar">
            Cerrar
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Blank({
  title = "Aún no hay registros",
  description = "Los datos aparecerán aquí cuando estén disponibles.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="blank">
      <span className="blank-mark">T</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function Problem({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="problem">
      <div>
        <strong>Módulo temporalmente no disponible</strong>
        <p>{message}</p>
      </div>
      <Button secondary small onClick={retry}>
        Reintentar
      </Button>
    </div>
  );
}

function Pill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "green" | "gold" | "red" | "muted";
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function statusTone(status: string): "green" | "gold" | "red" | "muted" {
  if (["ACTIVE", "AVAILABLE", "APPROVED", "DONE", "RETURNED"].includes(status))
    return "green";
  if (["PENDING", "HELD", "PARTIAL", "REGULAR"].includes(status)) return "gold";
  if (
    ["MAINTENANCE", "DAMAGED", "DAÑADO", "INACTIVE", "REJECTED"].includes(
      status,
    )
  )
    return "red";
  return "muted";
}

function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function Table({
  heads,
  rows,
  render,
}: {
  heads: string[];
  rows: Data[];
  render: (row: Data) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const signature = rows.map((row) => row.id).join(",");
  useEffect(() => setPage(0), [signature]);
  if (!rows.length) return <Blank />;
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {heads.map((head, index) => (
                <th key={`${head}-${index}`}>{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((row, index) => (
                <tr key={row.id ?? index}>{render(row)}</tr>
              ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav
          className="table-pagination"
          aria-label={`Paginación de ${heads[0]}`}
        >
          <span>
            {current * pageSize + 1}–
            {Math.min((current + 1) * pageSize, rows.length)} de {rows.length}
          </span>
          <div>
            <button
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Anterior
            </button>
            <label>
              Página{" "}
              <select
                aria-label={`Página de ${heads[0]}`}
                value={current}
                onChange={(e) => setPage(Number(e.target.value))}
              >
                {Array.from({ length: pages }, (_, index) => (
                  <option key={index} value={index}>
                    {index + 1}
                  </option>
                ))}
              </select>{" "}
              de {pages}
            </label>
            <button
              disabled={current + 1 === pages}
              onClick={() => setPage(current + 1)}
            >
              Siguiente
            </button>
          </div>
        </nav>
      )}
    </>
  );
}

function Login({
  onLogin,
  notify,
}: {
  onLogin: (value: Session) => void;
  notify: Notify;
}) {
  const [email, setEmail] = useState("admin@tunantay.local");
  const [password, setPassword] = useState("");
  const [waiting, setWaiting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setWaiting(true);
    try {
      const session = await send<Session>("auth/login", { email, password });
      saveSession(session);
      onLogin(session);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setWaiting(false);
    }
  };

  return (
    <div className="login-layout">
      <aside className="login-art">
        <div className="login-brand">
          <span className="brand-symbol">T</span>
          <span>
            TUNANTAY <small>VESTUARIOS</small>
          </span>
        </div>
        <div className="login-copy">
          <span className="eyebrow light">PATRIMONIO QUE PERMANECE</span>
          <h1>Tradición que se viste, cultura que perdura.</h1>
          <p>
            Una forma más precisa y humana de cuidar cada pieza de nuestra
            identidad.
          </p>
        </div>
        <span className="login-location">JAUJA · JUNÍN · PERÚ</span>
      </aside>
      <main className="login-form-zone">
        <div className="login-form-wrap">
          <span className="eyebrow">SISTEMA DE GESTIÓN</span>
          <h2>Bienvenido de nuevo</h2>
          <p>
            Ingresa tus credenciales para acceder al espacio de trabajo de
            Tunantay.
          </p>
          <form onSubmit={submit} className="form-stack login-form">
            <Field label="Correo electrónico">
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="correo@tunantay.pe"
              />
            </Field>
            <Field label="Contraseña">
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Ingresa tu contraseña"
              />
            </Field>
            <Button type="submit" disabled={waiting}>
              {waiting ? "Ingresando..." : "Ingresar al sistema"}
            </Button>
          </form>
          <p>
            <a href="/">Volver a la colección de vestuarios</a>
          </p>
          <div className="login-note">
            Acceso exclusivo para el personal autorizado. Versión de
            demostración.
          </div>
        </div>
      </main>
    </div>
  );
}

function Overview({ navigate }: { navigate: (page: Page) => void }) {
  const { data, loading, error, refresh } = useRemote<Data>(
    "admin/reports/overview",
  );
  const metrics = [
    {
      label: "Prendas registradas",
      value: data?.stock?.total ?? "—",
      note: "Unidades físicas",
    },
    {
      label: "Disponibles",
      value: data?.stock?.available ?? "—",
      note: "Listas para alquiler",
    },
    {
      label: "Alquileres activos",
      value: data?.rentals?.active ?? "—",
      note: "Por devolver",
    },
    {
      label: "Ingresos registrados",
      value: currency(data?.payments?.received),
      note: "Pagos contabilizados",
    },
  ];

  return (
    <>
      <section className="hero-banner">
        <div className="hero-inner">
          <span className="eyebrow light">TUNANTAY · JAUJA</span>
          <h1>
            Nuestra cultura,
            <br />
            <em>bien organizada.</em>
          </h1>
          <p>
            Cada traje guarda una historia. Hagamos que cada alquiler también
            esté bien cuidado.
          </p>
          <button onClick={() => navigate("alquileres")} className="hero-cta">
            Registrar alquiler
          </button>
        </div>
        <div className="hero-caption">TRADICIÓN · IDENTIDAD · PATRIMONIO</div>
      </section>
      <div className="section-title">
        <div>
          <span className="eyebrow">EN TIEMPO REAL</span>
          <h2>Estado del negocio</h2>
        </div>
        <button className="text-link" onClick={refresh}>
          Actualizar
        </button>
      </div>
      {error && <Problem message={error} retry={refresh} />}
      <div className="metrics-grid">
        {metrics.map((metric) => (
          <article className="metric" key={metric.label}>
            <div className="metric-top">
              <span>{metric.label}</span>
            </div>
            <strong>{loading ? "..." : metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="surface-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">OPERACIÓN DIARIA</span>
              <h3>Últimos alquileres</h3>
            </div>
            <button
              className="text-link"
              onClick={() => navigate("alquileres")}
            >
              Ver todos
            </button>
          </div>
          <Table
            heads={["Referencia", "Cliente", "Importe", "Estado"]}
            rows={data?.recent ?? []}
            render={(row) => (
              <>
                <td className="strong-cell">{row.folio}</td>
                <td>{row.client_name}</td>
                <td>{currency(row.base_amount)}</td>
                <td>
                  <Pill tone={statusTone(row.status)}>{row.status}</Pill>
                </td>
              </>
            )}
          />
        </section>
        <section className="surface-card editorial-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">PATRIMONIO VIVO</span>
              <h3>Un inventario con identidad</h3>
            </div>
          </div>
          <div className="decorative-typography">
            {data?.dances ?? "—"}
            <span>expresiones</span>
          </div>
          <p>
            Un catálogo cultural de referencia organizado por regiones, con
            fotografías acreditadas, referencias visuales y control de cada
            unidad física.
          </p>
          <button className="text-link" onClick={() => navigate("danzas")}>
            Explorar danzas
          </button>
          <div className="editorial-lines" />
        </section>
      </div>
    </>
  );
}

function Dances() {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("Todas");
  const [selected, setSelected] = useState<Data | null>(null);
  const { data, loading, error, refresh } =
    useRemote<Data[]>("inventory/dances");
  const filtered = (data || []).filter(
    (item) =>
      (region === "Todas" || item.region === region) &&
      `${item.name} ${item.department}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  return (
    <>
      <PageTitle
        eyebrow="CULTURA DEL PERÚ"
        title="Catálogo cultural"
        subtitle="Expresiones representativas del Perú, organizadas por su territorio y tradición."
      />
      <div className="catalog-intro">
        <div className="catalog-ornament">T</div>
        <div>
          <span className="eyebrow light">COLECCIÓN TUNANTAY</span>
          <h2>Vestir nuestras raíces.</h2>
          <p>
            Un recorrido visual por la riqueza coreográfica del país. Imágenes
            conceptuales ilustrativas; no son registros fotográficos de trajes
            tradicionales específicos.
          </p>
        </div>
      </div>
      <div className="filters-bar">
        <div className="search-field">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar danza o departamento"
          />
        </div>
        <div className="tabs">
          {["Todas", "Costa", "Sierra", "Selva"].map((item) => (
            <button
              key={item}
              className={region === item ? "active" : ""}
              onClick={() => setRegion(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="count-caption">{filtered.length} expresiones</span>
      </div>
      {error && <Problem message={error} retry={refresh} />}
      {loading && (
        <div className="loading-skeleton">Cargando colección cultural...</div>
      )}
      {!loading && !error && (
        <div className="dance-grid">
          {filtered.map((item) => (
            <button
              className="dance-card"
              key={item.id}
              onClick={() => setSelected(item)}
            >
              <img
                src={`/api/inventory/dances/${item.id}/image`}
                alt={`Imagen de referencia de ${item.name}`}
                loading="lazy"
              />
              <div className="dance-content">
                <span>
                  {item.department} · {item.region}
                </span>
                <h3>{item.name}</h3>
                <div className="dance-bottom">Ver detalles</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {!loading && !filtered.length && !error && (
        <Blank
          title="No encontramos esa danza"
          description="Prueba con otro departamento o tipo de región."
        />
      )}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div className="dance-detail">
            <img
              src={`/api/inventory/dances/${selected.id}/image`}
              alt={selected.name}
            />
            <div>
              <Pill tone="gold">
                {selected.department} · {selected.region}
              </Pill>
              <p>{selected.description}</p>
              <small>
                {selected.image_credit}. Imagen de referencia cultural.
                {selected.image_source && (
                  <a
                    href={selected.image_source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {" "}
                    Fuente de la imagen
                  </a>
                )}
                {selected.image_license && (
                  <a
                    href={selected.image_license}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {" "}
                    Licencia
                  </a>
                )}
              </small>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Clients({ notify }: { notify: Notify }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<Data | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    docNumber: "",
    phone: "",
    email: "",
    address: "",
  });
  const { data, error, refresh } = useRemote<Data[]>("rental/clients");
  const list = (data || []).filter((row) =>
    `${row.full_name} ${row.doc_number}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await send(
        edit ? `rental/clients/${edit.id}` : "rental/clients",
        form,
        edit ? "PATCH" : "POST",
      );
      notify(edit ? "Cliente actualizado" : "Cliente registrado");
      setShow(false);
      setEdit(null);
      refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="GESTIÓN DE PERSONAS"
        title="Clientes"
        subtitle="Información de contacto e historial de nuestros clientes."
        action={
          <Button
            onClick={() => {
              setEdit(null);
              setForm({
                fullName: "",
                docNumber: "",
                phone: "",
                email: "",
                address: "",
              });
              setShow(true);
            }}
          >
            Nuevo cliente
          </Button>
        }
      />
      <div className="surface-card">
        <div className="toolbar">
          <div className="search-field">
            <input
              placeholder="Buscar por nombre o documento"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="count-caption">{list.length} clientes</span>
        </div>
        {error && <Problem message={error} retry={refresh} />}
        <Table
          heads={["Nombre", "Documento", "Teléfono", "Correo", "Acciones"]}
          rows={list}
          render={(row) => (
            <>
              <td className="strong-cell">{row.full_name}</td>
              <td>{row.doc_number}</td>
              <td>{row.phone || "—"}</td>
              <td>{row.email || "—"}</td>
              <td>
                <div className="actions-row">
                  <button
                    className="text-link"
                    onClick={() => {
                      setEdit(row);
                      setForm({
                        fullName: row.full_name,
                        docNumber: row.doc_number,
                        phone: row.phone || "",
                        email: row.email || "",
                        address: row.address || "",
                      });
                      setShow(true);
                    }}
                  >
                    Editar
                  </button>
                  {getSession()?.user.role === "ADMIN" && (
                    <button
                      className="text-link"
                      onClick={async () => {
                        try {
                          await send(
                            `returns/clients/${row.id}/authorize-debt`,
                            {},
                          );
                          notify(
                            "Autorización registrada para el siguiente alquiler",
                          );
                        } catch (err) {
                          notify((err as Error).message, "error");
                        }
                      }}
                    >
                      Autorizar deuda
                    </button>
                  )}
                </div>
              </td>
            </>
          )}
        />
      </div>
      {show && (
        <Modal
          title={edit ? "Editar cliente" : "Nuevo cliente"}
          onClose={() => setShow(false)}
        >
          <form className="form-stack" onSubmit={submit}>
            <Field label="Nombre completo">
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label="Documento de identidad">
              <input
                required
                value={form.docNumber}
                onChange={(e) =>
                  setForm({ ...form, docNumber: e.target.value })
                }
              />
            </Field>
            <div className="two-fields">
              <Field label="Teléfono">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Correo">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Dirección">
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Button type="submit">Guardar cliente</Button>
          </form>
        </Modal>
      )}
    </>
  );
}

function Inventory({ notify }: { notify: Notify }) {
  const [danceId, setDanceId] = useState("");
  const [mode, setMode] = useState<"garment" | "unit" | "set" | "">("");
  const [g, setG] = useState({
    sku: "",
    name: "",
    danceId: "",
    type: "PRENDA",
    size: "M",
    rentalPrice: "35",
  });
  const [u, setU] = useState({
    garmentId: "",
    code: "",
    conservation: "BUENO",
  });
  const [s, setS] = useState({
    name: "",
    danceId: "",
    size: "M",
    fixedPrice: "49",
    garmentIds: [] as number[],
  });
  const [editGarment, setEditGarment] = useState<Data | null>(null);
  const [editSet, setEditSet] = useState<Data | null>(null);
  const [editUnit, setEditUnit] = useState<Data | null>(null);
  const [condition, setCondition] = useState("BUENO");
  const [state, setState] = useState("AVAILABLE");
  const [search, setSearch] = useState("");
  const garments = useRemote<Data[]>("inventory/garments");
  const units = useRemote<Data[]>("inventory/units");
  const dances = useRemote<Data[]>("inventory/dances");
  const sets = useRemote<Data[]>("inventory/sets");
  const filtered = (garments.data || []).filter(
    (row) =>
      (!danceId || String(row.dance_id) === danceId) &&
      `${row.name} ${row.sku}`.toLowerCase().includes(search.toLowerCase()),
  );

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (mode === "garment")
        await send("inventory/garments", {
          ...g,
          danceId: Number(g.danceId),
          rentalPrice: Number(g.rentalPrice),
        });
      if (mode === "unit")
        await send("inventory/units", { ...u, garmentId: Number(u.garmentId) });
      if (mode === "set")
        await send("inventory/sets", {
          ...s,
          danceId: Number(s.danceId),
          fixedPrice: Number(s.fixedPrice),
          items: s.garmentIds.map((id) => ({ garmentId: id, quantity: 1 })),
        });
      notify("Registro guardado correctamente");
      setMode("");
      garments.refresh();
      units.refresh();
      sets.refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const saveUnit = async () => {
    if (!editUnit) return;
    try {
      await send(
        `inventory/units/${editUnit.id}`,
        { state, conservation: condition },
        "PATCH",
      );
      notify("Estado de conservación actualizado");
      setEditUnit(null);
      units.refresh();
      garments.refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="PATRIMONIO EN CUSTODIA"
        title="Inventario"
        subtitle="Control de prendas, accesorios, conjuntos y unidades físicas."
        action={
          <div className="actions-row">
            <Button secondary onClick={() => setMode("unit")}>
              Unidad
            </Button>
            <Button secondary onClick={() => setMode("set")}>
              Conjunto
            </Button>
            <Button onClick={() => setMode("garment")}>Prenda</Button>
          </div>
        }
      />
      <div className="inventory-summary">
        <div>
          <strong>{units.data?.length ?? "—"}</strong>
          <span>Unidades consultadas</span>
        </div>
        <div>
          <strong>
            {units.data?.filter((item) => item.state === "AVAILABLE").length ??
              "—"}
          </strong>
          <span>Disponibles</span>
        </div>
        <div>
          <strong>
            {units.data?.filter((item) => item.state === "RENTED").length ??
              "—"}
          </strong>
          <span>En alquiler</span>
        </div>
        <div>
          <strong>{sets.data?.length ?? "—"}</strong>
          <span>Conjuntos</span>
        </div>
      </div>
      <div className="surface-card">
        <div className="toolbar">
          <div className="search-field">
            <input
              placeholder="Buscar prenda o código"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select-filter"
            value={danceId}
            onChange={(e) => setDanceId(e.target.value)}
          >
            <option value="">Todas las danzas</option>
            {dances.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        {garments.error && (
          <Problem message={garments.error} retry={garments.refresh} />
        )}
        <Table
          heads={[
            "Prenda / Código",
            "Danza",
            "Tipo",
            "Talla",
            "Disponibilidad",
            "Tarifa",
            "Acciones",
          ]}
          rows={filtered}
          render={(row) => (
            <>
              <td>
                <div className="item-name">
                  {row.name}
                  <small>{row.sku}</small>
                </div>
              </td>
              <td>{row.dance_name}</td>
              <td>{row.type === "PRENDA" ? "Prenda" : "Accesorio"}</td>
              <td>{row.size}</td>
              <td>
                <Pill tone={row.available_units > 0 ? "green" : "red"}>
                  {row.available_units}/{row.total_units} libres
                </Pill>
              </td>
              <td className="strong-cell">{currency(row.rental_price)}</td>
              <td>
                <button
                  className="text-link"
                  onClick={() => setEditGarment(row)}
                >
                  Editar
                </button>
              </td>
            </>
          )}
        />
      </div>
      <section className="surface-card section-below">
        <div className="card-heading">
          <div>
            <span className="eyebrow">COLECCIONES</span>
            <h3>Conjuntos completos</h3>
          </div>
        </div>
        <Table
          heads={["Conjunto", "Danza", "Talla", "Tarifa fija", "Acción"]}
          rows={sets.data || []}
          render={(row) => (
            <>
              <td className="strong-cell">{row.name}</td>
              <td>{row.dance_name}</td>
              <td>{row.size}</td>
              <td>{currency(row.fixed_price)}</td>
              <td>
                <button className="text-link" onClick={() => setEditSet(row)}>
                  Editar tarifa
                </button>
              </td>
            </>
          )}
        />
      </section>
      <section className="surface-card section-below">
        <div className="card-heading">
          <div>
            <span className="eyebrow">CONTROL INDIVIDUAL</span>
            <h3>Unidades físicas</h3>
          </div>
          <button className="text-link" onClick={units.refresh}>
            Actualizar
          </button>
        </div>
        {units.error && <Problem message={units.error} retry={units.refresh} />}
        <Table
          heads={[
            "Identificador",
            "Prenda",
            "Estado",
            "Conservación",
            "Acción",
          ]}
          rows={units.data || []}
          render={(row) => (
            <>
              <td className="strong-cell">{row.code}</td>
              <td>{row.garment_name}</td>
              <td>
                <Pill tone={statusTone(row.state)}>{row.state}</Pill>
              </td>
              <td>{row.conservation}</td>
              <td>
                <button
                  className="text-link"
                  onClick={() => {
                    setEditUnit(row);
                    setCondition(row.conservation);
                    setState(row.state);
                  }}
                >
                  Inspeccionar
                </button>
              </td>
            </>
          )}
        />
      </section>
      {mode && (
        <Modal
          title={
            mode === "garment"
              ? "Registrar prenda"
              : mode === "unit"
                ? "Nueva unidad física"
                : "Nuevo conjunto"
          }
          onClose={() => setMode("")}
        >
          <form className="form-stack" onSubmit={create}>
            {mode === "garment" && (
              <>
                <Field label="Código SKU">
                  <input
                    required
                    value={g.sku}
                    onChange={(e) => setG({ ...g, sku: e.target.value })}
                    placeholder="TV-053-01"
                  />
                </Field>
                <Field label="Nombre de la prenda">
                  <input
                    required
                    value={g.name}
                    onChange={(e) => setG({ ...g, name: e.target.value })}
                  />
                </Field>
                <Field label="Danza">
                  <select
                    required
                    value={g.danceId}
                    onChange={(e) => setG({ ...g, danceId: e.target.value })}
                  >
                    <option value="">Seleccionar danza</option>
                    {dances.data?.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="two-fields">
                  <Field label="Tipo">
                    <select
                      value={g.type}
                      onChange={(e) => setG({ ...g, type: e.target.value })}
                    >
                      <option value="PRENDA">Prenda</option>
                      <option value="ACCESORIO">Accesorio</option>
                    </select>
                  </Field>
                  <Field label="Talla">
                    <input
                      value={g.size}
                      onChange={(e) => setG({ ...g, size: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Tarifa por día (S/)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={g.rentalPrice}
                    onChange={(e) =>
                      setG({ ...g, rentalPrice: e.target.value })
                    }
                  />
                </Field>
              </>
            )}
            {mode === "unit" && (
              <>
                <Field label="Tipo de prenda">
                  <select
                    required
                    value={u.garmentId}
                    onChange={(e) => setU({ ...u, garmentId: e.target.value })}
                  >
                    <option value="">Seleccionar prenda</option>
                    {garments.data?.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Código único">
                  <input
                    required
                    value={u.code}
                    onChange={(e) => setU({ ...u, code: e.target.value })}
                    placeholder="UNI-053-01-01"
                  />
                </Field>
                <Field label="Conservación">
                  <select
                    value={u.conservation}
                    onChange={(e) =>
                      setU({ ...u, conservation: e.target.value })
                    }
                  >
                    {["EXCELENTE", "BUENO", "REGULAR", "DAÑADO"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {mode === "set" && (
              <>
                <Field label="Nombre">
                  <input
                    required
                    value={s.name}
                    onChange={(e) => setS({ ...s, name: e.target.value })}
                  />
                </Field>
                <Field label="Danza">
                  <select
                    required
                    value={s.danceId}
                    onChange={(e) =>
                      setS({ ...s, danceId: e.target.value, garmentIds: [] })
                    }
                  >
                    <option value="">Seleccionar danza</option>
                    {dances.data?.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Precio fijo del conjunto">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={s.fixedPrice}
                    onChange={(e) => setS({ ...s, fixedPrice: e.target.value })}
                  />
                </Field>
                <label className="field">
                  <span>Prendas del conjunto</span>
                </label>
                <div className="checklist">
                  {garments.data
                    ?.filter((row) => String(row.dance_id) === s.danceId)
                    .map((row) => (
                      <label key={row.id}>
                        <input
                          type="checkbox"
                          checked={s.garmentIds.includes(row.id)}
                          onChange={(e) =>
                            setS({
                              ...s,
                              garmentIds: e.target.checked
                                ? [...s.garmentIds, row.id]
                                : s.garmentIds.filter((id) => id !== row.id),
                            })
                          }
                        />
                        {row.name}
                      </label>
                    ))}
                </div>
              </>
            )}
            <Button type="submit">Guardar registro</Button>
          </form>
        </Modal>
      )}
      {editGarment && (
        <Modal
          title="Editar prenda y tarifa"
          onClose={() => setEditGarment(null)}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await send(
                  `inventory/garments/${editGarment.id}`,
                  {
                    name: editGarment.name,
                    rentalPrice: Number(editGarment.rental_price),
                    active: !!editGarment.active,
                  },
                  "PATCH",
                );
                notify("Prenda actualizada");
                setEditGarment(null);
                garments.refresh();
              } catch (err) {
                notify((err as Error).message, "error");
              }
            }}
          >
            <Field label="Nombre">
              <input
                required
                value={editGarment.name}
                onChange={(e) =>
                  setEditGarment({ ...editGarment, name: e.target.value })
                }
              />
            </Field>
            <Field label="Tarifa por día (S/)">
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={editGarment.rental_price}
                onChange={(e) =>
                  setEditGarment({
                    ...editGarment,
                    rental_price: e.target.value,
                  })
                }
              />
            </Field>
            <label className="check-switch">
              <input
                type="checkbox"
                checked={!!editGarment.active}
                onChange={(e) =>
                  setEditGarment({ ...editGarment, active: e.target.checked })
                }
              />{" "}
              Prenda activa
            </label>
            <Button type="submit">Guardar cambios</Button>
          </form>
        </Modal>
      )}
      {editSet && (
        <Modal title="Editar conjunto" onClose={() => setEditSet(null)}>
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await send(
                  `inventory/sets/${editSet.id}`,
                  {
                    fixedPrice: Number(editSet.fixed_price),
                    name: editSet.name,
                    active: !!editSet.active,
                  },
                  "PATCH",
                );
                notify("Conjunto actualizado");
                setEditSet(null);
                sets.refresh();
              } catch (err) {
                notify((err as Error).message, "error");
              }
            }}
          >
            <Field label="Nombre del conjunto">
              <input
                required
                value={editSet.name}
                onChange={(e) =>
                  setEditSet({ ...editSet, name: e.target.value })
                }
              />
            </Field>
            <Field label="Tarifa fija (S/)">
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={editSet.fixed_price}
                onChange={(e) =>
                  setEditSet({ ...editSet, fixed_price: e.target.value })
                }
              />
            </Field>
            <label className="check-switch">
              <input
                type="checkbox"
                checked={!!editSet.active}
                onChange={(e) =>
                  setEditSet({ ...editSet, active: e.target.checked })
                }
              />{" "}
              Conjunto activo
            </label>
            <Button type="submit">Guardar cambios</Button>
          </form>
        </Modal>
      )}
      {editUnit && (
        <Modal
          title={`Unidad ${editUnit.code}`}
          onClose={() => setEditUnit(null)}
        >
          <div className="form-stack">
            <p className="muted">{editUnit.garment_name}</p>
            <Field label="Estado">
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                disabled={["RENTED", "HELD"].includes(editUnit.state)}
              >
                {["AVAILABLE", "MAINTENANCE", "INACTIVE"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Conservación">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                disabled={["RENTED", "HELD"].includes(editUnit.state)}
              >
                {["EXCELENTE", "BUENO", "REGULAR", "DAÑADO"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Button
              onClick={saveUnit}
              disabled={["RENTED", "HELD"].includes(editUnit.state)}
            >
              Guardar cambios
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Rentals({
  notify,
  navigate,
  prepared,
}: {
  notify: Notify;
  navigate: (page: Page) => void;
  prepared: Data | null;
}) {
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [clientId, setClientId] = useState("");
  const [setId, setSetId] = useState("");
  const [garmentId, setGarmentId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState<"SET" | "ITEM">("SET");
  const [dueAt, setDueAt] = useState(() => {
    const date = new Date(Date.now() + 2 * 86400000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => window.crypto.randomUUID());
  const [filter, setFilter] = useState("Todos");
  const rental = useRemote<Data[]>("rental/rentals");
  const clients = useRemote<Data[]>("rental/clients");
  const sets = useRemote<Data[]>("inventory/sets");
  const garments = useRemote<Data[]>("inventory/garments");
  const detail = useRemote<Data>(
    detailId ? `rental/rentals/${detailId}` : null,
  );
  const filtered = (rental.data || []).filter(
    (row) => filter === "Todos" || row.status === filter,
  );

  useEffect(() => {
    if (!prepared) return;
    setClientId(String(prepared.clientId));
    setSetId(String(prepared.setId));
    setRequestId(prepared.requestId);
    setDueAt(prepared.dueAt);
    setMode("SET");
    setOpen(true);
  }, [prepared]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const request = {
        requestId,
        clientId: Number(clientId),
        dueAt: new Date(dueAt).toISOString(),
        ...(mode === "SET"
          ? { setId: Number(setId) }
          : { items: [{ garmentId: Number(garmentId), quantity }] }),
      };
      const result = await send<Data>("rental/rentals", request);
      notify(
        `Alquiler ${result.folio} registrado por ${currency(result.amount)}`,
      );
      setOpen(false);
      setRequestId(window.crypto.randomUUID());
      rental.refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="CONTROL DE CONTRATOS"
        title="Alquileres"
        subtitle="Seguimiento de entregas, fechas comprometidas y tarifas de alquiler."
        action={
          <Button
            onClick={() => {
              setClientId("");
              setSetId("");
              setRequestId(window.crypto.randomUUID());
              setOpen(true);
            }}
          >
            Registrar alquiler
          </Button>
        }
      />
      <div className="surface-card">
        <div className="toolbar">
          <div className="tabs">
            {["Todos", "ACTIVE", "PARTIAL", "RETURNED"].map((item) => (
              <button
                key={item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item === "Todos"
                  ? "Todos"
                  : item === "ACTIVE"
                    ? "Activos"
                    : item === "PARTIAL"
                      ? "Parciales"
                      : "Devueltos"}
              </button>
            ))}
          </div>
          <button className="text-link" onClick={rental.refresh}>
            Actualizar
          </button>
        </div>
        {rental.error && (
          <Problem message={rental.error} retry={rental.refresh} />
        )}
        <Table
          heads={[
            "Folio",
            "Cliente",
            "Entrega",
            "Devolución prevista",
            "Total",
            "Estado",
            "",
          ]}
          rows={filtered}
          render={(row) => (
            <>
              <td className="strong-cell">{row.folio}</td>
              <td>{row.client_name}</td>
              <td>{dateFormat(row.start_at)}</td>
              <td>{dateFormat(row.due_at)}</td>
              <td className="strong-cell">{currency(row.base_amount)}</td>
              <td>
                <Pill tone={statusTone(row.status)}>{row.status}</Pill>
              </td>
              <td>
                <button
                  className="text-link"
                  onClick={() => setDetailId(row.id)}
                >
                  Detalle
                </button>
              </td>
            </>
          )}
        />
      </div>
      <div className="notice-text">
        Las prendas se asignan al confirmar el alquiler. Las solicitudes web se
        convierten en alquiler al entregar las prendas.
      </div>
      {open && (
        <Modal
          wide
          title="Registrar un nuevo alquiler"
          onClose={() => setOpen(false)}
        >
          <form className="form-stack" onSubmit={submit}>
            <div className="form-section-label">01 · Datos de la operación</div>
            <Field label="Cliente">
              <select
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Seleccionar cliente</option>
                {clients.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.full_name} · {row.doc_number}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha y hora prevista de devolución">
              <input
                type="datetime-local"
                required
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
            <div className="form-section-label">02 · Prendas a entregar</div>
            <div className="tabs stretch-tabs">
              <button
                type="button"
                className={mode === "SET" ? "active" : ""}
                onClick={() => setMode("SET")}
              >
                Conjunto completo
              </button>
              <button
                type="button"
                className={mode === "ITEM" ? "active" : ""}
                onClick={() => setMode("ITEM")}
              >
                Prenda individual
              </button>
            </div>
            {mode === "SET" ? (
              <Field label="Conjunto">
                <select
                  required
                  value={setId}
                  onChange={(e) => setSetId(e.target.value)}
                >
                  <option value="">Seleccionar conjunto</option>
                  {sets.data?.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} — {currency(row.fixed_price)} / día
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="two-fields">
                <Field label="Prenda">
                  <select
                    required
                    value={garmentId}
                    onChange={(e) => setGarmentId(e.target.value)}
                  >
                    <option value="">Seleccionar prenda</option>
                    {garments.data?.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} ({row.available_units} libres)
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Cantidad">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </Field>
              </div>
            )}
            <div className="form-hint">
              El sistema calcula la duración según el horario de corte
              configurado, y valida cada unidad física antes de registrar la
              entrega.
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Verificando disponibilidad..." : "Confirmar entrega"}
            </Button>
          </form>
        </Modal>
      )}
      {detailId !== null && (
        <Modal
          wide
          title="Detalle de alquiler"
          onClose={() => setDetailId(null)}
        >
          {detail.error ? (
            <Problem message={detail.error} retry={detail.refresh} />
          ) : (
            detail.data?.id && (
              <div className="form-stack">
                <div className="detail-summary">
                  <div>
                    <span>FOLIO</span>
                    <strong>{detail.data.folio}</strong>
                  </div>
                  <div>
                    <span>CLIENTE</span>
                    <strong>{detail.data.client_name}</strong>
                  </div>
                  <div>
                    <span>ESTADO</span>
                    <Pill tone={statusTone(detail.data.status)}>
                      {detail.data.status}
                    </Pill>
                  </div>
                </div>
                <div className="detail-summary">
                  <div>
                    <span>ENTREGA</span>
                    <b>{dateFormat(detail.data.start_at)}</b>
                  </div>
                  <div>
                    <span>DEVOLUCIÓN</span>
                    <b>{dateFormat(detail.data.due_at)}</b>
                  </div>
                  <div>
                    <span>DURACIÓN</span>
                    <b>{detail.data.duration_days} día(s)</b>
                  </div>
                </div>
                <Table
                  heads={["Unidad", "Prenda", "Estado"]}
                  rows={detail.data.items}
                  render={(row) => (
                    <>
                      <td>{row.unit_code}</td>
                      <td>{row.garment_name}</td>
                      <td>
                        <Pill tone={statusTone(row.status)}>{row.status}</Pill>
                      </td>
                    </>
                  )}
                />
                <div className="detail-totals">
                  <div>
                    <span>Subtotal del alquiler</span>
                    <strong>{currency(detail.data.base_amount)}</strong>
                  </div>
                  <div>
                    <span>Saldo pendiente</span>
                    <strong>
                      {detail.data.balance
                        ? currency(detail.data.balance.balance)
                        : "No disponible"}
                    </strong>
                  </div>
                </div>
                <div className="actions-row">
                  <Button
                    secondary
                    onClick={() => {
                      setDetailId(null);
                      navigate("pagos");
                    }}
                  >
                    Ir a pagos
                  </Button>
                  <Button
                    onClick={() => {
                      setDetailId(null);
                      navigate("devoluciones");
                    }}
                  >
                    Registrar devolución
                  </Button>
                </div>
              </div>
            )
          )}
        </Modal>
      )}
    </>
  );
}

function Returns({ notify }: { notify: Notify }) {
  const [rentalId, setRentalId] = useState("");
  const [itemId, setItemId] = useState("");
  const [condition, setCondition] = useState("BUENO");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const rental = useRemote<Data[]>("rental/rentals");
  const details = useRemote<Data>(
    rentalId ? `rental/rentals/${rentalId}` : null,
  );
  const history = useRemote<Data[]>("returns/returns");
  const damages = useRemote<Data[]>("returns/damages");
  const open = (rental.data || []).filter((row) =>
    ["ACTIVE", "PARTIAL"].includes(row.status),
  );
  const pendingItems = (details.data?.items || []).filter(
    (item: Data) => item.status === "OUT",
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await send("returns/returns", {
        rentalId: Number(rentalId),
        rentalItemId: Number(itemId),
        condition,
        notes,
      });
      notify(
        condition === "DAÑADO"
          ? "Devolución registrada. Cargo pendiente de aprobación."
          : "Devolución registrada correctamente",
      );
      details.refresh();
      history.refresh();
      damages.refresh();
      rental.refresh();
      setItemId("");
      setNotes("");
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="SEGUIMIENTO DE PRENDAS"
        title="Devoluciones"
        subtitle="Recibe las prendas, inspecciona su estado y registra observaciones."
      />
      <div className="dashboard-grid returns-layout">
        <section className="surface-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">RECEPCIÓN</span>
              <h3>Registrar devolución</h3>
            </div>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <Field label="Alquiler activo">
              <select
                value={rentalId}
                required
                onChange={(e) => {
                  setRentalId(e.target.value);
                  setItemId("");
                }}
              >
                <option value="">Seleccionar alquiler</option>
                {open.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.folio} · {row.client_name}
                  </option>
                ))}
              </select>
            </Field>
            {rentalId && (
              <>
                {details.error && (
                  <Problem message={details.error} retry={details.refresh} />
                )}
                <Field label="Unidad a devolver">
                  <select
                    value={itemId}
                    required
                    onChange={(e) => setItemId(e.target.value)}
                  >
                    <option value="">Seleccionar unidad pendiente</option>
                    {pendingItems.map((row: Data) => (
                      <option key={row.id} value={row.id}>
                        {row.unit_code} · {row.garment_name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field label="Estado de conservación">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                {["EXCELENTE", "BUENO", "REGULAR", "DAÑADO"].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observaciones">
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Registra faltantes, daños o información de entrega"
              />
            </Field>
            {condition === "DAÑADO" && (
              <div className="warning-box">
                Las unidades dañadas pasan a mantenimiento y se genera una
                evaluación económica para aprobación del administrador.
              </div>
            )}
            <Button type="submit" disabled={busy || !itemId}>
              {busy ? "Procesando..." : "Confirmar devolución"}
            </Button>
          </form>
        </section>
        <section className="surface-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">CONDICIÓN Y RESPONSABILIDAD</span>
              <h3>Evaluaciones de daños</h3>
            </div>
          </div>
          <div className="stack-list">
            {(damages.data || []).slice(0, 9).map((row) => (
              <div className="stack-row" key={row.id}>
                <div>
                  <strong>Unidad #{row.unit_id}</strong>
                  <small>
                    Alquiler #{row.rental_id} · Sugerido{" "}
                    {currency(row.suggested_amount)}
                  </small>
                </div>
                <Pill tone={statusTone(row.status)}>{row.status}</Pill>
              </div>
            ))}
            {!damages.data?.length && (
              <Blank
                title="Sin daños registrados"
                description="Las inspecciones aparecerán aquí."
              />
            )}
          </div>
        </section>
      </div>
      <section className="surface-card section-below">
        <div className="card-heading">
          <div>
            <span className="eyebrow">CONTROL DE RECEPCIÓN</span>
            <h3>Historial de devoluciones</h3>
          </div>
        </div>
        {history.error && (
          <Problem message={history.error} retry={history.refresh} />
        )}
        <Table
          heads={[
            "Alquiler",
            "Unidad",
            "Conservación",
            "Observaciones",
            "Fecha",
          ]}
          rows={history.data || []}
          render={(row) => (
            <>
              <td className="strong-cell">#{row.rental_id}</td>
              <td>#{row.unit_id}</td>
              <td>
                <Pill tone={statusTone(row.condition_state)}>
                  {row.condition_state}
                </Pill>
              </td>
              <td>{row.notes || "Sin observaciones"}</td>
              <td>{dateFormat(row.created_at)}</td>
            </>
          )}
        />
      </section>
    </>
  );
}

function Payments({ notify }: { notify: Notify }) {
  const [rentalId, setRentalId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("YAPE");
  const [busy, setBusy] = useState(false);
  const rental = useRemote<Data[]>("rental/rentals");
  const balance = useRemote<Data>(
    rentalId
      ? `returns/rentals/${rentalId}/balance`
      : "returns/rentals/0/balance",
  );
  const payments = useRemote<Data[]>("returns/payments");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await send("returns/payments", {
        rentalId: Number(rentalId),
        amount: Number(amount),
        method,
      });
      notify("Pago contabilizado correctamente");
      setAmount("");
      balance.refresh();
      payments.refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="CONTROL FINANCIERO"
        title="Pagos y cobros"
        subtitle="Abonos parciales, saldos pendientes y registro de métodos de pago."
      />
      <div className="dashboard-grid returns-layout">
        <section className="surface-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">NUEVA OPERACIÓN</span>
              <h3>Registrar pago</h3>
            </div>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <Field label="Alquiler">
              <select
                required
                value={rentalId}
                onChange={(e) => setRentalId(e.target.value)}
              >
                <option value="">Seleccionar alquiler</option>
                {rental.data
                  ?.filter(
                    (row) =>
                      row.status !== "CANCELLED" && row.status !== "PENDING",
                  )
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.folio} · {row.client_name}
                    </option>
                  ))}
              </select>
            </Field>
            {rentalId &&
              (balance.error ? (
                <Problem message={balance.error} retry={balance.refresh} />
              ) : (
                balance.data?.rentalId && (
                  <div className="balance-panel">
                    <span>SALDO ACTUAL</span>
                    <strong>{currency(balance.data.balance)}</strong>
                    <small>
                      Importe total: {currency(balance.data.total)} · Pagado:{" "}
                      {currency(balance.data.paid)}
                    </small>
                  </div>
                )
              ))}
            <div className="two-fields">
              <Field label="Importe a registrar">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Método de pago">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {["YAPE", "PLIN", "EFECTIVO", "TRANSFERENCIA"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button
              type="submit"
              disabled={busy || !rentalId || !balance.data?.balance}
            >
              {busy ? "Registrando..." : "Registrar cobro"}
            </Button>
          </form>
        </section>
        <section className="surface-card">
          <div className="card-heading">
            <div>
              <span className="eyebrow">TRAZABILIDAD</span>
              <h3>Últimos cobros</h3>
            </div>
          </div>
          <div className="stack-list">
            {payments.data?.slice(0, 10).map((row) => (
              <div className="stack-row" key={row.id}>
                <div>
                  <strong>Alquiler #{row.rental_id}</strong>
                  <small>
                    {row.method} · {dateFormat(row.created_at)}
                  </small>
                </div>
                <span className="positive-amount">
                  + {currency(row.amount)}
                </span>
              </div>
            ))}
            {!payments.data?.length && (
              <Blank
                title="Aún no hay pagos"
                description="Puedes registrar un pago desde el formulario."
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Reports({ notify }: { notify: Notify }) {
  const summary = useRemote<Data>("admin/reports/overview");
  const inventory = useRemote<Data[]>("admin/reports/inventory");
  const audit = useRemote<Data[]>("admin/reports/audit");

  const downloadCsv = () => {
    const items = inventory.data || [];
    if (!items.length) {
      notify("No hay datos para exportar", "error");
      return;
    }
    const headers = [
      "Danza",
      "Prenda",
      "SKU",
      "Total",
      "Disponibles",
      "Alquiladas",
      "Mantenimiento",
    ];
    const values = items.map((item) => [
      item.dance,
      item.garment,
      item.sku,
      item.total,
      item.available,
      item.rented,
      item.maintenance,
    ]);
    const text = [headers, ...values]
      .map((line) =>
        line
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + text], {
      type: "text/csv;charset=utf-8;",
    });
    const address = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = address;
    link.download = "tunantay-inventario.csv";
    link.click();
    URL.revokeObjectURL(address);
  };

  return (
    <>
      <PageTitle
        eyebrow="INTELIGENCIA DE NEGOCIO"
        title="Reportes"
        subtitle="Información consolidada para tomar mejores decisiones."
        action={<Button onClick={downloadCsv}>Exportar inventario</Button>}
      />
      {summary.error && (
        <Problem message={summary.error} retry={summary.refresh} />
      )}
      <div className="reports-heading">
        <div>
          <span className="eyebrow">RESUMEN OPERATIVO</span>
          <h2>Indicadores de gestión</h2>
        </div>
      </div>
      <div className="metrics-grid">
        <article className="metric">
          <span>Clientes</span>
          <strong>{summary.data?.clients ?? "—"}</strong>
          <small>Registrados</small>
        </article>
        <article className="metric">
          <span>Danzas del catálogo</span>
          <strong>{summary.data?.dances ?? "—"}</strong>
          <small>Expresiones catalogadas</small>
        </article>
        <article className="metric">
          <span>Prendas en mantenimiento</span>
          <strong>{summary.data?.stock?.maintenance ?? "—"}</strong>
          <small>Requieren seguimiento</small>
        </article>
        <article className="metric">
          <span>Daños por aprobar</span>
          <strong>{summary.data?.pendingDamages ?? "—"}</strong>
          <small>Decisiones pendientes</small>
        </article>
      </div>
      <section className="surface-card section-below">
        <div className="card-heading">
          <div>
            <span className="eyebrow">DISPONIBILIDAD</span>
            <h3>Informe de inventario</h3>
          </div>
        </div>
        {inventory.error && (
          <Problem message={inventory.error} retry={inventory.refresh} />
        )}
        <Table
          heads={["Danza", "Prenda", "Unidades", "Disponibles", "Alquiladas"]}
          rows={inventory.data || []}
          render={(row) => (
            <>
              <td>{row.dance}</td>
              <td className="strong-cell">{row.garment}</td>
              <td>{row.total}</td>
              <td>{row.available}</td>
              <td>{row.rented}</td>
            </>
          )}
        />
      </section>
      {!audit.error && (
        <section className="surface-card section-below">
          <div className="card-heading">
            <div>
              <span className="eyebrow">AUDITORÍA</span>
              <h3>Acciones registradas</h3>
            </div>
          </div>
          <Table
            heads={["Operación", "Entidad", "Responsable", "Fecha"]}
            rows={audit.data || []}
            render={(row) => (
              <>
                <td className="strong-cell">{row.action}</td>
                <td>
                  {row.entity} #{row.entity_id}
                </td>
                <td>{row.actor || `Usuario #${row.user_id}`}</td>
                <td>{dateFormat(row.created_at)}</td>
              </>
            )}
          />
        </section>
      )}
    </>
  );
}

function UsersPage({ notify }: { notify: Notify }) {
  const { data, error, refresh } = useRemote<Data[]>("auth/users");
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<Data | null>(null);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "EMPLEADO",
    active: true,
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = { ...form, password: form.password || undefined };
      await send(
        edit ? `auth/users/${edit.id}` : "auth/users",
        payload,
        edit ? "PATCH" : "POST",
      );
      notify(edit ? "Cuenta actualizada" : "Empleado registrado");
      setShow(false);
      refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="CONTROL DE ACCESO"
        title="Empleados y permisos"
        subtitle="Gestiona las cuentas del equipo y su nivel de acceso."
        action={
          <Button
            onClick={() => {
              setEdit(null);
              setForm({
                fullName: "",
                email: "",
                password: "",
                role: "EMPLEADO",
                active: true,
              });
              setShow(true);
            }}
          >
            Agregar empleado
          </Button>
        }
      />
      <div className="surface-card">
        {error && <Problem message={error} retry={refresh} />}
        <Table
          heads={["Nombre", "Correo electrónico", "Rol", "Cuenta", "Acciones"]}
          rows={data || []}
          render={(row) => (
            <>
              <td className="strong-cell">{row.fullName}</td>
              <td>{row.email}</td>
              <td>
                <Pill tone={row.role === "ADMIN" ? "gold" : "muted"}>
                  {row.role}
                </Pill>
              </td>
              <td>
                <Pill tone={row.active ? "green" : "red"}>
                  {row.active ? "Activa" : "Inactiva"}
                </Pill>
              </td>
              <td>
                <button
                  className="text-link"
                  onClick={() => {
                    setEdit(row);
                    setForm({
                      fullName: row.fullName,
                      email: row.email,
                      role: row.role,
                      password: "",
                      active: !!row.active,
                    });
                    setShow(true);
                  }}
                >
                  Administrar
                </button>
              </td>
            </>
          )}
        />
      </div>
      {show && (
        <Modal
          title={edit ? "Administrar empleado" : "Registrar empleado"}
          onClose={() => setShow(false)}
        >
          <form className="form-stack" onSubmit={submit}>
            <Field label="Nombre completo">
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label="Correo">
              <input
                type="email"
                required
                disabled={!!edit}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field
              label={
                edit ? "Nueva contraseña (opcional)" : "Contraseña inicial"
              }
            >
              <input
                type="password"
                minLength={10}
                required={!edit}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="Rol">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="EMPLEADO">Empleado</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </Field>
            {edit && (
              <label className="check-switch">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />{" "}
                Cuenta activa
              </label>
            )}
            <Button type="submit">Guardar cuenta</Button>
          </form>
        </Modal>
      )}
    </>
  );
}

function Configuration({ notify }: { notify: Notify }) {
  const config = useRemote<Data>("admin/settings");
  const [draft, setDraft] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const values = { ...config.data, ...draft };
  const fields = [
    {
      key: "PRICE_MODE",
      label: "Cálculo de alquiler por conjunto",
      options: [
        ["FIXED", "Precio fijo del conjunto"],
        ["ITEMS", "Suma de las prendas"],
      ],
    },
    {
      key: "DEBT_POLICY",
      label: "Política de deuda pendiente",
      options: [
        ["REQUIRE_APPROVAL", "Solicitar autorización"],
        ["BLOCK", "Bloquear nuevos alquileres"],
        ["ALLOW", "Permitir operación"],
      ],
    },
  ];
  const save = async () => {
    setBusy(true);
    try {
      await send("admin/settings", draft, "PATCH");
      notify("Configuración guardada correctamente");
      setDraft({});
      config.refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle
        eyebrow="PREFERENCIAS DEL NEGOCIO"
        title="Configuración"
        subtitle="Reglas comerciales que controlan tarifas, duración y autorizaciones."
      />
      <div className="surface-card form-page">
        {config.error && (
          <Problem message={config.error} retry={config.refresh} />
        )}
        <div className="card-heading">
          <div>
            <span className="eyebrow">REGLAS DE NEGOCIO</span>
            <h3>Parámetros generales</h3>
          </div>
        </div>
        <div className="form-stack">
          {fields.map((field) => (
            <Field key={field.key} label={field.label}>
              <select
                value={values[field.key] || ""}
                onChange={(e) =>
                  setDraft({ ...draft, [field.key]: e.target.value })
                }
              >
                {field.options.map((option) => (
                  <option key={option[0]} value={option[0]}>
                    {option[1]}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <div className="two-fields">
            <Field label="Hora de corte (0 a 23)">
              <input
                type="number"
                min="0"
                max="23"
                value={values.CUTOFF_HOUR || ""}
                onChange={(e) =>
                  setDraft({ ...draft, CUTOFF_HOUR: e.target.value })
                }
              />
            </Field>
            <Field label="Cargo base sugerido por daño (S/)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={values.DAMAGE_BASE || ""}
                onChange={(e) =>
                  setDraft({ ...draft, DAMAGE_BASE: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="form-hint">
            Los cargos por daños siempre necesitan aprobación del administrador
            antes de incorporarse al saldo.
          </div>
          <div>
            <Button
              onClick={save}
              disabled={busy || !Object.keys(draft).length}
            >
              {busy ? "Guardando..." : "Guardar configuración"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function ServiceStatus() {
  const services = [
    {
      key: "auth",
      name: "Autenticación",
      scope: "Sesiones, empleados y permisos",
    },
    {
      key: "inventory",
      name: "Inventario",
      scope: "Prendas, unidades y disponibilidad",
    },
    { key: "rental", name: "Alquileres", scope: "Clientes y contratos" },
    {
      key: "returns",
      name: "Devoluciones y pagos",
      scope: "Recepciones y finanzas",
    },
    {
      key: "admin",
      name: "Administración",
      scope: "Configuración, reportes y auditoría",
    },
  ];
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const results = await Promise.all(
      services.map(async (service) => {
        try {
          await api(`${service.key}/health`);
          return [service.key, true] as const;
        } catch {
          return [service.key, false] as const;
        }
      }),
    );
    setStatus(Object.fromEntries(results));
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);
  const online = Object.values(status).filter(Boolean).length;

  return (
    <>
      <PageTitle
        eyebrow="RESILIENCIA DEL SISTEMA"
        title="Estado de servicios"
        subtitle="Supervisión de los cinco microservicios a través del API Gateway."
        action={
          <Button secondary onClick={check} disabled={checking}>
            {checking ? "Verificando..." : "Comprobar servicios"}
          </Button>
        }
      />
      <div className="service-overview">
        <span>MICROSERVICIOS DISPONIBLES</span>
        <strong>{Object.keys(status).length ? `${online} / 5` : "—"}</strong>
        <p>La interfaz permanece independiente de los servicios funcionales.</p>
      </div>
      <div className="service-grid">
        {services.map((service) => (
          <article key={service.key} className="service-card">
            <div className="service-card-head">
              <span className="service-dot" />
              <strong>{service.name}</strong>
              <Pill
                tone={
                  status[service.key] === undefined
                    ? "muted"
                    : status[service.key]
                      ? "green"
                      : "red"
                }
              >
                {status[service.key] === undefined
                  ? "Sin comprobar"
                  : status[service.key]
                    ? "Disponible"
                    : "No disponible"}
              </Pill>
            </div>
            <p>{service.scope}</p>
            <code>{service.key}-service</code>
          </article>
        ))}
      </div>
      <div className="notice-text">
        Si un contenedor deja de responder, se bloquearán las operaciones
        dependientes para proteger la integridad de los datos. Los demás módulos
        seguirán disponibles cuando no requieran el servicio afectado.
      </div>
    </>
  );
}

function DamageQueue({
  notify,
  session,
}: {
  notify: Notify;
  session: Session;
}) {
  const { data, refresh } = useRemote<Data[]>("returns/damages");
  const pending = (data || []).filter((row) => row.status === "PENDING");
  const decide = async (
    id: number,
    decision: "APPROVED" | "REJECTED",
    amount: number,
  ) => {
    try {
      await send(
        `returns/damages/${id}/decision`,
        { decision, amount },
        "PATCH",
      );
      notify(decision === "APPROVED" ? "Cargo autorizado" : "Cargo rechazado");
      refresh();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };
  if (session.user.role !== "ADMIN" || !pending.length) return null;

  return (
    <section className="surface-card section-below">
      <div className="card-heading">
        <div>
          <span className="eyebrow">AUTORIZACIONES</span>
          <h3>Cargos pendientes de revisión</h3>
        </div>
      </div>
      <div className="stack-list">
        {pending.map((row) => (
          <div key={row.id} className="stack-row wrap-row">
            <div>
              <strong>
                Alquiler #{row.rental_id} · Unidad #{row.unit_id}
              </strong>
              <small>
                Importe sugerido: {currency(row.suggested_amount)} —{" "}
                {row.notes || "Sin observaciones adicionales"}
              </small>
            </div>
            <div className="actions-row">
              <Button
                secondary
                small
                onClick={() => decide(row.id, "REJECTED", 0)}
              >
                Rechazar
              </Button>
              <Button
                small
                onClick={() =>
                  decide(row.id, "APPROVED", Number(row.suggested_amount))
                }
              >
                Autorizar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Requests({
  notify,
  onPrepare,
}: {
  notify: Notify;
  onPrepare: (value: Data) => void;
}) {
  const { data, error, loading, refresh } =
    useRemote<Data[]>("rental/requests");
  const [busy, setBusy] = useState<number | null>(null);
  async function prepare(id: number) {
    setBusy(id);
    try {
      onPrepare(await send<Data>(`rental/requests/${id}/prepare`, {}));
    } catch (err) {
      notify((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ATENCIÓN A CLIENTES"
        title="Solicitudes de la web"
        subtitle="Confirma los detalles con el cliente y prepara el alquiler cuando recoja sus prendas."
        action={
          <Button secondary onClick={refresh}>
            Actualizar
          </Button>
        }
      />
      <div className="surface-card">
        {error && <Problem message={error} retry={refresh} />}
        {loading && <p>Cargando solicitudes…</p>}
        {!loading && !data?.length && (
          <p>Todavía no hay solicitudes de la web.</p>
        )}
        <div className="stack-list">
          {(data || []).map((row) => (
            <article className="stack-row wrap-row" key={row.id}>
              <div>
                <strong>
                  {row.reference} · {row.full_name}
                </strong>
                <small>
                  {row.set_name} · Recojo:{" "}
                  {String(row.pickup_date).slice(0, 10)} · Devolución:{" "}
                  {String(row.return_date).slice(0, 10)}
                </small>
                <small>
                  Documento: {row.doc_number} · Teléfono: {row.phone}{" "}
                  {row.email ? ` · ${row.email}` : ""}
                </small>
                {row.notes && <p>{row.notes}</p>}
                <small>
                  {row.folio
                    ? `Alquiler ${row.folio} · ${row.rental_status}`
                    : row.status === "CANCELLED"
                      ? "Solicitud cerrada."
                      : "Pendiente de atención. Aún no compromete inventario."}
                </small>
              </div>
              {!row.rental_id && row.status === "PENDING" && (
                <Button
                  small
                  disabled={busy !== null}
                  onClick={() => prepare(row.id)}
                >
                  {busy === row.id ? "Preparando…" : "Preparar entrega"}
                </Button>
              )}
              {!row.rental_id && (
                <Button
                  small
                  secondary
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(row.id);
                    try {
                      await send(
                        `rental/requests/${row.id}/status`,
                        {
                          status:
                            row.status === "PENDING" ? "CANCELLED" : "PENDING",
                        },
                        "PATCH",
                      );
                      refresh();
                    } catch (err) {
                      notify((err as Error).message, "error");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {row.status === "PENDING"
                    ? "Cerrar solicitud"
                    : "Reabrir solicitud"}
                </Button>
              )}
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(getSession);
  const [page, setPage] = useState<Page>("inicio");
  const [prepared, setPrepared] = useState<Data | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { toast, notify, dismiss } = useToast();
  const now = useMemo(
    () =>
      new Date().toLocaleDateString("es-PE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [],
  );

  const navigate = (next: Page) => {
    if (next !== "alquileres") setPrepared(null);
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const logout = () => {
    saveSession(null);
    setSession(null);
    setPage("inicio");
  };

  useEffect(() => {
    if (!session) return;
    let alive = true;
    api("auth/me")
      .then((user: Data) => {
        if (alive && !user.active) logout();
      })
      .catch(() => {
        // Mantener la UI si Autenticación se encuentra desconectado;
        // las rutas de backend siguen verificando firma y expiración JWT.
      });
    return () => {
      alive = false;
    };
  }, [session]);

  if (!session)
    return (
      <>
        <Login onLogin={setSession} notify={notify} />
        {toast && (
          <div role="alert" className={`toast toast-${toast.kind}`}>
            {toast.text}
            <button onClick={dismiss}>Cerrar</button>
          </div>
        )}
      </>
    );

  const routeNames = Object.fromEntries(
    navigation.flatMap((section) =>
      section.items.map((item) => [item.page, item.title]),
    ),
  );

  const content = () => {
    switch (page) {
      case "inicio":
        return <Overview navigate={navigate} />;
      case "danzas":
        return <Dances />;
      case "inventario":
        return <Inventory notify={notify} />;
      case "solicitudes":
        return (
          <Requests
            notify={notify}
            onPrepare={(value) => {
              setPrepared(value);
              navigate("alquileres");
            }}
          />
        );
      case "alquileres":
        return (
          <Rentals notify={notify} navigate={navigate} prepared={prepared} />
        );
      case "devoluciones":
        return (
          <>
            <Returns notify={notify} />
            <DamageQueue notify={notify} session={session} />
          </>
        );
      case "pagos":
        return <Payments notify={notify} />;
      case "clientes":
        return <Clients notify={notify} />;
      case "reportes":
        return <Reports notify={notify} />;
      case "usuarios":
        return <UsersPage notify={notify} />;
      case "ajustes":
        return <Configuration notify={notify} />;
      case "servicios":
        return <ServiceStatus />;
      default:
        return <Overview navigate={navigate} />;
    }
  };

  return (
    <div className="app-shell">
      <button
        className="mobile-menu"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Abrir menú"
      >
        Menú
      </button>
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-logo">
          <span className="brand-symbol">T</span>
          <div>
            TUNANTAY <small>VESTUARIOS</small>
          </div>
        </div>
        <div className="sidebar-inner">
          <div className="sidebar-overline">PANEL DE ADMINISTRACIÓN</div>
          {navigation.map((group) => (
            <div className="nav-group" key={group.group}>
              <div className="nav-label">{group.group}</div>
              {group.items
                .filter((item) => !item.admin || session.user.role === "ADMIN")
                .map((item) => (
                  <button
                    key={item.page}
                    className={`nav-item ${page === item.page ? "nav-active" : ""}`}
                    onClick={() => navigate(item.page)}
                  >
                    <span>{item.title}</span>
                    {page === item.page && (
                      <span className="nav-active-marker" />
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <a className="sidebar-caption" href="/">
            VER WEB DE CLIENTES
          </a>
          <div className="sidebar-profile">
            <span className="avatar">
              {session.user.fullName.charAt(0).toUpperCase()}
            </span>
            <div className="profile-detail">
              <strong>{session.user.fullName}</strong>
              <small>
                {session.user.role === "ADMIN" ? "Administrador" : "Empleado"}
              </small>
            </div>
            <button onClick={logout} title="Cerrar sesión">
              Salir
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="mobile-dim"
          onClick={() => setMenuOpen(false)}
          aria-label="Cerrar menú"
        />
      )}
      <main className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            Tunantay <span>/</span> <strong>{routeNames[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="today">{now}</span>
            <span className="topbar-separator" />
            <span className="user-role">
              {session.user.role === "ADMIN" ? "Administración" : "Operaciones"}
            </span>
            <span className="avatar avatar-small">
              {session.user.fullName.charAt(0).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="page-content">
          {content()}
          <footer className="footer">
            <span>TUNANTAY VESTUARIOS · JAUJA, PERÚ</span>
            <span>Sistema interno de gestión · Servicios Cloud</span>
          </footer>
        </div>
      </main>
      {toast && (
        <div role="alert" className={`toast toast-${toast.kind}`}>
          <span>{toast.text}</span>
          <button onClick={dismiss} aria-label="Cerrar">
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
