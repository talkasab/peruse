---
type: Data Structure
title: Imaging Problem List
description: A patient's observations grouped by finding, with fields, grouping rules, computed status, and planned FHIR encoding.
tags: [data-structures, imaging-problem-list, anatomic-location, fhir]
status: draft
generated: { by: codex/gpt-6, at: 2026-09-21T20:34:50Z }
sources:
  - id: ipl-main
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/06f64a7893b444b761dc069ed86140a081195eac/README.md
    title: imaging-problem-list README, main branch, the stable specification
  - id: ipl-main-claude
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/06f64a7893b444b761dc069ed86140a081195eac/CLAUDE.md
    title: imaging-problem-list domain model notes, main branch
  - id: ipl-claude-dev
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/36fa30c7383bf687d7bc17815282a93e123a56cb/CLAUDE.md
    title: imaging-problem-list domain model notes, dev branch
  - id: ipl-sample
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/36fa30c7383bf687d7bc17815282a93e123a56cb/sample_data/example2/MRN0000001_ipl.json
    title: MRN0000001_ipl.json, the anatomy-grouped Imaging Problem List sample, dev branch
  - id: ipl-script
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/36fa30c7383bf687d7bc17815282a93e123a56cb/scripts/generate_ipl_from_efls.py
    title: generate_ipl_from_efls.py, the Imaging Problem List generator, dev branch
  - id: viewer-app
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/36fa30c7383bf687d7bc17815282a93e123a56cb/viewer/app.js
    title: viewer/app.js, the temporal status derivation, dev branch
  - id: ipl-diagram
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/06f64a7893b444b761dc069ed86140a081195eac/imaging-problem-list-process.png
    title: imaging-problem-list-process.png, the pipeline diagram in the README
  - id: anat-rules
    resource: https://github.com/openimagingdata/imaging-problem-list/blob/36fa30c7383bf687d7bc17815282a93e123a56cb/docs/anatomic-location-assignment-rules.md
    title: Anatomic location assignment rules, imaging-problem-list dev branch
  - id: deck
    resource: https://gamma.app/docs/Open-Imaging-Data-Model-2026-Status-Update:-Realizing-Object-Oriented-Imaging-Results-yfxzx4q9zssafal
    title: "Open Imaging Data Model 2026 Status Update, January 2026"
---

# Definition

"In the context of a patient, the list of findings that have been described as present/absent in exams of the patient."[^ipl-main] An [Imaging Problem List](/glossary/imaging-problem-list.md) groups [observations](/data-structures/observation.md) from a patient's [Exam Finding Lists](/data-structures/exam-finding-list.md) by finding. It is the third level of [the hierarchy](/data-structures/hierarchy.md).

Grouping by finding allows a lookup for the deck's core query: "was finding X present on the most recent study?"[^deck]

# Fields

| Field | Type | Notes |
|---|---|---|
| `$schema` | URL string | points at `http://example.com/schemas/imaging_problem_list.json`; nothing is published there |
| `patient.id` | string | medical record number |
| `patient.name` | string | display name |
| `patient.dob` | date string | birth date |
| `findings[]` | array | one entry per grouped finding |
| `findings[].id` | string | identity within this list, for example `ipl-finding-116`. This, not the finding code, is the stable key.[^ipl-claude-dev] |
| `findings[].finding_type_code` | `OIFM_[A-Z]{3,4}_[0-9]{6}` | the [OIFM](/glossary/oifm.md) identifier |
| `findings[].finding_type_display` | string | the finding model's display name |
| `findings[].anatomicLocation` | `{locationId, locationDisplay}` | **development branch only**; the second half of the grouping key |
| `findings[].observations[]` | array | every time this finding was documented, oldest first |
| `observations[].report_id` | UUID string | the `diagnosticReportId` of the source Exam Finding List |
| `observations[].observation_id` | string | the `observationId` within that list |
| `observations[].exam_date` | date string | from the source exam's `studyDateTime` |
| `observations[].exam_type_code` | [LOINC](/glossary/loinc.md) code | from the source exam header |
| `observations[].exam_type_display` | string | exam display name |
| `observations[].presence` | string | `present`, `absent`, or `indeterminate` in the sample data, flattened from the source attribute code and value code pair |
| `observations[].anatomicLocation` | `{locationId, locationDisplay}` | **development branch only**; repeats the finding's location |
| `observations[].reportText` | string | the verbatim span, carried through so the timeline reads without fetching the source exams |

The problem list uses snake_case for its own fields and retains camelCase for fields copied from the Exam Finding List. Thus `finding_type_code` and `anatomicLocation` share an object. See two worked entries in [the Imaging Problem List example](/references/imaging-problem-list-example.md).

# The grouping key

The stable branch groups by finding code. The development branch pairs that code with the [anatomic location](/glossary/anatomic-location.md) identifier. Its domain notes explain:

> Groups observations by finding type **and** anatomic location (`locationId`) across exams, preserving references to each source report, so one finding code at distinct sites (e.g. ascending vs. abdominal aortic aneurysm) yields separate entries; consumers key on the IPL finding `id`, not `finding_type_code`.[^ipl-claude-dev]

The generator uses this tuple, grouping observations without a location under a null location.[^ipl-script]

The same ten exams for one synthetic patient produce 98 entries grouped by code alone and 123 grouped by code and location.[^ipl-sample] The observation count is unchanged.

Consumers key on `id` because a finding code is no longer unique within a list.

# Temporal status

The viewer computes each finding's status from its observations at display time. The file has no status field.[^viewer-app]

1. No observations gives **Unknown**.
2. Sort the observations by exam date, most recent first.
3. If the most recent is `present`, every observation is `present`, and there is more than one, the status is **Always**.
4. If the most recent is `present` otherwise, the status is **Current**.
5. If the most recent is not `present` but some earlier observation was, the status is **Resolved**.
6. If no observation was ever `present`, the status is **Never**.

The viewer groups and filters findings by those four statuses.

A finding with only absent observations records that it was checked for on specific exams and not found. A finding missing from the list carries no such record.

The stable branch's prose describes an older model with three states: Present, Resolved, and Not Present or Ruled Out.[^ipl-main-claude] That wording is stale relative to the code on both branches, which computes four. See [the Imaging Problem List glossary entry](/glossary/imaging-problem-list.md) for the discrepancy.

# What the structure is for

The deck lists these properties and a demonstration.[^deck]

- Organized by finding, meaning pathology, rather than by chronology. The grouping key implements this.
- Filtering through anatomy-embedded definitions. The development branch's grouping key and viewer support this.
- Tracking appearance, disappearance, and change. Computed status provides an initial implementation. Measurement trends over time are not modelled.
- A public demonstration at `imaging-problem-list.pages.dev`.

See [Imaging Persona](/data-structures/imaging-persona.md) for uses such as protocoling and passive screening that need context beyond imaging results.

# The pipeline diagram

The README's hand-drawn `imaging-problem-list-process.png` shows Report 1 through Report n feeding an Extractor, drawn as a neural network.[^ipl-diagram] A database labelled "Findings (CDE 'stub' defs)" also feeds the Extractor. Its Findings Lists feed an Assembler, also drawn as a neural network, which produces the Imaging Problem List.

Four output cards list observations by dated exam: Pulmonary Nodule, Pulmonary Apical Scarring, Subsegmental Atelectasis, and Pleural Effusion. Pulmonary Nodule shows "Chest CT 2020-11-23 (x8)", combining repeated findings into one row. Pleural Effusion has five rows, four marked "(absent)". The list also retains findings whose entire history records absence.

The diagram depicts a learned Assembler, but `generate_ipl_from_efls.py` uses deterministic aggregation.[^ipl-script]

# FHIR

The documented encoding is "**Report** containing a list of **Condition** objects (labeled with the finding identifier), where each Condition object also contains a list of **Observation** objects which document which exams (**DiagnosticReports**) the finding type has been documented on, including the exam date and exam type (LOINC type)."[^ipl-main] One [FHIR Condition](/glossary/fhir-condition.md) per problem list entry, with the observation trail underneath it.

The mapping is unimplemented. No code in the repository produces a Condition resource. Its container is called a "Report," which is not a FHIR resource name. See [FHIR mapping](/data-structures/fhir-mapping.md).

# Known limitation

Exact location matching splits a problem described at different levels of detail across exams. The assignment rules state:

> Parent/child or generic-vs-specific pairs for the *same finding code across exams* (e.g. "lung" vs "lower lobe of right lung"; "kidney" vs "left kidney") still produce separate IPL groups. Deciding whether such observations are the same problem or distinct is the **anatomic-compatibility reconciliation** step.[^anat-rules]

The anatomic location plan names this step, but work has not started. See [anatomic location assignment rules](/data-structures/anatomic-location-assignment-rules.md) for precedence, laterality, and specificity rules.

# How it is produced

`generate_ipl_from_efls.py` reads `*_efl.json` files sorted by filename to follow chronology. It takes the first file's patient block, groups findings by the key above, and writes one `ipl.json` without model calls.[^ipl-script] See the [Imaging Problem List viewer](/applications/imaging-problem-list-viewer.md) and its [sample data](/data-structures/sample-data.md).

[^ipl-main]: imaging-problem-list README, main branch
[^ipl-main-claude]: imaging-problem-list domain model notes, main branch
[^ipl-claude-dev]: imaging-problem-list domain model notes, dev branch
[^ipl-sample]: MRN0000001_ipl.json, dev branch
[^ipl-script]: generate_ipl_from_efls.py, dev branch
[^viewer-app]: viewer/app.js, the temporal status derivation, dev branch
[^ipl-diagram]: imaging-problem-list-process.png, the pipeline diagram
[^anat-rules]: Anatomic location assignment rules, dev branch
[^deck]: "Open Imaging Data Model 2026 Status Update", January 2026
