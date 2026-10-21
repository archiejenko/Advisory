import React, { createContext, useContext, useEffect, useState } from "react";

// Hash router: works from a single offline file, with back/forward and deep links.
// Routes look like #/agents/client-book-watch or #/?s=method for a home section.
function parse() {
  const raw = (window.location.hash || "#/").slice(1) || "/";
  const [path, qs] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  return { path: path.replace(/\/+$/, "") || "/", query };
}

const RouteCtx = createContext({ path: "/", query: {} });

export function RouterProvider({ children }) {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // Scroll: to a named section when asked, otherwise to the top of the new page.
  useEffect(() => {
    const s = route.query.s;
    const go = () => {
      if (s) {
        const el = document.getElementById(s);
        if (el) { window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: "smooth" }); return; }
      }
      window.scrollTo(0, 0);
    };
    requestAnimationFrame(go);
  }, [route.path, route.query.s]);
  // Page title per route.
  useEffect(() => {
    const t = document.querySelector("[data-page-title]");
    document.title = (t ? t.getAttribute("data-page-title") + " | " : "") + "Agent House";
  });
  return <RouteCtx.Provider value={route}>{children}</RouteCtx.Provider>;
}

export const useRoute = () => useContext(RouteCtx);

export function navigate(to) {
  window.location.hash = to;
}

export function Link({ to, className, children, exact, ...rest }) {
  const { path } = useRoute();
  const base = to.split("?")[0];
  const active = base !== "/" && (path === base || (!exact && path.startsWith(base + "/")));
  return (
    <a href={"#" + to} className={[className, active ? "is-current" : ""].filter(Boolean).join(" ") || undefined} aria-current={path === base ? "page" : undefined} {...rest}>
      {children}
    </a>
  );
}

// Match "/workspace/clients/:no" style patterns.
export function match(pattern, path) {
  const a = pattern.split("/"), b = path.split("/");
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
