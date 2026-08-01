import { Link, Text } from '@react-email/components';
import { Layout } from './layout.js';

type ResetPasswordEmailProps = {
  url: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
};

export function ResetPasswordEmail({
  url,
  logoUrl,
  supportEmail,
  supportPhone,
}: ResetPasswordEmailProps) {
  return (
    <Layout logoUrl={logoUrl} supportEmail={supportEmail} supportPhone={supportPhone}>
      <Text>Someone requested a password reset for your Koru account.</Text>
      <Link href={url}>{url}</Link>
      <Text>If you didn't request this, ignore this email — your password will not change.</Text>
    </Layout>
  );
}
