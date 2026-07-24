export function verificationEmailHtml(url: string) {
  return `<p>Welcome to Koru. Click the link below to verify your email address:</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't create this account, ignore this email.</p>`;
}

export function resetPasswordEmailHtml(url: string) {
  return `<p>Someone requested a password reset for your Koru account.</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, ignore this email — your password will not change.</p>`;
}
