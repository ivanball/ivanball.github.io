# Guides & Specifications

The narrative documentation for the MMCA platform: adoption guides, business specifications, workflow analyses, and per-concern reference notes. Files are prefixed by the repo they describe (common = the framework, store = the e-commerce app, adc = the conference app).

## Framework (MMCA.Common)

- [Getting Started](common-GETTING-STARTED.md): stand up a new application from the `MMCA.Templates` scaffold, in six steps.
- [Small Apps](common-SMALL-APPS.md): the `--database sqlite --no-aspire` floor (no Docker, no SQL Server, no orchestrator), what is deliberately off in it, and when to flip each switch.
- [Build MMCA.ECommerce](common-ECOMMERCE-SAMPLE.md): the two-module store sample (Products + Orders) built end to end from the templates, with the minimum hand-written code.
- [Templates](common-TEMPLATES.md): every parameter of `mmca-app`, `mmca-module`, `mmca-command`, and `mmca-query`.
- [Building by Hand](common-BUILD-BY-HAND.md): the same solution phase by phase, for retrofitting an existing solution or understanding what the scaffold generated (MMCA.Helpdesk is the worked companion).
- [Versioning & Breaking-Change Policy](common-VERSIONING.md)
- [Accessibility](common-ACCESSIBILITY.md)
- [Resilience & Business Continuity](common-RESILIENCE.md)
- [Responsive Design & Cross-Browser Support](common-RESPONSIVE.md)
- [Cost & FinOps Notes](common-COST.md)

## MMCA.Store (e-commerce)

- [Business Specification](store-Specification.md)
- [Business Workflow Analysis](store-BusinessWorkflows.md)
- [Navigation Flow](store-NavigationFlow.md)
- [Manual Screen-Reader Pass Runbook](store-ACCESSIBILITY-SCREENREADER-PASS.md)

## MMCA.ADC (conference)

- [Business Specifications](adc-specifications.md)
- [Navigation Flow](adc-NavigationFlow.md)
- [Manual Screen-Reader Pass Runbook](adc-ACCESSIBILITY-SCREENREADER-PASS.md)
- [Integration-Test Tier Rework Plan](adc-IntegrationTestReworkPlan.md)

Related reading: the [Architecture Decision Records](../adr/README.md) and the [governance scorecards](../governance/README.md).
