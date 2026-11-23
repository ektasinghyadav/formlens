// validate.js - the respondent form's checks, shown live as the person types. (FR-2.2)
// Plain function, no React. The server repeats every check (never trust the browser);
// these exist so the person gets help immediately instead of after pressing Submit.

// name@domain.tld: no spaces, one @, a dot in the domain, a last part of 2+ letters, no empty parts like "a..b"
const EMAIL = /^[^\s@.]+(\.[^\s@.]+)*@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/;
const PHONE = /^\d{10}$/; // exactly 10 digits, nothing else
const NUMBER = /^-?\d+(\.\d+)?$/;

// Returns an error message (string) or '' when the answer is fine.
// `value` is the text answer; `file` is the chosen File for file fields.
export function validateAnswer(field, value, file) {
  const rules = field.validations || {};

  if (field.field_type === 'file') {
    if (!file) return field.is_required ? 'This field is required' : '';
    const max = rules.maxFileSizeMB ?? 5;
    if (file.size > max * 1024 * 1024) return `The file is too large. The limit is ${max} MB.`;
    return '';
  }

  const text = (value ?? '').trim();
  if (text === '') return field.is_required ? 'This field is required' : '';
  if (text.length > 5000) return 'Answer is too long (max 5000 characters)';

  const format = field.field_type === 'text' ? rules.format : field.field_type;
  if (format === 'email' && !EMAIL.test(text)) return 'Enter a valid email address, like name@example.com';
  if (format === 'phone' && !PHONE.test(text)) return 'Enter a 10-digit phone number, like 9876543210';
  if (format === 'number' && !NUMBER.test(text)) return 'Enter a number, like 42';
  if (field.field_type === 'dropdown' && !rules.options.includes(text)) return 'Choose one of the listed options';
  return '';
}
