# Oddmash Impact

Oddmash Impact is an independent advisory agent in the existing reviewer service. A maintainer requests an assessment by commenting `@oddmash-reviewer[bot] /impact` in a pull request conversation. It does not run automatically, approve changes, request changes, or affect merge eligibility. It reuses the existing signed delivery, repository-scoped authorization, queue, and configured model.

Impact assesses user value, product fit, maintenance cost, risks, and missing evidence. It reads bounded, filtered changed-file evidence and PR context. It posts one bilingual advisory per PR, refreshes it on a new head or base, and does not repeat a completed assessment for the same revision. Incomplete coverage forces an insufficient-evidence recommendation. It does not execute contributor code, access repository secrets, or send excluded protected files to the model. Usage is recorded as a distinct impact phase.

The GitHub author remains `oddmash-reviewer[bot]`. A separate `oddmash-impact[bot]` identity would require a separately registered and installed GitHub App with its own signing secret and private key. It can use the same Vercel project and queue, but must have only the permissions needed to read and comment. Do not enable a second app until its identity and authorization are configured and verified independently.
