# @lutealark/contracts

Transport-level TypeScript contracts shared by the browser and backend.
Schemas that validate untrusted input remain in `backend/src/contracts`; they
must stay structurally compatible with these types. All imports from this
package should currently use `import type` so no browser or server runtime is
coupled to the source package.
