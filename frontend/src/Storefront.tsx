import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, send, currency } from "./api";
import "./storefront.css";

type SetItem = {
  id: number;
  name: string;
  size: string;
  price: number;
  available: number;
};
type Dance = {
  id: number;
  name: string;
  region: string;
  department: string;
  description: string;
  image_credit: string;
  image_source?: string;
  image_license?: string;
  sets: SetItem[];
};

function Inquiry({ dance, onClose }: { dance: Dance; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await send<{ reference: string }>(
        "rental/public/requests",
        {
          ...Object.fromEntries(data),
          setId: Number(data.get("setId")),
          requestKey,
          consent: data.get("consent") === "on",
        },
      );
      setReference(result.reference);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="inquiry"
      onCancel={onClose}
      aria-labelledby="inquiry-title"
    >
      <button className="inquiry-close" onClick={onClose} type="button">
        Cerrar
      </button>
      {reference ? (
        <div className="inquiry-success" role="status">
          <span className="store-eyebrow">SOLICITUD RECIBIDA</span>
          <h2 id="inquiry-title">Tu próxima celebración empieza aquí.</h2>
          <p>
            Guarda tu código <strong>{reference}</strong>. El equipo de Tunantay
            revisará las fechas y se comunicará contigo al teléfono indicado.
          </p>
          <p>
            La solicitud no confirma una reserva ni un pago. La disponibilidad y
            el importe final se confirman con la tienda.
          </p>
          <button className="store-button" onClick={onClose}>
            Seguir explorando
          </button>
        </div>
      ) : (
        <>
          <span className="store-eyebrow">VISTE TU PRÓXIMA CELEBRACIÓN</span>
          <h2 id="inquiry-title">{dance.name}</h2>
          <p>
            Cuéntanos cuándo lo necesitas. Te ayudaremos a elegir las piezas y
            la talla.
          </p>
          <form onSubmit={submit} className="inquiry-form">
            <label className="form-full">
              Conjunto
              <select name="setId" required>
                {dance.sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.size} · {currency(s.price)} por período de
                    alquiler
                  </option>
                ))}
              </select>
            </label>
            <label className="form-full">
              Nombres y apellidos
              <input
                name="fullName"
                required
                maxLength={160}
                autoComplete="name"
              />
            </label>
            <label>
              DNI o documento
              <input
                name="docNumber"
                required
                minLength={8}
                maxLength={20}
                pattern="[0-9A-Za-z\-]{8,20}"
              />
            </label>
            <label>
              Teléfono
              <input
                name="phone"
                type="tel"
                required
                maxLength={25}
                autoComplete="tel"
              />
            </label>
            <label className="form-full">
              Correo electrónico (opcional)
              <input
                name="email"
                type="email"
                maxLength={180}
                autoComplete="email"
              />
            </label>
            <label>
              Fecha de recojo
              <input name="pickupDate" type="date" min={today} required />
            </label>
            <label>
              Fecha de devolución
              <input name="returnDate" type="date" min={today} required />
            </label>
            <label className="form-full">
              Tallas, agrupación o detalles (opcional)
              <textarea name="notes" maxLength={500} rows={3} />
            </label>
            <label className="form-full consent">
              <input name="consent" type="checkbox" required />
              <span>
                Autorizo a Tunantay a utilizar estos datos para atender mi
                solicitud y contactarme. No se realizará ningún cobro en esta
                web.
              </span>
            </label>
            <p className="form-full form-note">
              Solicitas un conjunto. Para una agrupación, indica la cantidad en
              los detalles. El personal confirmará existencias, tallas y tarifa
              antes de la entrega.
            </p>
            {error && (
              <p className="form-full store-error" role="alert">
                {error}
              </p>
            )}
            <button className="store-button form-full" disabled={busy}>
              {busy ? "Enviando solicitud…" : "Enviar solicitud de alquiler"}
            </button>
          </form>
        </>
      )}
    </dialog>
  );
}

export default function Storefront() {
  const [dances, setDances] = useState<Dance[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("Todas");
  const [department, setDepartment] = useState("Todos");
  const [limit, setLimit] = useState(12);
  const [selected, setSelected] = useState<Dance | null>(null);

  function load() {
    setLoading(true);
    setError("");
    api<Dance[]>("inventory/public/catalog")
      .then(setDances)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const filtered = useMemo(
    () =>
      dances.filter(
        (d) =>
          (region === "Todas" || d.region === region) &&
          (department === "Todos" || d.department === department) &&
          normalize(`${d.name} ${d.department}`).includes(normalize(query)),
      ),
    [dances, region, department, query],
  );
  const departments = [...new Set(dances.map((d) => d.department))].sort(
    (a, b) => a.localeCompare(b, "es"),
  );

  return (
    <div className="storefront">
      <a className="skip-link" href="#coleccion">
        Saltar al catálogo
      </a>
      <div className="store-topline">DESDE JAUJA, PARA CELEBRAR EL PERÚ</div>
      <header className="store-header">
        <a className="store-brand" href="/">
          TUNANTAY<small>V E S T U A R I O S</small>
        </a>
        <nav aria-label="Navegación principal">
          <a href="#coleccion">Colección</a>
          <a href="#nosotros">Nuestra casa</a>
          <a href="#como-alquilar">Cómo alquilar</a>
        </nav>
        <a className="store-contact" href="#visitanos">
          Visítanos en Jauja
        </a>
      </header>
      <main>
        <section className="store-hero" aria-labelledby="hero-title">
          <img
            src="/hero-tunantay.png"
            alt="Composición artística de vestuarios festivos inspirados en las tradiciones peruanas"
            fetchPriority="high"
          />
          <div className="store-hero-copy">
            <span className="store-eyebrow">
              ALQUILER DE TRAJES TÍPICOS · JAUJA
            </span>
            <h1 id="hero-title">
              La tradición
              <br />
              se lleva <em>puesta.</em>
            </h1>
            <p>
              Vestimentas para bailar nuestra historia.
              <br />
              Encuentra las piezas que acompañarán
              <br />
              tu próxima celebración.
            </p>
            <a className="store-button light-button" href="#coleccion">
              Explorar la colección
            </a>
          </div>
          <span className="hero-caption">BORDADOS, MEMORIA Y CELEBRACIÓN</span>
        </section>
        <div className="store-ribbon">
          <span>Raíces de Jauja</span>
          <i />
          <span>Conjuntos y accesorios</span>
          <i />
          <span>Atención para agrupaciones</span>
        </div>
        <section id="coleccion" className="store-section collection-section">
          <div className="collection-heading">
            <div>
              <span className="store-eyebrow">
                UN PAÍS, MUCHAS FORMAS DE CELEBRAR
              </span>
              <h2>Elige tu próxima danza.</h2>
            </div>
            <p>
              De la costa a la Amazonía, pasando por los Andes. Una colección
              para reencontrarte con nuestras tradiciones.
            </p>
          </div>
          <div className="store-filters">
            <div className="region-tabs" aria-label="Filtrar por región">
              {["Todas", "Costa", "Sierra", "Selva"].map((r) => (
                <button
                  key={r}
                  className={r === region ? "selected" : ""}
                  aria-pressed={r === region}
                  onClick={() => {
                    setRegion(r);
                    setLimit(12);
                  }}
                >
                  {r === "Todas" ? "Todo el Perú" : r}
                </button>
              ))}
            </div>
            <label className="search-label">
              <span className="sr-only">Buscar danza o departamento</span>
              <input
                type="search"
                placeholder="Buscar una danza…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(12);
                }}
              />
            </label>
            <label>
              <span className="sr-only">Departamento</span>
              <select
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setLimit(12);
                }}
              >
                <option value="Todos">Todos los departamentos</option>
                {departments.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="collection-count" aria-live="polite">
            {loading
              ? "Consultando colección…"
              : `${filtered.length} danzas en la colección`}
            <span>
              Disponibilidad actualizada al consultar{" "}
              <button onClick={load} disabled={loading}>
                Actualizar
              </button>
            </span>
          </div>
          {error && (
            <div className="store-error" role="alert">
              {error} <button onClick={load}>Volver a intentar</button>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="store-empty">
              <h3>No encontramos esa danza.</h3>
              <p>Prueba con otro nombre o departamento.</p>
              <button
                onClick={() => {
                  setQuery("");
                  setRegion("Todas");
                  setDepartment("Todos");
                }}
              >
                Limpiar filtros
              </button>
            </div>
          )}
          <div className="dance-collection">
            {filtered.slice(0, limit).map((dance, index) => {
              const price = dance.sets.length
                ? Math.min(...dance.sets.map((s) => Number(s.price)))
                : null;
              const available = dance.sets.reduce(
                (sum, s) => sum + Number(s.available),
                0,
              );
              return (
                <article className="collection-card" key={dance.id}>
                  <button
                    className="dance-picture"
                    onClick={() => setSelected(dance)}
                    aria-label={`Ver ${dance.name}`}
                    disabled={!dance.sets.length}
                  >
                    <img
                      src={`/api/inventory/dances/${dance.id}/image`}
                      alt={`Imagen de referencia de ${dance.name}`}
                      loading={index < 3 ? "eager" : "lazy"}
                    />
                    <span className="region-label">{dance.region}</span>
                  </button>
                  <div className="dance-meta">
                    <span>{dance.department}</span>
                    <span>
                      {available > 0
                        ? "Disponible en tienda"
                        : "Consultar disponibilidad"}
                    </span>
                  </div>
                  <div className="dance-title">
                    <h3>{dance.name}</h3>
                    {price !== null && (
                      <span>
                        Desde <strong>{currency(price)}</strong>
                      </span>
                    )}
                  </div>
                  <p>{dance.description}</p>
                  <button
                    className="collection-action"
                    onClick={() => setSelected(dance)}
                    disabled={!dance.sets.length}
                  >
                    Solicitar este vestuario <span aria-hidden="true">↗</span>
                  </button>
                  <details className="image-attribution">
                    <summary>Sobre la imagen</summary>
                    {dance.image_license && (
                      <a
                        href={dance.image_license}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Licencia de uso
                      </a>
                    )}
                    <span>
                      {dance.image_credit}. Imagen de referencia; consulta las
                      prendas físicas disponibles.
                    </span>
                    {dance.image_source && (
                      <a
                        href={dance.image_source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver fuente
                      </a>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
          {filtered.length > limit && (
            <div className="load-more">
              <button
                className="store-button outline-button"
                onClick={() => setLimit((v) => v + 12)}
              >
                Ver más danzas ({filtered.length - limit})
              </button>
            </div>
          )}
          <p className="catalog-note">
            Catálogo cultural ampliable. Las imágenes son referencias culturales
            o ilustraciones; las prendas, tallas y tarifas se confirman en
            tienda. Los precios publicados corresponden al período de cobro
            configurado.
          </p>
        </section>
        <section id="nosotros" className="store-story">
          <div className="story-title">
            <span className="store-eyebrow">NUESTRA CASA ESTÁ EN JAUJA</span>
            <h2>
              Hay historias
              <br />
              que se cuentan
              <br />
              <em>bailando.</em>
            </h2>
          </div>
          <div className="story-copy">
            <span className="story-number">01 / NUESTRAS RAÍCES</span>
            <p>
              En Tunantay acompañamos a quienes mantienen vivas las fiestas, las
              danzas y las costumbres de nuestra tierra.
            </p>
            <p>
              Desde la Tunantada y el Santiago hasta el Carnaval Jaujino, cada
              celebración reúne familias, músicos y danzantes. Nosotros te
              ayudamos a encontrar la vestimenta para formar parte de ella.
            </p>
            <a href="#visitanos">Conoce nuestra tienda en Jauja</a>
          </div>
        </section>
        <section id="como-alquilar" className="store-section">
          <span className="store-eyebrow">TE ACOMPAÑAMOS EN CADA PASO</span>
          <h2>De la elección a la celebración.</h2>
          <div className="rental-steps">
            {[
              [
                "01",
                "Encuentra tu danza",
                "Explora la colección y elige el conjunto que deseas consultar.",
              ],
              [
                "02",
                "Cuéntanos tu fecha",
                "Envía tu solicitud. Revisaremos tallas, piezas y disponibilidad contigo.",
              ],
              [
                "03",
                "Recoge y celebra",
                "Confirma tu alquiler en tienda y recoge el conjunto. Al devolverlo, revisamos juntos cada pieza.",
              ],
            ].map(([number, title, text]) => (
              <div key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
        <section id="visitanos" className="store-visit">
          <div>
            <span className="store-eyebrow">
              NOS ENCONTRAMOS EN EL CENTRO DE JAUJA
            </span>
            <h2>Ven. La tradición te espera.</h2>
            <p>
              Jr. Ayacucho, a media cuadra de la RENIEC.
              <br />
              Jauja, Junín, Perú.
            </p>
          </div>
          <a
            className="store-button light-button"
            href="https://www.google.com/maps/search/?api=1&query=Jr.+Ayacucho+Jauja+Junin+Peru"
            target="_blank"
            rel="noreferrer"
          >
            Ver la zona en el mapa
          </a>
        </section>
      </main>
      <footer className="store-footer">
        <a className="store-brand" href="/">
          TUNANTAY<small>V E S T U A R I O S</small>
        </a>
        <p>
          Alquiler de trajes típicos de Jauja.
          <br />
          Hecho para celebrar lo nuestro.
        </p>
        <a href="/gestion">Acceso del personal</a>
        <span>© {new Date().getFullYear()} Tunantay Vestuarios</span>
      </footer>
      {selected && (
        <Inquiry dance={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
