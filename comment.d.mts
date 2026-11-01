export const MARKER: string;

export function buildCommentBody(markdown: string): string;

export function findA11yComment(
  comments: ReadonlyArray<{ id?: unknown; body?: unknown } | null>,
): { id: number; body: string } | null;
