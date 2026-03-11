## ADDED Requirements

### Requirement: Delete observation by ID
The system SHALL export a `deleteObservation()` function from `observation-store.ts` that deletes a single row from the LanceDB observations table by its `id` field.

#### Scenario: Delete existing observation
- **WHEN** `deleteObservation(store, "a3f08c2b")` is called with a valid ID
- **THEN** the row with `id = 'a3f08c2b'` is removed from the table

#### Scenario: Delete nonexistent ID
- **WHEN** `deleteObservation(store, "nonexistent")` is called with an ID that does not exist
- **THEN** the function completes without error (no-op)

#### Scenario: Delete with unavailable store
- **WHEN** `deleteObservation()` is called and the store is not available
- **THEN** the function returns without error

### Requirement: Update observation fields by ID with re-embedding
The system SHALL export an `updateObservation()` function from `observation-store.ts` that updates specified fields of a single row identified by its `id`. Updatable fields SHALL be: `title`, `narrative`, and `concepts` (as JSON array string). Other fields (id, session_id, project, type, timestamp, tool_name, facts, files_read, files_modified) SHALL NOT be updatable through this function.

When `narrative` is updated and the row's `type` is `summary` or `manual` (types that carry embedding vectors), the function SHALL recompute the embedding vector using `store.embed()` and update the `vector` column. If `store.embed` is null (no embedding provider configured), the vector SHALL remain unchanged.

#### Scenario: Update title only
- **WHEN** `updateObservation(store, "a3f08c2b", { title: "New title" })` is called
- **THEN** the row's `title` field is updated to "New title" and the vector is NOT recomputed

#### Scenario: Update narrative triggers re-embedding for summary
- **WHEN** `updateObservation(store, "a3f08c2b", { narrative: "Updated content" })` is called and the row's type is "summary"
- **THEN** the row's `narrative` field is updated AND a new embedding vector is computed from "Updated content" and stored in the `vector` column

#### Scenario: Update narrative triggers re-embedding for manual
- **WHEN** `updateObservation(store, "a3f08c2b", { narrative: "Updated manual note" })` is called and the row's type is "manual"
- **THEN** the row's `narrative` field is updated AND a new embedding vector is computed and stored

#### Scenario: Update narrative does NOT re-embed for observation type
- **WHEN** `updateObservation(store, "a3f08c2b", { narrative: "Updated text" })` is called and the row's type is "observation"
- **THEN** the row's `narrative` field is updated but the vector column is NOT changed (observations use zero vectors)

#### Scenario: Update narrative without embedding provider
- **WHEN** `updateObservation(store, "a3f08c2b", { narrative: "Updated content" })` is called and `store.embed` is null
- **THEN** the row's `narrative` is updated but the vector remains unchanged

#### Scenario: Update multiple fields
- **WHEN** `updateObservation(store, "a3f08c2b", { title: "New title", narrative: "New text" })` is called
- **THEN** both the `title` and `narrative` fields are updated (and re-embedding occurs if applicable)

#### Scenario: Update with unavailable store
- **WHEN** `updateObservation()` is called and the store is not available
- **THEN** the function returns without error

### Requirement: List observations with pagination and filtering
The system SHALL export a `listObservations()` function from `observation-store.ts` that returns rows from the observations table with support for pagination (limit/offset), type filtering, project filtering, and sort order (newest-first or oldest-first). The function SHALL return `IndexResult[]` with the same compact fields as `ftsSearch`.

#### Scenario: List recent observations
- **WHEN** `listObservations(store, { project: "my-app", limit: 100, offset: 0, order: "desc" })` is called
- **THEN** the function returns the 100 most recent rows for project "my-app" sorted by timestamp descending

#### Scenario: List with type filter
- **WHEN** `listObservations(store, { project: "my-app", type: "summary", limit: 50 })` is called
- **THEN** only rows with `type = 'summary'` are returned

#### Scenario: Paginate results
- **WHEN** `listObservations(store, { project: "my-app", limit: 100, offset: 100 })` is called
- **THEN** rows 101-200 are returned (skipping the first 100)

#### Scenario: List with empty store
- **WHEN** `listObservations()` is called and the store has no data
- **THEN** an empty array is returned

### Requirement: Count observations
The system SHALL export a `countObservations()` function from `observation-store.ts` that returns the total number of rows matching the given filters (project, type). This is used for displaying totals in the browser header without loading all rows.

#### Scenario: Count all observations for a project
- **WHEN** `countObservations(store, { project: "my-app" })` is called
- **THEN** the function returns the total number of rows for that project

#### Scenario: Count with type filter
- **WHEN** `countObservations(store, { project: "my-app", type: "observation" })` is called
- **THEN** the function returns only the count of observation-type rows

#### Scenario: Count with unavailable store
- **WHEN** `countObservations()` is called and the store is not available
- **THEN** the function returns 0

### Requirement: Get single observation by ID with full details
The system SHALL export a `getObservationById()` function from `observation-store.ts` that returns a single `FullResult` for a given ID, or `null` if not found. This is a convenience wrapper over `getObservationsByIds()` for single-item lookups.

#### Scenario: Get existing observation
- **WHEN** `getObservationById(store, "a3f08c2b")` is called with a valid ID
- **THEN** the function returns the full observation details

#### Scenario: Get nonexistent observation
- **WHEN** `getObservationById(store, "nonexistent")` is called
- **THEN** the function returns `null`

### Requirement: Get observation row type by ID
The system SHALL export a `getObservationType()` function from `observation-store.ts` that returns the `type` field for a given row ID, or `null` if not found. This is needed by `updateObservation()` to determine whether re-embedding is required.

#### Scenario: Get type for existing row
- **WHEN** `getObservationType(store, "a3f08c2b")` is called for a summary row
- **THEN** the function returns `"summary"`

#### Scenario: Get type for nonexistent row
- **WHEN** `getObservationType(store, "nonexistent")` is called
- **THEN** the function returns `null`
