export function toJsonOrNull(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function fromJsonOrNull(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}
