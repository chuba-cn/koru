import { Text } from '@react-email/components';
import { Layout } from './layout.js';

type StaffRemovedEmailProps = {
  churchName: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
};

export function StaffRemovedEmail({
  churchName,
  logoUrl,
  supportEmail,
  supportPhone,
}: StaffRemovedEmailProps) {
  return (
    <Layout logoUrl={logoUrl} supportEmail={supportEmail} supportPhone={supportPhone}>
      <Text>You have been removed as staff at {churchName} on Koru.</Text>
      <Text>If you believe this is a mistake, contact an administrator at {churchName}.</Text>
    </Layout>
  );
}
