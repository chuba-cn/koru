import { Text } from '@react-email/components';
import { Layout } from './layout.js';

type WelcomeEmailProps = {
  churchName: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
};

export function WelcomeEmail({
  churchName,
  logoUrl,
  supportEmail,
  supportPhone,
}: WelcomeEmailProps) {
  return (
    <Layout logoUrl={logoUrl} supportEmail={supportEmail} supportPhone={supportPhone}>
      <Text>Welcome to Koru! {churchName} is now set up and ready to go.</Text>
      <Text>
        You're set as the founding super_admin, you can invite the rest of your team next.
      </Text>
    </Layout>
  );
}
