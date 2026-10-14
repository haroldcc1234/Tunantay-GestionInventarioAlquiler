export type User = {
  id: number;
  fullName: string;
  email: string;
  role: "ADMIN" | "EMPLEADO";
};

export type Session = {
  token: string;
  user: User;
};

export const getSession = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem("tunantay-session") || "null");
  } catch {
    return null;
  }
};

export const saveSession = (session: Session | null) => {
  if (session)
    sessionStorage.setItem("tunantay-session", JSON.stringify(session));
  else sessionStorage.removeItem("tunantay-session");
};

export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getSession()?.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);

  try {
    const response = await fetch(`/api/${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data.message || `Servicio no disponible (HTTP ${response.status})`,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "La solicitud tardó demasiado. Verifica el estado del servicio.",
      );
    }
    if (error instanceof TypeError) {
      throw new Error("No se pudo establecer conexión con el servicio.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const send = <T = any>(path: string, data: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(data) });

export const currency = (value: unknown) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    Number(value || 0),
  );

export const dateFormat = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
