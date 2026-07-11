# Server-Sent Events for live progress, not WebSockets or a sync engine

Live Campaign progress (the public display and staff dashboards) is pushed from NestJS via
Server-Sent Events. KORU's real-time needs are one-directional and modest, so SSE is sufficient
and far simpler than WebSockets or adopting a reactive backend like Convex (see system-wide
ADR-0002). Reconsider WebSockets only if a genuinely bidirectional feature appears.
