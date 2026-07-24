/** churchName is chosen by whoever self-serve-founds a church — never trust it as HTML. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inviteEmailHtml(churchName: string, link: string) {
  return `<p>You have been invited to join ${escapeHtml(churchName)} on Koru.</p>
<p><a href="${link}">${link}</a></p>
<p>This invitation expires in 7 days. If you weren't expecting it, ignore this email.</p>`;
}
