# Campaign scoping via a single scope on one Campaign entity

A Campaign carries a `scope_type` (church | region | branch) plus a `scope_ref`, rather than
modelling church-wide, regional, and branch campaigns as separate entities or join tables. One
engine serves all three reaches; a Member sees a Campaign when their home Branch falls within its
scope. Chosen over per-level tables to keep campaign logic uniform, at the cost of a small amount
of scope-resolution logic when listing a Member's campaigns.
