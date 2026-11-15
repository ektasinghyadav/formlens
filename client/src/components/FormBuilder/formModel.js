// formModel.js - plain helper functions for the Form Builder (no React). Requirements: FR-1.1, FR-1.2.
// The editor keeps each field in an easy-to-edit shape (e.g. dropdown options as lines of
// text). These helpers convert to/from the API shape and reorder lists.

// Plain names for the admin, not technical ones (NFR-4.1).
export const FIELD_TYPES = [
  { type: 'text', name: 'Short text' },
  { type: 'email', name: 'Email' },
  { type: 'number', name: 'Number' },
  { type: 'dropdown', name: 'Dropdown' },
  { type: 'file', name: 'File upload' },
];

// Sensible starting values so a new field is valid immediately (NFR-4.1).
const DEFAULTS = {
  text: { label: 'Your name' },
  email: { label: 'Your email' },
  number: { label: 'A number' },
  dropdown: { label: 'Choose one', optionsText: 'Option 1\nOption 2' },
  file: { label: 'Upload a file' },
};

let counter = 0; // local key so React can tell fields apart before they have a server id

export function newField(type) {
  return {
    key: `new-${++counter}`,
    field_id: null,
    field_type: type,
    label: '',
    is_required: false,
    format: '',
    optionsText: '',
    maxFileSizeMB: 5,
    ...DEFAULTS[type],
  };
}

export function fromApiField(f) {
  const v = f.validations || {};
  return {
    key: f.field_id,
    field_id: f.field_id,
    field_type: f.field_type,
    label: f.label,
    is_required: f.is_required,
    format: v.format || '',
    optionsText: (v.options || []).join('\n'),
    maxFileSizeMB: v.maxFileSizeMB ?? 5,
  };
}

function toApiField(f) {
  let validations = null;
  if (f.field_type === 'text' && f.format) validations = { format: f.format };
  if (f.field_type === 'dropdown') {
    validations = { options: f.optionsText.split('\n').map((o) => o.trim()).filter(Boolean) };
  }
  if (f.field_type === 'file') validations = { maxFileSizeMB: Number(f.maxFileSizeMB) };
  return {
    ...(f.field_id ? { field_id: f.field_id } : {}),
    field_type: f.field_type,
    label: f.label,
    is_required: f.is_required,
    validations,
  };
}

export function toApiForm(title, fields) {
  return { title, fields: fields.map(toApiField) };
}

// Returns a NEW list with the item at `from` moved to `to` (never edits the original).
export function moveItem(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
