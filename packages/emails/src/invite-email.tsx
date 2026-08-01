import { Link, Text } from '@react-email/components';
import { Layout } from './layout.js';

type InviteEmailProps = {
  churchName: string;
  link: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
};

export function InviteEmail({
  churchName,
  link,
  logoUrl,
  supportEmail,
  supportPhone,
}: InviteEmailProps) {
  return (
    <Layout logoUrl={logoUrl} supportEmail={supportEmail} supportPhone={supportPhone}>
      <Text>You have been invited to join {churchName} on Koru.</Text>
      <Link href={link}>{link}</Link>
      <Text>
        This invitation expires in 7 days. If you weren't expecting it, ignore this email.
      </Text>
    </Layout>
  );
}
