// Backend domain contracts are shared with the frontend through /shared.
// Keeping this module as the single backend import point avoids touching every
// service when a DTO moves between layers.
export * from '../../../shared/types.js';
