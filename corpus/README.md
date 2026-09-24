# Test corpus

**Public or self-made PDFs only** (CLAUDE.md rule 13, ARCHITECTURE.md §11). Never company or
client documents, and never copyrighted standards (ASME, ISO, …).

- Downloaded PDFs are git-ignored (`corpus/files/`). [`manifest.json`](manifest.json) lists each
  file's public source URL, license/public-domain status and SHA-256; `npm run corpus` fetches
  them and verifies or prints the hash.
- Contract profile: US-government public-domain documents (e.g. the Federal Acquisition
  Regulation, ~2,000 pages).
- Very large contract (~500 MB) and dense P&ID drawings: tested by the owner with local files;
  not stored or generated here.
- Owner-supplied CAD drawings (publicly available, but copyright not clearly public domain) live
  only in `corpus/files/drawings/` on the owner's machine. **No URLs or files are committed**
  (ADR-002).
