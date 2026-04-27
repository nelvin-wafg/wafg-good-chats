// strict server-side input validation. used by API route handlers.
// throws ValidationError on bad input; route handlers catch and return 400.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function stripControlChars(s) {
  return String(s).replace(CONTROL_CHARS, '');
}

// remove leading/trailing whitespace, collapse internal runs of whitespace
function normalizeText(s) {
  return stripControlChars(s).replace(/\s+/g, ' ').trim();
}

export function validateParticipantName(input) {
  if (typeof input !== 'string') throw new ValidationError('name must be a string');
  const cleaned = normalizeText(input);
  if (cleaned.length === 0) throw new ValidationError('name cannot be empty');
  if (cleaned.length > 48) throw new ValidationError('name must be 48 characters or less');
  return cleaned;
}

export function validateSessionName(input) {
  if (typeof input !== 'string') throw new ValidationError('session name must be a string');
  const cleaned = normalizeText(input);
  if (cleaned.length === 0) throw new ValidationError('session name cannot be empty');
  if (cleaned.length > 100) throw new ValidationError('session name must be 100 characters or less');
  return cleaned;
}

export function validateCode(input) {
  if (typeof input !== 'string') throw new ValidationError('code must be a string');
  const cleaned = String(input).toLowerCase().trim();
  if (cleaned.length === 0) throw new ValidationError('code cannot be empty');
  if (cleaned.length > 48) throw new ValidationError('code must be 48 characters or less');
  if (!/^[a-z0-9-]+$/.test(cleaned)) {
    throw new ValidationError('code can only contain lowercase letters, numbers, and dashes');
  }
  if (cleaned.startsWith('-') || cleaned.endsWith('-')) {
    throw new ValidationError('code cannot start or end with a dash');
  }
  return cleaned;
}

export function validateRounds(input) {
  const n = Number(input);
  if (!Number.isInteger(n)) throw new ValidationError('rounds must be an integer');
  if (n < 1 || n > 20) throw new ValidationError('rounds must be between 1 and 20');
  return n;
}

export function validateRoundSeconds(input) {
  const n = Number(input);
  if (!Number.isInteger(n)) throw new ValidationError('round_seconds must be an integer');
  if (n < 30 || n > 1800) throw new ValidationError('round_seconds must be between 30 and 1800');
  return n;
}

export function validatePromptText(input) {
  if (typeof input !== 'string') throw new ValidationError('prompt text must be a string');
  const cleaned = normalizeText(input);
  if (cleaned.length === 0) throw new ValidationError('prompt text cannot be empty');
  if (cleaned.length > 240) throw new ValidationError('prompt text must be 240 characters or less');
  return cleaned;
}

export function validatePrompts(input) {
  if (!Array.isArray(input)) throw new ValidationError('prompts must be an array');
  if (input.length === 0) throw new ValidationError('at least one prompt is required');
  if (input.length > 30) throw new ValidationError('too many prompts (max 30)');
  return input.map((p, idx) => {
    if (!p || typeof p !== 'object') throw new ValidationError(`prompt ${idx} is invalid`);
    const text = validatePromptText(p.text);
    return { id: typeof p.id === 'number' ? p.id : idx, text };
  });
}

export function validateNote(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') throw new ValidationError('note must be a string');
  const cleaned = normalizeText(input);
  if (cleaned.length > 500) throw new ValidationError('note must be 500 characters or less');
  return cleaned;
}

export function validateUuid(input, label = 'id') {
  if (typeof input !== 'string') throw new ValidationError(`${label} must be a string`);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(input)) throw new ValidationError(`${label} is not a valid uuid`);
  return input.toLowerCase();
}
