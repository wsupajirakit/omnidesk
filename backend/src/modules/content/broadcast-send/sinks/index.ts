/**
 * Sink implementations. The CONTRACT lives one level up in `chunk-sink.ts`,
 * because it is part of what `broadcast-send` promises; these are the things
 * that satisfy it, and there are now enough of them to deserve a folder.
 */
export * from './dry-run.sink';
export * from './inline.sink';
