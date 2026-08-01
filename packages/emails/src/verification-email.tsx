import { Link, Text } from '@react-email/components';
import { Layout } from './layout.js';

type VerificationEmailProps = {
  url: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
};

export function VerificationEmail({
  url,
  logoUrl,
  supportEmail,
  supportPhone,
}: VerificationEmailProps) {
  return (
    <Layout logoUrl={logoUrl} supportEmail={supportEmail} supportPhone={supportPhone}>
      <Text>Welcome to Koru. Click the link below to verify your email address:</Text>
      <Link href={url}>{url}</Link>
      <Text>If you didn't create this account, ignore this email.</Text>
    </Layout>
  );
}
