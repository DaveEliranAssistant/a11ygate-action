export const MARKER = '<!-- a11ygate -->';

const MAX_COMMENT_LENGTH = 65_000;

export function buildCommentBody(markdown) {
  const trimmed = String(markdown ?? '').trim();
  const body = `${MARKER}\n${trimmed}\n`;
  if (body.length <= MAX_COMMENT_LENGTH) return body;
  const note = '\n\n_Summary truncated to fit the GitHub comment limit._\n';
  const room = MAX_COMMENT_LENGTH - MARKER.length - note.length - 1;
  return `${MARKER}\n${trimmed.slice(0, Math.max(0, room))}${note}`;
}

export function findA11yComment(comments) {
  if (!Array.isArray(comments)) return null;
  for (const comment of comments) {
    if (!comment || typeof comment.body !== 'string' || typeof comment.id !== 'number') continue;
    if (comment.body.includes(MARKER)) return comment;
  }
  return null;
}
