let token = (() => { try { return localStorage.getItem("keel_token"); } catch { return null; } })();
export const setToken = (t) => { token = t; try { t ? localStorage.setItem("keel_token", t) : localStorage.removeItem("keel_token"); } catch {} };
export const hasToken = () => !!token;

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") { setToken(null); window.dispatchEvent(new Event("keel:logout")); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
