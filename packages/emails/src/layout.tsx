import { Body, Container, Head, Hr, Html, Img, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { BRAND_ACCENT, BRAND_DARK } from './colors.js';

type LayoutProps = {
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
  children: ReactNode;
};

export function Layout({ logoUrl, supportEmail, supportPhone, children }: LayoutProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'sans-serif', backgroundColor: '#f6f6f6', padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '8px',
            borderTop: `4px solid ${BRAND_ACCENT}`,
          }}
        >
          <table role="presentation" cellPadding={0} cellSpacing={0}>
            <tr>
              <td style={{ verticalAlign: 'middle', paddingRight: '8px' }}>
                <Img src={logoUrl} width="28" height="28" alt="Koru" />
              </td>
              <td style={{ verticalAlign: 'middle' }}>
                <Text
                  style={{ fontSize: '20px', fontWeight: 'bold', color: BRAND_DARK, margin: 0 }}
                >
                  Koru
                </Text>
              </td>
            </tr>
          </table>
          {children}
          <Hr />
          <Text style={{ fontSize: '12px', color: '#666666' }}>
            Need help? Contact us at {supportEmail} or {supportPhone}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
