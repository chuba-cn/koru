# Paystack subaccounts + pay-with-transfer for routing and reconciliation

Each Church bank account is registered as a Paystack subaccount (a Settlement Account), and every
online Payment uses pay-with-transfer: Paystack issues a one-time virtual account stamped with
member/campaign metadata, and the `charge.success` webhook auto-reconciles the Payment and routes
settlement to the correct branch account. Chosen over permanent per-Member Dedicated Virtual
Accounts (simpler routing, no account sprawl) and over manual bank-statement reconciliation (the
exact pain KORU eliminates). Consequence: money movement is locked to Paystack, and webhook
idempotency becomes load-bearing.
