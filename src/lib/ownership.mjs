/** Compare user_id on a row to req.user.Id (Postgres bigint vs string-safe). */
export function userOwnsRow(row, user) {
  if (!row || user?.Id == null) return false;
  return String(row.user_id) === String(user.Id);
}
