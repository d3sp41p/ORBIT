/** English number and text formatting shared by event texts and the UI. */

const NUM_LOCALE = "en-US";

export const fmt = (n: number) => Math.round(n).toLocaleString(NUM_LOCALE);

export const fmtBig = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  return fmt(n);
};

export const money = (n: number) =>
  n >= 1e9
    ? "$" + (n / 1e9).toFixed(2) + "B"
    : n >= 1e6
      ? "$" + (n / 1e6).toFixed(2) + "M"
      : n >= 1e3
        ? "$" + (n / 1e3).toFixed(1) + "K"
        : "$" + Math.round(n);

export const celsius = (n: number) => `${Math.round(n)} °C`;

export const cap1 = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export const shortAddr = (a: string) => a.slice(0, 4) + "…" + a.slice(-4);

/** Escape user or data text before it goes into HTML. */
export const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
