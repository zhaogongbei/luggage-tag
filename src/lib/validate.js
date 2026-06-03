export function normalizeCustomerName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/^ +/g, "")
    .replace(/ {2,}/g, " ")
    .slice(0, 12);
}

export function finalizeCustomerName(value) {
  return normalizeCustomerName(value).trim();
}

export function isValidCustomerName(value) {
  return /^[A-Z]+(?: [A-Z]+)*$/.test(value) && value.length <= 12;
}

export function parseBooleanParam(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}
