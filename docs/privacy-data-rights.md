# Privacy and data-rights operations

This runbook is for the operator of a Vibesboard deployment. It describes an
operational process; obtain legal advice appropriate to the jurisdictions and
processing activities for your deployment.

## Before accepting real users

- Set `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ADDRESS`, and `LEGAL_CONTACT_EMAIL`.
  Set the other `LEGAL_*` values that apply to your organisation so that the
  public privacy policy identifies the data controller and a privacy contact.
- Define and document retention periods for accounts, conversations, uploaded
  knowledge, logs, backups, and billing records. Configure third-party
  integrations and model providers consistently with those periods.
- Maintain a record of subprocessors, their processing locations, and the data
  they receive. Put required data-processing agreements and transfer safeguards
  in place before enabling them.
- Assign a trained owner for privacy requests and keep an internal request log
  with the request date, identity checks, scope, outcome, and any refusal
  rationale.

## Handling an access, export, correction, or deletion request

1. Receive requests through the published privacy contact and acknowledge them.
2. Verify the requester’s identity and authority for the account or workspace.
   Do not disclose data merely because someone knows an email address.
3. Determine whether the operator is acting as controller or processor. For
   tenant content, the workspace customer may be the controller; route the
   request to them when appropriate and assist under the applicable agreement.
4. Identify data in the account, workspaces, conversations, knowledge uploads,
   inbound channels, support records, audit/security logs, and connected
   providers. Include a statement of any applicable retention or legal hold.
5. Complete the request within the legal timeframe that applies to the
   deployment, or explain a lawful extension/refusal. Use a portable,
   structured format for exports where required.
6. For deletion, remove application data using the product’s ownership-aware
   controls, revoke any connected integrations where appropriate, and record
   backup expiry rather than attempting to mutate immutable backups. Send
   corresponding requests to processors when required.
7. Record what was completed, what remains retained and why, and notify the
   requester through a verified contact channel.

## Deletion callback for Meta products

`POST /api/meta/data-deletion` accepts Meta’s signed deletion callback. Keep
the `META_APP_SECRET` configured, retain the confirmation identifier supplied
to Meta, and follow up on the referenced user data under the process above.

## Incident handling

Treat a suspected personal-data breach as a security incident: contain it,
preserve evidence, assess the affected data and people, engage counsel or the
privacy lead, and make notifications required by the applicable law and
contracts.
