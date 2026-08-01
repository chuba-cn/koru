import { render } from '@react-email/render';
import { InviteEmail } from './invite-email.js';
import { ResetPasswordEmail } from './reset-password-email.js';
import { StaffRemovedEmail } from './staff-removed-email.js';
import { VerificationEmail } from './verification-email.js';
import { WelcomeEmail } from './welcome-email.js';

type BrandProps = { logoUrl: string; supportEmail: string; supportPhone: string };

export async function renderVerificationEmail(url: string, brand: BrandProps) {
  return render(<VerificationEmail url={url} {...brand} />);
}

export async function renderResetPasswordEmail(url: string, brand: BrandProps) {
  return render(<ResetPasswordEmail url={url} {...brand} />);
}

export async function renderInviteEmail(churchName: string, link: string, brand: BrandProps) {
  return render(<InviteEmail churchName={churchName} link={link} {...brand} />);
}

export async function renderWelcomeEmail(churchName: string, brand: BrandProps) {
  return render(<WelcomeEmail churchName={churchName} {...brand} />);
}

export async function renderStaffRemovedEmail(churchName: string, brand: BrandProps) {
  return render(<StaffRemovedEmail churchName={churchName} {...brand} />);
}
