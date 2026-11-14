// The html tagged template. Every interpolated value is escaped unless it is
// the result of another html`` call or was wrapped in raw(). Always put
// attribute values in double quotes.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new SafeHtml(String(value));
}

// The start of a text, for a button's accessible name: "Done, Phones away at dinner".
export function shorten(text, max = 48) {
  const chars = [...String(text).replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('').trimEnd()}…`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return new SafeHtml(out);
}
