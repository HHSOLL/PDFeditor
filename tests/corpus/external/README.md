# External Corpus Manifest

This directory is a manifest location for real-world PDFs that cannot always be
committed because of copyright, privacy, or customer-data restrictions.

Do not add private PDFs directly to the repository. Instead, record:

- Corpus ID
- Source or generation instructions
- License/privacy status
- Feature assertion protected
- Expected open/render/export/reopen behavior
- Manual compatibility status for Acrobat, Preview, Chrome, and Edge

## Required Before External 90+ Claim

At least 100 corpus entries are required across the categories below.

| Category | Minimum Count | Status |
| --- | ---: | --- |
| Acrobat-created / Acrobat-edited PDFs | 10 | Pending |
| macOS Preview annotated PDFs | 8 | Pending |
| Chrome/Edge print-to-PDF outputs | 8 | Pending |
| Office Word/PowerPoint/Excel exports | 12 | Pending |
| Government, contract, invoice, bank/tax forms | 15 | Pending |
| Scanned Korean and English PDFs | 10 | Pending |
| CJK, emoji, RTL text PDFs | 8 | Pending |
| Signed/encrypted PDFs | 8 | Pending |
| AcroForm/XFA PDFs | 8 | Pending |
| Annotation/image/vector/table-heavy PDFs | 10 | Pending |
| PDF/A/PDF/X/tagged/accessibility PDFs | 8 | Pending |
| Hidden-data, OCG, JS/action, embedded-file PDFs | 8 | Pending |
| Malformed-but-openable and large 100/300/500/1000-page PDFs | 7 | Pending |

## Entry Template

```md
### EXT-000

- Source:
- License/privacy:
- Stored path or retrieval command:
- Protected assertion:
- Expected result:
- Automated smoke:
- Acrobat:
- Preview:
- Chrome:
- Edge:
- Notes:
```
